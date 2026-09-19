/**
 * database/groups.js — domínio de grupos, membros, advertências e registro X9.
 *
 * CACHE DE CONFIGURAÇÕES: `settings` é um JSON lido em TODO o pipeline de
 * mensagens (antis, automações, status). Antes, cada verificação fazia
 * `SELECT` + `JSON.parse` — um grupo com os antis ligados gerava ~25 consultas
 * por mensagem. Agora existe um cache por grupo, com TTL curto e invalidação
 * explícita em toda escrita: o valor lido é sempre o que está no banco e o
 * custo por mensagem cai a praticamente zero.
 *
 * IMPORTANTE: `getSettings()` devolve o objeto do cache (não uma cópia) para
 * que o pipeline seja rápido. Mutações soltas nele são persistidas na próxima
 * escrita (`patchSettings`/`setSetting`) — sempre que quiser GARANTIR a
 * gravação, use `patchSettings` (atômico, 1 write) ou `setSetting`.
 */

'use strict';

const { prepare } = require('./database');
const logger = require('../utils/logger').child('groups');
const now = () => new Date().toISOString();

/* --------------------------- cache de settings ---------------------- */

const SETTINGS_TTL_MS = 15000;
const SETTINGS_CACHE_MAX = 2000;
const settingsCache = new Map(); // jid -> { value, expiresAt }

function settingsCacheStats() {
  return { size: settingsCache.size, ttlMs: SETTINGS_TTL_MS };
}

/** Invalida o cache de um grupo (ou de todos, sem argumento). */
function invalidateSettings(jid) {
  if (jid) settingsCache.delete(jid);
  else settingsCache.clear();
}

function readSettingsRow(jid) {
  const g = get(jid);
  if (!g) return {};
  try {
    return JSON.parse(g.settings || '{}');
  } catch (_) {
    return {};
  }
}

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
  const nowMs = Date.now();
  const hit = settingsCache.get(jid);
  if (hit && hit.expiresAt > nowMs) return hit.value;

  const value = readSettingsRow(jid);
  // LRU simples: acima do limite, descarta o mais antigo
  if (settingsCache.size >= SETTINGS_CACHE_MAX) {
    const oldest = settingsCache.keys().next().value;
    settingsCache.delete(oldest);
  }
  settingsCache.set(jid, { value, expiresAt: nowMs + SETTINGS_TTL_MS });
  return value;
}

function setSetting(jid, key, value) {
  ensure(jid, '');
  const s = getSettings(jid);
  const next = { ...s, [key]: value };
  persistSettings(jid, next);
  return next;
}

/**
 * Grava VÁRIAS chaves de uma vez, de forma atômica: lê o cache, aplica a
 * mutação e faz UM único UPDATE. Use isto sempre que precisar mexer em mais
 * de uma chave (ex.: ligar um anti + espelhar o filtro legado).
 * @param {string} jid
 * @param {(s:object) => void} mutate recebe o objeto de settings e altera
 */
function patchSettings(jid, mutate) {
  ensure(jid, '');
  const s = getSettings(jid);
  if (typeof mutate === 'function') mutate(s);
  persistSettings(jid, s);
  return s;
}

/** Substitui o objeto de settings inteiro (uso interno/avançado). */
function setAllSettings(jid, value) {
  ensure(jid, '');
  persistSettings(jid, value && typeof value === 'object' ? value : {});
  return value;
}

function persistSettings(jid, value) {
  const json = JSON.stringify(value || {});
  try {
    prepare('setall_group', `UPDATE groups SET settings = ? WHERE id = ?`).run(json, jid);
  } catch (err) {
    logger.error({ err: err.message, grupo: jid }, 'falha ao gravar settings do grupo');
    invalidateSettings(jid);
    throw err;
  }
  settingsCache.set(jid, { value, expiresAt: Date.now() + SETTINGS_TTL_MS });
  return true;
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

/* --------------------- listas genéricas (x9, gold) -------------------- */

/** Lê uma lista guardada em settings (ex.: 'x9', 'gold'). */
function getList(jid, key) {
  const s = getSettings(jid);
  const v = s && s[key];
  return Array.isArray(v) ? v : [];
}

function setList(jid, key, list) {
  const arr = Array.isArray(list) ? [...new Set(list.filter(Boolean))] : [];
  patchSettings(jid, (s) => {
    s[key] = arr;
  });
  return arr;
}

function addToList(jid, key, item) {
  if (!item) return getList(jid, key);
  const list = getList(jid, key);
  if (!list.includes(item)) list.push(item);
  return setList(jid, key, list);
}

function removeFromList(jid, key, item) {
  return setList(jid, key, getList(jid, key).filter((x) => x !== item));
}

function inList(jid, key, item) {
  return getList(jid, key).includes(item);
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

/** Grupos em que um usuário é membro conhecido (usado por aniversários/avisos). */
function groupsOfMember(userId) {
  return prepare(
    'groups_of_member',
    `SELECT group_id FROM group_members WHERE user_id = ?`
  ).all(userId).map((r) => r.group_id);
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
  patchSettings,
  setAllSettings,
  invalidateSettings,
  settingsCacheStats,
  updateFilter,
  setWhitelist,
  getList,
  setList,
  addToList,
  removeFromList,
  inList,
  setWelcome,
  setGoodbye,
  addMember,
  removeMember,
  incMemberMessages,
  memberStats,
  topMembers,
  inactiveMembers,
  groupsOfMember,
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
