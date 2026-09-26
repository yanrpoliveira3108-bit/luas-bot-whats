'use strict';

const crypto = require('node:crypto');
const db = require('../database/database');
const { listPending, approveRequests, rejectRequests } = require('./groupRequests');
const logger = require('./logger').child('captcha');

const CAPTCHA_TTL_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const AMBIGUOUS = /[01IO]/g;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const timers = new Map();
let socketRef = null;
let clock = () => Date.now();
function nowMs() { return clock(); }

function randomCode(length = 8) {
  let out = '';
  while (out.length < length) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out.slice(0, length);
}
function randomDigits(min, max) { return crypto.randomInt(min, max + 1); }
function makeChallenge() {
  const type = ['math', 'word', 'code'][crypto.randomInt(3)];
  if (type === 'math') {
    const a = randomDigits(2, 15); const b = randomDigits(1, a);
    return { type, prompt: `Quanto é ${a} + ${b}?`, expectedAnswer: String(a + b) };
  }
  if (type === 'word') { const token = randomCode(5); return { type, prompt: `Digite a palavra: ${token}`, expectedAnswer: token }; }
  const token = `${randomCode(4)}-${randomCode(4)}`;
  return { type, prompt: `Digite o código: ${token}`, expectedAnswer: token };
}
function normalizeAnswer(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }
function row(id) { return db.prepare('captcha_get', 'SELECT * FROM captcha_challenges WHERE challenge_id = ?').get(id) || null; }
function publicRow(r) { return r && { challengeId: r.challenge_id, groupJid: r.group_jid, participantJid: r.participant_jid, type: r.type, expectedAnswer: r.expected_answer, createdAt: r.created_at, expiresAt: r.expires_at, attempts: r.attempts, status: r.status, deliveryStatus: r.delivery_status || 'ok' }; }
function namespace(jid) { return String(jid || '').endsWith('@lid') ? 'lid' : String(jid || '').endsWith('@s.whatsapp.net') ? 'pn' : 'other'; }
function maskedGroup(jid) { const value = String(jid || ''); return value ? `${value.slice(0, 6)}…${value.slice(-5)}` : ''; }
function setClockForTests(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }
function resetClockForTests() { clock = () => Date.now(); }
function logCreate(r) { logger.info({ challengeId: r.challenge_id, groupJid: maskedGroup(r.group_jid), participantNamespace: namespace(r.participant_jid), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), ttlMs: CAPTCHA_TTL_MS, remainingMs: Number(r.expires_at) - nowMs(), attempts: Number(r.attempts), status: r.status }, '[CAPTCHA_RUNTIME] create'); }
function schedule(r) {
  if (!r || r.status !== 'pending') return;
  clearTimer(r.challenge_id);
  const now = nowMs();
  const remainingMs = Number(r.expires_at) - now;
  logger.info({ challengeId: r.challenge_id, now, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), remainingMs }, '[CAPTCHA_RUNTIME] schedule');
  timers.set(r.challenge_id, setTimeout(() => onCaptchaTimeout(r.challenge_id).catch((err) => {
    logger.error({ challengeId: r.challenge_id, err: err.message, stack: err.stack }, '[CAPTCHA_ERROR] falha no timeout');
  }), Math.max(0, remainingMs)));
}
async function onCaptchaTimeout(challengeId) {
  const challenge = row(challengeId);
  if (!challenge || challenge.status !== 'pending') return;
  const now = nowMs();
  const remainingMs = Number(challenge.expires_at) - now;
  logger.info({ challengeId, now, expiresAt: Number(challenge.expires_at), remainingMs, status: challenge.status }, '[CAPTCHA_RUNTIME] expire-check');
  if (remainingMs > 0) {
    schedule(challenge);
    return;
  }
  await expire(challengeId);
}
function clearTimer(id) { const t = timers.get(id); if (t) clearTimeout(t); timers.delete(id); }
function pendingFor(groupJid, participantJid) {
  return db.prepare('captcha_pending_pair', `SELECT * FROM captcha_challenges WHERE group_jid = ? AND participant_jid = ? AND status = 'pending' ORDER BY created_at DESC`).all(groupJid, participantJid);
}
function pendingForParticipant(jid) {
  return db.prepare('captcha_pending_person', `SELECT * FROM captcha_challenges WHERE participant_jid = ? AND status = 'pending' ORDER BY created_at ASC`).all(jid);
}
function create(groupJid, participantJid, meta = {}) {
  const old = pendingFor(groupJid, participantJid);
  if (old.length) return publicRow(old[0]);
  const challenge = makeChallenge();
  const id = `cap_${nowMs().toString(36)}_${randomCode(6)}`;
  const now = nowMs(); const expires = now + CAPTCHA_TTL_MS;
  try {
    db.prepare('captcha_insert', `INSERT INTO captcha_challenges (challenge_id, group_jid, participant_jid, type, expected_answer, created_at, expires_at, attempts, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')`).run(id, groupJid, participantJid, challenge.type, challenge.expectedAnswer, now, expires);
  } catch (err) {
    if (/unique/i.test(String(err && err.message))) {
      const existing = pendingFor(groupJid, participantJid)[0];
      if (existing) { schedule(existing); return publicRow(existing); }
    }
    throw err;
  }
  const r = row(id);
  logCreate(r);
  schedule(r);
  logger.info({ group: maskedGroup(groupJid), challengeId: id }, '[CAPTCHA] desafio persistido');
  return { ...publicRow(r), prompt: challenge.prompt };
}
function transition(id, from, to) {
  const result = db.prepare('captcha_transition', `UPDATE captcha_challenges SET status = ? WHERE challenge_id = ? AND status = ?`).run(to, id, from);
  if (result.changes !== 1) return false;
  clearTimer(id); return true;
}
async function stillPending(r) {
  const list = await listPending(socketRef, r.group_jid);
  return list.some((p) => p.jid === r.participant_jid);
}
async function approve(id) {
  const r = row(id); if (!r || r.status !== 'pending' || nowMs() > Number(r.expires_at)) return { ok: false, reason: 'not-pending' };
  if (!(await stillPending(r))) { transition(id, 'pending', 'cancelled'); return { ok: false, reason: 'request-gone' }; }
  if (!transition(id, 'pending', 'verified')) return { ok: false, reason: 'race' };
  const result = await approveRequests(socketRef, r.group_jid, [{ jid: r.participant_jid }]);
  if (!result.success) { db.prepare('captcha_reopen', `UPDATE captcha_challenges SET status = 'pending' WHERE challenge_id = ? AND status = 'verified'`).run(id); schedule(row(id)); return { ok: false, reason: 'approve-failed', result }; }
  return { ok: true, result };
}
async function reject(id, finalStatus = 'rejected') {
  const r = row(id); if (!r || r.status !== 'pending') return { ok: false, reason: 'not-pending' };
  if (!transition(id, 'pending', finalStatus)) return { ok: false, reason: 'race' };
  if (await stillPending(r)) return { ok: true, result: await rejectRequests(socketRef, r.group_jid, [{ jid: r.participant_jid }]) };
  return { ok: true, reason: 'request-gone' };
}
async function expire(id) {
  const r = row(id); if (!r || r.status !== 'pending') return;
  const now = nowMs();
  const remainingMs = Number(r.expires_at) - now;
  logger.info({ challengeId: id, now, expiresAt: Number(r.expires_at), remainingMs, status: r.status }, '[CAPTCHA_RUNTIME] expire-check');
  if (remainingMs > 0) return schedule(r);
  const result = await reject(id, 'expired');
  if (result.ok) logger.info({ group: maskedGroup(r.group_jid), result: result.reason || 'rejected' }, '[CAPTCHA] desafio expirado');
}
function markDeliveryFailed(id, err) {
  db.prepare('captcha_delivery_failed', `UPDATE captcha_challenges SET delivery_status = 'delivery_failed' WHERE challenge_id = ? AND status = 'pending'`).run(id);
  logger.error({ challengeId: id, errorName: err && err.name, errorCode: err && (err.code || err.statusCode), errorMessage: err && err.message, stack: err && err.stack }, '[CAPTCHA_DELIVERY_ERROR]');
}

