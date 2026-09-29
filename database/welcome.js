/**
 * database/welcome.js — armazenamento do sistema Welcome/Goodbye visual.
 *
 * Guarda o estado POR GRUPO (on/off, aleatório, menção, último template) e o
 * registro de eventos (fake IDs). É leve e separado do restante: não toca nas
 * colunas welcome_enabled/welcome_msg da tabela `groups` (usadas pelo sistema
 * textual antigo, que continua funcionando).
 */

'use strict';

const { prepare } = require('./database');
const now = () => new Date().toISOString();

const STATE_TTL_MS = 15000;
const STATE_CACHE_MAX = 2000;
const stateCache = new Map();

const DEFAULTS = {
  welcome_enabled: 0,
  welcome_random: 1,
  welcome_mention: 1,
  goodbye_enabled: 0,
  goodbye_random: 1,
  last_welcome_template: '',
  last_goodbye_template: '',
  welcome_text: '',
  goodbye_text: '',
};

function ensure(groupId) {
  prepare('ens_welcome_state', `INSERT OR IGNORE INTO welcome_state (group_id) VALUES (?)`).run(groupId);
}

/** Estado do grupo (com padrões). */
function invalidate(groupId) {
  if (groupId) stateCache.delete(groupId);
  else stateCache.clear();
}

function getState(groupId, options = {}) {
  const hit = stateCache.get(groupId);
  if (hit && hit.expiresAt > Date.now()) return Object.assign({}, hit.value);
  if (options.create !== false) ensure(groupId);
  const row = prepare('get_welcome_state', `SELECT * FROM welcome_state WHERE group_id = ?`).get(groupId) || {};
  const value = Object.assign({}, DEFAULTS, row);
  if (stateCache.size >= STATE_CACHE_MAX) stateCache.delete(stateCache.keys().next().value);
  stateCache.set(groupId, { value, expiresAt: Date.now() + STATE_TTL_MS });
  return Object.assign({}, value);
}

function setWelcome(groupId, enabled) {
  ensure(groupId);
  const result = prepare('set_welcome_en', `UPDATE welcome_state SET welcome_enabled = ? WHERE group_id = ?`).run(enabled ? 1 : 0, groupId);
  invalidate(groupId);
  return result;
}

function setGoodbye(groupId, enabled) {
  ensure(groupId);
  const result = prepare('set_goodbye_en', `UPDATE welcome_state SET goodbye_enabled = ? WHERE group_id = ?`).run(enabled ? 1 : 0, groupId);
  invalidate(groupId);
  return result;
}

function setRandom(groupId, kind, enabled) {
  ensure(groupId);
  const col = kind === 'welcome' ? 'welcome_random' : 'goodbye_random';
  const result = prepare('set_welcome_rand', `UPDATE welcome_state SET ${col} = ? WHERE group_id = ?`).run(enabled ? 1 : 0, groupId);
  invalidate(groupId);
  return result;
}

function setMention(groupId, enabled) {
  ensure(groupId);
  const result = prepare('set_welcome_mention', `UPDATE welcome_state SET welcome_mention = ? WHERE group_id = ?`).run(enabled ? 1 : 0, groupId);
  invalidate(groupId);
  return result;
}

function setText(groupId, kind, text) {
  ensure(groupId);
  const col = kind === 'goodbye' ? 'goodbye_text' : 'welcome_text';
  const result = prepare(`set_${col}`, `UPDATE welcome_state SET ${col} = ? WHERE group_id = ?`).run(String(text || ''), groupId);
  invalidate(groupId);
  return result;
}

/**
 * Escolhe o próximo template evitando repetir o último usado no grupo.
 * Se random estiver desligado, retorna sempre o PRIMEIRO da lista (fixo).
 * @returns {string} id do template (ex.: 'welcome-02')
 */
function chooseTemplate(groupId, kind, templates, options = {}) {
  const list = Array.isArray(templates) && templates.length ? templates : ['welcome-01'];
  const st = getState(groupId, options);
  const lastCol = kind === 'welcome' ? 'last_welcome_template' : 'last_goodbye_template';
  const random = kind === 'welcome' ? st.welcome_random : st.goodbye_random;

  let pick = list[0];
  if (random) {
    const candidates = list.filter((t) => t !== st[lastCol]);
    const pool = candidates.length ? candidates : list;
    pick = pool[Math.floor(Math.random() * pool.length)];
  }

  return pick;
}

function nextTemplate(groupId, kind, templates) {
  const pick = chooseTemplate(groupId, kind, templates);
  const col = kind === 'welcome' ? 'last_welcome_template' : 'last_goodbye_template';
  prepare('set_welcome_last', `UPDATE welcome_state SET ${col} = ? WHERE group_id = ?`).run(pick, groupId);
  invalidate(groupId);
  return pick;
}

function peekTemplate(groupId, kind, templates) {
  return chooseTemplate(groupId, kind, templates, { create: false });
}

/** Registra um evento (entrada/saída) com o fake ID — tabela limitada. */
function recordEvent(groupId, userId, eventType, fakeId, template) {
  prepare(
    'ins_welcome_event',
    `INSERT INTO welcome_events (group_id, user_id, event_type, fake_id, template, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(groupId, userId, eventType, fakeId, template || '', now());

  // mantém só os 500 eventos mais recentes (não cresce para sempre)
  prepare(
    'trim_welcome_events',
    `DELETE FROM welcome_events
      WHERE id NOT IN (SELECT id FROM welcome_events ORDER BY id DESC LIMIT 500)`
  ).run();
}

/** Contagem de membros registrados (fallback se o metadata falhar). */
function countMembers(groupId) {
  try {
    const row = prepare('count_members', `SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?`).get(groupId);
    return row ? row.c : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  getState,
  setWelcome,
  setGoodbye,
  setRandom,
  setMention,
  setText,
  nextTemplate,
  peekTemplate,
  recordEvent,
  countMembers,
};
