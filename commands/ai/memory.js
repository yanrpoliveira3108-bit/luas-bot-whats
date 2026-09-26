/**
 * commands/ai/memory.js — controle da memória da IA (!aimemory).
 */

'use strict';

const ai = require('../../ai');

module.exports = [
  {
    name: 'aimemory',
    commands: ['aimemory', 'memoriaia'],
    category: 'ai',
    description: 'Liga/desliga/limpa a memória da conversa com a IA.',
    usage: '!aimemory on|off|clear|status',
    cooldown: 2000,
    execute: async (ctx) => {
      const arg = String(ctx.args[0] || 'status').toLowerCase();
      if (arg === 'on' || arg === 'ligar') {
        ai.character.state.setMemoryEnabled(ctx.remoteJid, true);
        return ctx.reply('🧠 Memória da IA: *ATIVADA* para esta conversa.');
      }
      if (arg === 'off' || arg === 'desligar') {
        ai.character.state.setMemoryEnabled(ctx.remoteJid, false);
        return ctx.reply('🧠 Memória da IA: *DESATIVADA* para esta conversa.');
      }
      if (arg === 'clear' || arg === 'limpar') {
        ai.character.clearMemory(ctx.remoteJid);
        return ctx.reply('🧹 Memória da conversa com a IA *apagada*.');
      }
      const on = ai.character.memoryStatus(ctx.remoteJid).enabled;
      await ctx.reply(`🧠 Memória da IA: ${on ? 'ATIVADA' : 'DESATIVADA'}.\nUse ${ctx.prefix}aimemory on|off|clear.`);
    },
  },
];
