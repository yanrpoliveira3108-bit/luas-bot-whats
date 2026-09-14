'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, {
    category: 'stickers',
    title: '🎨 Stickers',
    description: 'Crie figurinhas a partir de imagens/vídeos. Envie/marque a mídia com o comando.',
  });
