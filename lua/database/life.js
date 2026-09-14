/**
 * database/life.js — domínio de persistência do Lua Life.
 *
 * Entidades separadas (players, properties, businesses, employees, market,
 * missions, achievements, daily, tools, economy_logs) — nada de objeto gigante.
 * Reaproveita economy.js (carteira/banco/inventário) e rpg.js (energia legada,
 * fazenda, cooldowns) para não duplicar sistemas.
 *
 * Operações econômicas multi-etapa são atômicas (transação SQLite) e devem ser
 * chamadas dentro de utils/keyedMutex.withLock(jid, ...) nos comandos.
 */

'use strict';

const { prepare, get: getDb } = require('./database');
const economy = require('./economy');
const now = () => new Date().toISOString();

/* ------------------------------ jogadores ----------------------------- */

function ensurePlayer(userId) {
  prepare('ensure_life', `INSERT OR IGNORE INTO life_players (user_id, created_at) VALUES (?, ?)`).run(userId, now());
}

function getPlayer(userId) {
  ensurePlayer(userId);
  return prepare('get_life', `SELECT * FROM life_players WHERE user_id = ?`).get(userId);
}

function createCharacter(userId, { name, age, city, money }) {
  const tx = getDb().transaction(() => {
    ensurePlayer(userId);
    prepare('set_char', `UPDATE life_players SET name = ?, age = ?, city = ? WHERE user_id = ?`).run(
      name || '',
      Number.isFinite(age) && age > 0 ? Math.floor(age) : 18,
      city || '',
      userId
    );
    if (money > 0) economy.addWallet(userId, money);
  });
  tx();
  return getPlayer(userId);
}

function updatePlayer(userId, fields) {
  const p = getPlayer(userId);
  const next = Object.assign({}, p, fields);
  prepare(
    'upd_life',
    `UPDATE life_players SET name=?, age=?, city=?, energy=?, health=?, hunger=?, happiness=?,
     knowledge=?, efficiency=?, luck=?, reputation=?, xp=?, level=?, career_xp=?, career_level=?, last_activity=? WHERE user_id=?`
  ).run(
    next.name, next.age, next.city, next.energy, next.health, next.hunger, next.happiness,
    next.knowledge, next.efficiency, next.luck, next.reputation, next.xp, next.level,
    next.career_xp, next.career_level, now(), userId
  );
  return getPlayer(userId);
}

/** Soma deltas em vitais/atributos (com clamp). */
function applyVitals(userId, { energy = 0, health = 0, hunger = 0, happiness = 0, xp = 0 }) {
  const tx = getDb().transaction(() => {
    const p = getPlayer(userId);
    const clamp = (v, min = 0, max = 100) => Math.min(max, Math.max(min, v));
    prepare(
      'vitals_life',
      `UPDATE life_players SET energy=?, health=?, hunger=?, happiness=?, xp=xp+? WHERE user_id=?`
    ).run(
      clamp(p.energy + energy, 0, 200),
      clamp(p.health + health),
      clamp(p.hunger + hunger),
      clamp(p.happiness + happiness),
      Math.max(0, Math.floor(xp)),
      userId
    );
  });
  tx();
  return getPlayer(userId);
}

function addLifeXp(userId, amount) {
  const tx = getDb().transaction(() => {
    const p = getPlayer(userId);
    const xp = p.xp + Math.max(0, Math.floor(amount));
    const level = lifeLevelFromXp(xp);
    const leveled = level > p.level;
    prepare('xp_life', `UPDATE life_players SET xp=?, level=? WHERE user_id=?`).run(xp, level, userId);
    return { xp, level, leveled };
  });
  return tx();
}

function lifeLevelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
}

function xpForNextLevel(level) {
  return Math.pow(level, 2) * 50;
}

/* ---------------------------- propriedades ---------------------------- */

function addProperty(userId, kind, spec, level = 1) {
  return prepare(
    'add_prop',
    `INSERT INTO life_properties (user_id, kind, spec, level, bought_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, kind, spec) DO UPDATE SET level = MAX(life_properties.level, excluded.level)`
  ).run(userId, kind, spec, level, now());
}

