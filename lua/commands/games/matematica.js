'use strict';

const session = require('../../utils/session');
const games = require('../../database/games');

function randomExpr() {
  const ops = ['+', '-', '*'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a, b;
  if (op === '*') {
    a = 2 + Math.floor(Math.random() * 10);
    b = 2 + Math.floor(Math.random() * 10);
  } else if (op === '-') {
    a = 10 + Math.floor(Math.random() * 40);
    b = 1 + Math.floor(Math.random() * a);
  } else {
    a = 10 + Math.floor(Math.random() * 90);
    b = 10 + Math.floor(Math.random() * 90);
  }
  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
  return { text: `${a} ${op} ${b} = ?`, answer };
}

module.exports = [
  {
    name: 'matematica',
    commands: ['matematica', 'math', 'calcule'],
    category: 'games',
    description: 'Desafio de contas rápidas (5 rodadas).',
    usage: '!matematica',
    cooldown: 3000,
    execute: async (ctx) => {
      const state = { round: 1, total: 5, score: 0, current: randomExpr() };
      session.set(ctx.remoteJid, ctx.sender, {
        type: 'matematica',
        onMessage: async (c) => {
          if (c.text.trim().toLowerCase().startsWith('!cancelar')) {
            session.clear(c.remoteJid, c.sender);
            await c.reply('❌ Jogo cancelado.');
            return;
          }
          const n = parseInt(c.text.trim(), 10);
          if (!Number.isFinite(n)) {
            await c.reply('🔢 Responda apenas com o número.');
            return;
          }
          if (n === state.current.answer) {
            state.score++;
            await c.reply('✅ Correto!');
          } else {
            await c.reply(`❌ Errado! Era ${state.current.answer}.`);
          }
          if (state.round >= state.total) {
            session.clear(c.remoteJid, c.sender);
            games.recordGame(c.sender, 'matematica', state.score >= 3 ? 'win' : 'loss');
            await c.reply(`🧮 Fim! Você acertou *${state.score}/${state.total}*.`);
          } else {
            state.round++;
            state.current = randomExpr();
            await c.reply(`🧮 *Rodada ${state.round}/${state.total}*: ${state.current.text}`);
          }
        },
      });
      await ctx.reply(`🧮 *Matemática* — ${state.total} rodadas.\n*Rodada 1*: ${state.current.text}`);
    },
  },
];
