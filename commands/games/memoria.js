'use strict';

const session = require('../../utils/session');
const games = require('../../database/games');

module.exports = [
  {
    name: 'memoria',
    commands: ['memoria'],
    category: 'games',
    description: 'Memorize e repita a sequência de números.',
    usage: '!memoria',
    cooldown: 5000,
    execute: async (ctx) => {
      const state = { round: 1, total: 3, score: 0, sequence: '', phase: 'show' };

      const newRound = () => {
        state.sequence = Array.from({ length: state.round + 2 }, () => Math.floor(Math.random() * 10)).join('');
        state.phase = 'show';
        return state.sequence;
      };

      session.set(ctx.remoteJid, ctx.sender, {
        type: 'memoria',
        onMessage: async (c) => {
          if (c.text.trim().toLowerCase().startsWith('!cancelar')) {
            session.clear(c.remoteJid, c.sender);
            await c.reply('❌ Jogo cancelado.');
            return;
          }
          if (state.phase === 'show') {
            await c.reply(`🧠 A sequência era: *${state.sequence}*\nAgora digite a sequência que você memorizou.`);
            state.phase = 'answer';
            return;
          }
          // fase answer
          const answer = c.text.trim();
          if (answer === state.sequence) {
            state.score++;
            await c.reply('✅ Correto!');
          } else {
            await c.reply(`❌ Errado! Era *${state.sequence}*.`);
          }
          if (state.round >= state.total) {
            session.clear(c.remoteJid, c.sender);
            games.recordGame(c.sender, 'memoria', state.score >= 2 ? 'win' : 'loss');
            await c.reply(`🧠 Fim! Você acertou *${state.score}/${state.total}* sequências.`);
          } else {
            state.round++;
            const seq = newRound();
            await c.reply(`🧠 *Rodada ${state.round}/${state.total}*\nMemorize: *${seq}*\n(quando estiver pronto, envie qualquer mensagem)`);
          }
        },
      });

      const seq = newRound();
      await ctx.reply(`🧠 *Memória — rodada 1/${state.total}*\nMemorize a sequência: *${seq}*\n(envie qualquer mensagem quando estiver pronto)`);
    },
  },
];
