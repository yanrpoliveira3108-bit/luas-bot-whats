/**
 * commands/general/readmore.js — !lermais on/off/status.
 *
 * Controla o "ler mais" (mensagens longas recolhidas). Persistido em settings
 * (sem reiniciar o bot), com padrão do .env (LUA_READMORE).
 */

'use strict';

const CONFIG = require('../../config');
const readmore = require('../../utils/readmore');

module.exports = [
  {
    name: 'lermais',
    commands: ['lermais', 'readmore'],
    category: 'general',
    description: 'Liga/desliga o "ler mais" (alterar = dono).',
    usage: '!lermais | !lermais on | !lermais off | !lermais status',
    cooldown: 1000,
    execute: async (ctx) => {
      const arg = String(ctx.args[0] || '').toLowerCase();
      const ON = ['on', 'ligar', 'ativar', '1', 'status', 'estado'];
      const OFF = ['off', 'desligar', 'desativar', '0'];

      if (OFF.includes(arg)) {
        if (!ctx.isOwner) return ctx.reply(CONFIG.messages.deniedOwner);
        readmore.setEnabled(false);
        return ctx.reply('📖 Sistema de "ler mais": *DESATIVADO*.');
      }
      if (ON.includes(arg) && arg !== 'status' && arg !== 'estado') {
        if (!ctx.isOwner) return ctx.reply(CONFIG.messages.deniedOwner);
        readmore.setEnabled(true);
        return ctx.reply('📖 Sistema de "ler mais": *ATIVADO*.');
      }
      const on = readmore.enabled();
      await ctx.reply(`📖 "Ler mais": ${on ? 'ATIVADO' : 'DESATIVADO'}.\nAltere com ${ctx.prefix}lermais on/off.`);
    },
  },
];
