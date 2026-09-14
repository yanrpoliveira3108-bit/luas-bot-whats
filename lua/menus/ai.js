'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, {
    category: 'ai',
    title: '🤖 IA',
    description: 'Assistente do Lua: chat, código, tradução e resumo.',
  });
