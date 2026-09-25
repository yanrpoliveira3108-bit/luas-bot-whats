/**
 * database/crypto.js — carteira de criptomoedas com preços flutuantes.
 *
 * Os preços mudam de forma DETERMINÍSTICA por janela de tempo (15 min),
 * sem depender de rede: mesmo preço para todos no mesmo período.
 * Todas as operações de saldo devem ser chamadas dentro de withLock.
 */

'use strict';

const { prepare } = require('./database');
const economy = require('./economy');

const TICK_MS = 15 * 60 * 1000; // preço "fixo" a cada 15 minutos

/** Moedas disponíveis (base em LuaCoins). */
const COINS = [
  { symbol: 'BTC', name: 'Bitcoin', emoji: '₿', base: 250000 },
  { symbol: 'ETH', name: 'Ethereum', emoji: 'Ξ', base: 18000 },
  { symbol: 'DOGE', name: 'Dogecoin', emoji: '🐕', base: 150 },
  { symbol: 'LUA', name: 'Lua Coin', emoji: '🌙', base: 50 },
];

function coin(symbol) {
  return COINS.find((c) => c.symbol === String(symbol || '').toUpperCase()) || null;
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Variação -15%..+15% determinística por (symbol, tick). */
function variance(symbol, tick) {
  const h = hashStr(symbol + ':' + tick);
  return (h % 3001) / 10000 - 0.15;
}

/** Preço atual (LuaCoins, inteiro) de uma moeda. */
function price(symbol, now = Date.now()) {
  const c = coin(symbol);
  if (!c) return null;
  const tick = Math.floor(now / TICK_MS);
  const p = Math.round(c.base * (1 + variance(c.symbol, tick)));
  return Math.max(1, p);
}

/** Variação percentual vs o período anterior (para exibir ▲/▼). */
function changePct(symbol, now = Date.now()) {
  const c = coin(symbol);
  if (!c) return 0;
  const tick = Math.floor(now / TICK_MS);
  const cur = price(c.symbol, now);
  const prev = Math.round(c.base * (1 + variance(c.symbol, tick - 1)));
  if (!prev) return 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function ensure(userId, symbol) {
  prepare('ens_cw', `INSERT OR IGNORE INTO crypto_wallet (user_id, symbol, amount, total_cost) VALUES (?, ?, 0, 0)`).run(userId, symbol);
}

function get(userId, symbol) {
  const c = coin(symbol);
  if (!c) return null;
  ensure(userId, c.symbol);
  return (
    prepare('get_cw', `SELECT * FROM crypto_wallet WHERE user_id = ? AND symbol = ?`).get(userId, c.symbol) || {
      user_id: userId,
      symbol: c.symbol,
      amount: 0,
      total_cost: 0,
    }
  );
}

function portfolio(userId) {
  return prepare('list_cw', `SELECT * FROM crypto_wallet WHERE user_id = ? AND amount > 0 ORDER BY symbol`).all(userId);
}

/** Compra `valueCoins` de uma moeda (usa a carteira). Lança INSUFFICIENT_FUNDS. */
function buy(userId, symbol, valueCoins, now = Date.now()) {
  const c = coin(symbol);
  if (!c) throw new Error('UNKNOWN_COIN');
  const p = price(c.symbol, now);
  const amount = valueCoins / p;

  // Movimenta carteira e grava na transactions / ledger
  economy.applyIdempotentOperation(`crypto-buy-${Date.now()}-${userId}`, userId, -valueCoins, 'cripto_compra', `Compra de ${amount.toFixed(6)} ${c.symbol}`);

  const row = get(userId, c.symbol);
  const nextAmount = row.amount + amount;
  const nextCost = row.total_cost + valueCoins;
  prepare(
    'ups_cw',
    `INSERT INTO crypto_wallet (user_id, symbol, amount, total_cost) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, symbol) DO UPDATE SET amount = excluded.amount, total_cost = excluded.total_cost`
  ).run(userId, c.symbol, nextAmount, nextCost);
  return { symbol: c.symbol, amount, price: p, valueCoins };
}

/** Vende `amount` (ou tudo) de uma moeda. Lança INSUFFICIENT_FUNDS se não tem. */
function sell(userId, symbol, amountOrNull, now = Date.now()) {
  const c = coin(symbol);
  if (!c) throw new Error('UNKNOWN_COIN');
  const row = get(userId, c.symbol);
  const amount = amountOrNull === null ? row.amount : amountOrNull;
  if (!amount || amount <= 0 || row.amount < amount) throw new Error('INSUFFICIENT_FUNDS');
  const p = price(c.symbol, now);
  const gain = Math.floor(amount * p);
  const cost = amount > 0 && row.amount > 0 ? Math.floor(row.total_cost * (amount / row.amount)) : 0;
  const nextAmount = row.amount - amount;
  const nextCost = Math.max(0, row.total_cost - cost);
  prepare(
    'ups_cw',
    `INSERT INTO crypto_wallet (user_id, symbol, amount, total_cost) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, symbol) DO UPDATE SET amount = excluded.amount, total_cost = excluded.total_cost`
  ).run(userId, c.symbol, nextAmount, nextCost);

  // Movimenta carteira e grava na transactions / ledger
  economy.applyIdempotentOperation(`crypto-sell-${Date.now()}-${userId}`, userId, gain, 'cripto_venda', `Venda de ${amount.toFixed(6)} ${c.symbol}`);

  return { symbol: c.symbol, amount, price: p, gain, cost };
}

module.exports = { COINS, coin, price, changePct, get, portfolio, buy, sell };
