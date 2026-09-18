'use strict';

const mediaUtil = require('../../utils/media');

module.exports = [
  {
    name: 'foto',
    commands: ['foto', 'fotogrupo', 'setfoto', 'setpp'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Define a foto do grupo (marque uma imagem).',
    usage: '!foto (respondendo a uma imagem)',
    cooldown: 10000,
    execute: async (ctx) => {
      const media = await ctx.downloadMedia();
      if (!media || media.type !== 'image') {
        return ctx.reply('🖼️ Marque uma imagem e use !foto para definir a foto do grupo.');
      }
      await ctx.reply('⏳ Definindo a foto do grupo...');
      try {
        await ctx.socket.updateProfilePicture(ctx.remoteJid, media.buffer);
        await ctx.reply('✅ Foto do grupo atualizada.');
      } catch (err) {
        await ctx.reply(`❌ Não consegui atualizar a foto: ${err.message}`);
      }
    },
  },
];
