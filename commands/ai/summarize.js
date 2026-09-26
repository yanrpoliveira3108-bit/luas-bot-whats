/**
 * commands/ai/summarize.js — resumo de texto (!resumir).
 *
 * Funciona respondendo a uma mensagem de texto (mensagem citada).
 */

'use strict';

const CONFIG = require('../../config');
const ai = require('../../ai');
const errorHandler = require('../../handlers/errorHandler');
const { sendLongMessage } = require('../../utils/aiResponse');

function quotedText(msg) {
  const m = msg && msg.message ? msg.message : msg;
  if (!m) return '';
  const ext = m.extendedTextMessage || m.conversation ? null : null;
  if (m.extendedTextMessage) {
    const et = m.extendedTextMessage;
    if (et.text) return et.text;
    if (et.contextInfo && et.contextInfo.quotedMessage) {
      const q = et.contextInfo.quotedMessage;
      return q.conversation || (q.extendedTextMessage && q.extendedTextMessage.text) || '';
    }
  }
  if (m.conversation) {
    // texto após o comando
    const parts = String(m.conversation).split(/\s+/);
    return parts.slice(1).join(' ');
  }
  return '';
}

module.exports = [
  {
    name: 'resumir',
    commands: ['resumir', 'resumo', 'summarize'],
    category: 'ai',
    description: 'Resume o texto de uma mensagem (responda a ela).',
    usage: '!resumir (respondendo a uma mensagem)',
    cooldown: CONFIG.ai.cooldownMs,
    execute: async (ctx) => {
      let text = ctx.args.join(' ').trim();
      if (!text) text = quotedText(ctx.message);
      if (!text) return ctx.reply('📄 Responda a uma mensagem de texto com !resumir (ou envie o texto junto).');
      await ctx.reply('📄 Resumindo...');
      try {
        const r = await ai.character.ask({ chatId: ctx.remoteJid, userId: ctx.sender, text, mode: 'summarize', participant: ctx.sender });
        if (!r.ok) return ctx.reply(r.message);
        await sendLongMessage(ctx, r.text);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'resumir' });
      }
    },
  },
];
