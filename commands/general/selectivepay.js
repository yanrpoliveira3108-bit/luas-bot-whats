/**
 * commands/general/selectivepay.js — CLI de teste do transporte seletivo.
 *
 * EXPERIMENTAL (ver utils/selective.js). NÃO substitui o socket; usa a API
 * anexada em connection/connect.js.
 *
 *   !sp normal                  → payment normal (todos)
 *   !sp members                 → payment só para membros (não-admin)
 *   !sp admins                  → payment só para admins
 *   !sp custom 5511...          → payment só para o JID informado
 *   !st <modo>                  → controle com texto (mesma mecânica)
 *
 * Dono apenas (ownerOnly) e somente em grupos. Nunca altera o prefixo global.
 */

'use strict';

const selective = require('../../utils/selective');
const theme = require('../../utils/theme');

const PAYMENT = {
  amount: '1000',
  currency: 'BRL',
  note: 'TESTE SELETIVO LUA',
};

function parseMode(args) {
  const mode = String((args[0] || 'normal')).toLowerCase();
  if (!selective.VALID_MODES.includes(mode)) return { mode: null };
  const recipients = mode === 'custom' ? args.slice(1).filter(Boolean) : [];
  return { mode, recipients };
}

function box(summary) {
  const c = theme.colors(theme.activeId());
  const lines = [
    '╭─────────────────',
    '│ 🌙 SELECTIVE ' + (summary.kind === 'payment' ? 'PAYMENT' : 'TEXT'),
    '├─────────────────',
    `│ Mode: ${String(summary.mode).toUpperCase()}`,
    `│ Group: ${summary.group}`,
    `│ Requested: ${summary.requestedRecipients.length || (summary.mode === 'custom' ? summary.requestedRecipients.length : summary.selectedParticipants.length)}`,
    `│ Selected: ${summary.selectedParticipants.length}`,
    `│ Devices: ${summary.resolvedDevices === undefined ? '—' : summary.resolvedDevices}`,
    `│ SenderKeyRecipients: ${summary.senderKeyRecipients === undefined ? '—' : summary.senderKeyRecipients}`,
    `│ Message ID: ${summary.messageId}`,
    '╰─────────────────',
    `☾ ${c.tagline}`,
  ];
  return lines.join('\n');
}

async function run(ctx, kind) {
  // Modo seguro: pedido de pagamento (requestPaymentMessage) em conta pessoal
  // é um dos payloads que o WhatsApp associa a uso indevido/automação.
  if (require('../../utils/safety').blocksPaymentTest()) {
    await ctx.reply(
      '🛑 *Modo seguro ativo* — o teste de pagamento seletivo está desativado.\n' +
        '_Esse payload (pedido de pagamento) em conta pessoal é um dos que geram restrição._\n' +
        '▸ Para reativar assumindo o risco: `ALLOW_PAYMENT_TEST=1` no .env'
    );
    return;
  }
  const { mode, recipients } = parseMode(ctx.args);
  if (!mode) {
    await ctx.reply(
      '⚠️ *Modo inválido.*\n\n' +
        '▸ `!sp normal` — payment para todos\n' +
        '▸ `!sp members` — só membros\n' +
        '▸ `!sp admins` — só admins\n' +
        '▸ `!sp custom <jid>` — só quem você informar\n' +
        '▸ `!st <modo>` — mesmo teste com texto'
    );
    return;
  }

  try {
    const options = { mode, recipients };
    const summary =
      kind === 'payment'
        ? await selective.sendSelectivePaymentMessage(ctx.socket, ctx.remoteJid, PAYMENT, options)
        : await selective.sendSelectiveTextMessage(
            ctx.socket,
            ctx.remoteJid,
            `🌙 LUA — teste seletivo (${mode})`,
            options
          );
    await ctx.reply(box(summary));
  } catch (err) {
    await ctx.reply(
      `⚠️ *Envio seletivo recusado.*\n\n_${err && err.message ? err.message : 'erro desconhecido'}_`
    );
  }
}

module.exports = [
  {
    name: 'selectivepay',
    commands: ['sp'],
    aliases: ['selectivepayment', 'spay'],
    category: 'general',
    description: '(experimental) Payment de grupo com transporte seletivo de recipients.',
    usage: '!sp members|admins|custom <jid>|normal',
    ownerOnly: true,
    groupOnly: true,
    cooldown: 6000,
    execute: (ctx) => run(ctx, 'payment'),
  },
  {
    name: 'selectivetext',
    commands: ['st'],
    aliases: ['selectivetext'],
    category: 'general',
    description: '(experimental) Texto de grupo com transporte seletivo (controle).',
    usage: '!st members|admins|custom <jid>|normal',
    ownerOnly: true,
    groupOnly: true,
    cooldown: 6000,
    execute: (ctx) => run(ctx, 'text'),
  },
];
