'use strict';

const CONFIG = require('../config');

const DEFAULTS = Object.freeze({
  ignoreOfflineBacklog: true,
  backlogGraceMs: 10000,
  maxPerMinute: Number(CONFIG.safety.send.maxPerMinute) || 15,
  minIntervalMs: Number(CONFIG.safety.send.minIntervalMs) || 1200,
  chatIntervalMs: Number(CONFIG.safety.send.chatIntervalMs) || 2000,
  jitterMs: Number(CONFIG.safety.send.jitterMs) || 900,
  typingEnabled: CONFIG.security.humanDelays !== false,
  typingMinMs: Number(CONFIG.security.minTypingDelayMs) || 600,
  typingMaxMs: Number(CONFIG.security.maxTypingDelayMs) || 2200,
});

let cache = null;
let cacheAt = 0;
const CACHE_MS = 1000;

function read() {
  const settings = require('../database/settings');
  const bool = (key, fallback) => settings.getBool(key, fallback);
  const integer = (key, fallback) => settings.getInt(key, fallback);
  return {
    ...DEFAULTS,
    ignoreOfflineBacklog: bool('freio_ignore_offline_backlog', DEFAULTS.ignoreOfflineBacklog),
    backlogGraceMs: integer('freio_backlog_grace_ms', DEFAULTS.backlogGraceMs),
    maxPerMinute: integer('freio_max_per_minute', DEFAULTS.maxPerMinute),
    minIntervalMs: integer('freio_min_interval_ms', DEFAULTS.minIntervalMs),
    chatIntervalMs: integer('freio_chat_interval_ms', DEFAULTS.chatIntervalMs),
    jitterMs: integer('freio_jitter_ms', DEFAULTS.jitterMs),
    typingEnabled: bool('freio_typing_enabled', DEFAULTS.typingEnabled),
    typingMinMs: integer('freio_typing_min_ms', DEFAULTS.typingMinMs),
    typingMaxMs: integer('freio_typing_max_ms', DEFAULTS.typingMaxMs),
  };
}

function get() {
  if (!cache || Date.now() - cacheAt > CACHE_MS) {
    cache = read();
    cacheAt = Date.now();
  }
  return { ...cache };
}

function set(key, value) {
  const settings = require('../database/settings');
  settings.set(`freio_${key}`, String(value));
  cache = null;
  return get();
}

function reset() {
  const settings = require('../database/settings');
  for (const [key, value] of Object.entries(DEFAULTS)) settings.set(`freio_${key}`, String(value));
  cache = null;
  return get();
}

function validateGrace(ms) {
  if (!Number.isFinite(ms) || ms < 1000 || ms > 5 * 60 * 1000) throw new Error('GRACE_INVALID');
  return Math.round(ms);
}
function validatePpm(n) {
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('PPM_INVALID');
  return n;
}
function validateDelay(n) {
  if (!Number.isInteger(n) || n < 0 || n > 60000) throw new Error('DELAY_INVALID');
  return n;
}
function parseDuration(value) {
  const m = String(value || '').trim().toLowerCase().match(/^(\d+)\s*(ms|s|m|min)$/);
  if (!m) throw new Error('DURATION_INVALID');
  const factor = { ms: 1, s: 1000, m: 60000, min: 60000 }[m[2]];
  return Number(m[1]) * factor;
}

module.exports = { DEFAULTS, get, set, reset, validateGrace, validatePpm, validateDelay, parseDuration };
