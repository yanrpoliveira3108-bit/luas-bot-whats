'use strict';

const mainMenu = require('../../menus/main');

module.exports = [
  {
    name: 'menu',
    commands: ['menu'],
    aliases: ['menuprincipal'],
    category: 'general',
    description: 'Abre o menu principal interativo.',
    usage: '!menu',
    cooldown: 2000,
    execute: async (ctx) => {
      await mainMenu(ctx);
    },
  },
];
