/**
 * database/blocked.js — usuários bloqueados (não podem usar o bot).
 */

'use strict';

const { prepare } = require('./database');
const now = () => new Date().toISOString();

function block(userId, reason) {
  return prepare(
    'block_user',
    `INSERT INTO blocked (user_id, reason, created_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`
  ).run(userId, reason || '', now());
}

function unblock(userId) {
  return prepare('unblock_user', `DELETE FROM blocked WHERE user_id = ?`).run(userId);
}

function isBlocked(userId) {
  return !!prepare('is_blocked', `SELECT user_id FROM blocked WHERE user_id = ?`).get(userId);
}

function list() {
  return prepare('list_blocked', `SELECT * FROM blocked ORDER BY created_at DESC`).all();
}

module.exports = { block, unblock, isBlocked, list };
