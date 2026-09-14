/**
 * database/investments.js — fundo de investimento com rendimento variável.
 *
 * O rendimento muda por dia (determinístico, sem rede) e pode ser negativo.
 * O valor é acumulado dia a dia a partir da data do investimento.
 * Operações de saldo devem ser chamadas dentro de withLock.
 */

'use strict';

const { prepare } = require('./database');
const economy = require('./economy');

const DAY_MS = 86400000;

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Taxa diária determinística entre -4% e +10%. */
function dailyRate(day) {
  const h = hashStr('invest:' + day);
  return (h % 1401) / 10000 - 0.04;
}

/** Taxa de hoje (para exibição). */
function todayRate(now = Date.now()) {
  return dailyRate(Math.floor(now / DAY_MS));
}

/** Valor atual de um investimento (composto dia a dia, cap 180 dias). */
function valueOf(invested, investedAt, now = Date.now()) {
  if (!invested || investedAt <= 0) return invested;
  const startDay = Math.floor(investedAt / DAY_MS);
  const endDay = Math.floor(now / DAY_MS);
  let value = invested;
  let d = startDay;
  for (; d < endDay && d - startDay < 180; d++) {
    value *= 1 + dailyRate(d);
  }
  if (d === endDay) {
    const frac = (now % DAY_MS) / DAY_MS;
    value *= 1 + dailyRate(endDay) * frac;
  }
  return Math.floor(value);
}

function ensure(userId) {
  prepare('ens_inv', `INSERT OR IGNORE INTO investments (user_id, invested, invested_at) VALUES (?, 0, '')`).run(userId);
}

function get(userId) {
  ensure(userId);
  return prepare('get_inv', `SELECT * FROM investments WHERE user_id = ?`).get(userId);
}

/** Investe `valueCoins` (usa a carteira). Lança INSUFFICIENT_FUNDS. */
function invest(userId, valueCoins, now = Date.now()) {
  economy.addWallet(userId, -valueCoins);
  const row = get(userId);
  const next = row.invested + valueCoins;
  prepare('set_inv', `UPDATE investments SET invested = ?, invested_at = ? WHERE user_id = ?`).run(
    next,
    row.invested > 0 ? row.invested_at : new Date(now).toISOString(),
    userId
  );
  return { invested: next };
}

/** Resgata tudo (ou um valor) do fundo. */
function redeem(userId, valueOrNull, now = Date.now()) {
  const row = get(userId);
  const current = valueOf(row.invested, Date.parse(row.invested_at || now), now);
  if (current <= 0) throw new Error('INSUFFICIENT_FUNDS');
  const amount = valueOrNull === null ? current : Math.min(valueOrNull, current);
  const nextInvested = valueOrNull === null ? 0 : row.invested - Math.floor((amount / current) * row.invested);
  const safeNext = Math.max(0, nextInvested);
  prepare('set_inv', `UPDATE investments SET invested = ? WHERE user_id = ?`).run(safeNext, userId);
  economy.addWallet(userId, amount);
  return { amount, current, remaining: safeNext };
}

module.exports = { get, invest, redeem, valueOf, todayRate };
