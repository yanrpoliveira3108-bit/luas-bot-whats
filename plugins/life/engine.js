/**
 * plugins/life/engine.js — motor do Lua Life (ações + segurança econômica).
 *
 * Regras de segurança:
 *  - toda operação multi-etapa roda em transação SQLite + mutex por usuário;
 *  - saldo nunca fica negativo (economy.addWallet lança INSUFFICIENT_FUNDS);
 *  - cooldowns persistentes (rpg.setCooldown) impedem spam/bypass;
 *  - ferramentas têm durabilidade; itens de coleta nunca são "criados" sem
 *    passar por compra/coleta/colheita;
 *  - toda movimentação de dinheiro é logada em economy_logs.
 */

'use strict';

const CONFIG = require('../../config');
const economy = require('../../database/economy');
const rpg = require('../../database/rpg');
const life = require('../../database/life');
const users = require('../../database/users');
const { withLock } = require('../../utils/keyedMutex');
const { get: getDb } = require('../../database/database');

const leveling = require('./leveling');
const market = require('./market');
const weather = require('./weather');
const networth = require('./networth');
const C = require('./config');

/* ------------------------------ helpers ------------------------------- */

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

/** Cria o personagem preguiçosamente (primeira ação econômica). */
function ensureCharacter(userId, name) {
  const p = life.getPlayer(userId);
  if (name && !p.name) {
    life.updatePlayer(userId, { name: String(name).slice(0, 24) });
  }
  return life.getPlayer(userId);
}

/** Regeneração passiva de energia (descanso ao longo do tempo). */
function passiveRegen(userId) {
  const p = life.getPlayer(userId);
  const last = p.last_activity ? new Date(p.last_activity).getTime() : Date.now();
  const elapsedMin = Math.floor((Date.now() - last) / 60000);
  if (elapsedMin >= 2) {
    const regen = Math.min(40, Math.floor(elapsedMin / 2));
    if (p.energy < CONFIG.life.start.energyMax) {
      life.applyVitals(userId, { energy: regen });
    }
  }
  life.updatePlayer(userId, {}); // toca last_activity
}

function spendEnergy(userId, cost) {
  const p = life.getPlayer(userId);
  if (p.energy < cost) {
    throw err('NO_ENERGY', '🔋 Sem energia. Descanse (!descansar) ou coma (!comer).');
  }
  life.applyVitals(userId, { energy: -cost });
  return life.getPlayer(userId).energy;
}

/** Resumo completo do jogador (usado por !vida, menus, etc.). */
function getContext(userId) {
  ensureCharacter(userId);
  passiveRegen(userId);
  const player = life.getPlayer(userId);
  const eco = economy.get(userId);
  const rp = rpg.getPlayer(userId);
  const job = C.findJob(rp.profession);
  return {
    player,
    eco,
    rpg: rp,
    job,
    level: player.level,
    title: leveling.title(player.level),
    nextTitle: leveling.nextTitle(player.level),
    careerLevel: player.career_level,
    careerTitle: job ? leveling.careerTitle(job, player.career_level) : '-',
    networth: networth.compute(userId),
    weather: weather.currentWeather(),
    event: weather.currentEvent(),
    mult: weather.multipliers(),
  };
}

/* ------------------------------ trabalho ------------------------------ */

