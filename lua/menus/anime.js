'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, { category: 'anime', title: '🍥 Anime', description: 'Animes, mangás, personagens e quiz.' });
