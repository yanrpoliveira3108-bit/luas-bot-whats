'use strict';

const users = require('../../database/users');
const { renderRanking, TYPES } = require('../_shared/ranking');

module.exports = [
  {
    name: 'rank',
    commands: ['rank'],
    category: 'members',
    description: 'Mostra sua posição no ranking de XP.',
    usage: '!rank',
    cooldown: 3000,
    execute: async (ctx) => {
      const top = users.top('xp', 1000);
      const idx = top.findIndex((u) => u.id === ctx.sender);
      if (idx === -1) return ctx.reply('ℹ️ Você ainda não está no ranking. Envie mensagens para ganhar XP!');
      const u = top[idx];
      await ctx.reply(`🏆 Sua posição: *${idx + 1}º* de ${users.count()} usuários\n▸ XP: ${u.xp}\n▸ Nível: ${u.level}`);
    },
  },
  {
    name: 'top',
    commands: ['top'],
    category: 'members',
    description: 'Mostra o top 10 (xp, mensagens, reputacao, karma, rpg, zueira, quiz).',
    usage: '!top [tipo]',
    cooldown: 3000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || 'xp').toLowerCase();
      const type = TYPES[arg] ? arg : 'xp';
      await ctx.reply(await renderRanking(ctx, type, 10));
    },
  },
];
