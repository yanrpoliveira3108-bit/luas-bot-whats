/**
 * services/moderationService.js — regras de negócio de moderação.
 *
 * Camada:
 *   Command/Handler → ModerationService → database/moderationCases.js
 *                                       → database/groups.js  → SQLite
 *
 * O que mora AQUI:
 *   • normalizar motivo/ação e validar grupo/usuário;
 *   • a regra de advertências (quantas → qual ação), que antes vivia dentro de
 *     handlers/groupHandler.applyWarningFlow;
 *   • registrar/consultar/fechar CASOS (tabela moderation_cases, Fase 4).
 *
 * O que NÃO mora aqui — e é importante:
 *   • a AÇÃO de WhatsApp. Remover/banir/mudar o grupo continua em quem tem o
 *     `sock` (comando ou handler). O service devolve a decisão (`action`) e o
 *     chamador executa; depois registra o caso. Não existe atomicidade entre
 *     "chamar a API do WhatsApp" e "gravar no banco" — fingir isso seria pior
 *     do que admitir a ordem real: ação → registro (com `metadata.source`).
 *   • SQL, formatação de mensagem e qualquer `sock.*`.
 */

'use strict';

const groups = require('../database/groups');
const cases = require('../database/moderationCases');
const logger = require('../utils/logger').child('moderation');

/** Motivo padrão (o mesmo texto que os comandos já usavam). */
const DEFAULT_REASON = 'Sem motivo informado';

/** Ações conhecidas. O schema aceita texto livre; isto é só vocabulário. */
const ACTIONS = Object.freeze({
  WARN: 'warn',
  KICK: 'kick',
  BAN: 'ban',
  UNBAN: 'unban',
  MUTE: 'mute',
  UNMUTE: 'unmute',
  DELETE: 'delete',
});

const CODES = {
  INVALID_GROUP: 'INVALID_GROUP',
  INVALID_USER: 'INVALID_USER',
  INVALID_ACTION: 'INVALID_ACTION',
};

function fail(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function normalizeReason(reason) {
  const text = String(reason == null ? '' : reason).trim();
  return text || DEFAULT_REASON;
}

function normalizeAction(action) {
  return String(action == null ? '' : action).toLowerCase().trim();
}

/**
 * Regra de advertências: dada a contagem atual, qual ação o grupo configurou.
 * Extraída de handlers/groupHandler.applyWarningFlow sem mudar a lógica
 * (mesmo clamp em 3 e mesmos thresholds padrão).
 *
 * @returns {'aviso'|'kick'|string}
 */
function resolveWarningAction(groupId, warnCount) {
  const s = groups.getSettings(groupId) || {};
  const thresholds = s.warning_thresholds || { 1: 'aviso', 2: 'aviso', 3: 'aviso' };
  return thresholds[Math.min(warnCount, 3)] || 'aviso';
}

/**
 * Registra um caso de moderação (camada de negócio sobre o repository da
 * Fase 4: normaliza, valida e loga).
 *
 * @returns {object} caso persistido
 */
function recordCase(input) {
  const data = input || {};
  const groupId = String(data.groupId || '');
  const userId = String(data.userId || '');
  const action = normalizeAction(data.action);
  if (!groupId) throw fail(CODES.INVALID_GROUP, 'grupo inválido para registrar caso');
  if (!userId) throw fail(CODES.INVALID_USER, 'usuário inválido para registrar caso');
  if (!action) throw fail(CODES.INVALID_ACTION, 'ação de moderação inválida');

  const caso = cases.createCase({
    groupId,
    userId,
    moderatorId: String(data.moderatorId || ''),
    action,
    reason: normalizeReason(data.reason),
    status: data.status || 'open',
    metadata: data.metadata || {},
  });
  logger.info(
    { case: caso.id, group: groupId, user: userId, action, source: (data.metadata && data.metadata.source) || 'manual' },
    '[LUA][MODERATION] caso registrado'
  );
  return caso;
}

/**
 * Aplica uma advertência: grava o aviso (como antes), calcula a contagem,
 * decide a ação configurada e registra o caso.
 *
 * NÃO executa o kick — devolve `action` para o chamador executar com o `sock`.
 *
 * @returns {{count:number, action:string, caseId:number}}
 */
function applyWarning(input) {
  const data = input || {};
  const groupId = String(data.groupId || '');
  const userId = String(data.userId || '');
  if (!groupId) throw fail(CODES.INVALID_GROUP, 'grupo inválido para advertir');
  if (!userId) throw fail(CODES.INVALID_USER, 'usuário inválido para advertir');

  const reason = normalizeReason(data.reason);
  groups.addWarning(groupId, userId, reason, String(data.moderatorId || ''));
  const count = groups.countWarnings(groupId, userId);
  const action = resolveWarningAction(groupId, count);

  const caso = recordCase({
    groupId,
    userId,
    moderatorId: data.moderatorId,
    action: ACTIONS.WARN,
    reason,
    metadata: { warnCount: count, nextAction: action, source: data.source || 'manual' },
  });

  return { count, action, caseId: caso.id };
}

/**
 * Registra a ação que o chamador executou no WhatsApp (kick/ban/mute...).
 * Falha de registro não pode derrubar a moderação: loga e devolve null.
 */
function recordAction(input) {
  try {
    return recordCase(input);
  } catch (err) {
    logger.warn({ err: err.message, input }, 'falha ao registrar caso de moderação');
    return null;
  }
}

/* ------------------------------ consultas ------------------------------ */

function getCase(caseId) {
  return cases.getCase(caseId);
}

function listCasesByGroup(groupId, limit = 20) {
  return cases.listCasesByGroup(String(groupId || ''), limit);
}

function listCasesByUser(userId, limit = 20) {
  return cases.listCasesByUser(String(userId || ''), limit);
}

function listCasesByGroupAndUser(groupId, userId, limit = 20) {
  return cases.listCasesByGroupAndUser(String(groupId || ''), String(userId || ''), limit);
}

function listRecent(limit = 20) {
  return cases.listRecent(limit);
}

/**
 * Fecha um caso. O motivo de fechamento é opcional de propósito:
 * `cases.closeCase(id, motivo)` SUBSTITUI o motivo original, então só enviamos
 * quando o chamador informou algo (senão o motivo da ação seria apagado).
 */
function closeCase(caseId, reason) {
  const text = String(reason == null ? '' : reason).trim();
  return text ? cases.closeCase(caseId, text) : cases.closeCase(caseId);
}

/** Advertências atuais de um usuário no grupo (repositório já existente). */
function warnings(groupId, userId) {
  return groups.getWarnings(String(groupId || ''), String(userId || ''));
}

function warnCount(groupId, userId) {
  return groups.countWarnings(String(groupId || ''), String(userId || ''));
}

module.exports = {
  ACTIONS,
  CODES,
  DEFAULT_REASON,
  normalizeReason,
  normalizeAction,
  resolveWarningAction,
  recordCase,
  recordAction,
  applyWarning,
  getCase,
  listCasesByGroup,
  listCasesByUser,
  listCasesByGroupAndUser,
  listRecent,
  closeCase,
  warnings,
  warnCount,
};
