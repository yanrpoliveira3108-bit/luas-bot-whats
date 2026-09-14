'use strict';

const youtube = require('../../downloaders/youtube');
const { sendVideoResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'video',
    commands: ['video', 'ytvideo2'],
    category: 'downloads',
    description: 'Baixa o vídeo de uma busca no YouTube.',
    usage: '!video <busca>',
    cooldown: 15000,
    execute: async (ctx) => {
      const query = ctx.args.join(' ');
      if (!query) return ctx.reply('⚠️ Envie a busca: !video <busca>');
      const results = await youtube.search(query, 1);
      if (!results.length) return ctx.reply('🔎 Nenhum resultado encontrado.');
      await ctx.reply('⏳ Baixando vídeo...');
      try {
        const video = await youtube.downloadVideo(results[0].url, results[0].title);
        await ctx.reply(`🎬 *${video.title}*\n▸ Canal: ${video.author || '-'}`);
        await sendVideoResult(ctx, video, video.title);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'video' });
      }
    },
  },
];
