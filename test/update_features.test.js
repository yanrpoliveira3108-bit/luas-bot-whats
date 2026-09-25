'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../database/database');
const economy = require('../database/economy');
const rpg = require('../database/rpg');
const market = require('../database/market');
const collections = require('../database/collections');
const expeditions = require('../database/expeditions');
const settings = require('../database/settings');

test.before(() => {
  process.env.NODE_ENV = 'test';
  db.open();
});

test.after(() => {
  db.close();
});

test('1. Feira: anúncio, custódia/escrow, compra parcial, disputa pela última unidade e cancelamento', async () => {
  const seller = `seller-feira-${Date.now()}@s.whatsapp.net`;
  const buyer1 = `buyer-feira-1-${Date.now()}@s.whatsapp.net`;
  const buyer2 = `buyer-feira-2-${Date.now()}@s.whatsapp.net`;

  economy.ensure(seller);
  economy.ensure(buyer1);
  economy.ensure(buyer2);

  // Dar 5x de picareta para o vendedor
  economy.addItem(seller, 'picareta', 5);
  economy.addWallet(buyer1, 5000);
  economy.addWallet(buyer2, 5000);

  // 1.1 Criar anúncio de 4x picaretas a 500 LC cada
  const listing = await market.createListing(seller, 'picareta', 4, 500);
  assert.ok(listing.listingId);
  assert.strictEqual(listing.quantity, 4);

  // O vendedor deve ter ficado apenas com 1x no inventário (4 em custódia/escrow)
  const sellerInv = economy.getItem(seller, 'picareta');
  assert.strictEqual(sellerInv.quantity, 1);

  // 1.2 Compra parcial: buyer1 compra 3 unidades
  const p1 = await market.buyListing(buyer1, listing.listingId, 3);
  assert.strictEqual(p1.buyQty, 3);
  assert.strictEqual(p1.totalPrice, 1500);
  assert.strictEqual(p1.remaining, 1);

  // Comprador 1 tem 3 picaretas e pagou 1500
  assert.strictEqual(economy.getItem(buyer1, 'picareta').quantity, 3);
  assert.strictEqual(economy.get(buyer1).wallet, 3500);

  // 1.3 Disputa pela última unidade: buyer2 tenta comprar 2, mas só resta 1
  await assert.rejects(
    async () => market.buyListing(buyer2, listing.listingId, 2),
    /maior que a disponível|Estoque insuficiente/
  );

  // Buyer2 compra a última unidade restante
  const p2 = await market.buyListing(buyer2, listing.listingId, 1);
  assert.strictEqual(p2.remaining, 0);

  const freshListing = market.getListing(listing.listingId);
  assert.strictEqual(freshListing.status, 'sold');

  // Comprador não pode comprar anúncio esgotado
  await assert.rejects(
    async () => market.buyListing(buyer1, listing.listingId, 1),
    /não está mais ativo/
  );

  // 1.4 Cancelamento e devolução de custódia
  economy.addItem(seller, 'machado', 3);
  const cancelListing = await market.createListing(seller, 'machado', 3, 300);
  assert.strictEqual(economy.getItem(seller, 'machado'), null); // todos em custódia

  const cancelled = await market.cancelListing(seller, cancelListing.listingId);
  assert.strictEqual(cancelled.returnedQuantity, 3);
  assert.strictEqual(economy.getItem(seller, 'machado').quantity, 3);
});

