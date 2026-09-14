'use strict';

const { downloadToBuffer } = require('../../utils/download');

async function getProfilePic(ctx, target) {
  try {
    return await ctx.socket.profilePictureUrl(target, 'image');
  } catch (_) {
    return null;
  }
}

module.exports = [
  {
    name: 'avatar',
    commands: ['avatar', 'fotoperfil'],
    category: 'members',
    description: 'Mostra a foto de perfil de alguém.',
    usage: '!avatar [@usuario]',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0] || ctx.sender;
      const url = await getProfilePic(ctx, target);
      if (!url) return ctx.reply('ℹ️ Este usuário não possui foto de perfil visível.');
      try {
        const buf = await downloadToBuffer(url, { maxBytes: 5 * 1024 * 1024 });
        await ctx.sendImage(buf, `Foto de @${target.split('@')[0]}`);
      } catch (_) {
        await ctx.reply('❌ Não consegui baixar a foto de perfil.');
      }
    },
  },
  {
    name: 'banner',
    commands: ['banner', 'capa'],
    category: 'members',
    description: 'Mostra a foto de perfil (o WhatsApp não tem banner separado).',
    usage: '!banner [@usuario]',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0] || ctx.sender;
      const url = await getProfilePic(ctx, target);
      if (!url) return ctx.reply('ℹ️ Sem foto de perfil visível (o WhatsApp não possui "banner" separado).');
      try {
        const buf = await downloadToBuffer(url, { maxBytes: 5 * 1024 * 1024 });
        await ctx.sendImage(buf, `Banner de @${target.split('@')[0]}`);
      } catch (_) {
        await ctx.reply('❌ Não consegui baixar a imagem.');
      }
    },
  },
];
