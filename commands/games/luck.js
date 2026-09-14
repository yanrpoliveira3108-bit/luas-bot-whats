'use strict';

const games = require('../../database/games');

module.exports = [
  {
    name: 'dado',
    commands: ['dado', 'dice', 'rolar'],
    category: 'games',
    description: 'Rola um dado (ou vários).',
    usage: '!dado [faces] [quantidade]',
    cooldown: 2000,
    execute: async (ctx) => {
      const faces = Math.min(100, Math.max(2, parseInt(ctx.args[0], 10) || 6));
      const qty = Math.min(5, Math.max(1, parseInt(ctx.args[1], 10) || 1));
      const rolls = Array.from({ length: qty }, () => 1 + Math.floor(Math.random() * faces));
      games.recordGame(ctx.sender, 'dado', 'win');
      await ctx.reply(`🎲 Dado${qty > 1 ? 's' : ''} (d${faces}): ${rolls.join(' • ')}${qty > 1 ? `\n▸ Soma: ${rolls.reduce((a, b) => a + b, 0)}` : ''}`);
    },
  },
  {
    name: 'moeda',
    commands: ['moeda', 'coinflip', 'caraoucoroa'],
    category: 'games',
    description: 'Joga uma moeda (cara ou coroa).',
    usage: '!moeda',
    cooldown: 2000,
    execute: async (ctx) => {
      const result = Math.random() < 0.5 ? '🪙 *CARA*' : '🪙 *COROA*';
      games.recordGame(ctx.sender, 'moeda', 'win');
      await ctx.reply(`Girando a moeda...\n▸ ${result}!`);
    },
  },
];
