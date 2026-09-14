'use strict';

const CONFIG = require('../../config');
const settings = require('../../database/settings');

module.exports = [
  {
    name: 'prefix',
    commands: ['prefix', 'prefixo'],
    category: 'general',
    description: 'Mostra o prefixo atual (alterar = dono).',
    usage: '!prefixo | !prefix [novo]',
    cooldown: 1500,
    execute: async (ctx) => {
      const novo = (ctx.args[0] || '').trim();
      if (!novo) {
        await ctx.reply(`🔤 Prefixo atual: *${settings.effectivePrefix()}*`);
        return;
      }
      if (!ctx.isOwner) {
        await ctx.reply(CONFIG.messages.deniedOwner);
        return;
      }
      if (novo.length > 3) {
        await ctx.reply('⚠️ O prefixo deve ter no máximo 3 caracteres.');
        return;
      }
      settings.set('prefix', novo);
      await ctx.reply(`✅ Prefixo alterado para: *${novo}*\nUse *${novo}menu* agora.`);
    },
  },
];
