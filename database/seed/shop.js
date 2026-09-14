/**
 * database/seed/shop.js — itens iniciais da loja do RPG.
 */

'use strict';

module.exports = [
  // sementes
  { id: 'semente_trigo', name: 'Semente de Trigo', type: 'semente', price: 40, sellPrice: 10, emoji: '🌾', description: 'Cresce em 2h. Colheita: 80 🌙' },
  { id: 'semente_milho', name: 'Semente de Milho', type: 'semente', price: 55, sellPrice: 15, emoji: '🌽', description: 'Cresce em 3h. Colheita: 120 🌙' },
  { id: 'semente_cenoura', name: 'Semente de Cenoura', type: 'semente', price: 70, sellPrice: 20, emoji: '🥕', description: 'Cresce em 4h. Colheita: 160 🌙' },
  { id: 'semente_morango', name: 'Semente de Morango', type: 'semente', price: 110, sellPrice: 30, emoji: '🍓', description: 'Cresce em 6h. Colheita: 260 🌙' },
  { id: 'semente_cafe', name: 'Semente de Café', type: 'semente', price: 260, sellPrice: 70, emoji: '☕', description: 'Cresce em 12h. Colheita: 700 🌙' },

  // animais
  { id: 'galinha', name: 'Galinha', type: 'animal', price: 300, sellPrice: 150, emoji: '🐔', description: 'Produz ovos (venda: 25 🌙 a cada 2h).' },
  { id: 'vaca', name: 'Vaca', type: 'animal', price: 1200, sellPrice: 700, emoji: '🐄', description: 'Produz leite (venda: 120 🌙 a cada 4h).' },
  { id: 'cavalo', name: 'Cavalo', type: 'animal', price: 3000, sellPrice: 1900, emoji: '🐴', description: 'Animal de prestígio da fazenda.' },

  // ferramentas / utilitários
  { id: 'regador', name: 'Regador', type: 'ferramenta', price: 150, sellPrice: 50, emoji: '🚿', description: 'Precisa para regar plantações.' },
  { id: 'vara_pescar', name: 'Vara de Pescar', type: 'ferramenta', price: 500, sellPrice: 180, emoji: '🎣', description: 'Necessária para trabalhar como pescador.' },
  { id: 'machado', name: 'Machado', type: 'ferramenta', price: 700, sellPrice: 260, emoji: '🪓', description: 'Necessário para trabalhar como lenhador.' },
  { id: 'picareta', name: 'Picareta', type: 'ferramenta', price: 800, sellPrice: 300, emoji: '⛏️', description: 'Necessária para trabalhar como minerador.' },

  // consumíveis
  { id: 'pocao_energia', name: 'Poção de Energia', type: 'consumivel', price: 200, sellPrice: 60, emoji: '⚡', description: 'Restaura 100 de energia.' },
  { id: 'fertilizante', name: 'Fertilizante', type: 'consumivel', price: 150, sellPrice: 45, emoji: '💩', description: 'Reduz o tempo de crescimento em 25%.' },
];
