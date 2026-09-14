/**
 * commands/general/menus.js — atalhos de menu (!menuadm, !menudono, …).
 *
 * Cada comando abre a tela correspondente no motor de navegação (utils/nav).
 * Botões e comandos compartilham as MESMAS telas/handlers.
 */

'use strict';

const nav = require('../../utils/nav');
const settings = require('../../database/settings');

async function openOrText(ctx, screen) {
  if (settings.buttonsEnabled()) {
    require('../../menus/screens');
    await nav.openScreen(ctx, screen);
  } else {
    const buttons = require('../../utils/buttons');
    await buttons.sendMainMenu(ctx);
  }
}

module.exports = [
  {
    name: 'menuadm',
    commands: ['menuadm'],
    category: 'general',
    description: 'Abre o menu de administração do grupo.',
    usage: '!menuadm',
    cooldown: 2000,
    execute: async (ctx) => openOrText(ctx, 'lua_admin_menu'),
  },
  {
    name: 'menuautomod',
    commands: ['menuautomod'],
    category: 'general',
    description: 'Abre o menu de filtros automáticos (automod).',
    usage: '!menuautomod',
    cooldown: 2000,
    execute: async (ctx) => openOrText(ctx, 'lua_automod'),
  },
  {
    name: 'menusticker',
    commands: ['menusticker'],
    category: 'general',
    description: 'Abre o menu de stickers.',
    usage: '!menusticker',
    cooldown: 2000,
    execute: async (ctx) => openOrText(ctx, 'lua_sticker_menu'),
  },
  {
    name: 'menuia',
    commands: ['menuia', 'menuai'],
    category: 'general',
    description: 'Abre o menu da IA.',
    usage: '!menuia',
    cooldown: 2000,
    execute: async (ctx) => openOrText(ctx, 'lua_ia_menu'),
  },
  {
    name: 'menumedia',
    commands: ['menumedia'],
    category: 'general',
    description: 'Abre o menu de mídia.',
    usage: '!menumedia',
    cooldown: 2000,
    execute: async (ctx) => openOrText(ctx, 'lua_media'),
  },
  {
    name: 'menudono',
    commands: ['menudono'],
    category: 'general',
    ownerOnly: true,
    description: 'Abre o menu exclusivo do dono.',
    usage: '!menudono',
    cooldown: 2000,
    execute: async (ctx) => openOrText(ctx, 'lua_owner'),
  },
  {
    name: 'menulifeadmin',
    commands: ['menulifeadmin'],
    category: 'general',
    ownerOnly: true,
    description: 'Abre o painel administrativo do Lua Life.',
    usage: '!menulifeadmin',
    cooldown: 2000,
    execute: async (ctx) => openOrText(ctx, 'lua_admin'),
  },
];
