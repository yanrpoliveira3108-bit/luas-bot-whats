'use strict';

const { renderRanking, TYPES } = require('../_shared/ranking');

function buildShortcut(name, type, description) {
  return {
    name,
    commands: [name],
    category: 'rankings',
    description,
    usage: `!${name}`,
    cooldown: 3000,
    execute: async (ctx) => {
      await ctx.reply(await renderRanking(ctx, type, 10));
    },
  };
}

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
  // atalhos (mesmo renderer — nada duplicado)
  buildShortcut('topxp', 'xp', 'Top usuários por XP.'),
  buildShortcut('topnivel', 'level', 'Top usuários por nível (Lua Life).'),
  buildShortcut('topricho', 'dinheiro', 'Top usuários mais ricos (carteira).'),
  buildShortcut('topfazenda', 'fazenda', 'Top maiores fazendas (animais).'),
];
