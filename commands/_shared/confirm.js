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
  const dados = {
    type: 'confirm',
    label,
    action: fn,
    onMessage: async (c) => {
      const t = c.text.trim().toLowerCase().replace(/^[!.]/, '');
      if (t === 'sim' || t === 's' || t === 'yes' || t === 'confirmar') {
        session.clearTodas(c.remoteJid, dados);
        await fn(c);
      } else if (t === 'nao' || t === 'n' || t === 'não' || t === 'no' || t === 'cancelar') {
        session.clearTodas(c.remoteJid, dados);
        await c.reply('✅ Ação cancelada.');
      } else {
        await c.reply('⚠️ Responda *sim* ou *não*.');
      }
    },
  };
  // gravada por TODAS as formas do remetente (PN, LID, com/sem dispositivo):
  // em grupo LID a resposta pode chegar identificada de outra forma e a
  // confirmação "sumia" — o dono via o pedido e o bot parecia ignorar o "sim"
  session.setAny(ctx.remoteJid, ctx.identidades || [ctx.sender], dados);
  await ctx.reply(`⚠️ Confirmar: *${label}*?\nResponda *sim* ou *não* (válido por 30s).`);
}

module.exports = { confirmAction };
