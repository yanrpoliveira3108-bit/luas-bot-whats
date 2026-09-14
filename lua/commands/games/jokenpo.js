'use strict';

const session = require('../../utils/session');
const games = require('../../database/games');

const CHOICES = { pedra: '🪨', papel: '📄', tesoura: '✂️' };

function winner(user, bot) {
  if (user === bot) return 'draw';
  const beats = { pedra: 'tesoura', papel: 'pedra', tesoura: 'papel' };
  return beats[user] === bot ? 'user' : 'bot';
}

module.exports = [
  {
    name: 'jokenpo',
    commands: ['jokenpo', 'rps', 'pedrapapeltesoura'],
    category: 'games',
    description: 'Jogue pedra, papel ou tesoura contra o bot.',
    usage: '!jokenpo (depois: pedra|papel|tesoura)',
    cooldown: 3000,
    execute: async (ctx) => {
      session.set(ctx.remoteJid, ctx.sender, {
        type: 'jokenpo',
        onMessage: async (c) => {
          const pick = c.text.trim().toLowerCase();
          if (pick.startsWith('!cancelar')) {
            session.clear(c.remoteJid, c.sender);
            await c.reply('❌ Jogo cancelado.');
            return;
          }
          if (!CHOICES[pick]) {
            await c.reply('✊ Escolha: *pedra*, *papel* ou *tesoura*.');
            return;
          }
          const bot = Object.keys(CHOICES)[Math.floor(Math.random() * 3)];
          const result = winner(pick, bot);
          session.clear(c.remoteJid, c.sender);
          const msg =
            `Você: ${CHOICES[pick]} • Bot: ${CHOICES[bot]}\n` +
            (result === 'draw' ? '🤝 Empate!' : result === 'user' ? '🎉 Você venceu!' : '🤖 O bot venceu!');
          games.recordGame(c.sender, 'jokenpo', result === 'draw' ? 'win' : result === 'user' ? 'win' : 'loss');
          await c.reply(msg);
        },
      });
      await ctx.reply('✊ *Pedra, Papel ou Tesoura?*\nResponda com pedra, papel ou tesoura.');
    },
  },
];
