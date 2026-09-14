'use strict';

const session = require('../../utils/session');
const games = require('../../database/games');

module.exports = [
  {
    name: 'adivinhacao',
    commands: ['adivinhacao', 'adivinhar', 'guess'],
    category: 'games',
    description: 'Adivinhe o número de 1 a 100.',
    usage: '!adivinhacao',
    cooldown: 3000,
    execute: async (ctx) => {
      const secret = 1 + Math.floor(Math.random() * 100);
      let attempts = 0;
      session.set(ctx.remoteJid, ctx.sender, {
        type: 'adivinhacao',
        onMessage: async (c) => {
          const n = parseInt(c.text.trim(), 10);
          if (!Number.isFinite(n)) {
            await c.reply('🔢 Diga um número entre 1 e 100 (ou !cancelar).');
            return;
          }
          if (c.text.trim().toLowerCase().startsWith('!cancelar')) {
            session.clear(c.remoteJid, c.sender);
            await c.reply('❌ Jogo cancelado.');
            return;
          }
          attempts++;
          if (n === secret) {
            session.clear(c.remoteJid, c.sender);
            games.recordGame(c.sender, 'adivinhacao', 'win');
            await c.reply(`🎉 Acertou! O número era *${secret}* (${attempts} tentativas).`);
          } else {
            await c.reply(n < secret ? '⬆️ Maior...' : '⬇️ Menor...');
          }
        },
      });
      await ctx.reply('🔢 *Adivinhação*\nPensei em um número de 1 a 100. Diga seu palpite!');
    },
  },
];
