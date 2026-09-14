'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, {
    category: 'downloads',
    title: '📥 Downloads',
    description: 'Baixar músicas e vídeos. Use !play <nome> ou !ytmp3 <url>.',
  });
