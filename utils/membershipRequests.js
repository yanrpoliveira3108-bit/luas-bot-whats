'use strict';

const groups = require('../database/groups');
const { listPending, approveRequests } = require('./groupRequests');
const captcha = require('./captchaManager');
const logger = require('./logger').child('membership');

// Vendor: GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD = 172.
const REQUEST_STUB = 172;
const initialized = new WeakSet();

async function groupName(sock, jid) {
  try { const meta = await sock.groupMetadata(jid); return meta && meta.subject ? meta.subject : 'este grupo'; } catch (_) { return 'este grupo'; }
}
async function handleMessage(sock, msg, type) {
  if (!sock || !msg || !msg.key) return false;
  if (type && type !== 'notify') return false;
  captcha.setSocket(sock);
  if (!initialized.has(sock)) { initialized.add(sock); await captcha.reconcile(sock); }
  if (typeof msg.messageStubType !== 'number' || msg.messageStubType !== REQUEST_STUB) return false;
  const groupJid = msg.key.remoteJid;
  const params = Array.isArray(msg.messageStubParameters) ? msg.messageStubParameters : [];
  const participantJid = params[0]; const action = String(params[1] || '').toLowerCase();
  if (!String(groupJid || '').endsWith('@g.us') || !participantJid) return true;
  if (action === 'revoked' || action === 'rejected') {
    await captcha.cancelFor(groupJid, participantJid, action);
    return true;
  }
  if (action !== 'created') return true;
  // Configuração é lida somente depois da confirmação real da lista pendente.
  const pending = await listPending(sock, groupJid);
  if (!pending.some((p) => p.jid === participantJid)) return true;
  const settings = groups.getSettings(groupJid) || {};
  const captchaEnabled = settings.captcha === true;
  if (captchaEnabled) {
    await captcha.handleCreated(sock, groupJid, participantJid, await groupName(sock, groupJid));
    return true;
  }
  if (settings.autoaceitar === true) {
    const result = await approveRequests(sock, groupJid, [{ jid: participantJid }]);
    logger.info({ group: groupJid, success: result.success, failed: result.failed }, '[AUTO_ACCEPT] pedido processado');
  }
  return true;
}
module.exports = { REQUEST_STUB, handleMessage };