async function work(userId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    passiveRegen(userId);
    const rp = rpg.getPlayer(userId);
    if (!rp.profession) throw err('NO_JOB', '⚠️ Escolha uma profissão primeiro: !empregos');
    const job = C.findJob(rp.profession);
    if (!job) throw err('NO_JOB', '⚠️ Profissão inválida. Escolha outra: !empregos');

    const p = life.getPlayer(userId);
    if (p.hunger <= 0) throw err('HUNGRY', '🍖 Você está faminto. Coma algo (!comer) antes de trabalhar.');

    const remaining = rpg.getCooldownRemaining('life', userId, 'trabalhar');
    if (remaining > 0) throw err('COOLDOWN', `⏳ Você já trabalhou. Aguarde.`);

    // requisito de ferramenta (qualquer nível) ou nível
    if (job.requires) {
      const has = job.requires.some((id) => {
        const item = economy.getItem(userId, id);
        return item && item.quantity >= 1;
      });
      const tool = has ? true : hasUsableTool(userId, job.requires);
      if (!has && !tool) throw err('NEED_TOOL', `🛠️ Você precisa de uma ferramenta (${job.requires.join(' ou ')}). Compre na loja.`);
    }
    if (p.level < (job.levelReq || 1)) throw err('LEVEL_REQ', `📈 Você precisa do nível ${job.levelReq} para ser ${job.name}.`);

    // custo de energia
    if (p.energy < job.energy) throw err('NO_ENERGY', '🔋 Sem energia. Descanse (!descansar) ou use uma Poção de Energia.');

    const mult = weather.multipliers();
    const careerMult = 1 + (Math.max(1, p.career_level) - 1) * 0.25;
    const eff = leveling.efficiencySalaryMul(p.efficiency);
    const bestVehicle = bestSpeedBonus(userId);
    const cooldownMs = Math.max(5 * 60000, Math.round(job.cooldownMs * leveling.vehicleCooldownMul(bestVehicle)));

    const reward = Math.round(C.randomBetween(job.reward) * careerMult * eff);
    const xp = Math.round(job.xp * leveling.knowledgeXpMul(p.knowledge) * mult.xpMul);
    const careerXp = job.xp;
    const tierCount = job.tiers.length;
    const newCareerLevel = Math.min(tierCount, leveling.careerLevelFromXp(p.career_xp + careerXp, job.tiers));

    const result = getDb().transaction(() => {
      life.walletTx(userId, reward, 'trabalho', job.name);
      life.applyVitals(userId, { energy: -job.energy, hunger: -5, happiness: -2 });
      const nx = life.addLifeXp(userId, xp);
      life.updatePlayer(userId, { career_xp: p.career_xp + careerXp, career_level: newCareerLevel });
      rpg.setCooldown('life', userId, 'trabalhar', cooldownMs);
      return { reward, xp, nx, newCareerLevel };
    })();

    // progresso pós-transação (idempotente, fora da tx para não enrolar lock)
    progressMissions(userId, 'work', 1);
    checkAchievement(userId, 'primeiro_salario');
    sweepAchievements(userId);

    return {
      reward,
      xp,
      level: result.nx.level,
      leveled: result.nx.leveled,
      newTitle: result.nx.leveled ? leveling.title(result.nx.level) : null,
      careerLevel: result.newCareerLevel,
      careerTitle: leveling.careerTitle(job, result.newCareerLevel),
      energy: life.getPlayer(userId).energy,
      job,
    };
  });
}

function bestSpeedBonus(userId) {
  let best = null;
  for (const p of life.listProperties(userId)) {
    if (p.kind !== 'veiculo') continue;
    const v = C.VEHICLES.find((x) => x.id === p.spec);
    if (v && (best === null || v.speedBonus < best)) best = v.speedBonus;
  }
  return best;
}

/* ------------------------------ ferramentas --------------------------- */

function toolDef(toolId) {
  return C.PICKAXES[toolId] || C.RODS[toolId] || null;
}

function hasUsableTool(userId, toolIds) {
  for (const id of toolIds) {
    const t = life.getTool(userId, id);
    if (t && t.uses_left > 0) return true;
    const item = economy.getItem(userId, id);
    if (item && item.quantity >= 1) return true;
  }
  return false;
}

/**
 * Resolve a melhor ferramenta utilizável (equipando uma do inventário se
 * necessário). Retorna { toolId, def, usesLeft } ou null.
 */
function resolveTool(userId, map) {
  const ids = Object.keys(map);
  let best = null;
  for (const id of ids) {
    const t = life.getTool(userId, id);
    if (t && t.uses_left > 0) {
      if (!best || map[id].luck > map[best.toolId].luck) best = { toolId: id, def: map[id], usesLeft: t.uses_left };
    }
  }
  if (best) return best;
  // tenta equipar do inventário (melhor tier primeiro)
  const sorted = ids.slice().sort((a, b) => map[b].luck - map[a].luck);
  for (const id of sorted) {
    const item = economy.getItem(userId, id);
    if (item && item.quantity >= 1) {
      const equipped = getDb().transaction(() => {
        economy.removeItem(userId, id, 1);
        life.setToolUses(userId, id, map[id].durability);
        return { toolId: id, def: map[id], usesLeft: map[id].durability };
      })();
      return equipped;
    }
  }
  return null;
}

