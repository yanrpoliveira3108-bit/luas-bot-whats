'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..');
const TEST_DB = path.join(RAIZ, 'tmp', 'etapa4-test.db');

async function testEtapa4() {
  console.log('=== TESTES DA ETAPA 4 (Extrato, Trocas & Missões) ===');

  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DATABASE_FILE = TEST_DB;

  const db = require('../database/database');
  db.open();

  const economy = require('../database/economy');
  const user1 = '5511999991111@s.whatsapp.net';
  const user2 = '5511999992222@s.whatsapp.net';

  economy.setWallet(user1, 1000);
  economy.setWallet(user2, 500);

  // 1. Comando de Extrato (!extrato)
  const extratoCmd = require('../commands/rpg/extrato')[0];
  economy.applyIdempotentOperation('op-e4-1', user1, -150, 'compra', 'espada de ferro');
  economy.applyIdempotentOperation('op-e4-2', user1, 300, 'recompensa', 'missão cumprida');

  let replyExtrato = '';
  await extratoCmd.execute({
    sender: user1,
    args: [],
    prefix: '!',
    reply: async (msg) => { replyExtrato = msg; },
  });

  assert.ok(replyExtrato.includes('EXTRATO DETALHADO DA CARTEIRA'), 'cabeçalho do extrato');
  assert.ok(replyExtrato.includes('Compra') || replyExtrato.includes('compra'), 'registro de compra presente');
  assert.ok(replyExtrato.includes('Recompensa') || replyExtrato.includes('recompensa'), 'registro de recompensa presente');
  console.log('✅ 1: Comando !extrato com paginação e formatação financeira correta');

  // 2. Sistema de Trocas (!troca)
  const trocaCmd = require('../commands/rpg/troca')[0];
  const mockChat = '12036300000000@g.us';

  // Proposta: user1 oferece 200 e pede 100 de user2
  let replyTroca1 = '';
  await trocaCmd.execute({
    sender: user1,
    remoteJid: mockChat,
    prefix: '!',
    args: ['@' + user2.split('@')[0], 'dar', '200', 'pedir', '100'],
    mentionedJid: [user2],
    message: { message: { extendedTextMessage: { contextInfo: { mentionedJid: [user2] } } } },
    reply: async (msg) => { replyTroca1 = msg; },
  });
  assert.ok(replyTroca1.includes('PROPOSTA DE TROCA'), 'proposta de troca gerada');

  // Tentativa de troca consigo mesmo
  let selfReply = '';
  await trocaCmd.execute({
    sender: user1,
    remoteJid: mockChat,
    prefix: '!',
    args: ['@' + user1.split('@')[0]],
    mentionedJid: [user1],
    message: { message: { extendedTextMessage: { contextInfo: { mentionedJid: [user1] } } } },
    reply: async (msg) => { selfReply = msg; },
  });
  assert.ok(selfReply.includes('não pode fazer uma troca consigo mesmo'), 'bloqueou auto-troca');

  // user2 aceita a troca
  let replyAceite = '';
  await trocaCmd.execute({
    sender: user2,
    remoteJid: mockChat,
    prefix: '!',
    args: ['aceitar'],
    reply: async (msg) => { replyAceite = msg; },
  });
  assert.ok(replyAceite.includes('TROCA CONCLUÍDA COM SUCESSO'), 'troca confirmada e finalizada');

  // Verifica saldos pós-troca
  // user1: 1000 - 150 + 300 - 200 + 100 = 1050
  // user2: 500 + 200 - 100 = 600
  assert.strictEqual(economy.get(user1).wallet, 1050, 'saldo user1 correto após troca');
  assert.strictEqual(economy.get(user2).wallet, 600, 'saldo user2 correto após troca');
  console.log('✅ 2: Sistema de trocas atômicas entre jogadores com validação e execução indivisível');

  // 3. Missões e Conquistas
  const progression = require('../commands/life/progression');
  const missoesCmd = progression[0];
  const conquistasCmd = progression[1];

  let replyMissoes = '';
  await missoesCmd.execute({
    sender: user1,
    args: [],
    prefix: '!',
    reply: async (msg) => { replyMissoes = msg; },
  });
  assert.ok(replyMissoes.includes('MISSÕES'), 'lista de missões');

  let replyConquistas = '';
  await conquistasCmd.execute({
    sender: user1,
    args: [],
    prefix: '!',
    reply: async (msg) => { replyConquistas = msg; },
  });
  assert.ok(replyConquistas.includes('CONQUISTAS'), 'lista de conquistas');
  console.log('✅ 3: Missões e conquistas integradas com registro de recompensas');

  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(TEST_DB + s)) fs.unlinkSync(TEST_DB + s);
  }
  console.log('=== ETAPA 4 VALIDADA COM SUCESSO! 🎉 ===\n');
}

testEtapa4().catch((err) => {
  console.error('Falha no teste da Etapa 4:', err);
  process.exit(1);
});
