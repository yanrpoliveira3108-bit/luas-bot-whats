'use strict';

const session = require('../../utils/session');
const games = require('../../database/games');
const users = require('../../database/users');

const LETTERS = ['A', 'B', 'C', 'D'];

module.exports = [
  {
    name: 'quiz',
    commands: ['quiz', 'perguntas'],
    category: 'games',
    description: 'Quiz de perguntas e respostas.',
    usage: '!quiz [categoria]',
    cooldown: 3000,
    execute: async (ctx) => {
      const catArg = (ctx.args[0] || '').toLowerCase();
      const cats = games.getQuizCategories();
      const category = cats.find((c) => c.toLowerCase() === catArg) || null;

      const questions = games.getQuizQuestions(category, 5);
      if (!questions.length) {
        return ctx.reply(`📭 Sem perguntas${category ? ` para "${category}"` : ''} ainda.`);
      }

      const state = { idx: 0, score: 0, questions, category: category || 'geral' };
      const ask = async (c) => {
        const q = state.questions[state.idx];
        const options = JSON.parse(q.options);
        const lines = [`❓ *Pergunta ${state.idx + 1}/${state.questions.length}* [${q.category}]`, '', q.question, ''];
        options.forEach((o, i) => lines.push(`${LETTERS[i]}) ${o}`));
        lines.push('', '_Responda com a letra (A, B, C ou D)._');
        await c.reply(lines.join('\n'));
      };

      session.set(ctx.remoteJid, ctx.sender, {
        type: 'quiz',
        onMessage: async (c) => {
          const ans = c.text.trim().toUpperCase().replace(/[^A-D]/g, '');
          if (!ans) {
            await c.reply('❓ Responda com A, B, C ou D.');
            return;
          }
          const q = state.questions[state.idx];
          const correctLetter = LETTERS[q.answer_index];
          if (ans === correctLetter) {
            state.score++;
            await c.reply('✅ Correto!');
          } else {
            await c.reply(`❌ Errado! A resposta era *${correctLetter}*.`);
          }
          state.idx++;
          if (state.idx >= state.questions.length) {
            session.clear(c.remoteJid, c.sender);
            games.recordQuizScore(c.sender, state.category, state.score, state.questions.length);
            users.addReputation(c.sender, state.score);
            await c.reply(`🏁 *Quiz finalizado!*\n▸ Acertos: ${state.score}/${state.questions.length}\nUse !top quiz para ver o ranking.`);
          } else {
            await ask(c);
          }
        },
      });

      const catNames = cats.join(', ');
      await ctx.reply(`❓ *Quiz* — categorias: ${catNames}\nComeçando com ${category || 'perguntas sortidas'}...`);
      await ask(ctx);
    },
  },
];