test('2. Coleções e Vitrine: progresso, persistência pós-venda, prêmio único e vitrine sincronizada', async () => {
  const user = `collector-${Date.now()}@s.whatsapp.net`;
  economy.ensure(user);

  // Adicionar itens da coleção 'ferramentas' ('regador', 'machado', 'picareta', 'vara_pescar')
  economy.addItem(user, 'regador', 1);
  economy.addItem(user, 'machado', 1);
  economy.addItem(user, 'picareta', 1);

  // Sincronizar descobertas
  collections.syncDiscoveriesFromInventory(user);
  let col = collections.getUserCollection(user, 'ferramentas');
  assert.strictEqual(col.foundCount, 3);
  assert.strictEqual(col.isComplete, false);

  // Consumir/vender um item: descoberta DEVE permanecer no histórico
  economy.removeItem(user, 'regador', 1);
  assert.strictEqual(economy.getItem(user, 'regador'), null);

  const discoveredSet = collections.getDiscoveredItemIds(user);
  assert.ok(discoveredSet.has('regador'), 'Regador deve continuar como descoberto mesmo após venda');

  // Encontrar o último item ('vara_pescar') e readquirir 'regador'
  economy.addItem(user, 'vara_pescar', 1);
  economy.addItem(user, 'regador', 1);
  collections.syncDiscoveriesFromInventory(user);

  col = collections.getUserCollection(user, 'ferramentas');
  assert.strictEqual(col.foundCount, 4);
  assert.strictEqual(col.isComplete, true);

  // Resgate de prêmio único
  const beforeWallet = economy.get(user).wallet;
  const rewardRes = collections.claimCollectionReward(user, 'ferramentas');
  assert.strictEqual(rewardRes.rewardCoins, col.rewardCoins);
  assert.strictEqual(economy.get(user).wallet, beforeWallet + col.rewardCoins);

  // Tentativa de resgate duplicado deve falhar
  assert.throws(
    () => collections.claimCollectionReward(user, 'ferramentas'),
    /já resgatou o prêmio/
  );

  // Vitrine: definir e validar
  collections.setShowcase(user, ['machado', 'picareta']);
  let showcase = collections.getShowcase(user);
  assert.strictEqual(showcase.length, 2);

  // Remover item do inventário: vitrine deve atualizar removendo o item indisponível
  economy.removeItem(user, 'machado', 1);
  showcase = collections.getShowcase(user);
  assert.strictEqual(showcase.length, 1);
  assert.strictEqual(showcase[0].itemId, 'picareta');
});

test('3. Expedições solo: início, escolhas por etapa, consumo de energia e recompensas no extrato', async () => {
  const user = `explorer-${Date.now()}@s.whatsapp.net`;
  economy.ensure(user);
  rpg.ensurePlayer(user);
  db.prepare('set_player_energy', `UPDATE rpg_players SET energy = 100, level = 5 WHERE user_id = ?`).run(user);

  // Iniciar expedição na floresta
  const start = await expeditions.startExpedition(user, 'floresta');
  assert.strictEqual(start.currentStage, 1);
  assert.strictEqual(rpg.getPlayer(user).energy, 85); // 100 - 15

  // Etapa 1
  const step1 = await expeditions.chooseOption(user, start.expeditionId, 'clareira');
  assert.strictEqual(step1.isCompleted, false);
  assert.strictEqual(step1.nextStage, 2);

  // Etapa 2
  const step2 = await expeditions.chooseOption(user, start.expeditionId, 'desviar');
  assert.strictEqual(step2.isCompleted, false);
  assert.strictEqual(step2.nextStage, 3);

  // Etapa 3 (Conclusão)
  const initialWallet = economy.get(user).wallet;
  const step3 = await expeditions.chooseOption(user, start.expeditionId, 'oferenda');
  assert.strictEqual(step3.isCompleted, true);
  assert.ok(step3.finalReward.coins > 0);
  assert.strictEqual(economy.get(user).wallet, initialWallet + step3.finalReward.coins);

  // Partida encerrada: getActiveExpedition retorna null
  assert.strictEqual(expeditions.getActiveExpedition(user), null);
});

test('4. Configurações da feira e persistência geral', () => {
  settings.set('feira_enabled', 'true');
  assert.strictEqual(market.isMarketEnabled(), true);

  settings.set('feira_max_listings', '8');
  assert.strictEqual(market.getMaxListingsPerUser(), 8);

  settings.set('feira_duration_hours', '48');
  assert.strictEqual(market.getExpirationMs(), 48 * 60 * 60 * 1000);
});
