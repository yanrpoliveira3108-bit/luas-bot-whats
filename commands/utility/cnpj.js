'use strict';

const CONFIG = require('../../config');

module.exports = [
  {
    name: 'cnpj',
    commands: ['cnpj', 'empresa'],
    category: 'utility',
    description: 'Consulta um CNPJ (Brasil API).',
    usage: '!cnpj 11222333000181',
    cooldown: 5000,
    execute: async (ctx) => {
      const cnpj = (ctx.args[0] || '').replace(/\D/g, '');
      if (!/^\d{14}$/.test(cnpj)) return ctx.reply('⚠️ CNPJ inválido. Use 14 dígitos: !cnpj 11222333000181');
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${CONFIG.external.brasilApi}/cnpj/v1/${cnpj}`, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return ctx.reply('🔎 CNPJ não encontrado.');
        const d = await res.json();
        await ctx.reply(
          [
            '🏢 *Consulta de CNPJ*',
            `▸ Razão social: ${d.razao_social || '-'}`,
            `▸ Fantasia: ${d.nome_fantasia || '-'}`,
            `▸ Atividade: ${d.cnae_fiscal_descricao || '-'}`,
            `▸ Município: ${d.municipio || '-'}/${d.uf || '-'}`,
            `▸ Situação: ${d.descricao_situacao_cadastral || '-'}`,
          ].join('\n')
        );
      } catch (_) {
        await ctx.reply('❌ Não consegui consultar o CNPJ agora. Tente novamente.');
      }
    },
  },
];
