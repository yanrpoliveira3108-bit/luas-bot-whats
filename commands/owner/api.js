'use strict';

const ai = require('../../ai');
const groq = require('../../ai/providers/groq');
const aiConfig = require('../../utils/aiConfig');

module.exports = [
  {
    name: 'api',
    commands: ['api'],
    category: 'owner',
    ownerOnly: true,
    description: 'Configura a API da IA.',
    usage: '!api ia <chave> | !api ia status',
    cooldown: 2000,
    execute: async (ctx) => {
      const args = (ctx.args || []).map((x) => String(x).trim());
      if (String(args[0] || '').toLowerCase() !== 'ia') {
        await ctx.reply(`⚠️ Use: ${ctx.prefix}api ia <chave> ou ${ctx.prefix}api ia status`);
        return;
      }
      const value = String(args[1] || '').trim();
      if (!value || ['status', 'estado', 'info'].includes(value.toLowerCase())) {
        const s = ai.status();
        await ctx.reply([
          '🤖 *IA*',
          '▸ Provider: Groq',
          `▸ API: ${s.groqConfigured ? 'configurada' : 'não configurada'}`,
          `▸ Modelo: ${s.groqModel}`,
        ].join('\n'));
        return;
      }
      if (['mostrar', 'show', 'remove', 'remover'].includes(value.toLowerCase())) {
        await ctx.reply('⚠️ Por segurança, a chave nunca é exibida nem removida por este comando.');
        return;
      }
      try {
        aiConfig.persistGroqApiKey(value);
        await ctx.reply('✅ API da IA atualizada com sucesso.');
      } catch (err) {
        await ctx.reply(err.code === 'GROQ_KEY_INVALID_FORMAT' ? '❌ Formato de chave da IA inválido.' : '❌ Não consegui salvar a configuração da IA.');
      }
    },
  },
];
