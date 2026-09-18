/**
 * database/rpg.js — jogadores do RPG, loja, fazenda e cooldowns persistentes.
 */

'use strict';

const { prepare } = require('./database');
const now = () => new Date().toISOString();

/* ------------------------------ jogador ---------------------------- */

function ensurePlayer(userId) {
  prepare('ensure_rpg', `INSERT OR IGNORE INTO rpg_players (user_id) VALUES (?)`).run(userId);
}

function getPlayer(userId) {
  ensurePlayer(userId);
  return prepare('get_rpg', `SELECT * FROM rpg_players WHERE user_id = ?`).get(userId);
}

function setProfession(userId, profession) {
  ensurePlayer(userId);
  return prepare('set_prof', `UPDATE rpg_players SET profession = ? WHERE user_id = ?`).run(profession, userId);
}

function addRpgXp(userId, amount) {
  ensurePlayer(userId);
  prepare('add_rpgxp', `UPDATE rpg_players SET xp = xp + ? WHERE user_id = ?`).run(Math.max(0, Math.floor(amount)), userId);
  const p = getPlayer(userId);
  const level = rpgLevelFromXp(p.xp);
  if (level > p.level) {
    prepare('lvl_rpg', `UPDATE rpg_players SET level = ? WHERE user_id = ?`).run(level, userId);
  }
  return { xp: p.xp, level: Math.max(level, p.level) };
}

function rpgLevelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1;
}

function addEnergy(userId, delta) {
  ensurePlayer(userId);
  prepare('add_energy', `UPDATE rpg_players SET energy = MIN(200, MAX(0, energy + ?)) WHERE user_id = ?`).run(delta, userId);
  return getPlayer(userId).energy;
}

function setEnergy(userId, value) {
  ensurePlayer(userId);
  prepare('set_energy', `UPDATE rpg_players SET energy = MIN(200, MAX(0, ?)) WHERE user_id = ?`).run(value, userId);
}

function addRpgReputation(userId, delta) {
  ensurePlayer(userId);
  prepare('add_rpgrep', `UPDATE rpg_players SET reputation = MAX(0, reputation + ?) WHERE user_id = ?`).run(delta, userId);
}

function getAchievements(userId) {
  const p = getPlayer(userId);
  try {
    return JSON.parse(p.achievements || '[]');
  } catch (_) {
    return [];
  }
}

function addAchievement(userId, id) {
  const list = getAchievements(userId);
  if (list.includes(id)) return false;
  list.push(id);
  prepare('set_ach', `UPDATE rpg_players SET achievements = ? WHERE user_id = ?`).run(JSON.stringify(list), userId);
  return true;
}

function rankRpg(field = 'level', limit = 10) {
  const allowed = ['level', 'xp', 'reputation'];
  if (!allowed.includes(field)) field = 'level';
  return prepare(
    'rank_rpg',
    `SELECT user_id, profession, xp, level, reputation FROM rpg_players ORDER BY ${field} DESC, xp DESC LIMIT ?`
  ).all(limit);
}

/* -------------------------------- loja ----------------------------- */

function getShopItems() {
  return prepare('shop_items', `SELECT * FROM rpg_items ORDER BY price ASC`).all();
}

function getShopItem(id) {
  return prepare('shop_item', `SELECT * FROM rpg_items WHERE id = ?`).get(id) || null;
}

/* ------------------------------ fazenda ---------------------------- */

function ensureFarm(userId) {
  prepare('ensure_farm', `INSERT OR IGNORE INTO farms (user_id) VALUES (?)`).run(userId);
}

function getFarm(userId) {
  ensureFarm(userId);
  return prepare('get_farm', `SELECT * FROM farms WHERE user_id = ?`).get(userId);
}

function renameFarm(userId, name) {
  ensureFarm(userId);
  return prepare('rename_farm', `UPDATE farms SET name = ? WHERE user_id = ?`).run(name, userId);
}

