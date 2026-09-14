'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, {
    category: 'life',
    title: '🎮 Lua Life',
    description: 'Sua vida virtual: trabalho, pesca, mineração, fazenda, casa e economia. Comece com !vida.',
  });
