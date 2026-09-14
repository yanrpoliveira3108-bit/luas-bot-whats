/**
 * database/seed/life.js — itens da loja do Lua Life.
 *
 * INSERT OR IGNORE por id: itens novos são adicionados mesmo em bancos
 * já existentes (idempotente). Reaproveita a tabela rpg_items.
 *
 * type: 'ferramenta' | 'semente' | 'animal' | 'comida' | 'consumivel' | 'especial'
 */

'use strict';

module.exports = [
  /* ---------------------------- ferramentas ---------------------------- */
  { id: 'picareta_simples', name: 'Picareta Simples', type: 'ferramenta', price: 300, sellPrice: 90, emoji: '⛏️', description: 'Mineração básica (25 usos).' },
  { id: 'picareta_reforcada', name: 'Picareta Reforçada', type: 'ferramenta', price: 900, sellPrice: 300, emoji: '⛏️', description: 'Mineração melhor (50 usos, +sorte).' },
  { id: 'picareta_pro', name: 'Picareta Profissional', type: 'ferramenta', price: 2500, sellPrice: 900, emoji: '⛏️', description: 'Mineração de elite (120 usos, ++sorte).' },
  { id: 'vara_simples', name: 'Vara Simples', type: 'ferramenta', price: 200, sellPrice: 60, emoji: '🎣', description: 'Pesca básica (25 usos).' },
  { id: 'vara_reforcada', name: 'Vara Reforçada', type: 'ferramenta', price: 700, sellPrice: 230, emoji: '🎣', description: 'Pesca melhor (50 usos, +sorte).' },
  { id: 'vara_pro', name: 'Vara Profissional', type: 'ferramenta', price: 2200, sellPrice: 800, emoji: '🎣', description: 'Pesca de elite (120 usos, ++sorte).' },
  { id: 'isca', name: 'Isca', type: 'consumivel', price: 40, sellPrice: 10, emoji: '🪱', description: '+sorte na pesca (1 uso).' },
  { id: 'comida', name: 'Comida', type: 'comida', price: 30, sellPrice: 8, emoji: '🍎', description: 'Restaura fome. Use !comer.' },

  /* ----------------------------- sementes ------------------------------ */
  { id: 'semente_batata', name: 'Semente de Batata', type: 'semente', price: 30, sellPrice: 8, emoji: '🥔', description: 'Cresce em 1h. Colheita: 50.' },
  { id: 'semente_tomate', name: 'Semente de Tomate', type: 'semente', price: 45, sellPrice: 12, emoji: '🍅', description: 'Cresce em 90min. Colheita: 70.' },
  { id: 'semente_melancia', name: 'Semente de Melancia', type: 'semente', price: 160, sellPrice: 45, emoji: '🍉', description: 'Cresce em 8h. Colheita: 380.' },
  { id: 'semente_uva', name: 'Semente de Uva', type: 'semente', price: 300, sellPrice: 85, emoji: '🍇', description: 'Cresce em 10h. Colheita: 800.' },

  /* ------------------------------ animais ------------------------------ */
  { id: 'porco', name: 'Porco', type: 'animal', price: 600, sellPrice: 320, emoji: '🐖', description: 'Produz bacon (venda: 90 a cada 3h).' },
  { id: 'ovelha', name: 'Ovelha', type: 'animal', price: 800, sellPrice: 430, emoji: '🐑', description: 'Produz lã (venda: 110 a cada 3h).' },
  { id: 'cabra', name: 'Cabra', type: 'animal', price: 1000, sellPrice: 540, emoji: '🐐', description: 'Produz leite de cabra (venda: 130 a cada 4h).' },

  /* ------------------------------ comida ------------------------------- */
  { id: 'pocao_felicidade', name: 'Poção de Felicidade', type: 'consumivel', price: 180, sellPrice: 50, emoji: '😊', description: '+50 felicidade. Use !usar pocao_felicidade.' },

  /* ----------------------------- especial ------------------------------ */
  { id: 'bilhete_loteria', name: 'Bilhete de Loteria', type: 'especial', price: 100, sellPrice: 0, emoji: '🎟️', description: 'Use !loteria para apostar.' },

  /* --------------------------- recursos (coleta) ----------------------- */
  { id: 'pedra', name: 'Pedra', type: 'recurso', price: 0, sellPrice: 8, emoji: '🪨', description: 'Minério básico.' },
  { id: 'carvao', name: 'Carvão', type: 'recurso', price: 0, sellPrice: 16, emoji: '🪵', description: 'Combustível natural.' },
  { id: 'cobre', name: 'Cobre', type: 'recurso', price: 0, sellPrice: 30, emoji: '🟠', description: 'Metal condutor.' },
  { id: 'prata', name: 'Prata', type: 'recurso', price: 0, sellPrice: 70, emoji: '🥈', description: 'Metal precioso.' },
  { id: 'ouro', name: 'Ouro', type: 'recurso', price: 0, sellPrice: 140, emoji: '🥇', description: 'Metal muito valioso.' },
  { id: 'diamante', name: 'Diamante', type: 'recurso', price: 0, sellPrice: 450, emoji: '💎', description: 'Pedra preciosa.' },
  { id: 'esmeralda', name: 'Esmeralda', type: 'recurso', price: 0, sellPrice: 700, emoji: '💚', description: 'Gema rara.' },
  { id: 'minerio_raro', name: 'Minério Raro', type: 'recurso', price: 0, sellPrice: 1500, emoji: '🔮', description: 'Achado lendário.' },
  { id: 'sardinha', name: 'Sardinha', type: 'recurso', price: 0, sellPrice: 20, emoji: '🐟', description: 'Peixe comum.' },
  { id: 'tilapia', name: 'Tilápia', type: 'recurso', price: 0, sellPrice: 35, emoji: '🐟', description: 'Peixe de água doce.' },
  { id: 'peixe_raro', name: 'Peixe Raro', type: 'recurso', price: 0, sellPrice: 90, emoji: '🐠', description: 'Peixe colorido e valioso.' },
  { id: 'peixe_exotico', name: 'Peixe Exótico', type: 'recurso', price: 0, sellPrice: 180, emoji: '🐡', description: 'Espécie exótica.' },
  { id: 'peixe_lendario', name: 'Peixe Lendário', type: 'recurso', price: 0, sellPrice: 650, emoji: '👑', description: 'O troféu dos pescadores.' },
];