/** Consome 1 uso da ferramenta; troca por reserva do inventário quando acaba. */
function consumeToolUse(userId, toolId, def) {
  return getDb().transaction(() => {
    const t = life.getTool(userId, toolId);
    if (!t || t.uses_left <= 0) throw err('NO_TOOL', '🛠️ Ferramenta quebrada.');
    const next = t.uses_left - 1;
    if (next > 0) {
      life.setToolUses(userId, toolId, next);
      return { broken: false, usesLeft: next };
    }
    // esgotou: tenta pegar outra igual do inventário
    const spare = economy.getItem(userId, toolId);
    if (spare && spare.quantity >= 1) {
      economy.removeItem(userId, toolId, 1);
      life.setToolUses(userId, toolId, def.durability);
      return { broken: false, usesLeft: def.durability, replaced: true };
    }
    life.deleteTool(userId, toolId);
    return { broken: true, usesLeft: 0 };
  })();
}

/* ------------------------------ mineração ----------------------------- */

function pickWeighted(list, luckBonus) {
  const weights = list.map((o) => Math.max(1, o.chance + (o.xp >= 15 ? luckBonus : 0)));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return list[i];
  }
  return list[list.length - 1];
}

async function mine(userId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    passiveRegen(userId);
    const remaining = rpg.getCooldownRemaining('life', userId, 'minerar');
    if (remaining > 0) throw err('COOLDOWN', '⏳ Aguarde um instante para minerar de novo.');

    const tool = resolveTool(userId, C.PICKAXES);
    if (!tool) throw err('NO_TOOL', '⛏️ Você precisa de uma picareta (!comprar picareta_simples).');

    spendEnergy(userId, 25);
    const mult = weather.multipliers();
    const luck = leveling.luckBonus(life.getPlayer(userId).luck) + (tool.def.luck || 0);
    const ore = pickWeighted(C.ORES, luck);
    const qty = Math.random() < 0.3 ? 2 : 1;
    const xp = Math.round(ore.xp * tool.def.xpMul * mult.xpMul);

    const r = getDb().transaction(() => {
      const use = consumeToolUse(userId, tool.toolId, tool.def);
      economy.addItem(userId, ore.id, qty);
      life.logEconomy(userId, 'mineracao', ore.id, qty, economy.get(userId).wallet, economy.get(userId).wallet, ore.name);
      const nx = life.addLifeXp(userId, xp);
      return { use, nx, qty };
    })();

    progressMissions(userId, 'mine', 1);
    checkAchievement(userId, 'minerador');
    sweepAchievements(userId);

    return {
      ore, qty: r.qty, xp,
      level: r.nx.level, leveled: r.nx.leveled,
      newTitle: r.nx.leveled ? leveling.title(r.nx.level) : null,
      broken: r.use.broken, usesLeft: r.use.usesLeft,
      energy: life.getPlayer(userId).energy,
    };
  });
}

/* -------------------------------- pesca ------------------------------- */

async function fish(userId, useBait) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    passiveRegen(userId);
    const remaining = rpg.getCooldownRemaining('life', userId, 'pescar');
    if (remaining > 0) throw err('COOLDOWN', '⏳ Aguarde um instante para pescar de novo.');

    const tool = resolveTool(userId, C.RODS);
    if (!tool) throw err('NO_TOOL', '🎣 Você precisa de uma vara (!comprar vara_simples).');

    spendEnergy(userId, 10);
    const mult = weather.multipliers();
    let luck = leveling.luckBonus(life.getPlayer(userId).luck) + (tool.def.luck || 0);
    if (useBait) {
      const bait = economy.getItem(userId, 'isca');
      if (!bait || bait.quantity < 1) throw err('NO_BAIT', '🪱 Você não tem isca.');
      economy.removeItem(userId, 'isca', 1);
      luck += 8;
    }
    const caught = pickWeighted(C.FISH, luck);
    const qty = Math.random() < 0.2 ? 2 : 1;
    const xp = Math.round(caught.xp * tool.def.xpMul * mult.xpMul);

    const r = getDb().transaction(() => {
      const use = consumeToolUse(userId, tool.toolId, tool.def);
      economy.addItem(userId, caught.id, qty);
      life.logEconomy(userId, 'pesca', caught.id, qty, economy.get(userId).wallet, economy.get(userId).wallet, caught.name);
      const nx = life.addLifeXp(userId, xp);
      rpg.setCooldown('life', userId, 'pescar', 30000);
      return { use, nx, qty };
    })();

    progressMissions(userId, 'fish', r.qty);
    checkAchievement(userId, 'pescador');
    sweepAchievements(userId);

    return {
      fish: caught, qty: r.qty, xp,
      level: r.nx.level, leveled: r.nx.leveled,
      newTitle: r.nx.leveled ? leveling.title(r.nx.level) : null,
      broken: r.use.broken, usesLeft: r.use.usesLeft,
      energy: life.getPlayer(userId).energy,
    };
  });
}