function getProperty(userId, kind, spec) {
  return prepare('get_prop', `SELECT * FROM life_properties WHERE user_id = ? AND kind = ? AND spec = ?`).get(userId, kind, spec) || null;
}

function listProperties(userId) {
  return prepare('list_prop', `SELECT * FROM life_properties WHERE user_id = ? ORDER BY kind, spec`).all(userId);
}

function upgradeProperty(userId, kind, spec, newLevel) {
  return prepare('upd_prop', `UPDATE life_properties SET level = ? WHERE user_id = ? AND kind = ? AND spec = ?`).run(newLevel, userId, kind, spec);
}

function countPropertyKind(userId, kind) {
  return prepare('count_prop_kind', `SELECT COUNT(*) AS c FROM life_properties WHERE user_id = ? AND kind = ?`).get(userId, kind).c;
}

/* ------------------------------ empresas ------------------------------ */

function addBusiness(userId, kind, name) {
  const info = prepare(
    'add_business',
    `INSERT INTO life_businesses (user_id, kind, name, last_collect_at) VALUES (?, ?, ?, ?)`
  ).run(userId, kind, name || '', now());
  return Number(info.lastInsertRowid);
}

function getBusiness(id) {
  return prepare('get_business', `SELECT * FROM life_businesses WHERE id = ?`).get(id) || null;
}

function listBusinesses(userId) {
  return prepare('list_business', `SELECT * FROM life_businesses WHERE user_id = ? ORDER BY id`).all(userId);
}

function touchBusiness(id, extraEmployees = 0) {
  return prepare('touch_business', `UPDATE life_businesses SET employees = employees + ?, last_collect_at = ? WHERE id = ?`).run(extraEmployees, now(), id);
}

function addEmployee(userId, businessId, kind, level = 1) {
  return prepare(
    'add_employee',
    `INSERT INTO life_employees (business_id, user_id, kind, level, hired_at) VALUES (?, ?, ?, ?, ?)`
  ).run(businessId, userId, kind, level, now());
}

function listEmployees(businessId) {
  return prepare('list_employees', `SELECT * FROM life_employees WHERE business_id = ? ORDER BY id`).all(businessId);
}

/* ------------------------------ mercado ------------------------------- */

function createOffer(sellerId, itemId, quantity, unitPrice) {
  const info = prepare(
    'create_offer',
    `INSERT INTO life_market (seller_id, item_id, quantity, unit_price, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`
  ).run(sellerId, itemId, quantity, unitPrice, now());
  return Number(info.lastInsertRowid);
}

function listOffers(status = 'active', limit = 20) {
  return prepare('list_offers', `SELECT * FROM life_market WHERE status = ? ORDER BY id DESC LIMIT ?`).all(status, limit);
}

function listUserOffers(sellerId) {
  return prepare('list_my_offers', `SELECT * FROM life_market WHERE seller_id = ? ORDER BY id DESC LIMIT 50`).all(sellerId);
}

function getOffer(id) {
  return prepare('get_offer', `SELECT * FROM life_market WHERE id = ?`).get(id) || null;
}

function closeOffer(id, buyerId) {
  return prepare('close_offer', `UPDATE life_market SET status = 'sold', buyer_id = ? WHERE id = ?`).run(buyerId || '', id);
}

function cancelOffer(id, sellerId) {
  return prepare('cancel_offer', `UPDATE life_market SET status = 'cancelled' WHERE id = ? AND seller_id = ?`).run(id, sellerId);
}

/* ------------------------------ missões ------------------------------- */

function ensureMission(userId, missionId, expiresAt) {
  prepare(
    'ensure_mission',
    `INSERT OR IGNORE INTO life_missions (user_id, mission_id, expires_at) VALUES (?, ?, ?)`
  ).run(userId, missionId, expiresAt || now());
}

