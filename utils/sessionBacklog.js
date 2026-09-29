'use strict';
const logger = require('./logger').child('backlog');
let sessionOnlineAt = 0, sessionId = 0, dropped = 0, oldestAgeMs = 0, lastSummaryAt = 0;
function timestampMs(value) { const n = value && typeof value.toNumber === 'function' ? value.toNumber() : Number(value); if (!Number.isFinite(n) || n <= 0) return null; return n < 1e12 ? n * 1000 : n; }
function markSessionOnline(at = Date.now()) { sessionOnlineAt = Number(at) || Date.now(); sessionId += 1; dropped = 0; oldestAgeMs = 0; lastSummaryAt = 0; return sessionOnlineAt; }
function shouldDrop(type, msg, receivedAt = Date.now()) {
  if (!sessionOnlineAt) return false;
  const ts = timestampMs(msg && msg.messageTimestamp); const old = String(type || '').toLowerCase() === 'append' || (ts != null && ts < sessionOnlineAt - 10000);
  if (!old) return false; dropped += 1; if (ts != null) oldestAgeMs = Math.max(oldestAgeMs, Math.max(0, receivedAt - ts));
  if (Date.now() - lastSummaryAt > 30000) { lastSummaryAt = Date.now(); logger.info({ count: dropped, oldestAge: oldestAgeMs, session: sessionId }, '[BACKLOG_DROP]'); }
  return true;
}
function stats() { return { sessionOnlineAt, sessionId, dropped, oldestAgeMs }; }
module.exports = { markSessionOnline, shouldDrop, stats, timestampMs };
