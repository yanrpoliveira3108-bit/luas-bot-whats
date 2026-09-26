'use strict';

const ai = require('../../ai');

module.exports = [{
  name: 'aistatus',
  commands: ['aistatus', 'iastatus'],
  category: 'ai',
  description: 'Mostra o status da IA Groq.',
  usage: '!aistatus',
  cooldown: 2000,
  execute: async (ctx) => {
    const s = ai.status();
    const c = ai.character.status(ctx.remoteJid);
    await ctx.reply([
      '🤖 *STATUS DA IA*',
      `▸ Provider: Groq`,
      `▸ Groq: ${s.groqConfigured ? '✅ configurada' : '❌ não configurada'}`,
      `▸ Modelo: ${s.groqModel}`,
      `▸ Última chamada: ${c.lastAiStatus || '—'}`,
      `▸ Estado neste chat: ${c.enabled ? 'ativa' : 'desativada'}`,
      `▸ Memória deste chat: ${c.memoryEnabled ? 'ativa' : 'inativa'} (${c.recentCount} recentes, ${c.memoryCount} memórias)`,
      `▸ Aprendizado de estilo: ${c.styleLearningEnabled ? 'ativo' : 'inativo'}`,
      '',
      '📏 *Operação*',
      `▸ Timeout: ${s.limits.timeoutMs / 1000}s`,
      `▸ Cooldown: ${s.limits.cooldownMs / 1000}s`,
      '',
      '_Nenhum token ou chave é exibido aqui._',
    ].join('\n'));
  },
}];
