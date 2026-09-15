/**
 * database/moderationCases.js — casos de moderação (Fase 4).
 *
 * Um CASO é diferente dos registros que já existiam:
 *   • `warnings`    → eventos de !warn, imutáveis, sem status/metadata;
 *   • `group_logs`  → trilha de auditoria do X9 (quem fez o quê no grupo);
 *   • `moderation_cases` → registro unificado com ciclo de vida (open/closed),
 *     metadados estruturados e updated_at, servindo warn/mute/kick/ban/unban/etc.
 * Nada aqui substitui as tabelas antigas: elas continuam sendo escritas pelos
 * fluxos atuais. A unificação de escrita é trabalho da Fase 5 (ModerationService).
 *
 * Padrões do banco (ver database/database.js):
 *   • id INTEGER PRIMARY KEY AUTOINCREMENT → case_id estável, único e crescente;
 *   • JIDs em TEXT, no formato já usado pelo bot;
 *   • timestamps TEXT ISO-8601;
 *   • metadata JSON em TEXT;
 *   • sem FOREIGN KEY (nenhuma tabela do banco declara FK);
 *   • queries sempre parametrizadas via prepare().
 */

'use strict';

const { prepare } = require('./database');
const logger = require('../utils/logger').child('mod-cases');

const now = () => new Date().toISOString();

/** Status existentes. Não há outros: um caso está aberto ou encerrado. */
const STATUS = Object.freeze(['open', 'closed']);

/**
 * Campos que updateCase() aceita. `action`, `group_id`, `user_id` e `created_at`
 * ficam de fora de propósito: a identidade de um caso é imutável.
 */
const EDITABLE = Object.freeze(['reason', 'status', 'metadata', 'moderator_id']);

/* ------------------------------ helpers ------------------------------ */

/** Lê metadata gravada. JSON corrompido é logado, nunca silencioso. */
function parseMetadata(raw) {
  if (raw === null || raw === undefined || raw === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    logger.warn({ err: err.message, raw: String(raw).slice(0, 80) }, 'metadata de caso corrompida');
    return {};
  }
}

/** Serializa metadata. Aceita objeto, JSON válido ou vazio; rejeita o resto. */
function stringifyMetadata(metadata) {
  if (metadata === null || metadata === undefined || metadata === '') return '{}';
  if (typeof metadata === 'string') {
    JSON.parse(metadata); // lança se for inválido — não gravamos lixo
    return metadata;
  }
  if (typeof metadata !== 'object') throw new Error('INVALID_METADATA');
  return JSON.stringify(metadata);
}

/** Devolve a linha com metadata já parseada. */
function shape(row) {
  if (!row) return null;
  return Object.assign({}, row, { metadata: parseMetadata(row.metadata) });
}

/* ------------------------------ escrita ------------------------------ */

/**
 * Cria um caso.
 * @param {object} data
 * @param {string} data.groupId      JID do grupo (obrigatório)
 * @param {string} data.userId       JID do alvo (obrigatório)
 * @param {string} data.action       warn|mute|kick|ban|unban|... (texto livre)
 * @param {string} [data.moderatorId] quem aplicou ('' = automod/sistema)
 * @param {string} [data.reason]
 * @param {object|string} [data.metadata]
 * @param {'open'|'closed'} [data.status='open']
 * @returns {object|null} o caso criado (com metadata parseada)
 */
