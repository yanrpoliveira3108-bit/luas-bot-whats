'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, { category: 'utility', title: '🛠️ Utilidades', description: 'Ferramentas úteis do dia a dia.' });
