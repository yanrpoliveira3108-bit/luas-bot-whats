'use strict';

const { runMeter } = require('../../engine/interactionEngine');

function make(name, desc, phrase) {
  return {
    name,
    commands: [name],
    category: 'fun',
    description: desc,
    usage: `!${name} [@usuario]`,
    cooldown: 2000,
    execute: async (ctx) => {
      await runMeter(ctx, name, phrase);
    },
  };
}

module.exports = [
  make('gaymer', 'Medidor de gaymer.', '🎮 {actor} é *{pct}%* gaymer!'),
  make('burro', 'Medidor de burrice (zoeira leve).', '🤡 {actor} está *{pct}%* burro(a) hoje!'),
  make('inteligente', 'Medidor de inteligência.', '🧠 {actor} é *{pct}%* inteligente!'),
  make('gado', 'Medidor de gado (zoeira leve).', '🐄 {actor} está *{pct}%* gado(a)!'),
  make('sigma', 'Medidor de sigma.', '🗿 {actor} é *{pct}%* sigma!'),
  make('based', 'Medidor de based.', '😎 {actor} é *{pct}%* based!'),
  {
    name: 'chance',
    commands: ['chance', 'probabilidade'],
    category: 'fun',
    description: 'Chance de algo acontecer.',
    usage: '!chance <evento>',
    cooldown: 2000,
    execute: async (ctx) => {
      const evento = ctx.args.join(' ') || 'isso acontecer';
      const pct = Math.floor(Math.random() * 101);
      await ctx.reply(`🎲 A chance de *${evento}* é de *${pct}%*.`);
    },
  },
  {
    name: 'sorte',
    commands: ['sorte', 'sortehoje'],
    category: 'fun',
    description: 'Sua sorte de hoje.',
    usage: '!sorte',
    cooldown: 2000,
    execute: async (ctx) => {
      const pct = Math.floor(Math.random() * 101);
      const msg = pct >= 80 ? '🍀 Sorte altíssima!' : pct >= 50 ? '✨ Sorte boa!' : pct >= 20 ? '🌤️ Sorte mediana.' : '🌧️ Hoje não, hein...';
      await ctx.reply(`🔮 Sua sorte hoje: *${pct}%*\n${msg}`);
    },
  },
  {
    name: 'azar',
    commands: ['azar'],
    category: 'fun',
    description: 'Seu nível de azar.',
    usage: '!azar',
    cooldown: 2000,
    execute: async (ctx) => {
      const pct = Math.floor(Math.random() * 101);
      await ctx.reply(`🍀 Seu azar hoje: *${pct}%* ${pct >= 70 ? '... cuidado com tomadas. ⚡' : ''}`);
    },
  },
];
