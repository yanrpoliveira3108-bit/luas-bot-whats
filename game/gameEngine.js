'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RULES = Object.freeze({ maxTurns: 80, startingGold: 900, incomeBase: 90, troopCost: 8, troopPopulation: 12, upkeep: 2, provinceGrowth: 18, buildings: { market: { cost: 240, turns: 2, income: 55, label: 'Mercado' }, barracks: { cost: 220, turns: 2, recruit: 12, label: 'Quartel' }, fortress: { cost: 300, turns: 3, defense: 0.25, label: 'Fortaleza' } } });
const NATIONS = [
  { id: 'lua', name: 'Lua', color: '#55bdb2', capital: 'p01', ai: false },
  { id: 'bruma', name: 'Bruma', color: '#be8d54', capital: 'p36', ai: true, profile: 'expansionista' },
  { id: 'aurora', name: 'Aurora', color: '#887bb8', capital: 'p06', ai: true, profile: 'defensiva' },
  { id: 'ferro', name: 'Ferro', color: '#ae5f61', capital: 'p31', ai: true, profile: 'economica' },
];
const TERRAIN = ['planicie', 'floresta', 'colina', 'costa'];

function makeProvinces() {
  const out = []; let n = 1;
  for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
    const id = `p${String(n++).padStart(2, '0')}`;
    const owner = col < 3 && row < 3 ? 'lua' : col >= 3 && row < 3 ? 'aurora' : col < 3 ? 'bruma' : 'ferro';
    const neighbors = [];
    if (row) neighbors.push(`p${String((row - 1) * 6 + col + 1).padStart(2, '0')}`);
    if (row < 5) neighbors.push(`p${String((row + 1) * 6 + col + 1).padStart(2, '0')}`);
    if (col) neighbors.push(`p${String(row * 6 + col).padStart(2, '0')}`);
    if (col < 5) neighbors.push(`p${String(row * 6 + col + 2).padStart(2, '0')}`);
    out.push({ id, name: ['Alvorada','Cedro','Dourado','Estrela','Fronteira','Gaia'][col] + ' ' + (row + 1), owner, population: 700 + ((row * 37 + col * 71) % 800), recruitable: 300, troops: 90 + ((row * 11 + col * 17) % 90), terrain: TERRAIN[(row + col) % TERRAIN.length], buildings: [], neighbors, capital: NATIONS.find((x) => x.capital === id)?.id || null });
  }
  return out;
}

