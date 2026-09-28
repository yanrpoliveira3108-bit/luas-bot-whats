'use strict';

const crypto = require('crypto');
const database = require('./database');
const rental = require('./rental');
const permissions = require('../utils/permissions');
const logger = require('../utils/logger').child('premium');

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEY_STATES = ['UNUSED', 'REDEEMED', 'REVOKED'];
const CAPABILITIES = new Set(['KEY_CREATE', 'KEY_LIST', 'KEY_REVOKE', 'VIP_LOOKUP']);
const now = () => new Date().toISOString();

function canonicalUser(jid) {
  const s = String(jid || '').trim();
  return s.replace(/:\d+(?=@)/, '');
}
function durationLabel(ms) { return rental.durationLabel(ms); }
function parseDuration(value) { return rental.parseDuration(String(value || '').replace(/^0+(?=\d)/, '')); }
function randomKey() { let raw = ''; for (let i = 0; i < 12; i++) raw += KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)]; return `LUA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`; }
function normalizeKey(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function hashKey(value) { return crypto.createHash('sha256').update(normalizeKey(value), 'utf8').digest('hex'); }
function safeKeyError() { const e = new Error('KEY_INVALID'); e.publicMessage = 'Chave inválida, usada ou revogada.'; return e; }
function audit(event, scope, subject, keyId, actor, metadata = {}) { database.prepare(`vip_audit_${event}`, 'INSERT INTO vip_audit (event,scope,subject_id,key_id,actor_id,metadata,created_at) VALUES (?,?,?,?,?,?,?)').run(event, scope, subject || '', keyId || null, actor || '', JSON.stringify(metadata), now()); }
function keyView(row) { if (!row) return null; return { id: row.id, scope: row.scope, tier: row.tier, durationMs: row.duration_ms, duration: durationLabel(row.duration_ms), status: row.status, prefix: row.key_prefix, last4: row.key_last4, createdAt: row.created_at, createdBy: row.created_by, redeemedAt: row.redeemed_at, redeemedBy: row.redeemed_by, redeemedFor: row.redeemed_for }; }
function entitlementView(row, clock = Date.now()) { if (!row) return null; const expired = row.status !== 'REVOKED' && Date.parse(row.expires_at) <= clock; return { ...row, status: row.status === 'REVOKED' ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE', remainingMs: expired ? 0 : Math.max(0, Date.parse(row.expires_at) - clock) }; }
function getEntitlement(scope, subject, clock = Date.now()) { const row = database.prepare('premium_entitlement_get', 'SELECT * FROM vip_entitlements WHERE scope=? AND subject_id=?').get(scope, canonicalUser(subject)); const view = entitlementView(row, clock); if (view && view.status === 'EXPIRED' && row.status === 'ACTIVE') { database.prepare('premium_entitlement_expire', "UPDATE vip_entitlements SET status='EXPIRED',updated_at=? WHERE id=? AND status='ACTIVE'").run(now(), row.id); audit('VIP_EXPIRED', scope, row.subject_id, row.key_id, '', { expiresAt: row.expires_at }); } return view; }
function hasUserVip(jid, clock = Date.now()) { const e = getEntitlement('USER', canonicalUser(jid), clock); return !!e && e.status === 'ACTIVE'; }
function hasGroupVip(jid, clock = Date.now()) { const s = rental.getGroupSubscription(jid, clock); if (s.plan === 'RENTAL' && s.status === 'ACTIVE' && s.rentalModeEnabled) return true; const e = getEntitlement('GROUP', jid, clock); return !!e && e.status === 'ACTIVE'; }
function hasVipAccess(ctx, options = {}) { if (ctx && ctx.isOwner) return true; const user = ctx && hasUserVip(ctx.sender); const group = ctx && ctx.isGroup && hasGroupVip(ctx.remoteJid); if (options.userOnly) return user; if (options.groupOnly) return group; return user || group; }
function createKey(scope, durationMs, createdBy) { scope = String(scope || '').toUpperCase(); if (!['GROUP', 'USER'].includes(scope)) throw new Error('SCOPE_INVALID'); if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error('DURATION_INVALID'); let plaintext; let hash; do { plaintext = randomKey(); hash = hashKey(plaintext); } while (database.prepare('premium_key_collision', 'SELECT 1 FROM activation_keys WHERE key_hash=?').get(hash)); const created = now(); const result = database.prepare('premium_key_insert', 'INSERT INTO activation_keys (key_hash,key_prefix,key_last4,scope,tier,duration_ms,status,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(hash, plaintext.slice(0, 8), plaintext.slice(-4), scope, scope === 'GROUP' ? 'RENTAL' : 'VIP', durationMs, 'UNUSED', created, canonicalUser(createdBy)); audit('KEY_CREATED', scope, '', result.lastInsertRowid, createdBy, { durationMs }); logger.info({ keyId: result.lastInsertRowid, scope, durationMs, createdBy: canonicalUser(createdBy) }, '[KEY_CREATED]'); return { id: result.lastInsertRowid, key: plaintext, scope, durationMs, duration: durationLabel(durationMs), status: 'UNUSED' }; }
function listKeys(limit = 20) { return database.prepare('premium_key_list', 'SELECT * FROM activation_keys ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 20, 1), 100)).map(keyView); }
function getKey(id) { return keyView(database.prepare('premium_key_get', 'SELECT * FROM activation_keys WHERE id=?').get(Number(id))); }
function revokeKey(id, actor) { const db = database.get(); const tx = db.transaction(() => { const row = db.prepare('SELECT * FROM activation_keys WHERE id=?').get(Number(id)); if (!row || row.status !== 'UNUSED') throw new Error('KEY_NOT_REVOCABLE'); const changed = db.prepare("UPDATE activation_keys SET status='REVOKED' WHERE id=? AND status='UNUSED'").run(row.id); if (changed.changes !== 1) throw new Error('KEY_NOT_REVOCABLE'); audit('KEY_REVOKED', row.scope, '', row.id, actor); return keyView({ ...row, status: 'REVOKED' }); }); return tx(); }
function isSubowner(jid) { return !!database.prepare('subowner_get', 'SELECT 1 FROM subowners WHERE user_id=? AND active=1').get(canonicalUser(jid)); }
function can(ctx, capability) { return !!(ctx && (ctx.isOwner || (CAPABILITIES.has(capability) && isSubowner(ctx.sender)))); }
function addSubowner(target, actor) { const user = canonicalUser(target); const r = database.prepare('subowner_upsert', 'INSERT INTO subowners(user_id,created_at,created_by,active) VALUES(?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET active=1').run(user, now(), canonicalUser(actor)); return !!r; }
function removeSubowner(target) { return database.prepare('subowner_remove', 'UPDATE subowners SET active=0 WHERE user_id=? AND active=1').run(canonicalUser(target)).changes > 0; }
function listSubowners() { return database.prepare('subowner_list', 'SELECT user_id,created_at,created_by FROM subowners WHERE active=1 ORDER BY user_id').all(); }
function revokeEntitlement(scope, subject, actor) { const normalized = scope === 'GROUP' ? String(subject || '') : canonicalUser(subject); const db = database.get(); const tx = db.transaction(() => { const row = db.prepare('SELECT * FROM vip_entitlements WHERE scope=? AND subject_id=?').get(scope, normalized); if (!row || row.status === 'REVOKED') throw new Error('VIP_NOT_FOUND'); db.prepare("UPDATE vip_entitlements SET status='REVOKED',updated_at=? WHERE id=?").run(now(), row.id); if (scope === 'GROUP') db.prepare("UPDATE rental_groups SET rental_mode_enabled=0,updated_at=? WHERE group_jid=?").run(now(), normalized); audit('VIP_REVOKED', scope, normalized, row.key_id, actor); return entitlementView(row); }); return tx(); }
function subjectFromCtx(ctx) { const ids = (ctx.identidades || [ctx.sender]).map(canonicalUser).filter(Boolean); return ids.find((x) => !x.endsWith('@lid')) || canonicalUser(ctx.sender); }
function redeem(ctx, suppliedKey) {
  const normalized = normalizeKey(suppliedKey); if (normalized.length < 12) throw safeKeyError();
  const hash = hashKey(normalized); const db = database.get();
  const tx = db.transaction(() => {
    const key = db.prepare('SELECT * FROM activation_keys WHERE key_hash=?').get(hash);
    if (!key || key.status !== 'UNUSED') throw safeKeyError();
    const isGroup = key.scope === 'GROUP';
    if (isGroup && !ctx.isGroup) { const e = new Error('GROUP_KEY_IN_GROUP'); e.publicMessage = 'Esta key deve ser resgatada dentro do grupo que receberá o aluguel.'; throw e; }
    if (!isGroup && ctx.isGroup) { const e = new Error('USER_KEY_IN_PV'); e.publicMessage = '🔐 Resgate esta key no privado do bot.'; throw e; }
    if (isGroup && !(ctx.isOwner || ctx.isAdmin || isSubowner(ctx.sender))) { const e = new Error('GROUP_REDEEM_FORBIDDEN'); e.publicMessage = 'Apenas o dono, subdono autorizado ou administrador pode ativar o aluguel.'; throw e; }
    const subject = isGroup ? ctx.remoteJid : subjectFromCtx(ctx); const existing = db.prepare('SELECT * FROM vip_entitlements WHERE scope=? AND subject_id=?').get(key.scope, subject); const t = Date.now(); const existingActive = existing && existing.status !== 'REVOKED' && Date.parse(existing.expires_at) > t; const started = existingActive ? existing.started_at : new Date(t).toISOString(); const base = existingActive ? Date.parse(existing.expires_at) : t; const expires = new Date(base + key.duration_ms).toISOString();
    db.prepare(`INSERT INTO vip_entitlements (scope,subject_id,plan,started_at,expires_at,status,source,created_by,key_id,updated_at) VALUES (?,?,?,?,?,'ACTIVE','KEY',?,?,?) ON CONFLICT(scope,subject_id) DO UPDATE SET plan=excluded.plan,started_at=excluded.started_at,expires_at=excluded.expires_at,status='ACTIVE',source='KEY',created_by=excluded.created_by,key_id=excluded.key_id,updated_at=excluded.updated_at`).run(key.scope, subject, key.scope === 'GROUP' ? 'RENTAL' : 'VIP', started, expires, ctx.sender, key.id, now());
    if (isGroup) {
      db.prepare(`INSERT INTO rental_groups (group_jid,plan,started_at,expires_at,duration_ms,activated_by,rental_mode_enabled,bot_enabled,updated_at) VALUES (?,'RENTAL',?,?,?,?,1,1,?) ON CONFLICT(group_jid) DO UPDATE SET plan='RENTAL',started_at=?,expires_at=?,duration_ms=?,activated_by=?,rental_mode_enabled=1,updated_at=?`).run(subject, started, expires, key.duration_ms, ctx.sender, now(), started, expires, key.duration_ms, ctx.sender, now());
    }
    const changed = db.prepare("UPDATE activation_keys SET status='REDEEMED',redeemed_at=?,redeemed_by=?,redeemed_for=? WHERE id=? AND status='UNUSED'").run(now(), canonicalUser(ctx.sender), subject, key.id); if (changed.changes !== 1) throw safeKeyError(); audit('KEY_REDEEMED', key.scope, subject, key.id, ctx.sender, { expiresAt: expires }); audit(existingActive ? 'VIP_EXTENDED' : 'VIP_GRANTED', key.scope, subject, key.id, ctx.sender, { expiresAt: expires }); logger.info({ keyId: key.id, scope: key.scope, subject: key.scope === 'GROUP' ? subject : canonicalUser(subject), expiresAt: expires }, '[KEY_REDEEMED]'); return { scope: key.scope, subject, durationMs: key.duration_ms, expiresAt: expires, extended: !!existingActive };
  });
  return tx();
}
module.exports = { CAPABILITIES, canonicalUser, parseDuration, durationLabel, createKey, listKeys, getKey, revokeKey, revokeEntitlement, redeem, hasUserVip, hasGroupVip, hasVipAccess, getEntitlement, isSubowner, can, addSubowner, removeSubowner, listSubowners };
