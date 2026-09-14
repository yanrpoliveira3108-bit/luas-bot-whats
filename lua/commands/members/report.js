'use strict';

const CONFIG = require('../../config');

function ownerJid() {
  const n = CONFIG.owner.numbers[0];
  return n ? `${n}@s.whatsapp.net` : null;
}

module.exports = [
  {
    name: 'reportar',
    commands: ['reportar', 'report'],
    category: 'members',
    description: 'Envia uma denúncia ao dono do bot.',
    usage: '!reportar <motivo>',
    cooldown: 30000,
    execute: async (ctx) => {
      const reason = ctx.args.join(' ').slice(0, 500);
      if (!reason) return ctx.reply('⚠️ Envie o motivo: !reportar <motivo>');
      const owner = ownerJid();
      if (!owner) return ctx.reply('ℹ️ Nenhum dono configurado para receber denúncias.');
      await ctx.socket.sendMessage(owner, {
        text: `🚨 *Denúncia*\n▸ De: ${ctx.sender}\n▸ Chat: ${ctx.remoteJid}\n▸ Motivo: ${reason}`,
      });
      await ctx.reply('✅ Denúncia enviada ao dono. Obrigado!');
    },
  },
  {
    name: 'sugerir',
    commands: ['sugerir', 'sugestao'],
    category: 'members',
    description: 'Envia uma sugestão ao dono do bot.',
    usage: '!sugerir <ideia>',
    cooldown: 30000,
    execute: async (ctx) => {
      const idea = ctx.args.join(' ').slice(0, 500);
      if (!idea) return ctx.reply('⚠️ Envie a sugestão: !sugerir <ideia>');
      const owner = ownerJid();
      if (!owner) return ctx.reply('ℹ️ Nenhum dono configurado para receber sugestões.');
      await ctx.socket.sendMessage(owner, {
        text: `💡 *Sugestão*\n▸ De: ${ctx.sender}\n▸ Ideia: ${idea}`,
      });
      await ctx.reply('✅ Sugestão enviada. Obrigado!');
    },
  },
];