function newCampaign(ownerId = 'lua') {
  const provinces = makeProvinces();
  return { id: crypto.randomUUID(), version: 1, turn: 1, status: 'playing', ownerId, nations: NATIONS.map((n) => ({ ...n, ai: n.id !== ownerId, gold: n.id === ownerId ? RULES.startingGold : 760, income: RULES.incomeBase, population: 4800, stability: 82, relations: Object.fromEntries(NATIONS.filter((x) => x.id !== n.id).map((x) => [x.id, 0])) })), provinces, log: [{ turn: 1, kind: 'event', text: 'A campanha começou. Expanda com cautela.' }], updatedAt: Date.now() };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nation(game, id) { return game.nations.find((n) => n.id === id); }
function province(game, id) { return game.provinces.find((p) => p.id === id); }
function owned(game, id, nationId) { const p = province(game, id); return !!p && p.owner === nationId; }
function assertPlaying(game) { if (!game || game.status !== 'playing') throw new Error('A campanha não está ativa.'); }
function assertVersion(game, version) { if (Number(version) !== game.version) throw new Error('CONFLICT: o estado mudou. Atualize o mapa.'); }
function assertNation(game, nationId) { const n = nation(game, nationId); if (!n) throw new Error('Nação inválida.'); return n; }
function log(game, text, kind = 'event') { game.log.unshift({ turn: game.turn, kind, text }); game.log = game.log.slice(0, 40); }
function income(game, n) { return RULES.incomeBase + game.provinces.filter((p) => p.owner === n.id).reduce((sum, p) => sum + 25 + (p.buildings.includes('market') ? RULES.buildings.market.income : 0), 0); }
function defense(p) { return 1 + (p.buildings.includes('fortress') ? RULES.buildings.fortress.defense : 0) + (p.terrain === 'colina' ? .12 : p.terrain === 'floresta' ? .08 : 0); }
function checkEnd(game) { const alive = game.nations.filter((n) => game.provinces.some((p) => p.owner === n.id)); if (!alive.some((n) => n.id === game.ownerId)) game.status = 'lost'; else if (alive.length === 1) game.status = 'won'; else if (game.turn > RULES.maxTurns) game.status = 'ended'; }
function finishTurn(game) { game.provinces.forEach((p) => { p.population += RULES.provinceGrowth; p.recruitable = Math.min(p.population, p.recruitable + 30); }); game.nations.forEach((n) => { const ownedCount = game.provinces.filter((p) => p.owner === n.id); n.income = income(game, n); n.gold += n.income - ownedCount.reduce((s, p) => s + p.troops * RULES.upkeep, 0); if (n.gold < 0) { n.gold = 0; ownedCount.forEach((p) => { p.troops = Math.max(0, p.troops - 12); }); n.stability = Math.max(0, n.stability - 5); log(game, `${n.name} sofreu cortes por falta de tesouro.`, 'warning'); } }); }
function aiTurn(game, ai) { const ownedProvinces = game.provinces.filter((p) => p.owner === ai.id); if (!ownedProvinces.length) return; const border = ownedProvinces.flatMap((p) => p.neighbors.map((id) => province(game, id))).find((p) => p && p.owner !== ai.id && p.troops < (province(game, p.neighbors.find((id) => owned(game, id, ai.id)))?.troops || 0) * 1.2); if (border && ai.profile === 'expansionista') { const source = ownedProvinces.find((p) => p.neighbors.includes(border.id) && p.troops > 60); if (source) resolveBattle(game, ai.id, source.id, border.id, Math.floor(source.troops * .35), true); } if (ai.profile === 'economica' && ai.gold >= RULES.buildings.market.cost) { const p = ownedProvinces.find((x) => !x.buildings.includes('market')); if (p) { ai.gold -= RULES.buildings.market.cost; p.buildings.push('market'); log(game, `${ai.name} construiu um mercado em ${p.name}.`, 'ai'); } } }
function resolveBattle(game, nationId, sourceId, targetId, amount, ai = false) { const source = province(game, sourceId); const target = province(game, targetId); const attacker = nation(game, nationId); if (!source || !target || source.owner !== nationId || !source.neighbors.includes(targetId) || target.owner === nationId) throw new Error('Ataque inválido: província não é vizinha ou não pertence à nação.'); if (!Number.isInteger(amount) || amount < 1 || amount >= source.troops) throw new Error('Quantidade de tropas inválida.'); const defender = nation(game, target.owner); const attackPower = amount * (0.82 + (attacker.stability / 500)); const defensePower = target.troops * defense(target) * (0.82 + defender.stability / 500); const seed = crypto.createHash('sha256').update(`${game.id}:${game.version}:${sourceId}:${targetId}:${amount}`).digest().readUInt32BE(0) / 0xffffffff; source.troops -= amount; if (attackPower * (0.9 + seed * .2) > defensePower) { target.owner = nationId; target.troops = Math.max(8, Math.floor(amount - target.troops * .35)); log(game, `${attacker.name} conquistou ${target.name}.`, 'battle'); } else { target.troops = Math.max(1, Math.floor(target.troops - amount * .18)); log(game, `${attacker.name} falhou ao tomar ${target.name}.`, 'battle'); } }

function action(game, nationId, payload) { assertPlaying(game); const n = assertNation(game, nationId); const type = payload.type; if (type === 'build') { const p = province(game, payload.provinceId); const rule = RULES.buildings[payload.building]; if (!p || p.owner !== nationId || !rule || p.buildings.includes(payload.building)) throw new Error('Construção indisponível nesta província.'); if (n.gold < rule.cost) throw new Error('Tesouro insuficiente para esta construção.'); n.gold -= rule.cost; p.buildings.push(payload.building); log(game, `${n.name} ergueu ${rule.label} em ${p.name}.`, 'build'); }
  else if (type === 'recruit') { const p = province(game, payload.provinceId); const amount = Number(payload.amount); const bonus = p?.buildings.includes('barracks') ? RULES.buildings.barracks.recruit : 0; if (!p || p.owner !== nationId || !Number.isInteger(amount) || amount < 1 || amount > 200 || p.recruitable < amount || n.gold < amount * RULES.troopCost) throw new Error('Recrutamento indisponível: verifique população e tesouro.'); p.recruitable -= amount; p.troops += amount + bonus; n.gold -= amount * RULES.troopCost; log(game, `${n.name} recrutou tropas em ${p.name}.`, 'build'); }
  else if (type === 'move') { const from = province(game, payload.from); const to = province(game, payload.to); const amount = Number(payload.amount); if (!from || !to || from.owner !== nationId || to.owner !== nationId || !from.neighbors.includes(to.id) || !Number.isInteger(amount) || amount < 1 || amount >= from.troops) throw new Error('Movimento inválido: escolha uma província vizinha e tropas disponíveis.'); from.troops -= amount; to.troops += amount; log(game, `${n.name} moveu tropas para ${to.name}.`, 'move'); }
  else if (type === 'attack') { resolveBattle(game, nationId, payload.from, payload.to, Number(payload.amount)); }
  else if (type === 'diplomacy') { const other = assertNation(game, payload.target); const relation = n.relations[other.id] || 0; if (payload.kind === 'war') { n.relations[other.id] = -80; other.relations[n.id] = -80; log(game, `${n.name} declarou guerra a ${other.name}.`, 'diplomacy'); } else if (payload.kind === 'peace' && relation < 20) { n.relations[other.id] = 25; other.relations[n.id] = 25; log(game, `${other.name} aceitou a paz com ${n.name}.`, 'diplomacy'); } else if (payload.kind === 'trade' && relation > -40 && n.gold >= 50) { n.gold -= 50; n.income += 20; other.income += 20; n.relations[other.id] = relation + 15; other.relations[n.id] = relation + 15; log(game, `${n.name} firmou acordo comercial com ${other.name}.`, 'diplomacy'); } else throw new Error('A proposta diplomática foi recusada pelas condições atuais.'); }
  else throw new Error('Ação desconhecida.'); game.version++; game.updatedAt = Date.now(); checkEnd(game); return game; }
function endTurn(game) { assertPlaying(game); finishTurn(game); game.turn++; game.nations.filter((n) => n.ai).forEach((ai) => aiTurn(game, ai)); log(game, `Turno ${game.turn} começou. Os adversários tomaram suas decisões.`, 'turn'); game.version++; checkEnd(game); return game; }
function publicState(game) { return { ...clone(game), rules: RULES, nations: game.nations.map((n) => ({ ...n, relations: n.id === game.ownerId ? n.relations : undefined })) }; }
module.exports = { RULES, NATIONS, newCampaign, action, endTurn, publicState, nation, province };
