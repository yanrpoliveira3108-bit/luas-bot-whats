'use strict';

const { renderRanking, TYPES } = require('../_shared/ranking');

module.exports = [
  {
    name: 'ranking',
    commands: ['ranking'],
    category: 'rankings',
    description: 'Ranking geral (xp, mensagens, rpg, zueira, quiz, reputacao).',
    usage: '!ranking [tipo]',
    cooldown: 3000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || 'xp').toLowerCase();
      if (!TYPES[arg]) {
        return ctx.reply(`📊 Tipos de ranking: ${Object.keys(TYPES).join(', ')}.\nUso: !ranking <tipo>`);
      }
      await ctx.reply(await renderRanking(ctx, arg, 10));
    },
  },
];
