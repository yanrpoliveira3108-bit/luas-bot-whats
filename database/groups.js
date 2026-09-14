/**
 * database/groups.js — domínio de grupos, membros, advertências e registro X9.
 */

'use strict';

const { prepare } = require('./database');
const now = () => new Date().toISOString();

/* ------------------------------ grupos ------------------------------ */

function ensure(jid, name) {
  prepare(
    'ensure_group',
    `INSERT INTO groups (id, name) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET name = CASE WHEN excluded.name != '' THEN excluded.name ELSE groups.name END`
  ).run(jid, name || '');
}

function get(jid) {
  return prepare('get_group', `SELECT * FROM groups WHERE id = ?`).get(jid) || null;
}

function setName(jid, name) {
  ensure(jid, name);
  return prepare('setname_group', `UPDATE groups SET name = ? WHERE id = ?`).run(name || '', jid);
}

function getSettings(jid) {
  const g = get(jid);
  if (!g) return {};
  try {
    return JSON.parse(g.settings || '{}');
  } catch (_) {
    return {};
  }
}

function setSetting(jid, key, value) {
  ensure(jid, '');
  const s = getSettings(jid);
  s[key] = value;
  return prepare('setcfg_group', `UPDATE groups SET settings = ? WHERE id = ?`).run(JSON.stringify(s), jid);
}

/** Atualiza um filtro do grupo (ex.: antilink = true). */
function updateFilter(jid, filter, value) {
  const s = getSettings(jid);
  if (!s.filters) s.filters = {};
  s.filters[filter] = !!value;
  return setSetting(jid, 'filters', s.filters);
}

function setWhitelist(jid, list) {
  const s = getSettings(jid);
  s.antilink_whitelist = Array.isArray(list) ? list : [];
  return setSetting(jid, 'antilink_whitelist', s.antilink_whitelist);
}

function setWelcome(jid, enabled, msg) {
  ensure(jid, '');
  return prepare(
    'setwelcome_group',
    `UPDATE groups SET welcome_enabled = ?, welcome_msg = ? WHERE id = ?`
  ).run(enabled ? 1 : 0, msg || '', jid);
}

function setGoodbye(jid, enabled, msg) {
  ensure(jid, '');
  return prepare(
    'setgoodbye_group',
    `UPDATE groups SET goodbye_enabled = ?, goodbye_msg = ? WHERE id = ?`
  ).run(enabled ? 1 : 0, msg || '', jid);
}

/* ------------------------------ membros ----------------------------- */

function addMember(groupId, userId) {
  prepare(
    'add_member',
    `INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)
     ON CONFLICT(group_id, user_id) DO UPDATE SET last_seen = excluded.last_seen`
  ).run(groupId, userId, now());
}

function removeMember(groupId, userId) {
  return prepare('rm_member', `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`).run(groupId, userId);
}

function incMemberMessages(groupId, userId) {
  addMember(groupId, userId);
  return prepare(
    'inc_member',
    `UPDATE group_members SET message_count = message_count + 1, last_seen = ? WHERE group_id = ? AND user_id = ?`
  ).run(now(), groupId, userId);
}

function memberStats(groupId, userId) {
  return (
    prepare(
      'stat_member',
      `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`
    ).get(groupId, userId) || null
  );
}

function topMembers(groupId, limit = 10) {
  return prepare(
    'top_members',
    `SELECT user_id, message_count, joined_at, last_seen FROM group_members WHERE group_id = ? ORDER BY message_count DESC LIMIT ?`
  ).all(groupId, limit);
}

/** Membros inativos (sem mensagens há mais de X horas). */
function inactiveMembers(groupId, hours = 72, limit = 20) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  return prepare(
    'inactive_members',
    `SELECT user_id, message_count, last_seen FROM group_members WHERE group_id = ? AND last_seen < ? ORDER BY last_seen ASC LIMIT ?`
  ).all(groupId, cutoff, limit);
}

/* ---------------------------- advertências -------------------------- */

function addWarning(groupId, userId, reason, adminId) {
  return prepare(
    'add_warning',
    `INSERT INTO warnings (group_id, user_id, reason, admin_id, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(groupId, userId, reason || '', adminId || '', now());
}

function getWarnings(groupId, userId) {
  return prepare(
    'get_warnings',
    `SELECT * FROM warnings WHERE group_id = ? AND user_id = ? ORDER BY id ASC`
  ).all(groupId, userId);
}

function countWarnings(groupId, userId) {
  return getWarnings(groupId, userId).length;
}

function removeWarningById(id) {
  return prepare('rm_warning', `DELETE FROM warnings WHERE id = ?`).run(id);
}

function removeLastWarning(groupId, userId) {
  const rows = getWarnings(groupId, userId);
  if (rows.length === 0) return null;
  removeWarningById(rows[rows.length - 1].id);
  return rows[rows.length - 1];
}

function clearWarnings(groupId, userId) {
  return prepare('clear_warnings', `DELETE FROM warnings WHERE group_id = ? AND user_id = ?`).run(groupId, userId);
}

/* ------------------------------ registro X9 ------------------------- */

const LOG_TYPES = [
  'entrada',
  'saida',
  'promote',
  'demote',
  'nome',
  'descricao',
  'foto',
  'config',
];

function logEvent(groupId, actorId, type, detail) {
  return prepare(
    'log_event',
    `INSERT INTO group_logs (group_id, actor_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(groupId, actorId || '', type, detail || '', now());
}

function all() {
  return prepare('all_groups', `SELECT id, name, active FROM groups`).all();
}

function getLogs(groupId, types, limit = 50) {
  const list = Array.isArray(types) && types.length ? types : LOG_TYPES;
  const placeholders = list.map(() => '?').join(',');
  return prepare(
    'get_logs',
    `SELECT * FROM group_logs WHERE group_id = ? AND type IN (${placeholders}) ORDER BY id DESC LIMIT ?`
  ).all(groupId, ...list, limit);
}

module.exports = {
  ensure,
  get,
  setName,
  getSettings,
  setSetting,
  updateFilter,
  setWhitelist,
  setWelcome,
  setGoodbye,
  addMember,
  removeMember,
  incMemberMessages,
  memberStats,
  topMembers,
  inactiveMembers,
  addWarning,
  getWarnings,
  countWarnings,
  removeWarningById,
  removeLastWarning,
  clearWarnings,
  logEvent,
  getLogs,
  all,
  LOG_TYPES,
};
