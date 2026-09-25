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

/**
 * Transfere da carteira de `from` para a carteira de `to`.
 * Atômico e consistente.
 */
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

/**
 * Operação atômica e idempotente no livro-caixa com proteção de duplicidade de chave.
 * Se opKey já existir, retorna o registro salvo sem refazer a movimentação.
 * Executa débito/crédito, transactions e economy_ledger juntos na mesma transação.
 */
function applyIdempotentOperation(opKey, userId, delta, type, note = '', targetId = '') {
  if (!opKey) throw new Error('OP_KEY_REQUIRED');
  ensure(userId);

  const existing = prepare(
    'get_ledger_op',
    `SELECT * FROM economy_ledger WHERE op_key = ?`
  ).get(opKey);

  if (existing) {
    return { ok: true, duplicated: true, record: existing };
  }

  const tx = getDb().transaction(() => {
    // Dupla checagem dentro da transação
    const inTx = prepare(
      'get_ledger_op',
      `SELECT * FROM economy_ledger WHERE op_key = ?`
    ).get(opKey);
    if (inTx) return { ok: true, duplicated: true, record: inTx };

    const row = get(userId);
    const next = row.wallet + delta;
    if (next < 0) throw new Error('INSUFFICIENT_FUNDS');

    prepare('set_wallet', `UPDATE economy SET wallet = ?, total_earned = total_earned + ? WHERE user_id = ?`).run(
      next,
      delta > 0 ? delta : 0,
      userId
    );

    const txTime = now();
    prepare(
      'add_tx',
      `INSERT INTO transactions (user_id, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, type, delta, note || '', txTime);

    prepare(
      'add_ledger',
      `INSERT INTO economy_ledger (op_key, user_id, target_id, type, amount, balance_after, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(opKey, userId, targetId || '', type, delta, next, note || '', txTime);

    const record = {
      op_key: opKey,
      user_id: userId,
      target_id: targetId || '',
      type,
      amount: delta,
      balance_after: next,
      note: note || '',
      status: 'completed',
      created_at: txTime,
    };

    return { ok: true, duplicated: false, record };
  });

  return tx();
}

/**
 * Transferência atômica e idempotente entre dois usuários com registros para ambas as partes.
 */
function applyIdempotentTransfer(opKey, fromId, toId, amount, note = '') {
  if (!opKey) throw new Error('OP_KEY_REQUIRED');
  if (fromId === toId) throw new Error('SELF_TRANSFER_PROHIBITED');
  const n = Math.floor(amount);
  if (n <= 0) throw new Error('INVALID_AMOUNT');

  const existing = prepare(
    'get_ledger_op',
    `SELECT * FROM economy_ledger WHERE op_key = ?`
  ).get(opKey);

  if (existing) {
    return { ok: true, duplicated: true, record: existing };
  }

  const tx = getDb().transaction(() => {
    const inTx = prepare(
      'get_ledger_op',
      `SELECT * FROM economy_ledger WHERE op_key = ?`
    ).get(opKey);
    if (inTx) return { ok: true, duplicated: true, record: inTx };

    ensure(fromId);
    ensure(toId);

    const fromRow = get(fromId);
    if (fromRow.wallet < n) throw new Error('INSUFFICIENT_FUNDS');

    const nextFrom = fromRow.wallet - n;
    prepare('set_wallet', `UPDATE economy SET wallet = ? WHERE user_id = ?`).run(nextFrom, fromId);

    const toRow = get(toId);
    const nextTo = toRow.wallet + n;
    prepare('set_wallet', `UPDATE economy SET wallet = ?, total_earned = total_earned + ? WHERE user_id = ?`).run(
      nextTo,
      n,
      toId
    );

    const txTime = now();
    const fromNote = note ? `${note} (para ${toId})` : `transferência para ${toId}`;
    const toNote = note ? `${note} (de ${fromId})` : `transferência de ${fromId}`;

    prepare(
      'add_tx',
      `INSERT INTO transactions (user_id, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(fromId, 'transfer_out', -n, fromNote, txTime);

    prepare(
      'add_tx',
      `INSERT INTO transactions (user_id, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(toId, 'transfer_in', n, toNote, txTime);

    prepare(
      'add_ledger',
      `INSERT INTO economy_ledger (op_key, user_id, target_id, type, amount, balance_after, note, status, created_at)
       VALUES (?, ?, ?, 'transfer', ?, ?, ?, 'completed', ?)`
    ).run(opKey, fromId, toId, n, nextFrom, note || '', txTime);

    const record = {
      op_key: opKey,
      user_id: fromId,
      target_id: toId,
      type: 'transfer',
      amount: n,
      balance_after: nextFrom,
      note: note || '',
      status: 'completed',
      created_at: txTime,
    };

    return { ok: true, duplicated: false, record };
  });

  return tx();
}

function recordTransaction(userId, type, amount, note) {
  return prepare(
    'add_tx',
    `INSERT INTO transactions (user_id, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, type, amount, note || '', now());
}

function history(userId, limit = 10, offset = 0, typeFilter = null) {
  if (typeFilter) {
    return prepare(
      'tx_history_filter',
      `SELECT * FROM transactions WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(userId, typeFilter, limit, offset);
  }
  return prepare(
    'tx_history_page',
    `SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(userId, limit, offset);
}

function countHistory(userId, typeFilter = null) {
  if (typeFilter) {
    const r = prepare(
      'tx_count_filter',
      `SELECT COUNT(*) as c FROM transactions WHERE user_id = ? AND type = ?`
    ).get(userId, typeFilter);
    return r ? r.c : 0;
  }
  const r = prepare(
    'tx_count_all',
    `SELECT COUNT(*) as c FROM transactions WHERE user_id = ?`
  ).get(userId);
  return r ? r.c : 0;
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
  applyIdempotentOperation,
  applyIdempotentTransfer,
  recordTransaction,
  history,
  countHistory,
  addItem,
  removeItem,
  getItem,
  inventory,
  rankWallet,
};
