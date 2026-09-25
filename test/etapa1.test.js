'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..');
const TEST_DB = path.join(RAIZ, 'tmp', 'etapa1-test.db');

async function testEtapa1() {
  console.log('=== TESTES DA ETAPA 1 (Base Compartilhada & Economia) ===');

  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DATABASE_FILE = TEST_DB;

  const db = require('../database/database');
  const dbc = db.open();

  // 1. Verificação das migrações e tabelas criadas
  const favTable = dbc.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_favorites'").get();
  assert.ok(favTable, 'tabela user_favorites existe');
  const ledgerTable = dbc.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'economy_ledger'").get();
  assert.ok(ledgerTable, 'tabela economy_ledger existe');
  console.log('✅ 1: Migrações aplicadas preservando integridade (user_favorites, economy_ledger)');

  // 2. Registro e resolução canônica de comandos
  const loader = require('../commands/loader');
  loader.loadCommands(true);
  const { registry } = require('../engine/plugins');
  assert.ok(registry.count() > 300, 'comandos carregados no registry');
  assert.strictEqual(registry.getCanonicalName('menu'), 'menu');
  assert.strictEqual(registry.getCanonicalName('ajuda'), 'help'); // alias de help
  assert.strictEqual(registry.getCanonicalName('ping'), 'ping');
  console.log('✅ 2: Carregamento do registry e resolução canônica');

  // 3. Favoritos: deduplicação de aliases e normalização
  const favorites = require('../database/favorites');
  const userA = '5511999990001@s.whatsapp.net';
  
  // Adiciona pelo alias 'ajuda'
  const res1 = favorites.addFavorite(userA, 'ajuda');
  assert.strictEqual(res1.ok, true);
  assert.strictEqual(res1.command.name, 'help');

  // Adiciona pelo nome 'help'
  const res2 = favorites.addFavorite(userA, 'help');
  assert.strictEqual(res2.ok, true);

  const listA = favorites.listFavorites(userA);
  assert.strictEqual(listA.length, 1, 'alias e nome não duplicam favorito');
  assert.strictEqual(listA[0].name, 'help');
  assert.strictEqual(favorites.isFavorite(userA, 'ajuda'), true);

  favorites.removeFavorite(userA, 'help');
  assert.strictEqual(favorites.listFavorites(userA).length, 0);
  console.log('✅ 3: Persistência, normalização e deduplicação de favoritos');

  // 4. Economia: Operações idempotentes e consistência
  const economy = require('../database/economy');
  const { withLock, withMultiLock } = require('../utils/keyedMutex');

  economy.setWallet(userA, 1000);
  assert.strictEqual(economy.get(userA).wallet, 1000);

  // Tentativa de operação duplicada com mesma opKey
  const opKey1 = 'op-tx-test-001';
  const opRes1 = economy.applyIdempotentOperation(opKey1, userA, -200, 'compra', 'item x');
  assert.strictEqual(opRes1.duplicated, false);
  assert.strictEqual(economy.get(userA).wallet, 800);

  const opRes2 = economy.applyIdempotentOperation(opKey1, userA, -200, 'compra', 'item x');
  assert.strictEqual(opRes2.duplicated, true);
  assert.strictEqual(economy.get(userA).wallet, 800, 'saldo não descontou duas vezes');

  // Transferência atômica entre dois usuários
  const userB = '5511999990002@s.whatsapp.net';
  economy.setWallet(userB, 500);

  const transKey = 'tx-trans-test-001';
  await withMultiLock([userA, userB], async () => {
    const tRes1 = economy.applyIdempotentTransfer(transKey, userA, userB, 300, 'pagamento teste');
    assert.strictEqual(tRes1.duplicated, false);
    assert.strictEqual(economy.get(userA).wallet, 500);
    assert.strictEqual(economy.get(userB).wallet, 800);

    // Retentativa com mesma chave
    const tRes2 = economy.applyIdempotentTransfer(transKey, userA, userB, 300, 'pagamento teste');
    assert.strictEqual(tRes2.duplicated, true);
    assert.strictEqual(economy.get(userA).wallet, 500);
    assert.strictEqual(economy.get(userB).wallet, 800);
  });
  console.log('✅ 4: Operações financeiras idempotentes e transferência com withMultiLock');

  // 5. Histórico e Extrato
  const histA = economy.history(userA, 10);
  assert.ok(histA.length >= 2, 'histórico registrado');
  const countA = economy.countHistory(userA);
  assert.strictEqual(countA, histA.length);
  console.log('✅ 5: Histórico e paginação de transações verificados');

  // 6. Fechar e reabrir banco mantendo dados
  db.close();
  const dbc2 = db.open();
  const reEcoA = dbc2.prepare("SELECT wallet FROM economy WHERE user_id = ?").get(userA);
  assert.strictEqual(reEcoA.wallet, 500, 'saldo preservado após reabertura');
  console.log('✅ 6: Reabertura do banco preservando dados e integridade');

  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(TEST_DB + s)) fs.unlinkSync(TEST_DB + s);
  }
  console.log('=== ETAPA 1 VALIDADA COM SUCESSO! 🎉 ===\n');
}

testEtapa1().catch((err) => {
  console.error('Falha no teste da Etapa 1:', err);
  process.exit(1);
});
