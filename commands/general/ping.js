'use strict';

module.exports = [
  {
    name: 'ping',
    commands: ['ping'],
    category: 'general',
    description: 'Testa a resposta do bot.',
    usage: '!ping',
    cooldown: 2000,
    execute: async (ctx) => {
      const ts = ctx.message.messageTimestamp ? Number(ctx.message.messageTimestamp) * 1000 : Date.now();
      const ms = Math.max(0, Date.now() - ts);
      await ctx.reply(`🏓 *Pong!*\n▸ Latência: ${ms}ms\n▸ Prefixo: ${ctx.prefix}\n▸ Bot online ✅`);
    },
  },
];
