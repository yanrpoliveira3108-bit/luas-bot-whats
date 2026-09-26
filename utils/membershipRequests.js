'use strict';

const groups = require('../database/groups');
const { listPending, approveRequests } = require('./groupRequests');
const captcha = require('./captchaManager');
const logger = require('./logger').child('membership');
const { WAMessageStubType } = require('../vendor/boruto-vk7-baileys/lib/Types/Message');

const REQUEST_STUB = WAMessageStubType.GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD;
const initialized = new WeakSet();

function safeJid(jid) {
  const value = String(jid || '');
  if (!value) return '';
  const at = value.lastIndexOf('@');
  return at < 0 ? '***' : `${value.slice(0, Math.min(at, 6))}…${value.slice(at)}`;
}
function suffix(jid) { return String(jid || '').endsWith('@lid') ? 'lid' : String(jid || '').endsWith('@s.whatsapp.net') ? 'pn' : 'other'; }
function withoutDevice(jid) { return String(jid || '').replace(/:\d+(?=@)/, ''); }

async function resolveLid(sock, jid) {
  if (!String(jid || '').endsWith('@lid')) return null;
  const map = sock && sock.signalRepository && sock.signalRepository.lidMapping;
  if (!map || typeof map.getPNForLID !== 'function') return null;
  const resolved = await map.getPNForLID(jid);
  return resolved && !String(resolved).endsWith('@lid') ? withoutDevice(resolved) : null;
}
async function participantMatches(sock, left, right) {
  if (withoutDevice(left) === withoutDevice(right)) return true;
  const leftPn = await resolveLid(sock, left);
  if (leftPn && withoutDevice(leftPn) === withoutDevice(right)) return true;
  const rightPn = await resolveLid(sock, right);
  return !!rightPn && withoutDevice(rightPn) === withoutDevice(left);
}
async function findParticipant(sock, pending, participantJid) {
  for (const entry of pending) if (await participantMatches(sock, entry.jid, participantJid)) return entry;
  return null;
}
async function groupName(sock, jid) {
  try {
    const meta = await sock.groupMetadata(jid);
    return meta && meta.subject ? meta.subject : 'este grupo';
  } catch (err) {
    logger.warn({ group: safeJid(jid), err: err && err.message, stack: err && err.stack }, '[MEMBERSHIP_DEBUG] falha ao obter nome do grupo');
    return 'este grupo';
  }
}

async function handleMessage(sock, msg, type) {
  if (!sock || !msg || !msg.key) return false;
  if (type && type !== 'notify') return false;
  captcha.setSocket(sock);
  if (!initialized.has(sock)) {
    initialized.add(sock);
    await captcha.reconcile(sock);
  }

  const receivedType = msg.messageStubType;
  const matched = receivedType === REQUEST_STUB;
  logger.info({ receivedType, expectedType: REQUEST_STUB, matched }, '[MEMBERSHIP_DEBUG] verificando stub');
  if (!matched) return false;

  const groupJid = msg.key.remoteJid;
  const params = Array.isArray(msg.messageStubParameters) ? msg.messageStubParameters : [];
  const participantJid = params[0];
  const action = typeof params[1] === 'string' ? params[1].toLowerCase() : '';
  const requestMethod = params[2];
  logger.info({ groupJid: safeJid(groupJid), parametersCount: params.length, action, participantSuffix: suffix(participantJid), requestMethod }, '[MEMBERSHIP_DEBUG] membership stub matched');

  if (!String(groupJid || '').endsWith('@g.us') || typeof participantJid !== 'string') return true;
  if (action === 'revoked' || action === 'rejected') {
    await captcha.cancelFor(groupJid, participantJid, action);
    return true;
  }
  if (action !== 'created') return true;

  const settings = groups.getSettings(groupJid) || {};
  const captchaEnabled = settings.captcha === true;
  const autoAcceptEnabled = settings.autoaceitar === true;
  logger.info({ groupJid: safeJid(groupJid), autoaceitar: autoAcceptEnabled, captcha: captchaEnabled }, '[MEMBERSHIP_DEBUG] settings');
  logger.info({ groupJid: safeJid(groupJid), participant: safeJid(participantJid) }, '[MEMBERSHIP_DEBUG] confirmando pedido');
  const pending = await listPending(sock, groupJid);
  logger.info({ groupJid: safeJid(groupJid), count: pending.length }, '[MEMBERSHIP_DEBUG] pending count');
  const match = await findParticipant(sock, pending, participantJid);
  logger.info({ stubType: suffix(participantJid), pendingCount: pending.length, matched: Boolean(match), stubParticipant: safeJid(participantJid), pendingParticipant: safeJid(match && match.jid) }, '[MEMBERSHIP_DEBUG] participant match');
  if (!match) return true;

  if (captchaEnabled) {
    logger.info({ group: safeJid(groupJid), participant: safeJid(participantJid) }, '[MEMBERSHIP] decision captcha');
    logger.info({ group: safeJid(groupJid), participant: safeJid(participantJid) }, '[CAPTCHA] criando desafio');
    const challenge = await captcha.handleCreated(sock, groupJid, match.jid, await groupName(sock, groupJid));
    if (challenge) logger.info({ group: safeJid(groupJid), challengeId: challenge.challengeId }, '[CAPTCHA] desafio persistido');
    return true;
  }
  if (autoAcceptEnabled) {
    logger.info({ group: safeJid(groupJid), participant: safeJid(match.jid) }, '[MEMBERSHIP] decision autoaccept');
    logger.info({ group: safeJid(groupJid), participant: safeJid(match.jid) }, '[AUTO_ACCEPT] iniciando');
    const result = await approveRequests(sock, groupJid, [{ jid: match.jid }]);
    logger.info({ requested: result.requested, success: result.success, failed: result.failed }, '[AUTO_ACCEPT] result');
    return true;
  }
  logger.info({ group: safeJid(groupJid), participant: safeJid(match.jid) }, '[MEMBERSHIP] decision manual');
  return true;
}

module.exports = { REQUEST_STUB, handleMessage, participantMatches };
