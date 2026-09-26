/**
 * commands/ai/chat.js — conversa com a IA (!ia / !ai / !ask / !perguntar / !chat).
 */

'use strict';

const CONFIG = require('../../config');
const ai = require('../../ai');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'ia',
    commands: ['ia', 'ai', 'ask', 'perguntar', 'chat'],
    category: 'ai',
    description: 'Conversa com a IA (assistente local ou API externa).',
    usage: '!ia <pergunta>',
    cooldown: CONFIG.ai.cooldownMs,
    execute: async (ctx) => {
      const sub = String(ctx.args[0] || '').toLowerCase();
      if (['on', 'off', 'status'].includes(sub) && ctx.args.length === 1) {
        if (sub === 'status') {
          const s = ai.character.status(ctx.remoteJid);
          return ctx.reply(`🤖 *IA*\n▸ Estado: ${s.enabled ? 'ativa' : 'desativada'}\n▸ Provider: ${s.provider}\n▸ Modelo: ${s.model}\n▸ Memória: ${s.memoryEnabled ? 'ativa' : 'inativa'}\n▸ Aprendizado de estilo: ${s.styleLearningEnabled ? 'ativo' : 'inativo'}`);
        }
        if (ctx.isGroup && !ctx.isOwner && !ctx.isAdmin) return ctx.reply('⛔ Apenas owner ou administrador pode alterar a IA do grupo.');
        ai.character.setEnabled(ctx.remoteJid, sub === 'on');
        return ctx.reply(sub === 'on' ? '🤖 IA ativada neste chat.' : '🤖 IA desativada neste chat.');
      }
      const text = ctx.args.join(' ').trim();

      // visão: se responder a uma imagem e não houver provider com visão, seja honesto
      const quoted = ctx.message && (ctx.message.extendedTextMessage || ctx.message.imageMessage);
      if (!text && quoted) {
        return ctx.reply('👁️ Não tenho análise de imagem no provider atual (o assistente local não enxerga). Configure um provider externo com visão ou envie texto.');
      }
      if (!text) return ctx.reply(`💬 Envie sua pergunta: ${ctx.prefix}ia <texto>\nEx.: ${ctx.prefix}ia quanto é 15% de 80`);

      await ctx.reply('🤖 Pensando...');
      try {
        const r = await ai.character.ask({ chatId: ctx.remoteJid, userId: ctx.sender, text, mode: 'chat', participant: ctx.sender });
        if (!r.ok) return ctx.reply(r.message);
        const meta = r.provider === 'api' ? `\n\n_${r.model} · ${r.latencyMs}ms_` : '';
        await ctx.reply(r.text + meta);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'ia' });
      }
    },
  },
];
