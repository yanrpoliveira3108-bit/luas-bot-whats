'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, { category: 'fun', title: '😂 Zueira', description: 'Diversão e interações. Marque alguém!' });
