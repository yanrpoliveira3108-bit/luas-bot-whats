/**
 * plugins/life/networth.js — cálculo consistente do patrimônio.
 *
 * Patrimônio = carteira + banco + valor de venda das propriedades
 * (casas/terrenos * nível, veículos) + empresas (preço * nível)
 * + animais (sell_price) + galinheiros/estábulos.
 */

'use strict';

const economy = require('../../database/economy');
const rpg = require('../../database/rpg');
const life = require('../../database/life');
const { HOUSES, LANDS, VEHICLES, BUSINESSES, COOPS } = require('./config');

function valueOf(kind, spec, level) {
  if (kind === 'casa') {
    const h = HOUSES.find((x) => x.id === spec);
    return h ? h.sellValue * level : 0;
  }
  if (kind === 'terreno') {
    const l = LANDS.find((x) => x.id === spec);
    return l ? l.sellValue * level : 0;
  }
  if (kind === 'veiculo') {
    const v = VEHICLES.find((x) => x.id === spec);
    return v ? v.sellValue * level : 0;
  }
  if (kind === 'galinheiro' || kind === 'estabulo') {
    const c = COOPS[spec];
    if (!c) return 0;
    const lvl = c.levels[Math.min(level, c.levels.length) - 1] || c.levels[0];
    return lvl ? Math.floor(lvl.price * 0.5) : 0;
  }
  return 0;
}

/** Patrimônio detalhado do usuário. */
function compute(userId) {
  const eco = economy.get(userId);
  const props = life.listProperties(userId);
  const businesses = life.listBusinesses(userId);
  const animals = rpg.getAnimals(userId);

  let propertiesValue = 0;
  const breakdown = {
    wallet: eco.wallet,
    bank: eco.bank,
    properties: 0,
    businesses: 0,
    animals: 0,
  };

  for (const p of props) {
    const v = valueOf(p.kind, p.spec, p.level);
    breakdown.properties += v;
    propertiesValue += v;
  }
  for (const b of businesses) {
    const def = BUSINESSES.find((x) => x.id === b.kind);
    if (def) breakdown.businesses += def.price * b.level;
  }
  for (const a of animals) {
    const item = rpg.getShopItem(a.type);
    if (item) breakdown.animals += item.sell_price || 0;
  }

  const total = breakdown.wallet + breakdown.bank + breakdown.properties + breakdown.businesses + breakdown.animals;
  return { total, breakdown, propertyCount: props.length, animalCount: animals.length, businessCount: businesses.length };
}

module.exports = { compute, valueOf };
