'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, {
    category: 'rpg',
    title: '⚔️ RPG',
    description: 'Economia, empregos, fazenda e loja. Comece com !rpg.',
  });
