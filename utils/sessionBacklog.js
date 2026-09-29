'use strict';

const logger = require('./logger').child('backlog');
const freio = require('./freioConfig');

let sessionOnlineAt = 0;
let sessionId = 0;
let dropped = 0;
let oldestAgeMs = 0;
let lastSummaryAt = 0;

function timestampMs(value) {
  if (value == null) return null;
  const n = typeof value === 'object' && typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function runtimeConfig() {
  try { return freio.get(); } catch (_) { return freio.DEFAULTS; }
}

function markSessionOnline(at = Date.now()) {
  runtimeConfig();
  sessionOnlineAt = Number(at) || Date.now();
  sessionId += 1;
  dropped = 0;
  oldestAgeMs = 0;
  lastSummaryAt = 0;
  return sessionOnlineAt;
}

function shouldDrop(type, msg, receivedAt = Date.now()) {
  const cfg = runtimeConfig();
  if (!cfg.ignoreOfflineBacklog || !sessionOnlineAt) return false;
  // append é histórico/sincronização nesta fork. Mesmo sem timestamp confiável,
  // não deve entrar no pipeline normal durante a política de backlog.
  const messageType = String(type || '').toLowerCase();
  const ts = timestampMs(msg && msg.messageTimestamp);
  const cutoff = sessionOnlineAt - Math.max(1000, cfg.backlogGraceMs);
  const oldByType = messageType === 'append';
  const oldByTime = ts != null && ts < cutoff;
  if (!oldByType && !oldByTime) return false;
  dropped += 1;
  if (ts != null) oldestAgeMs = Math.max(oldestAgeMs, Math.max(0, receivedAt - ts));
  if (Date.now() - lastSummaryAt > 30000) {
    lastSummaryAt = Date.now();
    logger.info({ count: dropped, oldestAge: oldestAgeMs, session: sessionId }, '[BACKLOG_DROP]');
  }
  return true;
}

function setEnabled(value) { freio.set('ignore_offline_backlog', !!value); }
function setGrace(ms) { freio.set('backlog_grace_ms', freio.validateGrace(ms)); }
function stats() {
  return { sessionOnlineAt, sessionId, dropped, oldestAgeMs, ...freio.get() };
}

module.exports = { markSessionOnline, shouldDrop, setEnabled, setGrace, stats, timestampMs };
