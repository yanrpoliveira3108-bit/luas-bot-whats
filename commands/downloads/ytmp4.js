'use strict';

const youtube = require('../../downloaders/youtube');
const { sendVideoResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'ytmp4',
    commands: ['ytmp4', 'ytvideo', 'videourl'],
    category: 'downloads',
    description: 'Baixa o vídeo de um link do YouTube.',
    usage: '!ytmp4 <url>',
    cooldown: 15000,
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url) return ctx.reply('⚠️ Envie o link: !ytmp4 <url>');
      if (!youtube.validateUrl(url)) return ctx.reply('🔗 Link do YouTube inválido.');
      await ctx.reply('⏳ Baixando vídeo...');
      try {
        const video = await youtube.downloadVideo(url);
        await ctx.reply(`🎬 *${video.title}*\n▸ Canal: ${video.author || '-'}`);
        await sendVideoResult(ctx, video, video.title);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'ytmp4' });
      }
    },
  },
];
