'use strict';

const { runInteraction, displayName } = require('../../engine/interactionEngine');
const R = require('./_responses');

function make(name, desc, bank) {
  return {
    name,
    commands: [name],
    category: 'fun',
    description: desc,
    usage: `!${name} [@usuario]`,
    cooldown: 2000,
    execute: async (ctx) => {
      await runInteraction(ctx, { action: name, responses: bank, karma: 1 });
    },
  };
}

module.exports = [
  make('zoar', 'Zoa alguém (na brincadeira).', R.zoar),
  make('trollar', 'Trolla alguém.', R.trollar),
  make('roast', 'Zoação leve estilo roast.', R.roast),
  make('elogio', 'Elogia alguém.', R.elogio),
  make('verdade', 'Revela uma "verdade" sobre alguém.', R.verdade),
  make('desafio', 'Desafia alguém.', R.desafio),
  {
    name: 'eu',
    commands: ['eu'],
    category: 'fun',
    description: 'Autoelogio instantâneo.',
    usage: '!eu',
    cooldown: 2000,
    execute: async (ctx) => {
      await runInteraction(ctx, { action: 'eu', responses: R.eu, karma: 1 });
    },
  },
  {
    name: 'meme',
    commands: ['meme'],
    category: 'fun',
    description: 'Meme aleatório em texto.',
    usage: '!meme',
    cooldown: 2000,
    execute: async (ctx) => {
      const meme = R.meme[Math.floor(Math.random() * R.meme.length)];
      await ctx.reply(`😂 ${meme}`);
    },
  },
  {
    name: 'memeuser',
    commands: ['memeuser'],
    category: 'fun',
    description: 'Cria um meme com o usuário marcado.',
    usage: '!memeuser @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      await runInteraction(ctx, { action: 'memeuser', responses: R.memeuser, karma: 1 });
    },
  },
  {
    name: 'caption',
    commands: ['caption', 'legenda'],
    category: 'fun',
    description: 'Sugere uma legenda (para a imagem marcada).',
    usage: '!caption (respondendo a uma imagem)',
    cooldown: 2000,
    execute: async (ctx) => {
      const caption = R.caption[Math.floor(Math.random() * R.caption.length)];
      await ctx.reply(`${caption}`);
    },
  },
];