function addMissionProgress(userId, missionId, delta = 1) {
  ensureMission(userId, missionId, null);
  return prepare('mission_prog', `UPDATE life_missions SET progress = progress + ? WHERE user_id = ? AND mission_id = ? AND status = 'active'`).run(delta, userId, missionId);
}

function listMissions(userId) {
  return prepare('list_missions', `SELECT * FROM life_missions WHERE user_id = ? ORDER BY id`).all(userId);
}

function getMission(userId, missionId) {
  return prepare('get_mission', `SELECT * FROM life_missions WHERE user_id = ? AND mission_id = ?`).get(userId, missionId) || null;
}

function claimMission(userId, missionId) {
  return prepare('claim_mission', `UPDATE life_missions SET status = 'claimed' WHERE user_id = ? AND mission_id = ?`).run(userId, missionId);
}

/* ----------------------------- conquistas ----------------------------- */

function unlockAchievement(userId, achievementId) {
  const exists = prepare('has_ach', `SELECT 1 AS x FROM life_achievements WHERE user_id = ? AND achievement_id = ?`).get(userId, achievementId);
  if (exists) return false;
  prepare('add_ach', `INSERT INTO life_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)`).run(userId, achievementId, now());
  return true;
}

function listAchievements(userId) {
  return prepare('list_ach', `SELECT achievement_id, unlocked_at FROM life_achievements WHERE user_id = ? ORDER BY unlocked_at`).all(userId);
}

/* ------------------------------ diário -------------------------------- */

function getDaily(userId) {
  return prepare('get_daily', `SELECT * FROM life_daily WHERE user_id = ?`).get(userId) || null;
}

function updateDaily(userId, { streak, lastClaim, totalClaims }) {
  return prepare(
    'upd_daily',
    `INSERT INTO life_daily (user_id, streak, last_claim, total_claims) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET streak = excluded.streak, last_claim = excluded.last_claim, total_claims = excluded.total_claims`
  ).run(userId, streak, lastClaim, totalClaims);
}

/* ---------------------------- ferramentas ----------------------------- */

function getTool(userId, toolId) {
  return prepare('get_tool', `SELECT * FROM life_tools WHERE user_id = ? AND tool_id = ?`).get(userId, toolId) || null;
}

function setToolUses(userId, toolId, usesLeft) {
  return prepare(
    'set_tool',
    `INSERT INTO life_tools (user_id, tool_id, uses_left) VALUES (?, ?, ?)
     ON CONFLICT(user_id, tool_id) DO UPDATE SET uses_left = excluded.uses_left`
  ).run(userId, toolId, usesLeft);
}

function deleteTool(userId, toolId) {
  return prepare('del_tool', `DELETE FROM life_tools WHERE user_id = ? AND tool_id = ?`).run(userId, toolId);
}

/* --------------------------- logs econômicos -------------------------- */

function logEconomy(userId, action, item, amount, balanceBefore, balanceAfter, note) {
  return prepare(
    'log_econ',
    `INSERT INTO economy_logs (user_id, action, item, amount, balance_before, balance_after, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, action, item || '', amount, balanceBefore, balanceAfter, note || '', now());
}

function recentLogs(limit = 20) {
  return prepare('recent_econ_logs', `SELECT * FROM economy_logs ORDER BY id DESC LIMIT ?`).all(limit);
}

function userLogs(userId, limit = 20) {
  return prepare('user_econ_logs', `SELECT * FROM economy_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, limit);
}

/* --------------------- transação monetária com log --------------------- */

/**
 * Crédito/débito atômico na carteira com registro em economy_logs.
 * Lança 'INSUFFICIENT_FUNDS' se delta < 0 e saldo insuficiente.
 */
function walletTx(userId, delta, action, note) {
  const tx = getDb().transaction(() => {
    const before = economy.get(userId).wallet;
    const after = economy.addWallet(userId, delta);
    logEconomy(userId, action, '', delta, before, after, note);
    return after;
  });
  return tx();
}

/* ------------------------------- rankings ------------------------------ */

