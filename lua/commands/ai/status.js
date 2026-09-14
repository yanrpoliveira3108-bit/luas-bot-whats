/**
 * commands/ai/status.js — status da IA (!aistatus). Sem segredos.
 */

'use strict';

const ai = require('../../ai');

module.exports = [
  {
    name: 'aistatus',
    commands: ['aistatus', 'iastatus'],
    category: 'ai',
    description: 'Mostra o status e a configuração da IA.',
    usage: '!aistatus',
    cooldown: 2000,
    execute: async (ctx) => {
      const s = ai.status();
      await ctx.reply(
        [
          '🤖 *STATUS DA IA*',
          `▸ Provider ativo: ${s.active}`,
          `▸ Modelo: ${s.model}`,
          `▸ API externa: ${s.apiConfigured ? '✅ configurada' : '❌ não configurada (modo local)'}`,
          `▸ Cadeia de fallback: ${s.order.join(' → ')}`,
          `▸ Memória: ${s.memory}`,
          '',
          '📏 *Limites*',
          `▸ Prompt máx.: ${s.limits.maxInput} caracteres`,
          `▸ Timeout: ${s.limits.timeoutMs / 1000}s`,
          `▸ Cooldown: ${s.limits.cooldownMs / 1000}s`,
          '',
          '_Nenhum token ou chave é exibido aqui._',
        ].join('\n')
      );
    },
  },
];
