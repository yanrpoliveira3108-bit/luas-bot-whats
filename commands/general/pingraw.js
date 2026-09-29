'use strict';
module.exports = [{
  name: 'pingraw', commands: ['pingraw'], category: 'general', ownerOnly: true, cooldown: 1000,
  description: 'Sonda textual mínima para diagnóstico de latência.', usage: '.pingraw',
  execute: async (ctx) => {
    if (!ctx.isOwner) return ctx.reply('🚫 Apenas o dono pode usar o pingraw.');
    const started = Date.now();
    const receive = ctx.message && ctx.message.messageTimestamp ? Number(ctx.message.messageTimestamp) * 1000 : null;
    await ctx.reply(`🏓 RAW PONG\nreceiveAgeMs=${receive ? Math.max(0, started - receive) : 'indisponível'}\nhandlerToReplyMs=${Date.now() - started}ms`, { quoted: false });
  },
}];
