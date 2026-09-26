'use strict';

const groups = require('../database/groups');
const connection = require('../connection/connect');
const { listPending } = require('./groupRequests');
const membership = require('./membershipRequests');
const logger = require('./logger').child('membership-monitor');

const MEMBERSHIP_MONITOR_INTERVAL_MS = 10 * 1000;
const MAX_BACKOFF_MS = 60 * 1000;
const knownPending = new Map(); // groupJid -> [{ jid }]
const scanningGroups = new Set();
const backoff = new Map(); // groupJid -> { failures, nextAt }
let timer = null;
let scanRunning = false;
let socketProvider = () => connection.getSocket();

function activeSettings() {
  return groups.all().filter((group) => {
    const settings = groups.getSettings(group.id) || {};
    return settings.captcha === true || settings.autoaceitar === true;
  });
}
function errorCode(err) { return err && err.code ? err.code : 'UNKNOWN'; }
function recordFailure(groupJid) {
  const previous = backoff.get(groupJid) || { failures: 0, nextAt: 0 };
  const failures = previous.failures + 1;
  const delay = Math.min(MEMBERSHIP_MONITOR_INTERVAL_MS * (2 ** (failures - 1)), MAX_BACKOFF_MS);
  backoff.set(groupJid, { failures, nextAt: Date.now() + delay });
}
function recordSuccess(groupJid) { backoff.delete(groupJid); }
function due(groupJid) {
  const state = backoff.get(groupJid);
  return !state || Date.now() >= state.nextAt;
}
async function contains(sock, entries, jid) {
  for (const entry of entries) if (await membership.participantMatches(sock, entry.jid, jid)) return true;
  return false;
}
async function newEntries(sock, groupJid, pending) {
  const old = knownPending.get(groupJid) || [];
  await membership.forgetProcessed(sock, groupJid, pending);
  const fresh = [];
  for (const entry of pending) if (!(await contains(sock, old, entry.jid))) fresh.push(entry);
  knownPending.set(groupJid, pending.map((entry) => ({ jid: entry.jid })));
  return fresh;
}
async function scanGroup(sock, group) {
  const groupJid = group.id;
  if (!due(groupJid) || scanningGroups.has(groupJid)) return;
  scanningGroups.add(groupJid);
  try {
    const pending = await listPending(sock, groupJid);
    logger.info({ group: groupJid, pending: pending.length }, '[MEMBERSHIP_MONITOR] scan');
    const fresh = await newEntries(sock, groupJid, pending);
    recordSuccess(groupJid);
    for (const entry of fresh) {
      logger.info({ group: groupJid, source: 'monitor' }, '[MEMBERSHIP_MONITOR] new request');
      await membership.processMembershipRequest({
        sock,
        groupJid,
        participantJid: entry.jid,
        pendingEntry: entry,
        source: 'monitor',
      });
    }
  } catch (err) {
    recordFailure(groupJid);
    logger.error({ operation: 'scan', group: groupJid, code: errorCode(err), message: err && err.message, stack: err && err.stack }, '[MEMBERSHIP_MONITOR_ERROR]');
  } finally {
    scanningGroups.delete(groupJid);
  }
}
async function scanOnce(sock = socketProvider()) {
  if (scanRunning) return false;
  if (!sock) return false;
  scanRunning = true;
  try {
    const active = activeSettings();
    const activeIds = new Set(active.map((group) => group.id));
    for (const groupJid of knownPending.keys()) if (!activeIds.has(groupJid)) knownPending.delete(groupJid);
    await Promise.all(active.map((group) => scanGroup(sock, group)));
    return true;
  } finally {
    scanRunning = false;
  }
}
function start(provider = socketProvider) {
  socketProvider = typeof provider === 'function' ? provider : socketProvider;
  if (timer) return timer;
  timer = setInterval(() => {
    scanOnce().catch((err) => logger.error({ message: err.message, stack: err.stack }, '[MEMBERSHIP_MONITOR_ERROR] scheduler'));
  }, MEMBERSHIP_MONITOR_INTERVAL_MS);
  if (timer.unref) timer.unref();
  scanOnce().catch((err) => logger.error({ message: err.message, stack: err.stack }, '[MEMBERSHIP_MONITOR_ERROR] initial scan'));
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  scanRunning = false;
  scanningGroups.clear();
}
function reset() { knownPending.clear(); backoff.clear(); scanningGroups.clear(); }
function state(groupJid) { return { known: (knownPending.get(groupJid) || []).map((x) => x.jid), backoff: backoff.get(groupJid) || null, scanning: scanningGroups.has(groupJid) }; }

module.exports = { MEMBERSHIP_MONITOR_INTERVAL_MS, start, stop, scanOnce, reset, state, activeSettings };
