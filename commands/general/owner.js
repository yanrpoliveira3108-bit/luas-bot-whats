/**
 * commands/general/owner.js — contato do dono.
 *
 * O nome/desenvolvedor vêm de utils/creatorProfile.js (editáveis por
 * !setcriador), então mudar lá atualiza aqui e no cartão !criador ao mesmo
 * tempo. O número do contato sai do link de suporte quando ele for wa.me,
 * senão do OWNER_NUMBER do .env.
 */

'use strict';

const CONFIG = require('../../config');
const creatorProfile = require('../../utils/creatorProfile');

function supportNumber() {
  const url = String(creatorProfile.get('supportUrl') || '');
  const m = url.match(/wa\.me\/(\d{8,15})/i);
  if (m) return m[1];
  return (CONFIG.owner && CONFIG.owner.numbers && CONFIG.owner.numbers[0]) || '0';
}

function ownerVcard(name) {
  const number = supportNumber();
  return (
    'BEGIN:VCARD\n' +
    'VERSION:3.0\n' +
    `FN:${name}\n` +
    `TEL;type=CELL;waid=${number}:+${number}\n` +
    'END:VCARD'
  );
}

module.exports = [
  {
    name: 'owner',
    commands: ['owner', 'dono'], // 'criador' agora é o cartão rico: commands/general/criador.js
    category: 'general',
    description: 'Mostra o contato do dono do bot.',
    usage: '!owner',
    cooldown: 3000,
    execute: async (ctx) => {
      const name = creatorProfile.get('name');
      const developer = creatorProfile.get('developer');
      const custom = creatorProfile.isCustom('name') ? '' : '\n\n💡 O dono pode trocar esses dados com o comando de configuração.';

      await ctx.reply(
        `👑 *Dono do ${(CONFIG.bot && CONFIG.bot.name) || 'Lua Bot'}*\n▸ ${name}\n▸ Feito por: ${developer}${custom}`
      );
      try {
        await ctx.socket.sendMessage(ctx.remoteJid, {
          contacts: { displayName: name, contacts: [{ vcard: ownerVcard(name) }] },
        });
      } catch (_) {
        /* contato pode falhar em alguns clientes */
      }
    },
  },
];
