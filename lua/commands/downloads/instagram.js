'use strict';

const instagram = require('../../downloaders/instagram');
const { sendVideoResult, sendImageResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'instagram',
    commands: ['instagram', 'ig', 'insta'],
    category: 'downloads',
    description: 'Baixa mídia pública do Instagram.',
    usage: '!instagram <url>',
    cooldown: 10000,
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url || !/instagram\.com/i.test(url)) return ctx.reply('🔗 Envie um link do Instagram.');
      await ctx.reply('⏳ Baixando mídia do Instagram...');
      try {
        const media = await instagram.download(url);
        if (media.isVideo) {
          await sendVideoResult(ctx, media, media.title || '');
        } else {
          await sendImageResult(ctx, media, media.title || '');
        }
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'instagram' });
      }
    },
  },
];
