'use strict';

const CONFIG = require('../config');
const settings = require('../database/settings');
const premium = require('../database/premium');
const logger = require('./logger').child('pv-policy');

function enabled() { return settings.getBool('pv_auto_enabled', false); }
function setEnabled(value) { settings.set('pv_auto_enabled', !!value); return enabled(); }
function isPrivate(jid) { return String(jid || '').endsWith('@s.whatsapp.net') || String(jid || '').endsWith('@c.us'); }
function isPrivileged(jid) {
  const value = String(jid || '');
  if ((CONFIG.owner.numbers || []).some((n) => value.startsWith(String(n)))) return true;
  try { return premium.isSubowner(value); } catch (_) { return false; }
}
function canSendPrivate({ destination, sourceMessage, reason } = {}) {
  if (!isPrivate(destination) || enabled() || isPrivileged(destination)) return true;
  const source = sourceMessage && sourceMessage.key;
  const sameIncomingPv = !!source && !source.fromMe && source.remoteJid === destination;
  if (sameIncomingPv) return true;
  logger.info({ destination: String(destination).split('@')[1], reason: reason || 'unsolicited' }, '[PV_POLICY_BLOCK]');
  return false;
}
function status() { return { pvAutoEnabled: enabled(), incomingReplies: true, privileged: true }; }
module.exports = { enabled, setEnabled, canSendPrivate, status, isPrivate };
