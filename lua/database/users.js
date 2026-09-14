/**
 * database/users.js — domínio de usuários.
 */

'use strict';

const { prepare } = require('./database');
const now = () => new Date().toISOString();

function upsert(jid, name) {
  return prepare(
    'upsert_user',
    `INSERT INTO users (id, name, first_seen, last_seen)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = CASE WHEN excluded.name != '' THEN excluded.name ELSE users.name END, last_seen = excluded.last_seen`
  ).run(jid, name || '', now(), now());
}

function get(jid) {
  return prepare('get_user', `SELECT * FROM users WHERE id = ?`).get(jid) || null;
}

function register(jid, name) {
  upsert(jid, name);
  return prepare('reg_user', `UPDATE users SET is_registered = 1 WHERE id = ?`).run(jid);
}

function setRegistered(jid, val) {
  upsert(jid, '');
  return prepare('setreg_user', `UPDATE users SET is_registered = ? WHERE id = ?`).run(val ? 1 : 0, jid);
}

/** Incrementa XP e recalcula o nível. Retorna { xp, level }. */
function addXp(jid, amount) {
  upsert(jid, '');
  prepare('addxp_user', `UPDATE users SET xp = xp + ? WHERE id = ?`).run(Math.max(0, Math.floor(amount)), jid);
  const u = get(jid);
  const level = levelFromXp(u.xp);
  if (level > u.level) {
    prepare('lvl_user', `UPDATE users SET level = ? WHERE id = ?`).run(level, jid);
  }
  return { xp: u.xp, level: Math.max(level, u.level) };
}

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1;
}

function xpForNextLevel(level) {
  return Math.pow(level, 2) * 60;
}

function incMessages(jid) {
  upsert(jid, '');
  return prepare('incmsg_user', `UPDATE users SET messages = messages + 1, last_seen = ? WHERE id = ?`).run(now(), jid);
}

function addReputation(jid, delta) {
  upsert(jid, '');
  return prepare('addrep_user', `UPDATE users SET reputation = MAX(0, reputation + ?) WHERE id = ?`).run(delta, jid);
}

function addKarma(jid, delta) {
  upsert(jid, '');
  return prepare('addkarma_user', `UPDATE users SET karma = karma + ? WHERE id = ?`).run(delta, jid);
}

function setAfk(jid, reason) {
  upsert(jid, '');
  return prepare('setafk_user', `UPDATE users SET afk = 1, afk_reason = ? WHERE id = ?`).run(reason || '', jid);
}

function clearAfk(jid) {
  return prepare('clearafk_user', `UPDATE users SET afk = 0, afk_reason = '' WHERE id = ?`).run(jid);
}

function setAbout(jid, text) {
  upsert(jid, '');
  return prepare('setabout_user', `UPDATE users SET about = ? WHERE id = ?`).run(text || '', jid);
}

function top(field, limit = 10) {
  const allowed = ['xp', 'level', 'messages', 'reputation', 'karma'];
  if (!allowed.includes(field)) field = 'xp';
  return prepare(
    'top_users',
    `SELECT id, name, xp, level, messages, reputation, karma FROM users ORDER BY ${field} DESC, xp DESC LIMIT ?`
  ).all(limit);
}

function count() {
  return prepare('count_users', `SELECT COUNT(*) AS c FROM users`).get().c;
}

function all() {
  return prepare('all_users', `SELECT id, name FROM users`).all();
}

module.exports = {
  upsert,
  get,
  register,
  setRegistered,
  addXp,
  incMessages,
  addReputation,
  addKarma,
  setAfk,
  clearAfk,
  setAbout,
  levelFromXp,
  xpForNextLevel,
  top,
  count,
  all,
};
