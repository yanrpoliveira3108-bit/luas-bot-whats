/**
 * test/life.test.js — regressões do Lua Life.
 *
 * Cobre: personagem, trabalho (cooldown/energia), banco, compra/venda,
 * mineração/pesca (durabilidade), plantações, casas/patrimônio, missões,
 * conquistas, mercado entre jogadores, diário (streak), loteria, admin
 * (ownerOnly), ler mais, imagem de menu, downloads (router) e persistência.
 *
 * Roda com banco temporário no tmp/ do projeto — não toca o banco real.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DB = require('./dbtmp').tmpFile('lua-life-test.db');

function clearCache() {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
}

let failures = 0;
function ok(label) {
  console.log('✅ ' + label);
}
function fail(label, e) {
  failures++;
  console.log('❌ ' + label + ' — ' + (e && e.message));
}

async function main() {
  try { fs.rmSync(DB, { force: true }); } catch (_) {}
  process.env.DATABASE_FILE = DB;

  const CONFIG = require('../config');
  const database = require('../database/database');
  database.open();

  const economy = require('../database/economy');
  const rpg = require('../database/rpg');
  const life = require('../database/life');
  const engine = require('../plugins/life/engine');
  const networth = require('../plugins/life/networth');
  const market = require('../plugins/life/market');
  const leveling = require('../plugins/life/leveling');
  const C = require('../plugins/life/config');
  const { formatMoney } = require('../utils/formatter');
  const readmore = require('../utils/readmore');
  const menuImage = require('../utils/menuImage');
  const router = require('../downloaders/router');

  const U = '5511999999999@s.whatsapp.net';
  const U2 = '5511888888888@s.whatsapp.net';

  /* 1) criação de personagem */
  try {
    life.createCharacter(U, { name: 'Ana', age: 25, city: 'Sumaré', money: CONFIG.life.start.money });
    const p = life.getPlayer(U);
    assert.strictEqual(p.name, 'Ana');
    assert.strictEqual(p.age, 25);
    assert.strictEqual(economy.get(U).wallet, CONFIG.life.start.money);
    ok('1: criação de personagem + dinheiro inicial');
  } catch (e) { fail('1: criação de personagem', e); }

  /* 2) trabalho: cooldown, energia, carreira */
  try {
    rpg.setProfession(U, 'faxineiro');
    const w1 = await engine.work(U);
    assert.ok(w1.reward > 0, 'recompensa > 0');
    assert.strictEqual(w1.energy, 100 - 10, 'energia -10');
    assert.strictEqual(w1.careerLevel, 1);
    // cooldown bloqueia segundo trabalho
    let blocked = false;
    try { await engine.work(U); } catch (e) { blocked = e.code === 'COOLDOWN'; }
    assert.strictEqual(blocked, true, 'cooldown bloqueia');
    ok('2: trabalho (recompensa, energia, cooldown)');
  } catch (e) { fail('2: trabalho', e); }

  /* 3) sem energia bloqueia + descanso recupera */
  try {
    database.get().prepare('DELETE FROM cooldowns').run();
    life.applyVitals(U, { energy: -200 });
    let blocked = false;
    try { await engine.work(U); } catch (e) { blocked = e.code === 'NO_ENERGY'; }
    assert.strictEqual(blocked, true);
    const before = life.getPlayer(U).energy;
    const energy = await engine.rest(U);
    assert.ok(energy > before, 'descanso recupera energia');
    ok('3: energia (bloqueio + descanso)');
  } catch (e) { fail('3: energia', e); }

  /* 4) banco: depósito/saque atômicos + saldo insuficiente */
  try {
    const wBefore = economy.get(U).wallet;
    economy.deposit(U, 100);
    assert.strictEqual(economy.get(U).bank, 100);
    assert.strictEqual(economy.get(U).wallet, wBefore - 100);
    let insuf = false;
    try { economy.deposit(U, 999999999); } catch (e) { insuf = e.message === 'INSUFFICIENT_FUNDS'; }
    assert.strictEqual(insuf, true);
    economy.withdraw(U, 50);
    assert.strictEqual(economy.get(U).bank, 50);
    ok('4: banco (depósito/saque/saldo insuficiente)');
  } catch (e) { fail('4: banco', e); }

  /* 5) mineração: durabilidade + item criado */
  try {
    economy.addItem(U, 'picareta_simples', 1);
    const before = economy.getItem(U, 'pedra');
    const m = await engine.mine(U);
    assert.ok(m.ore && m.qty >= 1, 'minerou algo');
    const after = economy.getItem(U, m.ore.id);
    assert.strictEqual((after ? after.quantity : 0), (before && before.item_id === m.ore.id ? before.quantity : 0) + m.qty, 'item entrou no inventário');
    assert.strictEqual(m.usesLeft, 25 - 1, 'durabilidade -1');
    ok('5: mineração (durabilidade + item)');
  } catch (e) { fail('5: mineração', e); }

  /* 6) ferramenta quebra sem reserva */
  try {
    life.setToolUses(U, 'picareta_simples', 1);
    const m = await engine.mine(U);
    assert.strictEqual(m.broken, true, 'quebrou');
    let noTool = false;
    try { await engine.mine(U); } catch (e) { noTool = e.code === 'NO_TOOL'; }
    assert.strictEqual(noTool, true, 'sem ferramenta bloqueia');
    ok('6: quebra de ferramenta');
  } catch (e) { fail('6: quebra de ferramenta', e); }

  /* 7) pesca com isca */
  try {
    economy.addItem(U, 'vara_simples', 1);
    economy.addItem(U, 'isca', 2);
    const f = await engine.fish(U, true);
    assert.ok(f.fish && f.qty >= 1, 'pescou');
    assert.strictEqual(economy.getItem(U, 'isca').quantity, 1, 'isca consumida');
    ok('7: pesca com isca');
  } catch (e) { fail('7: pesca', e); }

  /* 8) casa: compra + patrimônio + saldo insuficiente */
  try {
    const beforeWallet = economy.get(U).wallet;
    let insuf = false;
    try { await engine.buyHouse(U, 'barraco'); } catch (e) { insuf = e.code === 'INSUFFICIENT_FUNDS'; }
    assert.strictEqual(insuf, true);
    assert.strictEqual(economy.get(U).wallet, beforeWallet, 'rollback: saldo intacto');

    life.updatePlayer(U, { level: 10 });
    economy.addWallet(U, 100000);
    await engine.buyHouse(U, 'casa_simples');
    const prop = life.getProperty(U, 'casa', 'casa_simples');
    assert.ok(prop, 'propriedade registrada');
    const nw = networth.compute(U);
    assert.ok(nw.total >= 8000, 'patrimônio inclui casa');
    ok('8: casa (rollback, compra, patrimônio)');
  } catch (e) { fail('8: casa', e); }

  /* 9) upgrade de propriedade */
  try {
    const r = await engine.upgradeProperty(U, 'casa', 'casa_simples');
    assert.strictEqual(r.level, 2);
    ok('9: upgrade de propriedade');
  } catch (e) { fail('9: upgrade', e); }

  /* 10) missões: progresso + resgate + resgate duplo bloqueado */
  try {
    engine.progressMissions(U, 'work', 3);
    const row = life.getMission(U, 'trabalhar3');
    assert.ok(row && row.progress >= 3, 'progresso registrado');
    const def = await engine.claimMissionReward(U, 'trabalhar3');
    assert.strictEqual(def.id, 'trabalhar3');
    let twice = false;
    try { await engine.claimMissionReward(U, 'trabalhar3'); } catch (e) { twice = e.code === 'ALREADY'; }
    assert.strictEqual(twice, true, 'resgate duplo bloqueado');
    ok('10: missões (progresso/resgate/anti-duplo)');
  } catch (e) { fail('10: missões', e); }

  /* 11) conquistas: condição + recompensa paga 1x (idempotente) */
  try {
    // 'primeiro_salario' já foi desbloqueada no trabalho → não paga de novo
    const before = economy.get(U).wallet;
    const again = engine.checkAchievement(U, 'primeiro_salario');
    assert.strictEqual(again, null, 'já desbloqueada não re-paga');
    assert.strictEqual(economy.get(U).wallet, before, 'saldo intacto (sem duplicata)');

    // 'primeiro_milhao' com condição satisfeita → desbloqueia 1x
    economy.addWallet(U, 2000000);
    const swept = engine.sweepAchievements(U);
    assert.ok(swept.some((a) => a.id === 'primeiro_milhao'), 'desbloqueou primeiro_milhao');
    const afterOnce = economy.get(U).wallet;
    const swept2 = engine.sweepAchievements(U);
    assert.strictEqual(swept2.length, 0, 'não desbloqueia 2x');
    assert.strictEqual(economy.get(U).wallet, afterOnce, 'recompensa paga 1x');
    ok('11: conquistas (condição + idempotência)');
  } catch (e) { fail('11: conquistas', e); }

  /* 12) mercado entre jogadores: oferta → compra → item transferido */
  try {
    economy.addItem(U, 'fertilizante', 5);
    const { offerId } = await engine.createOffer(U, 'fertilizante', 3, 100);
    economy.addWallet(U2, 1000);
    const buy = await engine.buyOffer(U2, offerId);
    assert.strictEqual(buy.total, 300);
    assert.strictEqual(economy.getItem(U, 'fertilizante').quantity, 2, 'vendedor: 5-3');
    assert.strictEqual(economy.getItem(U2, 'fertilizante').quantity, 3, 'comprador: +3');
    ok('12: mercado (oferta/compra)');
  } catch (e) { fail('12: mercado', e); }

  /* 13) cancelamento de oferta devolve item */
  try {
    const qBefore = economy.getItem(U, 'fertilizante').quantity;
    const { offerId } = await engine.createOffer(U, 'fertilizante', 2, 100);
    await engine.cancelOffer(U, offerId);
    assert.strictEqual(economy.getItem(U, 'fertilizante').quantity, qBefore, 'item devolvido');
    ok('13: cancelamento de oferta');
  } catch (e) { fail('13: cancelamento de oferta', e); }

  /* 14) presente entre jogadores */
  try {
    economy.addItem(U, 'fertilizante', 2);
    const before2 = economy.getItem(U2, 'fertilizante') ? economy.getItem(U2, 'fertilizante').quantity : 0;
    await engine.giftItem(U, U2, 'fertilizante', 2);
    assert.strictEqual(economy.getItem(U2, 'fertilizante').quantity, before2 + 2);
    ok('14: presente de item');
  } catch (e) { fail('14: presente', e); }

  /* 15) diário: streak + resgate duplo bloqueado */
  try {
    const d1 = await engine.dailyClaim(U);
    assert.strictEqual(d1.streak, 1);
    let twice = false;
    try { await engine.dailyClaim(U); } catch (e) { twice = e.code === 'ALREADY'; }
    assert.strictEqual(twice, true, 'mesmo dia bloqueado');
    // simula resgate ontem → streak incrementa
    life.updateDaily(U, { streak: 3, lastClaim: new Date(Date.now() - 86400000).toISOString(), totalClaims: 3 });
    const d2 = await engine.dailyClaim(U);
    assert.strictEqual(d2.streak, 4, 'streak incrementa');
    ok('15: presente diário (streak)');
  } catch (e) { fail('15: diário', e); }

  /* 16) loteria: limites + saldo insuficiente */
  try {
    let maxStake = false;
    try { await engine.lottery(U, 5, 99999999); } catch (e) { maxStake = e.code === 'MAX_STAKE'; }
    assert.strictEqual(maxStake, true, 'aposta máxima aplicada');
    const before = economy.get(U).wallet;
    const r = await engine.lottery(U, 5, 50);
    assert.ok(economy.get(U).wallet >= before - 50, 'nunca perde mais que a aposta');
    ok('16: loteria (limites)');
  } catch (e) { fail('16: loteria', e); }

  /* 17) admin: ownerOnly + givecoin */
  try {
    const { registry } = require('../engine/plugins');
    // comandos admin só existem após loadCommands; testa a flag diretamente
    const adminFile = require('../commands/life/admin');
    assert.ok(adminFile.every((c) => c.ownerOnly === true), 'todos admin são ownerOnly');
    economy.setWallet(U2, 0);
    life.walletTx(U2, 500, 'admin_give', 'teste');
    assert.strictEqual(economy.get(U2).wallet, 500);
    ok('17: admin ownerOnly + givecoin');
  } catch (e) { fail('17: admin', e); }

  /* 18) ler mais */
  try {
    readmore.setEnabled(true);
    const long = 'Título\n' + 'x'.repeat(1000);
    assert.notStrictEqual(readmore.maybeReadMore(long), long, 'readmore aplicado');
    readmore.setEnabled(false);
    assert.strictEqual(readmore.maybeReadMore(long), long, 'readmore desligado');
    readmore.setEnabled(true);
    ok('18: ler mais on/off');
  } catch (e) { fail('18: ler mais', e); }

  /* 19) imagem de menu (fallback sem quebrar) */
  try {
    const r = menuImage.resolve('admin');
    assert.ok(r === null || typeof r === 'string', 'resolve não lança');
    ok('19: imagem de menu (nunca quebra)');
  } catch (e) { fail('19: imagem de menu', e); }

  /* 20) router de downloads */
  try {
    assert.strictEqual(router.platformOf('https://youtu.be/abc'), 'youtube');
    assert.strictEqual(router.platformOf('https://www.tiktok.com/@x/video/1'), 'tiktok');
    assert.strictEqual(router.platformOf('https://pin.it/abc'), 'pinterest');
    assert.strictEqual(router.platformOf('https://example.com/x'), null);
    ok('20: router de downloads');
  } catch (e) { fail('20: router', e); }

  /* 21) persistência: reabrir banco mantém progresso */
  try {
    database.close();
    database.open();
    assert.strictEqual(life.getPlayer(U).name, 'Ana', 'personagem persiste');
    assert.ok(economy.get(U).wallet > 0, 'saldo persiste');
    assert.ok(life.getProperty(U, 'casa', 'casa_simples'), 'propriedade persiste');
    ok('21: persistência após reinício');
  } catch (e) { fail('21: persistência', e); }

  /* 22) registry: categorias geradas + execute() real */
  try {
    const { loadCommands } = require('../commands/loader');
    const { registry } = require('../engine/plugins');
    loadCommands(true);
    const lifeCmds = (registry.byCategory().get('life') || []);
    assert.ok(lifeCmds.length > 20, 'categoria life com comandos');
    assert.ok(lifeCmds.every((c) => typeof c.execute === 'function'), 'execute() real');
    ok('22: registry (categoria life auto-gerada)');
  } catch (e) { fail('22: registry', e); }

  /* 23) preços: limites min/max respeitados */
  try {
    const item = rpg.getShopItem('ouro');
    for (let i = 0; i < 30; i++) {
      const p = market.computePrice('ouro', { price: 140 }, item.sell_price);
      assert.ok(p >= 1 && p <= 1000, `preço dentro dos limites (${p})`);
    }
    ok('23: preços dinâmicos com limites');
  } catch (e) { fail('23: preços', e); }

  database.close();

  console.log(`\n=== LIFE TEST: ${failures === 0 ? 'TUDO OK' : failures + ' falha(s)'} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ erro fatal:', err);
  process.exit(1);
});