/* --------------------------- propriedades ----------------------------- */

async function buyHouse(userId, houseId) {
  return buyAsset(userId, 'casa', houseId, C.HOUSES, 'primeira_casa');
}

async function buyLand(userId, landId) {
  return buyAsset(userId, 'terreno', landId, C.LANDS, 'primeiro_terreno');
}

async function buyVehicle(userId, vehicleId) {
  return buyAsset(userId, 'veiculo', vehicleId, C.VEHICLES, null);
}

function buyAsset(userId, kind, specId, list, achievementId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    passiveRegen(userId);
    const def = list.find((x) => x.id === specId);
    if (!def) throw err('NOT_FOUND', '❌ Opção inválida.');
    const p = life.getPlayer(userId);
    if (p.level < (def.levelReq || 1)) throw err('LEVEL_REQ', `📈 Você precisa do nível ${def.levelReq}.`);

    const tx = getDb().transaction(() => {
      const before = economy.get(userId).wallet;
      if (before < def.price) throw err('INSUFFICIENT_FUNDS', '💸 Saldo insuficiente.');
      economy.addWallet(userId, -def.price);
      life.logEconomy(userId, 'compra', specId, -def.price, before, before - def.price, `${def.name} (${kind})`);
      life.addProperty(userId, kind, specId, 1);
    });
    tx();
    if (achievementId) checkAchievement(userId, achievementId);
    sweepAchievements(userId);
    return def;
  });
}

async function upgradeProperty(userId, kind, specId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const prop = life.getProperty(userId, kind, specId);
    if (!prop) throw err('NOT_FOUND', '❌ Você não possui essa propriedade.');
    if (prop.level >= 4) throw err('MAX_LEVEL', '✅ Propriedade já no nível máximo (4).');
    const def = kind === 'casa' ? C.HOUSES.find((x) => x.id === specId)
      : kind === 'terreno' ? C.LANDS.find((x) => x.id === specId)
        : kind === 'veiculo' ? C.VEHICLES.find((x) => x.id === specId) : null;
    const base = def ? def.price : 0;
    const cost = Math.round(base * 0.6 * prop.level);

    const tx = getDb().transaction(() => {
      const before = economy.get(userId).wallet;
      if (before < cost) throw err('INSUFFICIENT_FUNDS', '💸 Saldo insuficiente.');
      economy.addWallet(userId, -cost);
      life.logEconomy(userId, 'upgrade', specId, -cost, before, before - cost, `${def ? def.name : specId} nível ${prop.level + 1}`);
      life.upgradeProperty(userId, kind, specId, prop.level + 1);
    });
    tx();
    return { level: prop.level + 1, cost };
  });
}

/** Compra/upgrade de galinheiro/estábulo (capacidade de animais). */
async function buyCoop(userId, coopId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const def = C.COOPS[coopId];
    if (!def) throw err('NOT_FOUND', '❌ Tipo inválido.');
    const prop = life.getProperty(userId, coopId === 'galinheiro' ? 'galinheiro' : 'estabulo', coopId);
    const nextLevel = prop ? Math.min(prop.level + 1, def.levels.length) : 1;
    if (prop && prop.level >= def.levels.length) throw err('MAX_LEVEL', '✅ Já está no nível máximo.');
    const cost = def.levels[nextLevel - 1].price;

    const tx = getDb().transaction(() => {
      const before = economy.get(userId).wallet;
      if (before < cost) throw err('INSUFFICIENT_FUNDS', '💸 Saldo insuficiente.');
      economy.addWallet(userId, -cost);
      life.logEconomy(userId, 'compra', coopId, -cost, before, before - cost, `${def.name} nível ${nextLevel}`);
      if (prop) life.upgradeProperty(userId, prop.kind, coopId, nextLevel);
      else life.addProperty(userId, coopId === 'galinheiro' ? 'galinheiro' : 'estabulo', coopId, nextLevel);
    });
    tx();
    return { level: nextLevel, capacity: def.levels[nextLevel - 1].cap };
  });
}