function createCase(data) {
  const d = data || {};
  const groupId = String(d.groupId || '');
  const userId = String(d.userId || '');
  const action = String(d.action || '').toLowerCase().trim();
  if (!groupId) throw new Error('INVALID_GROUP_ID');
  if (!userId) throw new Error('INVALID_USER_ID');
  if (!action) throw new Error('INVALID_ACTION');
  const status = d.status === undefined ? 'open' : String(d.status);
  if (!STATUS.includes(status)) throw new Error('INVALID_STATUS');

  const ts = now();
  const info = prepare(
    'create_mod_case',
    `INSERT INTO moderation_cases
       (group_id, user_id, moderator_id, action, reason, status, metadata, created_at, updated_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    groupId,
    userId,
    String(d.moderatorId || ''),
    action,
    String(d.reason || ''),
    status,
    stringifyMetadata(d.metadata),
    ts,
    ts,
    status === 'closed' ? ts : ''
  );
  return getCase(info.lastInsertRowid);
}

/**
 * Atualiza campos permitidos de um caso. Sempre mexe em updated_at.
 * @param {number} id
 * @param {object} fields subconjunto de EDITABLE
 * @returns {object|null} o caso atualizado, ou null se o id não existe
 */
function updateCase(id, fields) {
  const f = fields || {};
  const sets = [];
  const values = [];
  for (const key of EDITABLE) {
    if (!(key in f)) continue;
    if (key === 'status') {
      const status = String(f.status);
      if (!STATUS.includes(status)) throw new Error('INVALID_STATUS');
      sets.push('status = ?');
      values.push(status);
      // fechar um caso carimba closed_at; reabrir limpa
      sets.push('closed_at = ?');
      values.push(status === 'closed' ? now() : '');
    } else if (key === 'metadata') {
      sets.push('metadata = ?');
      values.push(stringifyMetadata(f.metadata));
    } else {
      sets.push(`${key} = ?`);
      values.push(String(f[key] === null || f[key] === undefined ? '' : f[key]));
    }
  }
  if (!sets.length) return getCase(id);

  sets.push('updated_at = ?');
  values.push(now());
  values.push(Number(id));
  prepare('update_mod_case', `UPDATE moderation_cases SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getCase(id);
}

/** Encerra um caso (atalho de updateCase com motivo opcional). */
function closeCase(id, reason) {
  return updateCase(id, reason ? { status: 'closed', reason } : { status: 'closed' });
}

/* ------------------------------ leitura ------------------------------ */

/** Um caso pelo id. */
function getCase(id) {
  return shape(prepare('get_mod_case', `SELECT * FROM moderation_cases WHERE id = ?`).get(Number(id)));
}

/** Casos de um grupo, mais recentes primeiro. Usa idx_mod_cases_group. */
function listCasesByGroup(groupId, limit = 20) {
  return prepare(
    'list_mod_cases_group',
    `SELECT * FROM moderation_cases WHERE group_id = ? ORDER BY id DESC LIMIT ?`
  ).all(String(groupId), Number(limit)).map(shape);
}

/** Casos de um usuário em qualquer grupo. Usa idx_mod_cases_user. */
function listCasesByUser(userId, limit = 20) {
  return prepare(
    'list_mod_cases_user',
    `SELECT * FROM moderation_cases WHERE user_id = ? ORDER BY id DESC LIMIT ?`
  ).all(String(userId), Number(limit)).map(shape);
}

/** Casos de um usuário dentro de um grupo. Usa idx_mod_cases_user. */
function listCasesByGroupAndUser(groupId, userId, limit = 20) {
  return prepare(
    'list_mod_cases_group_user',
    `SELECT * FROM moderation_cases WHERE user_id = ? AND group_id = ? ORDER BY id DESC LIMIT ?`
  ).all(String(userId), String(groupId), Number(limit)).map(shape);
}

/** Casos mais recentes do bot inteiro (varredura pelo rowid). */
function listRecent(limit = 20) {
  return prepare('list_mod_cases_recent', `SELECT * FROM moderation_cases ORDER BY id DESC LIMIT ?`)
    .all(Number(limit))
    .map(shape);
}

/** Quantos casos de uma ação o usuário tem no grupo (base p/ escalonamento). */
function countByAction(groupId, userId, action) {
  return prepare(
    'count_mod_cases_action',
    `SELECT COUNT(*) AS c FROM moderation_cases WHERE user_id = ? AND group_id = ? AND action = ?`
  ).get(String(userId), String(groupId), String(action).toLowerCase()).c;
}

/** Quantos casos abertos existem no grupo. */
function countOpen(groupId) {
  return prepare(
    'count_mod_cases_open',
    `SELECT COUNT(*) AS c FROM moderation_cases WHERE group_id = ? AND status = 'open'`
  ).get(String(groupId)).c;
}

function count() {
  return prepare('count_mod_cases', `SELECT COUNT(*) AS c FROM moderation_cases`).get().c;
}

module.exports = {
  STATUS,
  EDITABLE,
  createCase,
  getCase,
  updateCase,
  closeCase,
  listCasesByGroup,
  listCasesByUser,
  listCasesByGroupAndUser,
  listRecent,
  countByAction,
  countOpen,
  count,
};
