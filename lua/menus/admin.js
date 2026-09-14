'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, {
    category: 'admin',
    title: '🛡️ Administração',
    description: 'Moderação, filtros e gestão do grupo. Requer admin.',
  });
