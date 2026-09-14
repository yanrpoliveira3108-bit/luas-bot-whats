'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, {
    category: 'stickers',
    title: '🎨 Stickers',
    description: 'Crie figurinhas com bio rica (criador, origem GP/PV, bot, dono, dev). Use !take para roubar com nova bio, !stickerinfo para ver infos.',
  });
