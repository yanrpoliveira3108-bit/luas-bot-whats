'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, { category: 'owner', title: '👑 Dono', description: 'Controle total do bot. Restrito ao dono.' });
