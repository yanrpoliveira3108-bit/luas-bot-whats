'use strict';

const groupHandler = require('../../handlers/groupHandler');
const { resolveTarget } = require('../_shared/admin');

module.exports = [
  {
    name: 'mute',
    commands: ['mute', 'silenciar'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Silencia um usuário (mensagens dele são apagadas).',
    usage: '!mute @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !mute @usuario');
      groupHandler.muteUser(ctx.remoteJid, target);
      const hint = ctx.isBotAdmin ? '' : '\n_⚠️ Para eu APAGAR as mensagens dele, preciso ser admin do grupo._';
      await ctx.reply(`🔇 @${target.split('@')[0]} foi silenciado.${hint}`, { mentions: [target] });
    },
  },
  {
    name: 'unmute',
    commands: ['unmute', 'dessilenciar'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Remove o silêncio de um usuário.',
    usage: '!unmute @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !unmute @usuario');
      groupHandler.unmuteUser(ctx.remoteJid, target);
      await ctx.reply(`🔊 @${target.split('@')[0]} pode falar novamente.`, { mentions: [target] });
    },
  },
];
