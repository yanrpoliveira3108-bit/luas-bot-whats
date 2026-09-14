/**
 * commands/general/pix.js — Payment Message (solicitação de pagamento).
 *
 * Formato: {prefix}pix [texto]|[valor]|[moeda]
 *   [texto] → payment.note
 *   [valor] → payment.amount
 *   [moeda] → payment.currency
 *
 * Envia uma Payment Message REAL do Baileys (requestPaymentMessage),
 * usando diretamente a estrutura { payment: {...} } — sem botões, listas,
 * quick_reply ou texto simulando pagamento.
 */

'use strict';

const USAGE = (prefix) =>
  `Uso correto:\n${prefix}pix [texto]|[valor]|[moeda]\n\nExemplo:\n${prefix}pix Pagamento do pedido|10000|BRL`;

/** Remove "{prefix}{comando}" e os espaços à frente, deixando só o payload. */
function stripCommand(text, prefix, name) {
  const esc = String(prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc + name + '\\b\\s*', 'i');
  return String(text || '').replace(re, '');
}

module.exports = [
  {
    name: 'pix',
    commands: ['pix'],
    category: 'general',
    description: 'Envia uma solicitação de pagamento (Payment Message).',
    usage: '!pix [texto]|[valor]|[moeda]',
    cooldown: 5000,
    execute: async (ctx) => {
      // parser separa os argumentos pelo caractere "|"
      const payload = stripCommand(ctx.text, ctx.prefix, 'pix');
      const parts = payload.split('|');

      // mais campos do que o formato aceita → formato incorreto
      if (parts.length > 3) {
        return ctx.reply(`⚠️ Formato incorreto (campos demais).\n\n${USAGE(ctx.prefix)}`);
      }

      const note = (parts[0] || '').trim();
      const amount = (parts[1] || '').trim();
      const currency = (parts[2] || '').trim();

      // campos faltando → informa exatamente qual(is)
      const missing = [];
      if (!note) missing.push('[texto]');
      if (!amount) missing.push('[valor]');
      if (!currency) missing.push('[moeda]');
      if (missing.length) {
        return ctx.reply(`⚠️ Campo(s) faltando: ${missing.join(', ')}.\n\n${USAGE(ctx.prefix)}`);
      }

      // valores claramente inválidos são rejeitados (sem conversões silenciosas)
      if (!/^\d+$/.test(amount) || Number(amount) <= 0) {
        return ctx.reply(`⚠️ Valor inválido: "${amount}". Informe um número inteiro positivo.\n\n${USAGE(ctx.prefix)}`);
      }
      if (!/^[A-Za-z]{3}$/.test(currency)) {
        return ctx.reply(`⚠️ Moeda inválida: "${currency}". Use um código de 3 letras (ex.: BRL, USD, IDR).\n\n${USAGE(ctx.prefix)}`);
      }

      await ctx.socket.sendMessage(ctx.remoteJid, {
        payment: {
          note,
          currency,
          offset: 0,
          amount,
          expiry: 0,
          from: '628xxxx@s.whatsapp.net',
          image: {
            placeholderArgb: 'your_background',
            textArgb: 'your_text',
            subtextArgb: 'your_subtext',
          },
        },
      });
    },
  },
];
