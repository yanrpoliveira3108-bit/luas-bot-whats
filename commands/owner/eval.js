'use strict';

const vm = require('vm');
const CONFIG = require('../../config');
const { withTimeout } = require('../../utils/resilience');

/** Um loop síncrono não pode ser interrompido depois de entregue ao event loop. */
const EVAL_SYNC_TIMEOUT_MS = 5000;
const EVAL_TOTAL_TIMEOUT_MS = 15000;
const { confirmAction } = require('../_shared/confirm');
const logger = require('../../utils/logger').child('eval');

module.exports = [
  {
    name: 'eval',
    commands: ['eval', 'exec'],
    category: 'owner',
    ownerOnly: true,
    description: 'Executa código JavaScript (APENAS dono).',
    usage: '!eval <código>',
    cooldown: 5000,
    execute: async (ctx) => {
      if (!CONFIG.limits.evalEnabled) {
        await ctx.reply('🔒 O !eval está desabilitado. Defina ENABLE_EVAL=true no .env para habilitar.');
        return;
      }
      const code = ctx.args.join(' ');
      if (!code) {
        await ctx.reply('⚠️ Envie o código junto: !eval 1 + 1');
        return;
      }
      await confirmAction(ctx, 'executar código no bot', async (c) => {
        try {
          // sandbox mínimo, restrito ao dono e com acesso explícito
          const sandbox = { require, console, process, CONFIG, ctx: c };
          // vm com timeout: while(true) do dono deixa de travar o bot inteiro
          let result = vm.runInNewContext(`(${code})`, sandbox, {
            timeout: EVAL_SYNC_TIMEOUT_MS,
            filename: 'lua-eval',
          });
          result = await withTimeout(Promise.resolve(result), EVAL_TOTAL_TIMEOUT_MS, 'eval');
          if (typeof result !== 'string') {
            result = require('util').inspect(result, { depth: 1, maxStringLength: 500 });
          }
          const out = String(result).slice(0, 1800);
          logger.warn({ user: c.sender }, 'eval executado');
          await c.reply(`🧪 *Resultado:*\n\`\`\`${out || '(sem retorno)'}\`\`\``);
        } catch (err) {
          await c.reply(`🧪 *Erro:*\n\`\`\`${String(err.message).slice(0, 800)}\`\`\``);
        }
      });
    },
  },
];
