/**
 * plugins/life/market.js — preços dinâmicos controlados.
 *
 * Cada item tem base/min/max. O preço oscila de forma DETERMINÍSTICA por dia
 * (hash item+dia) dentro dos limites, multiplicado pelos fatores de evento e
 * clima. Nunca sai da faixa [minPrice, maxPrice] — anti-inflação.
 *
 * Overrides: o dono pode ajustar com !setprice <item> <base> [min] [max]
 * (persistido em settings).
 */

'use strict';

const settings = require('../../database/settings');
const { multipliers } = require('./weather');
const { dayIndex } = require('./weather');

/** Hash simples e estável de uma string. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Override de preço do dono (JSON), se houver. */
function priceOverride(itemId) {
  const raw = settings.get(`life_price_${itemId}`, '');
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && Number.isFinite(o.base)) return o;
  } catch (_) {
    /* ignora override corrompido */
  }
  return null;
}

function setPriceOverride(itemId, { base, min, max }) {
  settings.set(`life_price_${itemId}`, JSON.stringify({ base, min, max }));
}

/**
 * Deriva base/min/max de um item da loja ou de uma definição de recurso.
 * @param {object} def { price|priceBase, sellPrice }
 */
function priceBounds(def, sellPrice) {
  const base = def.priceBase || def.price || def.basePrice || sellPrice * 2 || 0;
  const min = Math.max(1, Math.floor(base * 0.6));
  const max = Math.max(base + 1, Math.floor(base * 2.2));
  return { base, min, max };
}

/**
 * Preço de COMPRA atual de um item.
 * @returns {number} preço inteiro (≥ min, ≤ max)
 */
function computePrice(itemId, def, sellPrice) {
  const ov = priceOverride(itemId);
  const b = priceBounds(ov || def, ov ? ov.base : sellPrice);
  const m = multipliers();
  // oscilação determinística do dia (-12% .. +12%)
  const drift = ((hash(`${itemId}:${dayIndex()}`) % 25) - 12) / 100;
  const raw = b.base * m.priceMul * (typeof m.shopMul === 'number' ? m.shopMul : 1) * (1 + drift);
  const price = Math.round(Math.min(b.max, Math.max(b.min, raw)));
  return Math.max(1, price);
}

/** Preço de VENDA atual de um item (baseado no sellPrice do registro). */
function computeSellPrice(itemId, sellPrice) {
  const ov = priceOverride(itemId);
  const base = ov && Number.isFinite(ov.base) ? ov.base : sellPrice || 0;
  const m = multipliers();
  const sell = base * 0.5 * m.sellMul;
  return Math.max(1, Math.round(sell));
}

/** Tendência do dia para exibição (alta/baixa/estável). */
function trend(itemId) {
  const drift = ((hash(`${itemId}:${dayIndex()}`) % 25) - 12) / 100;
  if (drift > 0.03) return { label: '⬆️ Mercado em alta', dir: 1 };
  if (drift < -0.03) return { label: '⬇️ Mercado em baixa', dir: -1 };
  return { label: '➖ Mercado estável', dir: 0 };
}

module.exports = {
  computePrice,
  computeSellPrice,
  trend,
  priceBounds,
  setPriceOverride,
  priceOverride,
};
