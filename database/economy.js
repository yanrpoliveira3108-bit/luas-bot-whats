/**
 * database/economy.js — carteira, banco, transferências e inventário.
 *
 * As operações que mexem em saldo devem ser chamadas dentro de
 * utils/keyedMutex.withLock(jid, ...) para evitar race conditions.
 */

'use strict';

const { prepare, get: getDb } = require('./database');
const now = () => new Date().toISOString();

function ensure(userId) {
  prepare(
    'ensure_econ',
    `INSERT OR IGNORE INTO economy (user_id) VALUES (?)`
  ).run(userId);
}

function get(userId) {
  ensure(userId);
  return prepare('get_econ', `SELECT * FROM economy WHERE user_id = ?`).get(userId);
}

/**
 * Adiciona (ou remove) dinheiro da carteira, sem permitir saldo negativo.
 * Lança erro 'INSUFFICIENT_FUNDS' se delta < 0 e saldo insuficiente.
 */
function addWallet(userId, delta) {
  ensure(userId);
  const tx = getDb().transaction(() => {
    const row = get(userId);
    const next = row.wallet + delta;
    if (next < 0) throw new Error('INSUFFICIENT_FUNDS');
    prepare('set_wallet', `UPDATE economy SET wallet = ?, total_earned = total_earned + ? WHERE user_id = ?`).run(
      next,
      delta > 0 ? delta : 0,
      userId
    );
    return next;
  });
  return tx();
}

function setWallet(userId, value) {
  ensure(userId);
  const v = Math.max(0, Math.floor(value));
  return prepare('set_wallet', `UPDATE economy SET wallet = ? WHERE user_id = ?`).run(v, userId);
}

function addBank(userId, delta) {
  ensure(userId);
  const tx = getDb().transaction(() => {
    const row = get(userId);
    const next = row.bank + delta;
    if (next < 0) throw new Error('INSUFFICIENT_FUNDS');
    prepare('set_bank', `UPDATE economy SET bank = ? WHERE user_id = ?`).run(next, userId);
    return next;
  });
  return tx();
}

/** Deposita da carteira para o banco. */
function deposit(userId, amount) {
  const tx = getDb().transaction(() => {
    const row = get(userId);
    if (amount <= 0 || row.wallet < amount) throw new Error('INSUFFICIENT_FUNDS');
    prepare('set_wallet', `UPDATE economy SET wallet = wallet - ? WHERE user_id = ?`).run(amount, userId);
    prepare('set_bank', `UPDATE economy SET bank = bank + ? WHERE user_id = ?`).run(amount, userId);
  });
  tx();
}

/** Saca do banco para a carteira. */
function withdraw(userId, amount) {
  const tx = getDb().transaction(() => {
    const row = get(userId);
    if (amount <= 0 || row.bank < amount) throw new Error('INSUFFICIENT_FUNDS');
    prepare('set_bank', `UPDATE economy SET bank = bank - ? WHERE user_id = ?`).run(amount, userId);
    prepare('set_wallet', `UPDATE economy SET wallet = wallet + ? WHERE user_id = ?`).run(amount, userId);
  });
  tx();
}

/** Transfere da carteira de `from` para a carteira de `to`. */
function transfer(fromId, toId, amount) {
  const tx = getDb().transaction(() => {
    const from = get(fromId);
    if (amount <= 0 || from.wallet < amount) throw new Error('INSUFFICIENT_FUNDS');
    ensure(toId);
    prepare('set_wallet', `UPDATE economy SET wallet = wallet - ? WHERE user_id = ?`).run(amount, fromId);
    prepare('set_wallet', `UPDATE economy SET wallet = wallet + ? WHERE user_id = ?`).run(amount, toId);
  });
  tx();
}

function recordTransaction(userId, type, amount, note) {
  return prepare(
    'add_tx',
    `INSERT INTO transactions (user_id, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, type, amount, note || '', now());
}

function history(userId, limit = 10) {
  return prepare(
    'tx_history',
    `SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`
  ).all(userId, limit);
}

/* ------------------------------ inventário ------------------------- */

function addItem(userId, itemId, qty) {
  const n = Math.max(0, Math.floor(qty));
  prepare(
    'add_item',
    `INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity`
  ).run(userId, itemId, n);
}

function removeItem(userId, itemId, qty) {
  const n = Math.max(0, Math.floor(qty));
  const row = prepare('get_item', `SELECT * FROM inventory WHERE user_id = ? AND item_id = ?`).get(userId, itemId);
  if (!row || row.quantity < n) throw new Error('NOT_ENOUGH_ITEMS');
  if (row.quantity === n) {
    prepare('del_item', `DELETE FROM inventory WHERE user_id = ? AND item_id = ?`).run(userId, itemId);
  } else {
    prepare('dec_item', `UPDATE inventory SET quantity = quantity - ? WHERE user_id = ? AND item_id = ?`).run(n, userId, itemId);
  }
}

function getItem(userId, itemId) {
  return prepare('get_item', `SELECT * FROM inventory WHERE user_id = ? AND item_id = ?`).get(userId, itemId) || null;
}

function inventory(userId) {
  return prepare(
    'list_inv',
    `SELECT i.item_id, i.quantity, r.name, r.type, r.emoji, r.description
     FROM inventory i LEFT JOIN rpg_items r ON r.id = i.item_id
     WHERE i.user_id = ? ORDER BY r.type, r.name`
  ).all(userId);
}

/** Ranking por dinheiro (carteira + banco). */
function rankWallet(limit = 10) {
  return prepare(
    'rank_wallet',
    `SELECT user_id, (wallet + bank) AS v FROM economy ORDER BY v DESC LIMIT ?`
  ).all(limit);
}

module.exports = {
  ensure,
  get,
  addWallet,
  setWallet,
  addBank,
  deposit,
  withdraw,
  transfer,
  recordTransaction,
  history,
  addItem,
  removeItem,
  getItem,
  inventory,
  rankWallet,
};