function rankLevel(limit = 10) {
  return prepare('rank_life_level', `SELECT user_id, level, xp FROM life_players ORDER BY level DESC, xp DESC LIMIT ?`).all(limit);
}

function rankAnimals(limit = 10) {
  return prepare(
    'rank_life_animals',
    `SELECT user_id, COUNT(*) AS value FROM animals WHERE sold = 0 GROUP BY user_id ORDER BY value DESC LIMIT ?`
  ).all(limit);
}

function rankAchievements(limit = 10) {
  return prepare(
    'rank_life_ach',
    `SELECT user_id, COUNT(*) AS value FROM life_achievements GROUP BY user_id ORDER BY value DESC LIMIT ?`
  ).all(limit);
}

/** Patrimônio (aproximado por amostragem dos mais ricos, depois calculado). */
function rankNetworth(limit = 10) {
  const networth = require('../plugins/life/networth');
  const sample = prepare(
    'rank_life_cand',
    `SELECT e.user_id AS user_id, (e.wallet + e.bank) AS v FROM economy e ORDER BY v DESC LIMIT 100`
  ).all(100);
  const rows = sample.map((s) => ({ user_id: s.user_id, value: networth.compute(s.user_id).total }));
  rows.sort((a, b) => b.value - a.value);
  return rows.slice(0, limit);
}

/* ------------------------------ estatísticas --------------------------- */

function stats() {
  const dbc = getDb();
  const one = (sql) => {
    try {
      return dbc.prepare(sql).get();
    } catch (_) {
      return null;
    }
  };
  const sumWallet = one(`SELECT COALESCE(SUM(wallet),0) AS v FROM economy`).v;
  const sumBank = one(`SELECT COALESCE(SUM(bank),0) AS v FROM economy`).v;
  return {
    players: one(`SELECT COUNT(*) AS v FROM life_players`).v,
    playersWithMoney: one(`SELECT COUNT(*) AS v FROM economy WHERE wallet > 0 OR bank > 0`).v,
    totalMoney: sumWallet + sumBank,
    totalWallet: sumWallet,
    totalBank: sumBank,
    properties: one(`SELECT COUNT(*) AS v FROM life_properties`).v,
    businesses: one(`SELECT COUNT(*) AS v FROM life_businesses`).v,
    marketOffers: one(`SELECT COUNT(*) AS v FROM life_market WHERE status = 'active'`).v,
    achievements: one(`SELECT COUNT(*) AS v FROM life_achievements`).v,
    jobsDone: one(`SELECT COUNT(*) AS v FROM economy_logs WHERE action = 'trabalho'`).v,
    fishCaught: one(`SELECT COUNT(*) AS v FROM economy_logs WHERE action = 'pesca'`).v,
    oresMined: one(`SELECT COUNT(*) AS v FROM economy_logs WHERE action = 'mineracao'`).v,
    itemsSold: one(`SELECT COUNT(*) AS v FROM economy_logs WHERE action = 'venda'`).v,
    itemsBought: one(`SELECT COUNT(*) AS v FROM economy_logs WHERE action = 'compra'`).v,
  };
}

module.exports = {
  ensurePlayer,
  getPlayer,
  createCharacter,
  updatePlayer,
  applyVitals,
  addLifeXp,
  lifeLevelFromXp,
  xpForNextLevel,
  addProperty,
  getProperty,
  listProperties,
  upgradeProperty,
  countPropertyKind,
  addBusiness,
  getBusiness,
  listBusinesses,
  touchBusiness,
  addEmployee,
  listEmployees,
  createOffer,
  listOffers,
  listUserOffers,
  getOffer,
  closeOffer,
  cancelOffer,
  ensureMission,
  addMissionProgress,
  listMissions,
  getMission,
  claimMission,
  unlockAchievement,
  listAchievements,
  getDaily,
  updateDaily,
  getTool,
  setToolUses,
  deleteTool,
  logEconomy,
  recentLogs,
  userLogs,
  walletTx,
  stats,
  rankLevel,
  rankAnimals,
  rankAchievements,
  rankNetworth,
};
