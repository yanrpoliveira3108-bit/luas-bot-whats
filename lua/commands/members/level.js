'use strict';

const users = require('../../database/users');

module.exports = [
  {
    name: 'level',
    commands: ['level', 'nivel'],
    category: 'members',
    description: 'Mostra seu nível atual.',
    usage: '!level',
    cooldown: 2000,
    execute: async (ctx) => {
      const u = users.get(ctx.sender);
      if (!u) return ctx.reply('ℹ️ Você ainda não tem dados. Envie mensagens!');
      const next = users.xpForNextLevel(u.level);
      const pct = Math.min(100, Math.round((u.xp / next) * 100));
      const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      await ctx.reply(`📈 *Nível ${u.level}*\n▸ XP: ${u.xp}/${next}\n▸ Progresso: ${bar} ${pct}%`);
    },
  },
  {
    name: 'xp',
    commands: ['xp'],
    category: 'members',
    description: 'Mostra seu XP acumulado.',
    usage: '!xp',
    cooldown: 2000,
    execute: async (ctx) => {
      const u = users.get(ctx.sender);
      if (!u) return ctx.reply('ℹ️ Você ainda não tem XP. Envie mensagens para ganhar!');
      await ctx.reply(`✨ Você tem *${u.xp} XP* (nível ${u.level}).`);
    },
  },
];