/** Capacidade de animais do usuário (galinheiro p/ aves, estábulo p/ grandes). */
function animalCapacity(userId) {
  const coop = life.getProperty(userId, 'galinheiro', 'galinheiro');
  const stable = life.getProperty(userId, 'estabulo', 'estabulo');
  const coopCap = coop ? C.COOPS.galinheiro.levels[Math.min(coop.level, 3) - 1].cap : 3;
  const stableCap = stable ? C.COOPS.estabulo.levels[Math.min(stable.level, 3) - 1].cap : 3;
  return { coopCap, stableCap };
}

/* ------------------------------ empresas ------------------------------ */

async function openBusiness(userId, kindId, name) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const def = C.BUSINESSES.find((b) => b.id === kindId);
    if (!def) throw err('NOT_FOUND', '❌ Tipo de empresa inválido.');
    const p = life.getPlayer(userId);
    if (p.level < def.levelReq) throw err('LEVEL_REQ', `📈 Você precisa do nível ${def.levelReq}.`);
    if (networth.compute(userId).total < def.price) throw err('INSUFFICIENT_FUNDS', '💸 Patrimônio insuficiente.');

    const tx = getDb().transaction(() => {
      const before = economy.get(userId).wallet;
      if (before < def.price) throw err('INSUFFICIENT_FUNDS', '💸 Saldo insuficiente.');
      economy.addWallet(userId, -def.price);
      life.logEconomy(userId, 'compra', kindId, -def.price, before, before - def.price, def.name);
      return life.addBusiness(userId, kindId, name || def.name);
    });
    const id = tx();
    checkAchievement(userId, 'empresario');
    return { id, def };
  });
}

async function hireEmployee(userId, businessId, empId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const biz = life.getBusiness(businessId);
    if (!biz || biz.user_id !== userId) throw err('NOT_FOUND', '❌ Empresa não encontrada.');
    const def = C.BUSINESSES.find((b) => b.id === biz.kind);
    if (!def) throw err('NOT_FOUND', '❌ Empresa inválida.');
    const emp = C.EMPLOYEES.find((e) => e.id === empId);
    if (!emp) throw err('NOT_FOUND', '❌ Tipo de funcionário inválido.');
    if (biz.employees >= def.maxEmployees) throw err('FULL', '❌ Sem vagas (melhore a empresa).');

    const tx = getDb().transaction(() => {
      const before = economy.get(userId).wallet;
      const cost = emp.wagePerH * 10; // taxa de contratação
      if (before < cost) throw err('INSUFFICIENT_FUNDS', '💸 Saldo insuficiente para contratar.');
      economy.addWallet(userId, -cost);
      life.logEconomy(userId, 'contratacao', empId, -cost, before, before - cost, emp.name);
      life.addEmployee(userId, businessId, empId, 1);
      life.touchBusiness(businessId, 1);
    });
    tx();
    return emp;
  });
}

