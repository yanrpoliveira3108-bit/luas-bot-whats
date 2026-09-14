'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, { category: 'general', title: '⚙️ Geral', description: 'Comandos básicos do bot.' });
