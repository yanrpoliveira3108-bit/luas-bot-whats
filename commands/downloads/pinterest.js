'use strict';

const pinterest = require('../../downloaders/pinterest');
const { sendImageResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'pinterest',
    commands: ['pinterest', 'pin'],
    category: 'downloads',
    description: 'Baixa uma imagem do Pinterest.',
    usage: '!pinterest <url>',
    cooldown: 10000,
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url || !/pinterest\.com|pin\.it/i.test(url)) return ctx.reply('🔗 Envie um link do Pinterest.');
      await ctx.reply('⏳ Baixando imagem do Pinterest...');
      try {
        const img = await pinterest.download(url);
        await sendImageResult(ctx, img, img.title ? img.title.slice(0, 200) : '');
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'pinterest' });
      }
    },
  },
];