async function collectBusiness(userId, businessId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const biz = life.getBusiness(businessId);
    if (!biz || biz.user_id !== userId) throw err('NOT_FOUND', '❌ Empresa não encontrada.');
    const def = C.BUSINESSES.find((b) => b.id === biz.kind);
    const empCount = life.listEmployees(businessId).length;

    const last = new Date(biz.last_collect_at).getTime();
    const hours = Math.min(24, Math.max(0, (Date.now() - last) / 3600000));
    if (hours < 0.5) throw err('NOT_READY', '⏳ Sua empresa ainda não produziu o suficiente. Volte mais tarde.');

    const revenue = Math.round(def.revenuePerH * biz.level * hours * (1 + 0.1 * empCount));
    const wagePerH = life.listEmployees(businessId).reduce((a, e) => a + (C.EMPLOYEES.find((x) => x.id === e.kind) || { wagePerH: 0 }).wagePerH, 0);
    const costs = Math.round(wagePerH * hours);
    const profit = Math.max(0, revenue - costs);

    const tx = getDb().transaction(() => {
      const before = economy.get(userId).wallet;
      if (profit > 0) {
        economy.addWallet(userId, profit);
        life.logEconomy(userId, 'empresa', def.id, profit, before, before + profit, `${def.name} (${Math.floor(hours)}h)`);
      }
      life.touchBusiness(businessId, 0);
    });
    tx();

    const nx = life.addLifeXp(userId, Math.round(hours * 5));
    sweepAchievements(userId);
    return { revenue, costs, profit, hours, level: nx.level, leveled: nx.leveled };
  });
}

/* ------------------------------ mercado ------------------------------- */

async function createOffer(userId, itemId, quantity, unitPrice) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const item = rpg.getShopItem(itemId);
    if (!item) throw err('NOT_FOUND', '❌ Item não encontrado.');
    const qty = Math.max(1, Math.floor(quantity));
    const price = Math.max(1, Math.floor(unitPrice));

    const tx = getDb().transaction(() => {
      const has = economy.getItem(userId, itemId);
      if (!has || has.quantity < qty) throw err('NOT_ENOUGH_ITEMS', '📦 Você não possui essa quantidade.');
      economy.removeItem(userId, itemId, qty); // escrow
      life.logEconomy(userId, 'oferta', itemId, -qty, has.quantity, has.quantity - qty, `oferta criada (${price} LC/un)`);
      return life.createOffer(userId, itemId, qty, price);
    });
    return { offerId: tx(), item };
  });
}

async function buyOffer(userId, offerId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const offer = life.getOffer(offerId);
    if (!offer || offer.status !== 'active') throw err('NOT_FOUND', '❌ Oferta não encontrada.');
    if (offer.seller_id === userId) throw err('SELF', '🤨 Você não pode comprar a própria oferta.');
    const total = offer.unit_price * offer.quantity;

    const tx = getDb().transaction(() => {
      const before = economy.get(userId).wallet;
      if (before < total) throw err('INSUFFICIENT_FUNDS', '💸 Saldo insuficiente.');
      economy.addWallet(userId, -total);
      life.logEconomy(userId, 'compra_oferta', offer.item_id, -total, before, before - total, `oferta #${offer.id}`);
      economy.addItem(userId, offer.item_id, offer.quantity);
      const sellerBefore = economy.get(offer.seller_id).wallet;
      economy.addWallet(offer.seller_id, total);
      life.logEconomy(offer.seller_id, 'venda_oferta', offer.item_id, total, sellerBefore, sellerBefore + total, `oferta #${offer.id}`);
      life.closeOffer(offer.id, userId);
    });
    tx();
    return { offer, total };
  });
}

async function cancelOffer(userId, offerId) {
  return withLock(userId, async () => {
    const offer = life.getOffer(offerId);
    if (!offer || offer.seller_id !== userId || offer.status !== 'active') throw err('NOT_FOUND', '❌ Oferta não encontrada.');
    getDb().transaction(() => {
      economy.addItem(userId, offer.item_id, offer.quantity);
      life.logEconomy(userId, 'oferta_cancelada', offer.item_id, offer.quantity, economy.get(userId).wallet, economy.get(userId).wallet, 'devolução');
      life.cancelOffer(offer.id, userId);
    })();
    return offer;
  });
}

/* ------------------------------ presentes ----------------------------- */

async function giftItem(fromId, toId, itemId, quantity) {
  return withLock(fromId, async () => {
    ensureCharacter(fromId);
    const item = rpg.getShopItem(itemId);
    if (!item) throw err('NOT_FOUND', '❌ Item não encontrado.');
    const qty = Math.max(1, Math.floor(quantity));

    getDb().transaction(() => {
      economy.removeItem(fromId, itemId, qty);
      economy.addItem(toId, itemId, qty);
      life.logEconomy(fromId, 'presente', itemId, -qty, economy.get(fromId).wallet, economy.get(fromId).wallet, `para ${toId}`);
      life.logEconomy(toId, 'presente_recebido', itemId, qty, economy.get(toId).wallet, economy.get(toId).wallet, `de ${fromId}`);
    })();
    return { item, qty };
  });
}

