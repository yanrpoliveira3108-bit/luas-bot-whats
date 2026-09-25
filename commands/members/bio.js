'use strict';

const alvoUtil = require('../../utils/alvo');

module.exports = [
  {
    name: 'bio',
    commands: ['bio', 'recado'],
    category: 'members',
    description: 'Mostra o recado (about) do WhatsApp de alguém.',
    usage: '!bio [@usuario]',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = alvoUtil.alvo(ctx) || ctx.sender;
      try {
        const res = await ctx.socket.fetchStatus(target);
        const status = res && res.status ? res.status : '(sem recado)';
        await ctx.reply(`📝 Recado de @${target.split('@')[0]}:\n${status}`, { mentions: [target] });
      } catch (_) {
        await ctx.reply('ℹ️ Não consegui ler o recado deste usuário (privacidade).');
      }
    },
  },
];
