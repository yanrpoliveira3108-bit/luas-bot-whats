'use strict';

const games = require('../../database/games');
const users = require('../../database/users');

module.exports = [
  {
    name: 'rankzueira',
    commands: ['rankzueira', 'topzueira'],
    category: 'fun',
    description: 'Ranking das interações (zueira).',
    usage: '!rankzueira',
    cooldown: 3000,
    execute: async (ctx) => {
      const { renderRanking } = require('../_shared/ranking');
      await ctx.reply(await renderRanking(ctx, 'zueira', 10));
    },
  },
  {
    name: 'karma',
    commands: ['karma'],
    category: 'fun',
    description: 'Mostra seu karma acumulado.',
    usage: '!karma [@usuario]',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0] || ctx.sender;
      const u = users.get(target);
      await ctx.reply(`⚖️ Karma de @${target.split('@')[0]}: *${u ? u.karma : 0}*`, { mentions: [target] });
    },
  },
];