/* ------------------------------ diário -------------------------------- */

async function dailyClaim(userId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const d = life.getDaily(userId) || { streak: 0, last_claim: '', total_claims: 0 };
    const lastDay = d.last_claim ? Math.floor(new Date(d.last_claim).getTime() / 86400000) : -1;
    const today = Math.floor(Date.now() / 86400000);

    if (lastDay === today) throw err('ALREADY', '⏳ Você já resgatou o presente de hoje.');
    const streak = lastDay === today - 1 ? d.streak + 1 : 1;
    const capped = Math.min(streak, CONFIG.life.limits.dailyStreakMax);
    const bonus = capped * 50;
    const reward = CONFIG.life.limits.dailyBase + Math.floor(Math.random() * (CONFIG.life.limits.dailyMax - CONFIG.life.limits.dailyBase + 1)) + bonus;

    getDb().transaction(() => {
      life.walletTx(userId, reward, 'diario', `streak ${capped}`);
      life.updateDaily(userId, { streak: capped, lastClaim: new Date().toISOString(), totalClaims: d.total_claims + 1 });
    })();
    progressMissions(userId, 'daily', 1);
    sweepAchievements(userId);
    return { reward, streak: capped };
  });
}

/* ------------------------------ loteria ------------------------------- */

async function lottery(userId, pickNumber, stake) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const num = Math.floor(Number(pickNumber));
    const max = CONFIG.life.limits.lotteryMaxStake;
    const s = Math.max(1, Math.floor(stake || 50));
    if (s > max) throw err('MAX_STAKE', `💸 Aposta máxima: ${max} LC.`);
    if (!Number.isFinite(num) || num < 1 || num > 10) throw err('BAD_PICK', '🎲 Escolha um número de 1 a 10.');

    const remaining = rpg.getCooldownRemaining('life', userId, 'loteria');
    if (remaining > 0) throw err('COOLDOWN', '⏳ Aguarde um instante para apostar de novo.');

    const tx = getDb().transaction(() => {
      const before = economy.get(userId).wallet;
      if (before < s) throw err('INSUFFICIENT_FUNDS', '💸 Saldo insuficiente para apostar.');
      economy.addWallet(userId, -s);
      life.logEconomy(userId, 'loteria', '', -s, before, before - s, `aposta no ${num}`);
    });
    tx();

    const drawn = 1 + Math.floor(Math.random() * 10);
    let won = 0;
    if (drawn === num) {
      won = s * CONFIG.life.limits.lotteryMultiplier;
      life.walletTx(userId, won, 'loteria_ganho', `acertou ${num}`);
    }
    rpg.setCooldown('life', userId, 'loteria', 30000);
    return { num, drawn, won, stake: s };
  });
}

/* --------------------------- comida/descanso -------------------------- */

async function eat(userId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    getDb().transaction(() => {
      economy.removeItem(userId, 'comida', 1);
      life.applyVitals(userId, { hunger: 40, health: 5 });
    })();
    const p = life.getPlayer(userId);
    return { hunger: p.hunger };
  });
}

async function rest(userId) {
  return withLock(userId, async () => {
    ensureCharacter(userId);
    const remaining = rpg.getCooldownRemaining('life', userId, 'descansar');
    if (remaining > 0) throw err('COOLDOWN', '⏳ Você acabou de descansar.');
    life.applyVitals(userId, { energy: 60, happiness: 10, health: 5 });
    rpg.setCooldown('life', userId, 'descansar', 60 * 60000);
    return life.getPlayer(userId).energy;
  });
}

/* ------------------------- missões/conquistas ------------------------- */

const MISSION_METRICS = {};

function progressMissions(userId, metric, delta = 1) {
  try {
    const defs = C.MISSIONS.filter((m) => m.metric === metric);
    for (const def of defs) {
      const row = life.getMission(userId, def.id);
      if (row && row.status === 'claimed') continue;
      if (def.metric === 'networth' || def.metric === 'house') {
        const nw = networth.compute(userId).total;
        const value = def.metric === 'house' ? life.listProperties(userId).filter((p) => p.kind === 'casa').length : nw;
        life.ensureMission(userId, def.id, null);
        require('../../database/database').prepare('mission_set', `UPDATE life_missions SET progress = ? WHERE user_id = ? AND mission_id = ? AND status = 'active'`).run(value, userId, def.id);
      } else {
        life.addMissionProgress(userId, def.id, delta);
      }
    }
  } catch (_) {
    /* missões nunca derrubam o bot */
  }
}

