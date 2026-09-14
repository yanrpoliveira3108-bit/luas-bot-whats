'use strict';

const CONFIG = require('../../config');

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = [
  {
    name: 'cep',
    commands: ['cep'],
    category: 'utility',
    description: 'Consulta um CEP brasileiro (ViaCEP).',
    usage: '!cep 13090000',
    cooldown: 5000,
    execute: async (ctx) => {
      const cep = (ctx.args[0] || '').replace(/\D/g, '');
      if (!/^\d{8}$/.test(cep)) return ctx.reply('⚠️ CEP inválido. Use 8 dígitos: !cep 13090000');
      try {
        const data = await fetchJson(`${CONFIG.external.viacep}/${cep}/json/`);
        if (data.erro) return ctx.reply('🔎 CEP não encontrado.');
        await ctx.reply(
          [
            '📍 *Consulta de CEP*',
            `▸ CEP: ${data.cep}`,
            `▸ Logradouro: ${data.logradouro || '-'}`,
            `▸ Bairro: ${data.bairro || '-'}`,
            `▸ Cidade: ${data.localidade || '-'}`,
            `▸ UF: ${data.uf || '-'}`,
          ].join('\n')
        );
      } catch (_) {
        await ctx.reply('❌ Não consegui consultar o CEP agora. Tente novamente.');
      }
    },
  },
];
