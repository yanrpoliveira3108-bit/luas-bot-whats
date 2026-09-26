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
function publicRow(r) { return r && { challengeId: r.challenge_id, groupJid: r.group_jid, participantJid: r.participant_jid, type: r.type, expectedAnswer: r.expected_answer, createdAt: r.created_at, expiresAt: r.expires_at, attempts: r.attempts, status: r.status }; }
function schedule(r) {
  if (!r || r.status !== 'pending') return;
  clearTimer(r.challenge_id);
  const delay = Math.max(0, Number(r.expires_at) - Date.now());
  timers.set(r.challenge_id, setTimeout(() => expire(r.challenge_id).catch(() => {}), delay));
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
  const id = `cap_${Date.now().toString(36)}_${randomCode(6)}`;
  const now = Date.now(); const expires = now + CAPTCHA_TTL_MS;
  try {
    db.prepare('captcha_insert', `INSERT INTO captcha_challenges (challenge_id, group_jid, participant_jid, type, expected_answer, created_at, expires_at, attempts, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')`).run(id, groupJid, participantJid, challenge.type, challenge.expectedAnswer, now, expires);
  } catch (err) {
    if (/unique/i.test(String(err && err.message))) {
      const existing = pendingFor(groupJid, participantJid)[0];
      if (existing) { schedule(existing); return publicRow(existing); }
    }
    throw err;
  }
  const r = row(id); schedule(r); return { ...publicRow(r), prompt: challenge.prompt };
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
  const r = row(id); if (!r || r.status !== 'pending' || Date.now() > Number(r.expires_at)) return { ok: false, reason: 'not-pending' };
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
  if (Date.now() < Number(r.expires_at)) return schedule(r);
  const result = await reject(id, 'expired');
  if (result.ok) logger.info({ group: r.group_jid, result: result.reason || 'rejected' }, '[CAPTCHA] desafio expirado');
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
  if (Date.now() > Number(r.expires_at)) { await expire(r.challenge_id); await send('⌛ O prazo de verificação expirou.'); return true; }
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
  for (const r of rows) { if (Number(r.expires_at) <= Date.now()) await expire(r.challenge_id); else schedule(r); }
}
async function handleCreated(sock, groupJid, participantJid, groupName = 'este grupo') {
  socketRef = sock;
  const pending = await listPending(sock, groupJid);
  if (!pending.some((p) => p.jid === participantJid)) return null;
  const challenge = create(groupJid, participantJid);
  // Stub duplicado não dispara nova DM nem reinicia o TTL.
  if (!challenge.prompt) return challenge;
  const privateJid = participantJid.endsWith('@lid') ? await resolveLid(sock, participantJid) : participantJid;
  if (!privateJid) { await reject(challenge.challengeId); logger.error({ group: groupJid }, '[CAPTCHA_DELIVERY_ERROR] LID/PN não resolvido'); return null; }
  const shortId = challenge.challengeId.slice(-6).toUpperCase();
  const text = `🔐 *Verificação de entrada*\n\nVocê solicitou entrada em *${groupName}*.\n\n[${shortId}] ${challenge.prompt}\n\nSe tiver mais de uma verificação, responda: ${shortId} sua resposta\n⏱ Você tem 3 minutos.`;
  try { await sock.sendMessage(privateJid, { text }); } catch (err) { logger.error({ group: groupJid, err: err.message }, '[CAPTCHA_DELIVERY_ERROR] falha ao enviar DM'); await reject(challenge.challengeId); return null; }
  return challenge;
}
async function resolveLid(sock, lid) {
  try { const map = sock && sock.signalRepository && sock.signalRepository.lidMapping; const value = map && typeof map.getPNForLID === 'function' ? await map.getPNForLID(lid) : null; return value && !String(value).endsWith('@lid') ? String(value).replace(/:\d+(?=@)/, '') : null; } catch (_) { return null; }
}
function setSocket(sock) { socketRef = sock; }
function makeCode() { return `${randomCode(4)}-${randomCode(4)}`; }
module.exports = { CAPTCHA_TTL_MS, MAX_ATTEMPTS, randomCode, makeCode, makeChallenge, create, approve, reject, expire, reconcile, onResponse, handleCreated, cancelFor, cancelGroup, pendingFor, setSocket, publicRow };
