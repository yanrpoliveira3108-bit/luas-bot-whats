'use strict';

const { prepare } = require('./database');
const logger = require('../utils/logger').child('rental');

const PLANS = ['FREE', 'TEST', 'RENTAL'];
const CATALOG = [
  ['NUMBER', 'Números', 700, 'A partir de números para uso no WhatsApp.'],
  ['BOT', 'Bot', 0, 'Venda do bot Lua.'],
  ['RENTAL', 'Aluguel', 2500, 'Aluguel do bot por período.'],
  ['DATABASE', 'Database', 0, 'Bases e estruturas de dados.'],
  ['HOST', 'Host', 0, 'Hospedagem e infraestrutura.'],
];
const DEFAULTS = { FREE: null, TEST: 24 * 60 * 60 * 1000, RENTAL: 30 * 24 * 60 * 60 * 1000 };
const now = () => new Date().toISOString();

function ensureSeed() {
  for (const [key, label, cents, description] of CATALOG) {
    prepare(`rental_seed_${key}`, `INSERT OR IGNORE INTO rental_catalog (key,label,price_cents,currency,description,active,sort_order,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(key, label, cents, 'BRL', description, cents > 0 ? 1 : 0, CATALOG.findIndex((x) => x[0] === key), now());
  }
  for (const plan of PLANS) {
    prepare(`rental_plan_seed_${plan}`, `INSERT OR IGNORE INTO rental_plan_defaults (plan,duration_ms,updated_at) VALUES (?,?,?)`)
      .run(plan, DEFAULTS[plan], now());
  }
}

function normalizeGroup(jid) {
  const v = String(jid || '');
  return v.endsWith('@g.us') ? v : null;
}
function assertGroup(jid) { const v = normalizeGroup(jid); if (!v) throw new Error('GROUP_REQUIRED'); return v; }
function parseMoney(input) {
  const raw = String(input || '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(raw)) throw new Error('MONEY_INVALID');
  const parts = raw.replace(',', '.').split('.');
  const cents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000000) throw new Error('MONEY_INVALID');
  return cents;
}
function formatMoney(cents, currency = 'BRL') {
  const value = Number(cents);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('MONEY_INVALID');
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value / 100);
}
function parseDuration(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (raw === 'infinito' || raw === 'infinite' || raw === '∞') return null;
  const m = raw.match(/^(\d+)\s*(m|min|h|d|w)$/);
  if (!m || Number(m[1]) <= 0) throw new Error('DURATION_INVALID');
  const unit = { m: 60000, min: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]];
  const ms = Number(m[1]) * unit;
  if (!Number.isSafeInteger(ms) || ms > 10 * 365 * 86400000) throw new Error('DURATION_INVALID');
  return ms;
}
function durationLabel(ms) {
  if (ms === null || ms === undefined) return 'infinito';
  let n = Math.floor(ms / 86400000); if (n) return `${n}d`;
  n = Math.floor(ms / 3600000); if (n) return `${n}h`;
  return `${Math.floor(ms / 60000)}m`;
}
function getPlanDefaults() { ensureSeed(); return Object.fromEntries(prepare('rental_defaults_all', 'SELECT plan,duration_ms FROM rental_plan_defaults').all().map((r) => [r.plan, r.duration_ms === null ? null : Number(r.duration_ms)])); }
function setPlanDefaultDuration(plan, duration) { plan = String(plan).toUpperCase(); if (!PLANS.includes(plan)) throw new Error('PLAN_INVALID'); const ms = duration === null ? null : (typeof duration === 'number' ? duration : parseDuration(duration)); if (ms !== null && (!Number.isSafeInteger(ms) || ms <= 0)) throw new Error('DURATION_INVALID'); ensureSeed(); prepare('rental_default_set', 'UPDATE rental_plan_defaults SET duration_ms=?,updated_at=? WHERE plan=?').run(ms, now(), plan); return getPlanDefaults()[plan]; }
function getCatalog(includeInactive = false) { ensureSeed(); return prepare('rental_catalog_all', `SELECT * FROM rental_catalog ${includeInactive ? '' : 'WHERE active=1'} ORDER BY sort_order,key`).all(); }
function getCatalogItem(key) { ensureSeed(); return prepare('rental_catalog_one', 'SELECT * FROM rental_catalog WHERE key=?').get(String(key).toUpperCase()) || null; }
function setCatalogPrice(key, price) { const item = getCatalogItem(key); if (!item) throw new Error('CATALOG_INVALID'); const cents = typeof price === 'number' ? price : parseMoney(price); prepare('rental_catalog_price', 'UPDATE rental_catalog SET price_cents=?,updated_at=? WHERE key=?').run(cents, now(), item.key); logger.info({ key: item.key, cents }, '[RENTAL_CATALOG_UPDATED]'); return getCatalogItem(item.key); }
function updateCatalogItem(key, patch) { const item = getCatalogItem(key); if (!item) throw new Error('CATALOG_INVALID'); const next = { ...item, ...patch }; const cents = patch.price_cents === undefined ? item.price_cents : parseMoney(patch.price_cents); prepare('rental_catalog_update', 'UPDATE rental_catalog SET label=?,price_cents=?,currency=?,description=?,active=?,sort_order=?,updated_at=? WHERE key=?').run(next.label, cents, next.currency || 'BRL', next.description || '', next.active ? 1 : 0, Number(next.sort_order) || 0, now(), item.key); return getCatalogItem(item.key); }
function getGroupSubscription(jid, clock = Date.now()) { const group = assertGroup(jid); ensureSeed(); const row = prepare('rental_group_one', 'SELECT * FROM rental_groups WHERE group_jid=?').get(group); const r = row || { group_jid: group, plan: 'FREE', started_at: '', expires_at: null, duration_ms: null, activated_by: '', rental_mode_enabled: 0, bot_enabled: 1, updated_at: '' }; const expired = r.expires_at ? clock >= Date.parse(r.expires_at) : false; return { ...r, rentalModeEnabled: !!r.rental_mode_enabled, botEnabled: !!r.bot_enabled, status: expired ? 'EXPIRED' : 'ACTIVE', remainingMs: expired || !r.expires_at ? null : Math.max(0, Date.parse(r.expires_at) - clock) }; }
function setGroupPlan(jid, plan, options = {}) { const group = assertGroup(jid); plan = String(plan || '').toUpperCase(); if (!PLANS.includes(plan)) throw new Error('PLAN_INVALID'); ensureSeed(); const duration = options.durationMs !== undefined ? options.durationMs : getPlanDefaults()[plan]; if (duration !== null && (!Number.isSafeInteger(duration) || duration <= 0)) throw new Error('DURATION_INVALID'); const started = options.startedAt || now(); const expires = duration === null ? null : new Date(Date.parse(started) + duration).toISOString(); prepare('rental_group_plan', `INSERT INTO rental_groups (group_jid,plan,started_at,expires_at,duration_ms,activated_by,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(group_jid) DO UPDATE SET plan=excluded.plan,started_at=excluded.started_at,expires_at=excluded.expires_at,duration_ms=excluded.duration_ms,activated_by=excluded.activated_by,updated_at=excluded.updated_at`).run(group, plan, started, expires, duration, options.activatedBy || '', now()); logger.info({ groupJid: group, plan, expiresAt: expires }, '[GROUP_PLAN_CHANGED]'); return getGroupSubscription(group); }
function setRentalMode(jid, enabled) { const group = assertGroup(jid); ensureSeed(); prepare('rental_mode_set', `INSERT INTO rental_groups (group_jid, rental_mode_enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(group_jid) DO UPDATE SET rental_mode_enabled=excluded.rental_mode_enabled,updated_at=excluded.updated_at`).run(group, enabled ? 1 : 0, now()); logger.info({ groupJid: group, enabled: !!enabled }, '[RENTAL_MODE_CHANGED]'); return getGroupSubscription(group); }
function setGroupBotEnabled(jid, enabled) { const group = assertGroup(jid); ensureSeed(); prepare('rental_bot_set', `INSERT INTO rental_groups (group_jid, bot_enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(group_jid) DO UPDATE SET bot_enabled=excluded.bot_enabled,updated_at=excluded.updated_at`).run(group, enabled ? 1 : 0, now()); logger.info({ groupJid: group, enabled: !!enabled }, '[GROUP_BOT_STATE_CHANGED]'); return getGroupSubscription(group); }
function canUseRentalFeature(jid, options = {}) { const s = getGroupSubscription(jid); if (!s.rentalModeEnabled) return { ok: false, reason: 'MODE_OFF', state: s }; if (options.plan && (s.plan !== options.plan || s.status !== 'ACTIVE')) return { ok: false, reason: 'PLAN_INVALID', state: s }; return { ok: true, state: s }; }
function isGroupBotEnabled(jid) { return getGroupSubscription(jid).botEnabled; }
function isGroupBotActiveFor(ctx) { return !ctx.isGroup || ctx.isOwner || isGroupBotEnabled(ctx.remoteJid); }
function getGroupBotState(jid) { const s = getGroupSubscription(jid); return { enabled: s.botEnabled, plan: s.plan, status: s.status, rentalModeEnabled: s.rentalModeEnabled, updatedAt: s.updated_at }; }
module.exports = { PLANS, parseMoney, formatMoney, parseDuration, durationLabel, getCatalog, getRentalCatalog: getCatalog, getCatalogItem, setCatalogPrice, updateCatalogItem, getPlanDefaults, setPlanDefaultDuration, getGroupSubscription, setGroupPlan, setRentalMode, setGroupBotEnabled, canUseRentalFeature, isGroupBotEnabled, isGroupBotActiveFor, getGroupBotState };
