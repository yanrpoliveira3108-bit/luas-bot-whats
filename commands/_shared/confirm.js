/**
 * commands/_shared/confirm.js — confirmação para comandos perigosos.
 *
 * Pasta/arquivo com prefixo "_" são ignorados pelo loader de comandos.
 */

'use strict';

const session = require('../../utils/session');

/**
 * Pede confirmação (sim/não) antes de executar `fn`.
 */
async function confirmAction(ctx, label, fn) {
  session.set(ctx.remoteJid, ctx.sender, {
    type: 'confirm',
    label,
    action: fn,
    onMessage: async (c) => {
      const t = c.text.trim().toLowerCase().replace(/^[!.]/, '');
      if (t === 'sim' || t === 's' || t === 'yes' || t === 'confirmar') {
        session.clear(c.remoteJid, c.sender);
        await fn(c);
      } else if (t === 'nao' || t === 'n' || t === 'não' || t === 'no' || t === 'cancelar') {
        session.clear(c.remoteJid, c.sender);
        await c.reply('✅ Ação cancelada.');
      } else {
        await c.reply('⚠️ Responda *sim* ou *não*.');
      }
    },
  });
  await ctx.reply(`⚠️ Confirmar: *${label}*?\nResponda *sim* ou *não* (válido por 30s).`);
}

module.exports = { confirmAction };
