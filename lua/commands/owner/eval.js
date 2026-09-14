'use strict';

const CONFIG = require('../../config');
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
          const fn = new Function(...Object.keys(sandbox), `return (${code})`);
          let result = await fn(...Object.values(sandbox));
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
