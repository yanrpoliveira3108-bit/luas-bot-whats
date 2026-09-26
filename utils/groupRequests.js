'use strict';

const logger = require('./logger').child('groupRequests');

function isParticipantJid(value) {
  if (typeof value !== 'string') return false;
  const jid = value.trim();
  return /^(?:\d+|[A-Za-z0-9._-]+):?\d*@(s\.whatsapp\.net|lid)$/.test(jid);
}

function normalizePending(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.participants)) return raw.participants;
  const error = new Error('Formato inesperado na lista de pedidos de entrada.');
  error.code = 'GROUP_REQUESTS_INVALID_LIST_RESPONSE';
  throw error;
}

function validEntries(entries) {
  const seen = new Set();
  const valid = [];
  for (const entry of entries) {
    const jid = entry && typeof entry === 'object' ? entry.jid : null;
    if (!isParticipantJid(jid)) {
      logger.warn({ hasEntry: Boolean(entry), fields: entry && typeof entry === 'object' ? Object.keys(entry).slice(0, 8) : [] }, '[GROUP_REQUESTS] participante inválido');
      continue;
    }
    if (!seen.has(jid)) {
      seen.add(jid);
      valid.push({ ...entry, jid });
    }
  }
  return valid;
}

async function listPending(sock, groupJid) {
  if (!sock || typeof sock.groupRequestParticipantsList !== 'function') {
    const error = new Error('API de pedidos de entrada indisponível nesta versão.');
    error.code = 'GROUP_REQUESTS_UNAVAILABLE';
    throw error;
  }
  logger.info({ group: groupJid }, '[GROUP_REQUESTS] consulta iniciada');
  let raw;
  try {
    raw = await sock.groupRequestParticipantsList(groupJid);
  } catch (cause) {
    const error = new Error('Falha ao consultar pedidos de entrada.', { cause });
    error.code = 'GROUP_REQUESTS_LIST_FAILED';
    logger.error({ group: groupJid, err: cause && cause.message }, '[GROUP_REQUESTS_ERROR] operation=list');
    throw error;
  }
  const entries = normalizePending(raw);
  const pending = validEntries(entries);
  logger.info({ group: groupJid, count: pending.length }, '[GROUP_REQUESTS] list');
  return pending;
}

function normalizeUpdateResult(raw, requested) {
  if (!Array.isArray(raw)) {
    const error = new Error('Formato inesperado no resultado da operação de pedidos.');
    error.code = 'GROUP_REQUESTS_INVALID_UPDATE_RESPONSE';
    throw error;
  }
  const byJid = new Map(raw.filter((x) => x && isParticipantJid(x.jid)).map((x) => [x.jid, x]));
  const results = requested.map((jid) => {
    const item = byJid.get(jid);
    const status = item && item.status !== undefined ? String(item.status) : null;
    return { jid, status, ok: status === '200' };
  });
  return {
    requested: requested.length,
    success: results.filter((x) => x.ok).length,
    failed: results.filter((x) => !x.ok).length,
    results,
  };
}

async function updateRequests(sock, groupJid, entries, action) {
  if (!['approve', 'reject'].includes(action)) {
    throw new Error('Ação de pedido inválida.');
  }
  const participants = validEntries(entries).map((x) => x.jid);
  if (!participants.length) return { requested: 0, success: 0, failed: 0, results: [] };
  if (!sock || typeof sock.groupRequestParticipantsUpdate !== 'function') {
    const error = new Error('API de atualização de pedidos indisponível nesta versão.');
    error.code = 'GROUP_REQUESTS_UNAVAILABLE';
    throw error;
  }
  let raw;
  try {
    raw = await sock.groupRequestParticipantsUpdate(groupJid, participants, action);
  } catch (cause) {
    const error = new Error(`Falha ao ${action === 'approve' ? 'aprovar' : 'rejeitar'} pedidos.`, { cause });
    error.code = 'GROUP_REQUESTS_UPDATE_FAILED';
    logger.error({ group: groupJid, action, requested: participants.length, err: cause && cause.message }, '[GROUP_REQUESTS_ERROR] operation=update');
    throw error;
  }
  const summary = normalizeUpdateResult(raw, participants);
  logger.info({ group: groupJid, action, requested: summary.requested, success: summary.success, failed: summary.failed }, '[GROUP_REQUESTS] update');
  return summary;
}

async function approveRequests(sock, groupJid, entries) {
  return updateRequests(sock, groupJid, entries, 'approve');
}

async function rejectRequests(sock, groupJid, entries) {
  return updateRequests(sock, groupJid, entries, 'reject');
}

module.exports = { isParticipantJid, normalizePending, listPending, approveRequests, rejectRequests, normalizeUpdateResult };
