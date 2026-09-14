'use strict';

const { sendMenu } = require('../../utils/menu');
const commandHandler = require('../../handlers/commandHandler');

const GAMES = [
  { id: 'dado', title: '🎲 Dado', desc: 'Rola um dado.', args: [] },
  { id: 'moeda', title: '🪙 Cara ou coroa', desc: 'Joga uma moeda.', args: [] },
  { id: 'adivinhacao', title: '🔢 Adivinhação', desc: 'Adivinhe o número.', args: [] },
  { id: 'matematica', title: '🧮 Matemática', desc: 'Resolva contas.', args: [] },
  { id: 'jokenpo', title: '✊ Pedra-Papel-Tesoura', desc: 'Desafie o bot.', args: [] },
  { id: 'batalha', title: '⚔️ Batalha', desc: 'Lute contra o bot.', args: [] },
  { id: 'cacatesouro', title: '🗺️ Caça ao tesouro', desc: 'Encontre o tesouro.', args: [] },
  { id: 'memoria', title: '🧠 Memória', desc: 'Repita a sequência.', args: [] },
  { id: 'quiz', title: '❓ Quiz', desc: 'Perguntas e respostas.', args: [] },
];

module.exports = [
  {
    name: 'games',
    commands: ['games', 'jogos'],
    category: 'games',
    description: 'Lista os jogos disponíveis.',
    usage: '!games',
    cooldown: 3000,
    execute: async (ctx) => {
      await sendMenu(ctx, {
        id: 'games',
        title: '🎮 Games',
        text: 'Escolha um jogo para começar.',
        rows: GAMES.map((g) => ({
          id: g.id,
          title: g.title,
          description: g.desc,
          run: (c) => commandHandler.runByName(c, g.id, g.args),
        })),
      });
    },
  },
];
