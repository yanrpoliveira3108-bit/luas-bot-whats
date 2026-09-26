/**
 * commands/ai/translate.js — tradução (!traduzir).
 */

'use strict';

const CONFIG = require('../../config');
const ai = require('../../ai');
const errorHandler = require('../../handlers/errorHandler');
const { sendLongMessage } = require('../../utils/aiResponse');

module.exports = [
  {
    name: 'traduzir',
    commands: ['traduzir', 'traduz', 'translate'],
    category: 'ai',
    description: 'Traduz um texto (idioma + texto).',
    usage: '!traduzir <idioma> <texto>',
    cooldown: CONFIG.ai.cooldownMs,
    execute: async (ctx) => {
      const text = ctx.args.join(' ').trim();
      if (!text) return ctx.reply(`🌎 Use: ${ctx.prefix}traduzir <idioma> <texto>\nEx.: ${ctx.prefix}traduzir inglês bom dia`);
      await ctx.reply('🌎 Traduzindo...');
      try {
        const r = await ai.character.ask({ chatId: ctx.remoteJid, userId: ctx.sender, text, mode: 'translate', participant: ctx.sender });
        if (!r.ok) return ctx.reply(r.message);
        await sendLongMessage(ctx, r.text);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'traduzir' });
      }
    },
  },
];
