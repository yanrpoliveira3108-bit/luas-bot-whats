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
const responseLocks = new Map();
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
function publicRow(r) { return r && { challengeId: r.challenge_id, groupJid: r.group_jid, participantJid: r.participant_jid, type: r.type, expectedAnswer: r.expected_answer, createdAt: r.created_at, expiresAt: r.expires_at, attempts: r.attempts, status: r.status, deliveryStatus: r.delivery_status || 'ok', challengeMessageId: r.challenge_message_id || '' }; }
function namespace(jid) { return String(jid || '').endsWith('@lid') ? 'lid' : String(jid || '').endsWith('@s.whatsapp.net') ? 'pn' : 'other'; }
function mappingStore(sock) {
  const repository = sock && sock.signalRepository;
  if (!repository) return { store: null, method: 'none' };
  if (typeof repository.getLIDMappingStore === 'function') return { store: repository.getLIDMappingStore(), method: 'getLIDMappingStore' };
  if (repository.lidMapping) return { store: repository.lidMapping, method: 'signalRepository.lidMapping' };
  return { store: null, method: 'none' };
}
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
function normalizeIdentity(jid) { return String(jid || '').replace(/:\d+(?=@)/, ''); }
async function sameParticipantIdentity(sock, a, b) {
  if (!a || !b) return false;
  if (normalizeIdentity(a) === normalizeIdentity(b)) return true;
  const aNs = namespace(a); const bNs = namespace(b);
  if (aNs === bNs) return false;
  const source = aNs === 'lid' ? a : b;
  const other = aNs === 'lid' ? b : a;
  const resolved = await resolveLidInfo(sock, source);
  return Boolean(resolved.value && normalizeIdentity(resolved.value) === normalizeIdentity(other));
}
async function stillPending(r) {
  const list = await listPending(socketRef, r.group_jid);
  for (const p of list) if (await sameParticipantIdentity(socketRef, p.jid, r.participant_jid)) return true;
  return false;
}
async function approve(id) {
  if (responseLocks.has(id)) return responseLocks.get(id);
  const operation = (async () => {
    const r = row(id); if (!r || r.status !== 'pending' || nowMs() >= Number(r.expires_at)) return { ok: false, reason: 'not-pending' };
    if (!(await stillPending(r))) { transition(id, 'pending', 'cancelled'); return { ok: false, reason: 'request-gone' }; }
    // A aprovação externa é a fonte de verdade; verified só vem depois de success=1.
    const result = await approveRequests(socketRef, r.group_jid, [{ jid: r.participant_jid }]);
    if (!result || Number(result.success) !== 1) return { ok: false, reason: 'approve-failed', result };
    if (!transition(id, 'pending', 'verified')) return { ok: false, reason: 'race' };
    return { ok: true, result };
  })();
  responseLocks.set(id, operation);
  try { return await operation; } finally { responseLocks.delete(id); }
}
async function reject(id, finalStatus = 'rejected') {
  const r = row(id); if (!r || r.status !== 'pending') return { ok: false, reason: 'not-pending' };
  // Nunca rejeitar no banco antes de confirmar que o pedido ainda está pending.
  if (!(await stillPending(r))) return { ok: false, reason: 'request-gone' };
  if (!transition(id, 'pending', finalStatus)) return { ok: false, reason: 'race' };
  return { ok: true, result: await rejectRequests(socketRef, r.group_jid, [{ jid: r.participant_jid }]) };
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
function markDeliveryFailed(id, err, details = {}) {
  db.prepare('captcha_delivery_failed', `UPDATE captcha_challenges SET delivery_status = 'delivery_failed' WHERE challenge_id = ? AND status = 'pending'`).run(id);
  logger.error({ challengeId: id, ...details, errorName: err && err.name, errorCode: err && (err.code || err.statusCode), errorMessage: err && err.message, stack: err && err.stack }, '[CAPTCHA_DELIVERY_ERROR]');
}

async function cancelFor(groupJid, participantJid, reason = 'manual') {
  for (const r of pendingFor(groupJid, participantJid)) transition(r.challenge_id, 'pending', 'cancelled');
  return true;
}
async function cancelGroup(groupJid, participantJids, reason) { for (const jid of participantJids || []) await cancelFor(groupJid, jid, reason); }
function quoteInfo(meta = {}) {
  const key = meta.quotedKey || null;
  const context = meta.contextInfo || null;
  const quoted = meta.quoted || (context && context.quotedMessage) || null;
  return {
    stanzaId: key && key.id ? String(key.id) : (context && context.stanzaId ? String(context.stanzaId) : ''),
    hasContextInfo: Boolean(key || quoted),
    hasStanzaId: Boolean((key && key.id) || (context && context.stanzaId)),
    hasQuotedMessage: Boolean(quoted),
    quotedParticipantNamespace: namespace((key && key.participant) || (context && context.participant)),
  };
}
async function onResponse(sock, participantJid, text, send, meta = {}) {
  socketRef = sock;
  const rawText = String(text || '').trim();
  const quote = quoteInfo(meta);
  const identities = [participantJid, ...(meta.identities || [])].filter(Boolean);
  const incomingNamespace = namespace(participantJid);
  const hasText = Boolean(rawText);
  const explicit = rawText.match(/^([A-Za-z0-9]{6})(?:\s+(.+))?$/);
  const explicitId = explicit ? explicit[1].toUpperCase() : '';
  const explicitAnswer = explicit ? String(explicit[2] || '').trim() : '';
  logger.info({ chatNamespace: namespace(meta.remoteJid), participantNamespace: incomingNamespace, fromMe: Boolean(meta.fromMe), messageType: meta.messageType || 'unknown', hasText, hasQuoted: quote.hasQuotedMessage, textLength: rawText.length, explicitChallengeId: Boolean(explicitId), quotedCaptchaCandidate: quote.hasStanzaId }, '[CAPTCHA_ANSWER] inbound');
  logger.info(quote, '[CAPTCHA_ANSWER] quote');

  const all = db.prepare('captcha_pending_all', `SELECT * FROM captcha_challenges WHERE status = 'pending' ORDER BY created_at ASC`).all();
  const matchesIdentity = [];
  for (const challenge of all) {
    let matched = false;
    for (const identity of identities) if (await sameParticipantIdentity(sock, identity, challenge.participant_jid)) { matched = true; break; }
    if (matched) matchesIdentity.push(challenge);
  }
  const mappingAttempted = matchesIdentity.some((r) => namespace(r.participant_jid) !== incomingNamespace);
  logger.info({ incomingNamespace, challengeNamespace: matchesIdentity[0] ? namespace(matchesIdentity[0].participant_jid) : 'none', directMatch: matchesIdentity.some((r) => normalizeIdentity(r.participant_jid) === normalizeIdentity(participantJid)), mappingAttempted, mappingFound: matchesIdentity.length > 0, mappedMatch: matchesIdentity.length > 0 }, '[CAPTCHA_ANSWER] identity');

  let mode = 'none';
  let challenge = null;
  if (explicitId) {
    mode = 'explicit_id';
    challenge = matchesIdentity.find((r) => r.challenge_id.slice(-6).toUpperCase() === explicitId) || null;
  } else if (quote.stanzaId) {
    mode = 'quoted';
    challenge = matchesIdentity.find((r) => r.challenge_message_id && r.challenge_message_id === quote.stanzaId) || null;
  } else if (matchesIdentity.length === 1) {
    mode = 'single_pending';
    challenge = matchesIdentity[0];
  }
  logger.info({ mode, challengeFound: Boolean(challenge), pendingChallengesForIdentity: matchesIdentity.length, challengeStatus: challenge && challenge.status, expired: Boolean(challenge && nowMs() >= Number(challenge.expires_at)) }, '[CAPTCHA_ANSWER] lookup');
  if (!challenge) {
    if (matchesIdentity.length > 1 && !explicitId && !quote.stanzaId) {
      await send('🔐 Há mais de uma verificação pendente. Responda com o código do desafio.');
      return true;
    }
    return false;
  }
  const answer = normalizeAnswer(explicitId ? explicitAnswer : rawText);
  const remainingMs = Number(challenge.expires_at) - nowMs();
  if (remainingMs <= 0) {
    await expire(challenge.challenge_id);
    await send('⌛ O prazo de verificação expirou.');
    return true;
  }
  const matched = answer === normalizeAnswer(challenge.expected_answer);
  const before = Number(challenge.attempts);
  logger.info({ challengeId: challenge.challenge_id, type: challenge.type, answerMatched: matched, attemptBefore: before, attemptAfter: matched ? before : Math.min(MAX_ATTEMPTS, before + 1), remainingMs }, '[CAPTCHA_ANSWER] validate');
  if (matched) {
    const result = await approve(challenge.challenge_id);
    await send(result.ok ? '✅ Verificação concluída. Sua entrada foi aprovada.' : '⚠️ O pedido não está mais pendente ou não pôde ser aprovado.');
    return true;
  }
  const updated = db.prepare('captcha_attempt', `UPDATE captcha_challenges SET attempts = attempts + 1 WHERE challenge_id = ? AND status = 'pending' AND attempts < ?`).run(challenge.challenge_id, MAX_ATTEMPTS);
  const attempts = updated.changes ? row(challenge.challenge_id).attempts : MAX_ATTEMPTS;
  if (attempts >= MAX_ATTEMPTS) { await reject(challenge.challenge_id); await send('❌ Três tentativas incorretas. O pedido foi rejeitado.'); }
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
async function handleCreated(sock, groupJid, participantJid, groupName = 'este grupo', pendingEntry = null) {
  socketRef = sock;
  const pending = await listPending(sock, groupJid);
  if (!pending.some((p) => p.jid === participantJid)) return null;
  const challenge = create(groupJid, participantJid);
  // Stub duplicado não dispara nova DM nem reinicia o TTL.
  if (!challenge.prompt) return challenge;
  logger.info({ group: maskedGroup(groupJid), challengeId: challenge.challengeId }, '[CAPTCHA] resolvendo destinatário privado');
  const pendingPhone = pendingEntry && (pendingEntry.phone_number || pendingEntry.pn || pendingEntry.participant_pn);
  const sourceJid = typeof pendingPhone === 'string' ? pendingPhone : participantJid;
  const source = typeof pendingPhone === 'string' ? 'pending.phone_number' : 'pending.jid';
  const sourceNamespace = namespace(sourceJid);
  let privateJid = sourceJid;
  let mappingFound = sourceNamespace === 'pn';
  let mappingMethod = 'not-needed';
  if (sourceNamespace === 'lid') {
    const resolved = await resolveLidInfo(sock, sourceJid);
    mappingMethod = resolved.method;
    mappingFound = resolved.mappingFound;
    // O fork trata @lid explicitamente no pipeline de envio; sem PN mapeado,
    // preservamos o LID original em vez de fabricar um número.
    if (resolved.value) privateJid = resolved.value;
  }
  const resolvedNamespace = namespace(privateJid);
  logger.info({ sourceNamespace, resolvedNamespace, mappingMethod, mappingFound, sameAsSource: sourceNamespace === resolvedNamespace }, '[CAPTCHA_IDENTITY] resolve');
  logger.info({ source, namespace: resolvedNamespace, mappingFound, sameAsSource: sourceNamespace === resolvedNamespace }, '[CAPTCHA_IDENTITY] destination');
  if (!privateJid || resolvedNamespace === 'other') {
    const err = new Error('destinatário privado não resolvido');
    markDeliveryFailed(challenge.challengeId, err, { destinationNamespace: resolvedNamespace, mappingFound });
    return challenge;
  }
  const shortId = challenge.challengeId.slice(-6).toUpperCase();
  const text = `🔐 *Verificação de entrada*\n\nVocê solicitou entrada em *${groupName}*.\n\n[${shortId}] ${challenge.prompt}\n\nSe tiver mais de uma verificação, responda: ${shortId} sua resposta\n⏱ Você tem 3 minutos.`;
  logger.info({ challengeId: challenge.challengeId, destinationNamespace: resolvedNamespace }, '[CAPTCHA_DM] send-start');
  try {
    const result = await sock.sendMessage(privateJid, { text });
    const resultNamespace = namespace(result && result.key && result.key.remoteJid);
    const messageId = result && result.key && result.key.id;
    if (messageId) db.prepare('captcha_message_id', `UPDATE captcha_challenges SET challenge_message_id = ? WHERE challenge_id = ? AND status = 'pending'`).run(messageId, challenge.challengeId);
    logger.info({ hasResult: Boolean(result), messageIdPresent: Boolean(messageId), destinationNamespace: resolvedNamespace, resultRemoteJidNamespace: resultNamespace, sameDestination: resultNamespace === resolvedNamespace }, '[CAPTCHA_DM] send-result');
    logger.info({ group: maskedGroup(groupJid), challengeId: challenge.challengeId }, '[CAPTCHA] DM enviada');
  } catch (err) {
    markDeliveryFailed(challenge.challengeId, err, { destinationNamespace: resolvedNamespace, mappingFound });
    return challenge;
  }
  return challenge;
}
async function resolveLidInfo(sock, lid) {
  const { store, method } = mappingStore(sock);
  if (!store || typeof store.getPNForLID !== 'function') return { value: null, method, mappingFound: false };
  try {
    const value = await store.getPNForLID(lid);
    const normalized = value && !String(value).endsWith('@lid') ? String(value).replace(/:\d+(?=@)/, '') : null;
    return { value: normalized, method, mappingFound: Boolean(normalized) };
  } catch (err) {
    logger.error({ lid: String(lid).slice(-8), mappingMethod: method, err: err.message, stack: err.stack }, '[CAPTCHA_DELIVERY_ERROR] falha na resolução LID/PN');
    return { value: null, method, mappingFound: false };
  }
}
function setSocket(sock) { socketRef = sock; }
function makeCode() { return `${randomCode(4)}-${randomCode(4)}`; }
module.exports = { CAPTCHA_TTL_MS, MAX_ATTEMPTS, randomCode, makeCode, makeChallenge, create, approve, reject, expire, onCaptchaTimeout, reconcile, onResponse, handleCreated, cancelFor, cancelGroup, pendingFor, setSocket, publicRow, setClockForTests, resetClockForTests };
