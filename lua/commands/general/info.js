'use strict';

const CONFIG = require('../../config');
const { registry } = require('../../engine/plugins');
const users = require('../../database/users');
const { formatUptime } = require('../../utils/formatter');

module.exports = [
  {
    name: 'info',
    commands: ['info', 'sobreobot'],
    category: 'general',
    description: 'Informações sobre o bot.',
    usage: '!info',
    cooldown: 3000,
    execute: async (ctx) => {
      const mem = process.memoryUsage();
      const lines = [
        `🌙 *${CONFIG.bot.name}* — v${CONFIG.bot.version}`,
        `▸ Autor: ${CONFIG.bot.author}`,
        `▸ Dono: ${CONFIG.owner.name}`,
        `▸ Prefixo: ${ctx.prefix}`,
        `▸ Comandos: ${registry.count()}`,
        `▸ Categorias: ${registry.categories().length}`,
        `▸ Usuários: ${users.count()}`,
        `▸ Online há: ${formatUptime(CONFIG.bot.startedAt)}`,
        `▸ Memória: ${Math.round(mem.rss / 1024 / 1024)} MB`,
        `▸ Conexão: pairing code (sem QR) 🔐`,
      ].join('\n');
      await ctx.reply(lines);
    },
  },
];