async function cancelFor(groupJid, participantJid, reason = 'manual') {
  for (const r of pendingFor(groupJid, participantJid)) transition(r.challenge_id, 'pending', 'cancelled');
  return true;
}
async function cancelGroup(groupJid, participantJids, reason) { for (const jid of participantJids || []) await cancelFor(groupJid, jid, reason); }
async function onResponse(sock, participantJid, text, send) {
  socketRef = sock;
  const rows = pendingForParticipant(participantJid);
  if (!rows.length) return false;
  // Resposta sem identificador só é aceita quando há um único desafio para evitar ambiguidade entre grupos.
  const answer = normalizeAnswer(text); const candidates = rows.length === 1 ? rows : rows.filter((r) => answer.includes(r.challenge_id.slice(-6).toUpperCase()));
  if (!candidates.length) { await send('🔐 Há mais de uma verificação pendente. Responda incluindo o código curto do desafio.'); return true; }
  const r = candidates[0];
  if (nowMs() > Number(r.expires_at)) { await expire(r.challenge_id); await send('⌛ O prazo de verificação expirou.'); return true; }
  const expected = normalizeAnswer(r.expected_answer);
  const supplied = answer.replace(r.challenge_id.slice(-6).toUpperCase(), '').trim();
  if (supplied === expected) {
    const result = await approve(r.challenge_id);
    await send(result.ok ? '✅ Verificação confirmada. Seu pedido foi aprovado.' : '⚠️ O pedido não está mais pendente ou não pôde ser aprovado.');
    return true;
  }
  const updated = db.prepare('captcha_attempt', `UPDATE captcha_challenges SET attempts = attempts + 1 WHERE challenge_id = ? AND status = 'pending' AND attempts < ?`).run(r.challenge_id, MAX_ATTEMPTS);
  const attempts = (updated.changes ? row(r.challenge_id).attempts : MAX_ATTEMPTS);
  if (attempts >= MAX_ATTEMPTS) { await reject(r.challenge_id); await send('❌ Três tentativas incorretas. O pedido foi rejeitado.'); }
  else await send(`❌ Resposta incorreta. Tentativa ${attempts} de ${MAX_ATTEMPTS}.`);
  return true;
}
async function reconcile(sock) {
  socketRef = sock;
  const rows = db.prepare('captcha_all_pending', `SELECT * FROM captcha_challenges WHERE status = 'pending'`).all();
  for (const r of rows) {
    const remainingMs = Number(r.expires_at) - nowMs();
    logger.info({ challengeId: r.challenge_id, now: nowMs(), expiresAt: Number(r.expires_at), remainingMs, status: r.status }, '[CAPTCHA_RUNTIME] reconcile');
    if (remainingMs <= 0) await expire(r.challenge_id); else schedule(r);
  }
}
async function handleCreated(sock, groupJid, participantJid, groupName = 'este grupo') {
  socketRef = sock;
  const pending = await listPending(sock, groupJid);
  if (!pending.some((p) => p.jid === participantJid)) return null;
  const challenge = create(groupJid, participantJid);
  // Stub duplicado não dispara nova DM nem reinicia o TTL.
  if (!challenge.prompt) return challenge;
  logger.info({ group: maskedGroup(groupJid), challengeId: challenge.challengeId }, '[CAPTCHA] resolvendo destinatário privado');
  const sourceNamespace = namespace(participantJid);
  let privateJid = participantJid;
  let mappingFound = sourceNamespace === 'pn';
  if (sourceNamespace === 'lid') {
    privateJid = await resolveLid(sock, participantJid);
    mappingFound = Boolean(privateJid);
  }
  const resolvedNamespace = namespace(privateJid);
  logger.info({ sourceNamespace, resolvedNamespace, mappingFound, sameAsSource: sourceNamespace === resolvedNamespace }, '[CAPTCHA_RUNTIME] recipient');
  if (!privateJid || resolvedNamespace === 'other') {
    const err = new Error('destinatário privado não resolvido');
    markDeliveryFailed(challenge.challengeId, err);
    return challenge;
  }
  const shortId = challenge.challengeId.slice(-6).toUpperCase();
  const text = `🔐 *Verificação de entrada*\n\nVocê solicitou entrada em *${groupName}*.\n\n[${shortId}] ${challenge.prompt}\n\nSe tiver mais de uma verificação, responda: ${shortId} sua resposta\n⏱ Você tem 3 minutos.`;
  logger.info({ challengeId: challenge.challengeId, destinationNamespace: resolvedNamespace }, '[CAPTCHA_RUNTIME] send-start');
  try {
    const result = await sock.sendMessage(privateJid, { text });
    logger.info({ hasResult: Boolean(result), messageIdPresent: Boolean(result && result.key && result.key.id), destinationNamespace: resolvedNamespace }, '[CAPTCHA_RUNTIME] send-result');
    logger.info({ group: maskedGroup(groupJid), challengeId: challenge.challengeId }, '[CAPTCHA] DM enviada');
  } catch (err) {
    markDeliveryFailed(challenge.challengeId, err);
    return challenge;
  }
  return challenge;
}
async function resolveLid(sock, lid) {
  try {
    const map = sock && sock.signalRepository && sock.signalRepository.lidMapping;
    const value = map && typeof map.getPNForLID === 'function' ? await map.getPNForLID(lid) : null;
    return value && !String(value).endsWith('@lid') ? String(value).replace(/:\d+(?=@)/, '') : null;
  } catch (err) {
    logger.error({ lid: String(lid).slice(0, 8), err: err.message, stack: err.stack }, '[CAPTCHA_DELIVERY_ERROR] falha na resolução LID/PN');
    return null;
  }
}
function setSocket(sock) { socketRef = sock; }
function makeCode() { return `${randomCode(4)}-${randomCode(4)}`; }
module.exports = { CAPTCHA_TTL_MS, MAX_ATTEMPTS, randomCode, makeCode, makeChallenge, create, approve, reject, expire, onCaptchaTimeout, reconcile, onResponse, handleCreated, cancelFor, cancelGroup, pendingFor, setSocket, publicRow, setClockForTests, resetClockForTests };
