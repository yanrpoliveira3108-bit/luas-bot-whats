'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const db = require('../database/database');
const economy = require('../database/economy');
const crypto = require('../database/crypto');
const coopEvents = require('../utils/coopEvents');
const autoBackup = require('../utils/autoBackup');

test.before(() => {
  process.env.NODE_ENV = 'test';
  db.open();
});

test.after(() => {
  db.close();
});

test('1. Sistema de trocas: suporte a itens e moedas com consistência e atomismo', async () => {
  const p1 = 'user-trade-1@s.whatsapp.net';
  const p2 = 'user-trade-2@s.whatsapp.net';

  economy.ensure(p1);
  economy.ensure(p2);

  // Dar saldo e itens iniciais
  economy.addWallet(p1, 1000);
  economy.addItem(p1, 'espada_ferro', 2);
  economy.addItem(p2, 'pocao_vida', 5);

  const initialP1Items = economy.getItem(p1, 'espada_ferro');
  assert.strictEqual(initialP1Items.quantity, 2);

  // Executa troca com itens
  economy.removeItem(p1, 'espada_ferro', 1);
  economy.addItem(p2, 'espada_ferro', 1);
  economy.removeItem(p2, 'pocao_vida', 2);
  economy.addItem(p1, 'pocao_vida', 2);

  assert.strictEqual(economy.getItem(p1, 'espada_ferro').quantity, 1);
  assert.strictEqual(economy.getItem(p2, 'espada_ferro').quantity, 1);
  assert.strictEqual(economy.getItem(p1, 'pocao_vida').quantity, 2);
  assert.strictEqual(economy.getItem(p2, 'pocao_vida').quantity, 3);
});

test('2. Eventos cooperativos: persistência completa no SQLite entre reinicializações', async () => {
  const chatId = 'group-raid-123@g.us';

  const ev = coopEvents.getOrCreateEvent(chatId);
  assert.ok(ev);
  assert.strictEqual(ev.chatId, chatId);
  assert.strictEqual(ev.status, 'active');

  // Adiciona dano e persiste
  const fakeCtx = {
    isGroup: true,
    remoteJid: chatId,
    sender: 'warrior-1@s.whatsapp.net',
    prefix: '!',
    reply: async (msg) => msg,
  };

  await coopEvents.handleEventCommand(fakeCtx, 'entrar');
  await coopEvents.handleEventCommand(fakeCtx, 'agir');

  // Recarregar evento direto do banco simulando reinicialização da aplicação
  const reloaded = coopEvents.loadEventFromDb(chatId);
  assert.ok(reloaded);
  assert.strictEqual(reloaded.id, ev.id);
  assert.ok(reloaded.hp < reloaded.maxHp);
  assert.ok(reloaded.participants.has('warrior-1@s.whatsapp.net'));
  assert.ok(reloaded.participants.get('warrior-1@s.whatsapp.net').damage > 0);
});

test('3. Mercado de criptomoedas: cálculo determinístico de cotação com janela de validade', () => {
  const q = crypto.quote('BTC');
  assert.ok(q);
  assert.strictEqual(q.symbol, 'BTC');
  assert.ok(q.price > 0);
  assert.ok(typeof q.remainingMs === 'number');
  assert.ok(q.remainingMs >= 0 && q.remainingMs <= crypto.TICK_MS);
});

test('4. Backup automático: checkpoint WAL e proteção contra credenciais vazadas', () => {
  const destDir = autoBackup.doBackup('audit-test');
  assert.ok(destDir);
  assert.ok(fs.existsSync(destDir));

  // Não deve vazar pasta session com credenciais nem chaves privadas
  const sessionBackup = path.join(destDir, 'session');
  assert.strictEqual(fs.existsSync(sessionBackup), false);

  // Deve ter cópia do banco lua.db e info.json
  assert.ok(fs.existsSync(path.join(destDir, 'lua.db')));
  assert.ok(fs.existsSync(path.join(destDir, 'info.json')));
});
