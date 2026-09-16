/**
 * commands/owner/pixfiltro.js — liga/desliga o filtro de entrega seletiva do PIX.
 *
 * O filtro (PIX_SELECTIVE no .env) decide se o PIX em grupo usa o transporte
 * seletivo real do vendor (selectiveParticipants) ou o envio normal com mentions.
 * Este comando permite alternar em RUNTIME, sem editar o .env, guardando o estado
 * no banco (settings) — que tem precedência sobre o padrão do .env.
 *
 * Uso:
 *   !pixfiltro            → mostra o status atual
 *   !pixfiltro on|ligar   → liga
 *   !pixfiltro off|desligar → desliga
 *
 * Exclusivo do dono (ownerOnly). Não altera o grupo, não envia mensagens de PIX.
 */

'use strict';

const settings = require('../../database/settings');
const CONFIG = require('../../config');

const KEY = 'pix:selective';

const ON = ['on', 'ligar', 'ativar', '1', 'true'];
const OFF = ['off', 'desligar', 'desativar', '0', 'false'];

function statusBox(ctx, enabled) {
  return (
    `🌙 *FILTRO PIX SELETIVO*\n` +
    `▸ Status: ${enabled ? '✅ LIGADO' : '⛔ DESLIGADO'}\n` +
    `\n` +
    `Quando LIGADO, o PIX em grupo tenta a entrega seletiva (só membros comuns ` +
    `recebem o transporte); em qualquer falha cai no envio normal com mentions.\n` +
    `⚠️ Não torna a mensagem invisível p/ admins (limitação de sender-key do WhatsApp).\n` +
    `\n` +
    `Use ${ctx.prefix}pixfiltro on | off para alternar.`
  );
}

module.exports = [
  {
    name: 'pixfiltro',
    commands: ['pixfiltro', 'filtro'],
    category: 'owner',
    ownerOnly: true,
    description: 'Liga/desliga o filtro de entrega seletiva do PIX em grupos.',
    usage: '!pixfiltro [on|off]',
    cooldown: 2000,
    execute: async (ctx) => {
      const arg = String(ctx.args[0] || '').toLowerCase();

      // padrão vem do .env (PIX_SELECTIVE); override em runtime fica no settings
      const atual = settings.getBool(KEY, !!(CONFIG.pix && CONFIG.pix.selective));

      if (!arg) return ctx.reply(statusBox(ctx, atual));

      if (ON.includes(arg)) {
        settings.set(KEY, 'true');
        return ctx.reply(`✅ Filtro PIX seletivo *LIGADO*.\nO próximo PIX em grupo tentará a entrega seletiva (com fallback seguro).`);
      }
      if (OFF.includes(arg)) {
        settings.set(KEY, 'false');
        return ctx.reply(`⛔ Filtro PIX seletivo *DESLIGADO*.\nO PIX em grupo usará o envio normal com mentions.`);
      }

      return ctx.reply(
        `⚠️ Use ${ctx.prefix}pixfiltro on | off (ou só ${ctx.prefix}pixfiltro p/ ver o status).`
      );
    },
  },
];
