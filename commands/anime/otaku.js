'use strict';

const { runMeter } = require('../../engine/interactionEngine');

const QUOTES = [
  '"Acredite em você mesmo. Senão, quem acreditará?" — Naruto',
  '"Não importa o quanto seja difícil, nunca desista." — Monkey D. Luffy',
  '"Se você não gosta do seu destino, não o aceite." — Naruto',
  '"O mundo não é perfeito. Mas ele existe para nós." — L (Death Note)',
  '"Trabalhe duro em silêncio e deixe o sucesso fazer o barulho." — inspirado em Saitama',
  '"Um herói não é quem nunca cai, e sim quem sempre se levanta." — inspirado em All Might',
  '"Proteja aqueles que ama, mesmo que isso custe tudo." — inspirado em Tanjiro',
  '"A força não vem da vitória; suas lutas desenvolvem suas forças." — inspirado em Goku',
];

module.exports = [
  {
    name: 'otaku',
    commands: ['otaku', 'otakometro'],
    category: 'anime',
    description: 'Mede seu nível de otaku.',
    usage: '!otaku [@usuario]',
    cooldown: 3000,
    execute: async (ctx) => {
      await runMeter(ctx, 'otaku', '🎌 {actor} é *{pct}%* otaku! 🍥');
    },
  },
  {
    name: 'quoteanime',
    commands: ['quoteanime', 'fraseanime', 'citacao'],
    category: 'anime',
    description: 'Frase aleatória inspirada em animes.',
    usage: '!quoteanime',
    cooldown: 3000,
    execute: async (ctx) => {
      const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      await ctx.reply(`🍥 ${quote}`);
    },
  },
];
