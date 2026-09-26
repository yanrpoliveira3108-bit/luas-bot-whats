/**
 * commands/ai/code.js — geração/explicação de código (!codigo).
 */

'use strict';

const CONFIG = require('../../config');
const ai = require('../../ai');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'codigo',
    commands: ['codigo', 'code'],
    category: 'ai',
    description: 'Gera ou explica código via IA.',
    usage: '!codigo <pedido>',
    cooldown: CONFIG.ai.cooldownMs,
    execute: async (ctx) => {
      const text = ctx.args.join(' ').trim();
      if (!text) return ctx.reply(`💻 Envie o pedido: ${ctx.prefix}codigo <pedido>\nEx.: ${ctx.prefix}codigo função JS que soma dois números`);
      await ctx.reply('💻 Gerando código...');
      try {
        const r = await ai.character.ask({ chatId: ctx.remoteJid, userId: ctx.sender, text, mode: 'code', participant: ctx.sender });
        if (!r.ok) return ctx.reply(r.message);
        await ctx.reply(r.text);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'codigo' });
      }
    },
  },
];
