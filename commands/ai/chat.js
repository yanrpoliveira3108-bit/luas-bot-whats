/**
 * commands/ai/chat.js — conversa com a IA (!ia / !ai / !ask / !perguntar / !chat).
 */

'use strict';

const CONFIG = require('../../config');
const ai = require('../../ai');
const errorHandler = require('../../handlers/errorHandler');
const { sendLongMessage } = require('../../utils/aiResponse');

module.exports = [
  {
    name: 'ia',
    commands: ['ia', 'ai', 'ask', 'perguntar', 'chat'],
    category: 'ai',
    description: 'Conversa com a IA Groq.',
    usage: '!ia <pergunta>',
    cooldown: CONFIG.ai.cooldownMs,
    execute: async (ctx) => {
      const sub = String(ctx.args[0] || '').toLowerCase();
      if (['on', 'off', 'status'].includes(sub) && ctx.args.length === 1) {
        if (sub === 'status') {
          const s = ai.character.status(ctx.remoteJid);
          return ctx.reply(`🤖 *IA*\n▸ Estado: ${s.enabled ? 'ativa' : 'desativada'}\n▸ Provider: Groq\n▸ Groq: ${s.groqConfigured ? 'configurada' : 'não configurada'}\n▸ Modelo: ${s.model}\n▸ Última chamada: ${s.lastAiStatus || '—'}\n▸ Memória: ${s.memoryEnabled ? 'ativa' : 'inativa'}\n▸ Aprendizado de estilo: ${s.styleLearningEnabled ? 'ativo' : 'inativo'}`);
        }
        if (ctx.isGroup && !ctx.isOwner && !ctx.isAdmin) return ctx.reply('⛔ Apenas owner ou administrador pode alterar a IA do grupo.');
        ai.character.setEnabled(ctx.remoteJid, sub === 'on');
        return ctx.reply(sub === 'on' ? '🤖 IA ativada neste chat.' : '🤖 IA desativada neste chat.');
      }
      const text = ctx.args.join(' ').trim();

      // visão: se responder a uma imagem e não houver provider com visão, seja honesto
      const quoted = ctx.message && (ctx.message.extendedTextMessage || ctx.message.imageMessage);
      if (!text && quoted) {
        return ctx.reply('👁️ O provider Groq atual não analisa imagens neste fluxo. Envie texto.');
      }
      if (!text) return ctx.reply(`💬 Envie sua pergunta: ${ctx.prefix}ia <texto>\nEx.: ${ctx.prefix}ia quanto é 15% de 80`);

      await ctx.reply('🤖 Pensando...');
      try {
        const r = await ai.character.ask({ chatId: ctx.remoteJid, userId: ctx.sender, text, mode: 'chat', participant: ctx.sender });
        if (!r.ok) return ctx.reply(r.message);
        const meta = r.provider === 'groq' ? `\n\n_${r.model} · ${r.latencyMs}ms_` : '';
        await sendLongMessage(ctx, r.text + meta);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'ia' });
      }
    },
  },
];