function claimMissionReward(userId, missionId) {
  const def = C.MISSIONS.find((m) => m.id === missionId);
  if (!def) throw err('NOT_FOUND', '❌ Missão não encontrada.');
  const row = life.getMission(userId, missionId);
  if (!row) throw err('NOT_FOUND', '❌ Você ainda não tem essa missão.');
  if (row.status === 'claimed') throw err('ALREADY', '✅ Missão já resgatada.');
  const progress = def.metric === 'networth' ? networth.compute(userId).total
    : def.metric === 'house' ? life.listProperties(userId).filter((p) => p.kind === 'casa').length
      : row.progress;
  if (progress < def.target) throw err('NOT_DONE', `⏳ Progresso: ${progress}/${def.target}.`);

  return withLock(userId, async () => {
    const again = life.getMission(userId, missionId);
    if (!again || again.status === 'claimed') throw err('ALREADY', '✅ Missão já resgatada.');
    getDb().transaction(() => {
      life.walletTx(userId, def.reward, 'missao', def.id);
      life.addLifeXp(userId, def.xp);
      life.claimMission(userId, missionId);
    })();
    return def;
  });
}

/** A condição da conquista está satisfeita? */
function achievementMet(userId, id) {
  const dbc = getDb();
  const countLog = (action) => dbc.prepare(`SELECT COUNT(*) AS c FROM economy_logs WHERE user_id = ? AND action = ?`).get(userId, action).c;
  switch (id) {
    case 'primeiro_salario': return countLog('trabalho') >= 1;
    case 'primeira_casa': return life.listProperties(userId).some((x) => x.kind === 'casa');
    case 'primeiro_terreno': return life.listProperties(userId).some((x) => x.kind === 'terreno');
    case 'primeiro_animal': return rpg.getAnimals(userId).length >= 1;
    case 'primeiro_milhao': return networth.compute(userId).total >= 1000000;
    case 'fazendeiro': return dbc.prepare(`SELECT COUNT(*) AS c FROM plantations WHERE user_id = ? AND harvested = 1`).get(userId).c >= 20;
    case 'minerador': return countLog('mineracao') >= 15;
    case 'pescador': return countLog('pesca') >= 15;
    case 'empresario': return life.listBusinesses(userId).length >= 1;
    case 'magnata': return life.getPlayer(userId).level >= 50;
    default: return true;
  }
}

/**
 * Desbloqueia conquista se a condição for satisfeita e ainda não desbloqueada.
 * Paga a recompensa UMA única vez. Retorna def ou null.
 */
function checkAchievement(userId, achievementId) {
  try {
    const def = C.ACHIEVEMENTS.find((a) => a.id === achievementId);
    if (!def) return null;
    if (!achievementMet(userId, achievementId)) return null;
    if (!life.unlockAchievement(userId, achievementId)) return null;
    if (def.reward > 0) life.walletTx(userId, def.reward, 'conquista', def.id);
    return def;
  } catch (_) {
    return null;
  }
}

/** Verificações agregadas (patrimônio/nível) — chamadas após ações relevantes. */
function sweepAchievements(userId) {
  const results = [];
  results.push(checkAchievement(userId, 'primeiro_milhao'));
  results.push(checkAchievement(userId, 'magnata'));
  return results.filter(Boolean);
}

module.exports = {
  ensureCharacter,
  getContext,
  work,
  mine,
  fish,
  buyHouse,
  buyLand,
  buyVehicle,
  upgradeProperty,
  buyCoop,
  animalCapacity,
  openBusiness,
  hireEmployee,
  collectBusiness,
  createOffer,
  buyOffer,
  cancelOffer,
  giftItem,
  dailyClaim,
  lottery,
  eat,
  rest,
  progressMissions,
  claimMissionReward,
  checkAchievement,
  sweepAchievements,
  resolveTool,
  toolDef,
};
