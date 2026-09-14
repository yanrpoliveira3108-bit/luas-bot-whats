'use strict';

const groups = require('../../database/groups');
const { formatDate, formatDuration } = require('../../utils/formatter');

module.exports = [
  {
    name: 'tempo',
    commands: ['tempo'],
    category: 'members',
    description: 'Há quanto tempo você está no grupo.',
    usage: '!tempo',
    groupOnly: true,
    cooldown: 2000,
    execute: async (ctx) => {
      const m = groups.memberStats(ctx.remoteJid, ctx.sender);
      if (!m || !m.joined_at) return ctx.reply('ℹ️ Não sei quando você entrou no grupo.');
      const since = new Date(m.joined_at).getTime();
      await ctx.reply(`⏳ Você está no grupo desde ${formatDate(since)} (${formatDuration(Date.now() - since)}).`);
    },
  },
  {
    name: 'atividade',
    commands: ['atividade'],
    category: 'members',
    description: 'Suas mensagens neste grupo.',
    usage: '!atividade',
    groupOnly: true,
    cooldown: 2000,
    execute: async (ctx) => {
      const m = groups.memberStats(ctx.remoteJid, ctx.sender);
      const count = m ? m.message_count : 0;
      await ctx.reply(`💬 Você enviou *${count}* mensagens neste grupo.`);
    },
  },
];
