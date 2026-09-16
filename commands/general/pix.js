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

const commandHandler = require('../../handlers/commandHandler');
const selective = require('../../utils/selective');
const logger = require('../../utils/logger').child('pix');

const USAGE = (prefix) =>
  `Uso correto:\n${prefix}pix [texto]|[valor]|[moeda]\n\nExemplo:\n${prefix}pix Pagamento do pedido|10000|BRL`;

/** Remove "{prefix}{comando}" e os espaços à frente, deixando só o payload. */
function stripCommand(text, prefix, name) {
  const esc = String(prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc + name + '\\b\\s*', 'i');
  return String(text || '').replace(re, '');
}

/**
 * Em GRUPO, devolve os JIDs dos membros comuns (sem admin/superadmin/bot/
 * duplicados) para usar como `mentions`. Em privado, ou sem participantes
 * recuperáveis, devolve [] — e o bot nunca quebra por isso.
 *
 * Reusa o cache de metadata do commandHandler (TTL 30 s): uma única chamada por
 * execução, sem arquitetura paralela. O destino do envio continua sendo o JID do
 * grupo — os JIDs aqui são só para mencionar, nunca para enviar individualmente.
 */
async function groupMemberMentions(ctx) {
  if (!ctx.isGroup) return [];
  try {
    const meta = await commandHandler.getGroupMetadata(ctx.socket, ctx.remoteJid);
    const participants = (meta && meta.participants) || [];
    const botJid = (ctx.socket && ctx.socket.user && ctx.socket.user.id) || '';
    const memberJids = selective.regularMemberJids(meta, [botJid]);
    const admins = participants.filter((x) => selective.isAdmin(x)).length;
    logger.debug(
      { grupo: ctx.remoteJid, participantes: participants.length, admins, membrosComuns: memberJids.length, botExcluido: botJid ? 1 : 0 },
      '[PIX] participantes do grupo separados (mentions)'
    );
    return memberJids;
  } catch (err) {
    logger.warn({ err: (err && err.message) || String(err) }, '[PIX] falha ao obter membros do grupo — sem mentions');
    return [];
  }
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

      // valores claramente inválidos são rejeitados (sem conversões silenciosas).
      // aceita inteiro ou decimal com "," ou "." (ex.: 29,90); o número em si é
      // validado separadamente para barrar 0, negativos, NaN e texto.
      const amountNorm = String(amount).replace(',', '.');
      const isMoney = /^\d+(?:\.\d{1,2})?$/.test(amountNorm) && Number(amountNorm) > 0;
      if (!isMoney) {
        return ctx.reply(`⚠️ Valor inválido: "${amount}". Informe um número positivo (ex.: 29,90).\n\n${USAGE(ctx.prefix)}`);
      }
      if (!/^[A-Za-z]{3}$/.test(currency)) {
        return ctx.reply(`⚠️ Moeda inválida: "${currency}". Use um código de 3 letras (ex.: BRL, USD, IDR).\n\n${USAGE(ctx.prefix)}`);
      }

      // Mensagem ÚNICA para o JID atual. Em grupo, os membros comuns vão como
      // `mentions` (não há envio individual por participante).
      const payPayload = {
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
      };

      const memberJids = await groupMemberMentions(ctx);
      if (memberJids.length) payPayload.mentions = memberJids;

      await ctx.socket.sendMessage(ctx.remoteJid, payPayload);
    },
  },
];
