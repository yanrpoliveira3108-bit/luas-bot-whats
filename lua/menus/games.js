'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, { category: 'games', title: '🎮 Games', description: 'Jogos que funcionam dentro do chat.' });
