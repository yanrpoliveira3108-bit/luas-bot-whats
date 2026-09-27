'use strict';

const settings = require('../database/settings');
const logger = require('./logger').child('group-access');

const KEY = 'group_access_blacklist';
const locks = new Map();
const leaving = new Set();

function validGroupJid(value) {
  const jid = String(value || '').trim();
  return /^\d+@g\.us$/.test(jid) ? jid : null;
}
function read() {
  try { const value = JSON.parse(settings.get(KEY, '{}') || '{}'); return value && typeof value === 'object' ? value : {}; } catch (_) { return {}; }
}
function write(value) { settings.set(KEY, JSON.stringify(value)); }
function get(jid) { const key = validGroupJid(jid); return key ? read()[key] || null : null; }
function isBlocked(jid) { return Boolean(get(jid)); }
function block(jid, blockedBy, name) {
  const key = validGroupJid(jid); if (!key) throw new Error('INVALID_GROUP_JID');
  const all = read();
  all[key] = { groupJid: key, blocked: true, reason: 'owner_leave', blockedAt: new Date().toISOString(), blockedBy: String(blockedBy || '').slice(0, 120), name: String(name || '').slice(0, 200) || null };
  write(all); return all[key];
}
function unblock(jid) { const key = validGroupJid(jid); if (!key) throw new Error('INVALID_GROUP_JID'); const all = read(); const existed = Boolean(all[key]); delete all[key]; write(all); return existed; }
function list() { return Object.values(read()).filter((x) => x && x.blocked); }
async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => {});
  locks.set(key, tail);
  try { return await current; } finally { if (locks.get(key) === tail) locks.delete(key); }
}
function extractInviteCode(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)\/?$/i);
  return match ? match[1] : null;
}
async function join(sock, inviteCode) {
  const info = typeof sock.groupGetInviteInfo === 'function' ? await sock.groupGetInviteInfo(inviteCode) : null;
  const knownJid = validGroupJid(info && (info.id || info.jid));
  if (knownJid && isBlocked(knownJid)) return { blocked: true, groupJid: knownJid, info };
  const groupJid = validGroupJid(await sock.groupAcceptInvite(inviteCode));
  if (!groupJid) throw Object.assign(new Error('JOIN_NO_GROUP_JID'), { code: 'JOIN_NO_GROUP_JID' });
  if (isBlocked(groupJid)) {
    await leave(sock, groupJid);
    return { blocked: true, groupJid };
  }
  return { blocked: false, groupJid, info };
}
async function leave(sock, groupJid) {
  const jid = validGroupJid(groupJid); if (!jid) throw Object.assign(new Error('INVALID_GROUP_JID'), { code: 'INVALID_GROUP_JID' });
  if (leaving.has(jid)) return { alreadyLeaving: true };
  leaving.add(jid);
  try { await sock.groupLeave(jid); return { alreadyLeaving: false }; }
  finally { setTimeout(() => leaving.delete(jid), 5000).unref?.(); }
}
async function guardExternalEntry(sock, ev) {
  const jid = validGroupJid(ev && ev.id); if (!jid || ev.action !== 'add' || !isBlocked(jid)) return false;
  const sameUser = (a, b) => String(a || '').replace(/:\d+(?=@)/, '') === String(b || '').replace(/:\d+(?=@)/, '');
  const ids = [sock.user && sock.user.id, sock.user && sock.user.lid].filter(Boolean).map(String);
  const participants = (ev.participants || []).map(String);
  if (!participants.some((p) => ids.some((id) => sameUser(p, id)))) return false;
  try { await leave(sock, jid); logger.warn({ groupJid: jid, reason: 'blacklist_external_entry' }, '[GROUP_ACCESS] blocked entry removed'); } catch (err) { logger.error({ groupJid: jid, code: err.code || err.message }, '[GROUP_ACCESS] failed blocked leave'); }
  return true;
}
module.exports = { validGroupJid, extractInviteCode, get, isBlocked, block, unblock, list, withLock, join, leave, guardExternalEntry };
