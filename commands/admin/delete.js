'use strict';

/**
 * commands/admin/delete.js — `!d` apaga SOMENTE a mensagem marcada.
 *
 * Pedido do dono (25/09/2026): "crie o comando {prefix}d para apagar somente a
 * mensagem marcada".
 *
 * Regras (as mesmas do `!apagar`, centralizadas em commands/_shared/apagarMsg.js):
 *   • DONO   → apaga qualquer mensagem;
 *   • ADMIN  → apaga qualquer mensagem do grupo;
 *   • MEMBRO → apaga somente a própria mensagem marcada;
 *   • sem mensagem marcada → apaga a última mensagem da própria pessoa (se ela
 *     ainda estiver no histórico do bot).
 *
 * Diferença para o `!apagar`: o `d` NUNCA apaga histórico/em lote — sempre UMA
 * mensagem (a marcada ou a última do alvo).
 */

const { apagarMarcada, apagarUltima, apagarUltimaOuAviso } = require('../_shared/apagarMsg');

module.exports = [
  {
    name: 'd',
    commands: ['d', 'del', 'apagarmsg', 'deletarmsg'],
    category: 'admin',
    groupOnly: false,
    // NÃO é adminOnly de propósito: membro comum pode apagar a PRÓPRIA mensagem.
    // A permissão é decidida em cada caso (commands/_shared/apagarMsg.js).
    description: 'Apaga a mensagem que você marcou (respondeu). Membro apaga a própria; admin apaga qualquer uma.',
    usage: '!d (respondendo/citando a mensagem) | !d @user (admin: última do usuário)',
    cooldown: 1500,
    execute: async (ctx) => {
      // com marcação de usuário: admin/dono apaga a última daquele usuário
      const alvo =
        (ctx.mentionedJid && ctx.mentionedJid[0]) ||
        (ctx.quotedKey && ctx.quotedKey.participant) ||
        null;

      if (ctx.quotedKey) {
        const r = await apagarMarcada(ctx);
        return ctx.reply(r.resposta);
      }

      if (alvo && (ctx.isOwner || (ctx.isGroup && ctx.isAdmin))) {
        const r = await apagarUltima(ctx, alvo);
        return ctx.replyWithMentions(r.resposta, [alvo]);
      }

      if (alvo) {
        return ctx.reply(
          '🚫 Você só pode apagar *suas próprias* mensagens.\n' +
            `▸ Responda (cite) a sua mensagem e mande ${ctx.prefix}d`
        );
      }

      // nada marcado: membro apaga a última dele; admin/dono recebem a instrução
      // (admin apaga qualquer mensagem — não pode perder a dele por engano)
      const r = await apagarUltimaOuAviso(ctx);
      return ctx.reply(r.resposta);
    },
  },
];
