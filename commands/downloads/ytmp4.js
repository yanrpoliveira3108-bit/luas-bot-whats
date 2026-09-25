'use strict';

const youtube = require('../../downloaders/youtube');
const { sendVideoResult } = require('../_shared/downloads');
const { parseArtistAndTitle, formatMediaCard } = require('../../utils/mediaPresentation');
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
      if (!url) return ctx.reply(`⚠️ Envie o link: ${ctx.prefix}ytmp4 <url>`);
      if (!youtube.validateUrl(url)) return ctx.reply('🔗 Link do YouTube inválido.');
      await ctx.reply('⏳ Preparando vídeo...');
      try {
        const video = await youtube.downloadVideo(url);
        const parsed = parseArtistAndTitle(video.title, video.author);

        const card = formatMediaCard({
          kind: 'video',
          title: parsed.title || video.title,
          artist: parsed.artist || null,
          channel: parsed.isChannel ? video.author : null,
          duration: video.duration ? `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}` : null,
          views: video.views || null,
          description: video.description || null,
          url: url,
          prefix: ctx.prefix,
        });

        await sendVideoResult(ctx, video, card);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'ytmp4' });
      }
    },
  },
];
