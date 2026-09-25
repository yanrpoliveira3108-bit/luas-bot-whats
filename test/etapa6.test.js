'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..');
const TEST_DB = path.join(RAIZ, 'tmp', 'etapa6-test.db');

async function testEtapa6() {
  console.log('=== TESTES DA ETAPA 6 (Mercado Fictício de Criptomoedas) ===');

  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DATABASE_FILE = TEST_DB;

  const db = require('../database/database');
  db.open();

  const economy = require('../database/economy');
  const crypto = require('../database/crypto');
  const user = '5511999994444@s.whatsapp.net';

  economy.setWallet(user, 10000);

  // 1. Cotações e determinismo
  const now = Date.now();
  const btcPrice1 = crypto.price('BTC', now);
  const btcPrice2 = crypto.price('BTC', now);
  assert.strictEqual(btcPrice1, btcPrice2, 'preço de BTC determinístico no mesmo instante');
  assert.ok(btcPrice1 > 0, 'preço maior que zero');
  console.log('✅ 1: Preços determinísticos e consistentes entre jogadores');

  // 2. Compra de cripto integrada ao extrato
  const buyRes = crypto.buy(user, 'BTC', 2500, now);
  assert.strictEqual(buyRes.symbol, 'BTC');
  assert.ok(buyRes.amount > 0, 'quantidade comprada');
  assert.strictEqual(economy.get(user).wallet, 7500, 'saldo em carteira descontado');

  const historyBuy = economy.history(user, 5);
  assert.ok(historyBuy.some((h) => h.type === 'cripto_compra'), 'compra registrada no extrato da carteira');
  console.log('✅ 2: Compra com débito atômico e registro no extrato');

  // 3. Venda de cripto com lucro/prejuízo
  const walletBeforeSell = economy.get(user).wallet;
  const sellRes = crypto.sell(user, 'BTC', buyRes.amount, now);
  assert.strictEqual(sellRes.symbol, 'BTC');
  assert.ok(sellRes.gain > 0, 'ganho na venda');
  assert.strictEqual(economy.get(user).wallet, walletBeforeSell + sellRes.gain, 'saldo da venda creditado');

  const historySell = economy.history(user, 5);
  assert.ok(historySell.some((h) => h.type === 'cripto_venda'), 'venda registrada no extrato da carteira');
  console.log('✅ 3: Venda com crédito atômico e registro no extrato');

  // 4. Bloqueio de venda acima do disponível
  assert.throws(
    () => crypto.sell(user, 'BTC', 10),
    /INSUFFICIENT_FUNDS/,
    'bloqueou venda sem saldo do ativo'
  );
  console.log('✅ 4: Proteção contra venda além da quantidade disponível');

  // 5. Geração de card visual em HTML do mercado
  const cryptoHtmlView = require('../utils/cryptoHtmlView');
  const html = cryptoHtmlView.renderCryptoMarketHtml(user, '!');
  assert.ok(html.includes('MERCADO CRIPTO'), 'título do card de cripto');
  assert.ok(html.includes('Bitcoin'), 'moeda listada');
  assert.ok(html.includes('Cotação:'), 'carimbo de horário presente');
  assert.ok(html.includes('Sua Carteira'), 'carteira do jogador no card');
  console.log('✅ 5: Card visual em HTML com cotações e carteira sem simulação ao vivo falsa');

  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(TEST_DB + s)) fs.unlinkSync(TEST_DB + s);
  }
  console.log('=== ETAPA 6 VALIDADA COM SUCESSO! 🎉 ===\n');
}

testEtapa6().catch((err) => {
  console.error('Falha no teste da Etapa 6:', err);
  process.exit(1);
});
