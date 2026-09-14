'use strict';

const users = require('../../database/users');

module.exports = [
  {
    name: 'afk',
    commands: ['afk'],
    category: 'members',
    description: 'Marca você como ausente.',
    usage: '!afk [motivo]',
    cooldown: 2000,
    execute: async (ctx) => {
      const reason = ctx.args.join(' ').slice(0, 80);
      users.setAfk(ctx.sender, reason);
      await ctx.reply(`💤 Você está AFK.${reason ? ` Motivo: ${reason}` : ''}`);
    },
  },
  {
    name: 'voltei',
    commands: ['voltei'],
    category: 'members',
    description: 'Remove seu status de ausente.',
    usage: '!voltei',
    cooldown: 2000,
    execute: async (ctx) => {
      users.clearAfk(ctx.sender);
      await ctx.reply('👋 Bem-vindo(a) de volta!');
    },
  },
];
