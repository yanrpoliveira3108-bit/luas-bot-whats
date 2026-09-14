'use strict';

const facebook = require('../../downloaders/facebook');
const { sendVideoResult, sendImageResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'facebook',
    commands: ['facebook', 'fb'],
    category: 'downloads',
    description: 'Baixa mídia pública do Facebook.',
    usage: '!facebook <url>',
    cooldown: 10000,
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url || !/(facebook\.com|fb\.watch)/i.test(url)) return ctx.reply('🔗 Envie um link do Facebook.');
      await ctx.reply('⏳ Baixando mídia do Facebook...');
      try {
        const media = await facebook.download(url);
        if (media.isVideo) {
          await sendVideoResult(ctx, media, media.title || '');
        } else {
          await sendImageResult(ctx, media, media.title || '');
        }
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'facebook' });
      }
    },
  },
];
