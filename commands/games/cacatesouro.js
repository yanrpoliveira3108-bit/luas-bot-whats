'use strict';

const session = require('../../utils/session');
const games = require('../../database/games');

const ROWS = ['a', 'b', 'c'];
const COLS = [1, 2, 3];

module.exports = [
  {
    name: 'cacatesouro',
    commands: ['cacatesouro', 'cacar', 'tesouro'],
    category: 'games',
    description: 'Encontre o tesouro no mapa 3x3.',
    usage: '!cacatesouro (depois: a1..c3)',
    cooldown: 5000,
    execute: async (ctx) => {
      const treasure = `${ROWS[Math.floor(Math.random() * 3)]}${COLS[Math.floor(Math.random() * 3)]}`;
      let attempts = 0;
      session.set(ctx.remoteJid, ctx.sender, {
        type: 'cacatesouro',
        onMessage: async (c) => {
          const guess = c.text.trim().toLowerCase();
          if (guess.startsWith('!cancelar')) {
            session.clear(c.remoteJid, c.sender);
            await c.reply('❌ Caça cancelada.');
            return;
          }
          if (!/^[a-c][1-3]$/.test(guess)) {
            await c.reply('🗺️ Coordenada inválida. Use a1, b2, c3...');
            return;
          }
          attempts++;
          if (guess === treasure) {
            session.clear(c.remoteJid, c.sender);
            games.recordGame(c.sender, 'cacatesouro', 'win');
            await c.reply(`💰 *Tesouro encontrado em ${guess}!* (${attempts} tentativa(s))`);
            return;
          }
          if (attempts >= 3) {
            session.clear(c.remoteJid, c.sender);
            games.recordGame(c.sender, 'cacatesouro', 'loss');
            await c.reply(`💀 Você não encontrou! O tesouro estava em *${treasure}*.`);
            return;
          }
          await c.reply(`❌ Nada em ${guess}. Tente de novo (${3 - attempts} tentativa(s) restantes).`);
        },
      });
      await ctx.reply('🗺️ *Caça ao tesouro*\nMapa 3x3: linhas a-c, colunas 1-3.\nDigite uma coordenada (ex.: b2). Você tem 3 tentativas!');
    },
  },
];
