'use strict';

const CONFIG = require('../../config');

function ownerVcard() {
  const number = CONFIG.owner.numbers[0] || '0';
  return (
    'BEGIN:VCARD\n' +
    'VERSION:3.0\n' +
    `FN:${CONFIG.owner.name}\n` +
    `TEL;type=CELL;waid=${number}:+${number}\n` +
    'END:VCARD'
  );
}

module.exports = [
  {
    name: 'owner',
    commands: ['owner', 'dono', 'criador'],
    category: 'general',
    description: 'Mostra o contato do dono do bot.',
    usage: '!owner',
    cooldown: 3000,
    execute: async (ctx) => {
      await ctx.reply(`👑 *Dono do ${CONFIG.bot.name}*\n▸ ${CONFIG.owner.name}\n▸ Feito por: ${CONFIG.bot.author}`);
      try {
        await ctx.socket.sendMessage(ctx.remoteJid, {
          contacts: { displayName: CONFIG.owner.name, contacts: [{ vcard: ownerVcard() }] },
        });
      } catch (_) {
        /* contato pode falhar em alguns clientes */
      }
    },
  },
];
