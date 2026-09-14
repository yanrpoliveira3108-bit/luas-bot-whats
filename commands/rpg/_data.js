/**
 * commands/rpg/_data.js — dados do RPG/Lua Life (plantações e animais).
 * Arquivo com "_" é ignorado pelo loader de comandos.
 *
 * As profissões evoluíram para o Lua Life e agora vivem em
 * plugins/life/config.js (JOBS) — importadas por jobs.js.
 */

'use strict';

const H = 3600 * 1000;
const M = 60 * 1000;

/** Plantações (id da semente -> dados de cultivo). */
const CROPS = {
  semente_trigo: { name: 'Trigo', emoji: '🌾', growMs: 2 * H, yieldRange: [60, 90], xp: 10 },
  semente_milho: { name: 'Milho', emoji: '🌽', growMs: 3 * H, yieldRange: [90, 130], xp: 12 },
  semente_cenoura: { name: 'Cenoura', emoji: '🥕', growMs: 4 * H, yieldRange: [120, 180], xp: 15 },
  semente_batata: { name: 'Batata', emoji: '🥔', growMs: 1 * H, yieldRange: [40, 70], xp: 8 },
  semente_tomate: { name: 'Tomate', emoji: '🍅', growMs: 90 * M, yieldRange: [55, 95], xp: 10 },
  semente_morango: { name: 'Morango', emoji: '🍓', growMs: 6 * H, yieldRange: [200, 300], xp: 20 },
  semente_melancia: { name: 'Melancia', emoji: '🍉', growMs: 8 * H, yieldRange: [280, 480], xp: 24 },
  semente_uva: { name: 'Uva', emoji: '🍇', growMs: 10 * H, yieldRange: [600, 900], xp: 30 },
  semente_cafe: { name: 'Café', emoji: '☕', growMs: 12 * H, yieldRange: [600, 800], xp: 30 },
};

/** Animais da fazenda (produção vendável ao alimentar/coletar). */
const ANIMALS = {
  galinha: { name: 'Galinha', emoji: '🐔', product: 'Ovo', productPrice: 25, productMs: 2 * H },
  vaca: { name: 'Vaca', emoji: '🐄', product: 'Leite', productPrice: 120, productMs: 4 * H },
  porco: { name: 'Porco', emoji: '🐖', product: 'Bacon', productPrice: 90, productMs: 3 * H },
  ovelha: { name: 'Ovelha', emoji: '🐑', product: 'Lã', productPrice: 110, productMs: 3 * H },
  cabra: { name: 'Cabra', emoji: '🐐', product: 'Leite de cabra', productPrice: 130, productMs: 4 * H },
  cavalo: { name: 'Cavalo', emoji: '🐴', product: null, productPrice: 0, productMs: 0 },
};

function randomBetween([min, max]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

module.exports = { CROPS, ANIMALS, randomBetween };