function addPlantation(userId, crop, readyAt) {
  return prepare(
    'add_plant',
    `INSERT INTO plantations (user_id, crop, planted_at, watered_at, ready_at) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, crop, now(), now(), readyAt);
}

function getPlantations(userId, onlyActive = true) {
  if (onlyActive) {
    return prepare(
      'get_plants',
      `SELECT * FROM plantations WHERE user_id = ? AND harvested = 0 ORDER BY id ASC`
    ).all(userId);
  }
  return prepare('get_plants_all', `SELECT * FROM plantations WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(userId);
}

function getPlantation(id) {
  return prepare('get_plant', `SELECT * FROM plantations WHERE id = ?`).get(id) || null;
}

/**
 * Rega a plantação: grava a nova maturação e o horário da rega.
 * (Fase 5: o SQL estava inline em commands/rpg/farm.js.)
 */
function waterPlantation(id, readyAt) {
  return prepare(
    'water_ready',
    `UPDATE plantations SET ready_at = ?, watered_at = ? WHERE id = ?`
  ).run(readyAt, now(), id);
}

/**
 * Fertiliza a plantação: grava a nova maturação.
 * (Fase 5: o SQL estava inline em commands/rpg/shop.js.)
 */
function fertilizePlantation(id, readyAt) {
  return prepare('fert_plant', `UPDATE plantations SET ready_at = ? WHERE id = ?`).run(readyAt, id);
}

function setPlantationWatered(id) {
  return prepare('water_plant', `UPDATE plantations SET watered_at = ? WHERE id = ?`).run(now(), id);
}

function setPlantationHarvested(id) {
  return prepare('harvest_plant', `UPDATE plantations SET harvested = 1 WHERE id = ?`).run(id);
}

function countAnimals(userId, type) {
  return prepare(
    'count_animals',
    `SELECT COUNT(*) AS c FROM animals WHERE user_id = ? AND type = ? AND sold = 0`
  ).get(userId, type).c;
}

function addAnimal(userId, type, name) {
  return prepare(
    'add_animal',
    `INSERT INTO animals (user_id, type, name, fed_at, born_at) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, type, name || '', now(), now());
}

function getAnimals(userId) {
  return prepare('get_animals', `SELECT * FROM animals WHERE user_id = ? AND sold = 0 ORDER BY id ASC`).all(userId);
}

function feedAnimal(id) {
  return prepare('feed_animal', `UPDATE animals SET fed_at = ? WHERE id = ?`).run(now(), id);
}

function removeAnimal(id) {
  return prepare('sell_animal', `UPDATE animals SET sold = 1 WHERE id = ?`).run(id);
}

/* ------------------------ cooldowns persistentes ------------------- */

function setCooldown(scope, key, command, ms) {
  const expires = new Date(Date.now() + ms).toISOString();
  return prepare(
    'set_cd',
    `INSERT INTO cooldowns (scope, key, command, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, key, command) DO UPDATE SET expires_at = excluded.expires_at`
  ).run(scope, key, command, expires);
}

/** Retorna milissegundos restantes de um cooldown persistente (0 se liberado). */
function getCooldownRemaining(scope, key, command) {
  const row = prepare('get_cd', `SELECT expires_at FROM cooldowns WHERE scope = ? AND key = ? AND command = ?`).get(
    scope,
    key,
    command
  );
  if (!row) return 0;
  const remain = new Date(row.expires_at).getTime() - Date.now();
  return remain > 0 ? remain : 0;
}

module.exports = {
  ensurePlayer,
  getPlayer,
  setProfession,
  addRpgXp,
  rpgLevelFromXp,
  addEnergy,
  setEnergy,
  addRpgReputation,
  getAchievements,
  addAchievement,
  rankRpg,
  getShopItems,
  getShopItem,
  ensureFarm,
  getFarm,
  renameFarm,
  addPlantation,
  getPlantations,
  getPlantation,
  waterPlantation,
  fertilizePlantation,
  setPlantationWatered,
  setPlantationHarvested,
  countAnimals,
  addAnimal,
  getAnimals,
  feedAnimal,
  removeAnimal,
  setCooldown,
  getCooldownRemaining,
};
