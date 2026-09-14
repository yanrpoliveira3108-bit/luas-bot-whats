'use strict';

const tiktok = require('../../downloaders/tiktok');
const { sendVideoResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'tiktok',
    commands: ['tiktok', 'tt'],
    category: 'downloads',
    description: 'Baixa um vídeo do TikTok.',
    usage: '!tiktok <url>',
    cooldown: 10000,
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url || !/tiktok\.com/i.test(url)) return ctx.reply('🔗 Envie um link do TikTok.');
      await ctx.reply('⏳ Baixando vídeo do TikTok...');
      try {
        const video = await tiktok.download(url);
        await ctx.reply(`🎵 *${video.title.slice(0, 80)}*\n▸ Autor: ${video.author || '-'}`);
        await sendVideoResult(ctx, video, video.title.slice(0, 100));
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'tiktok' });
      }
    },
  },
];
