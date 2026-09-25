'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..');
const TEST_DB = path.join(RAIZ, 'tmp', 'etapa5-test.db');

async function testEtapa5() {
  console.log('=== TESTES DA ETAPA 5 (Eventos Cooperativos & HTML RPG) ===');

  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DATABASE_FILE = TEST_DB;

  const db = require('../database/database');
  db.open();

  // 1. Eventos Cooperativos
  const coopEvents = require('../utils/coopEvents');
  const mockChat = '12036300000001@g.us';
  const player1 = '5511999993333@s.whatsapp.net';

  let replyEvent = '';
  const mockCtx = {
    isGroup: true,
    remoteJid: mockChat,
    sender: player1,
    prefix: '!',
    reply: async (msg) => { replyEvent = msg; },
  };

  // Status
  await coopEvents.handleEventCommand(mockCtx, 'status');
  assert.ok(replyEvent.includes('EVENTO COOPERATIVO'), 'status do evento cooperativo');
  assert.ok(replyEvent.includes('Vida do Chefe'), 'barra de vida do chefe visível');

  // Entrar
  await coopEvents.handleEventCommand(mockCtx, 'entrar');
  assert.ok(replyEvent.includes('juntou-se à batalha'), 'inscrição no evento confirmada');

  // Agir
  await coopEvents.handleEventCommand(mockCtx, 'agir');
  assert.ok(replyEvent.includes('atacou o') && replyEvent.includes('de dano'), 'ataque desferido com sucesso');
  console.log('✅ 1: Eventos cooperativos ativos (status, entrada e ataque coordenado)');

  // 2. Renderização de Telas HTML
  const rpgHtmlViews = require('../utils/rpgHtmlViews');

  const profileHtml = rpgHtmlViews.renderProfileHtml({
    name: 'Guerreiro Teste',
    level: 10,
    profession: 'Minerador',
    xp: 500,
    nextXp: 1000,
    wallet: 2500,
    bank: 10000,
    reputation: 15,
    messages: 120,
    achievementsCount: 3,
  });
  assert.ok(profileHtml.includes('PERFIL • Guerreiro Teste'), 'título no HTML de perfil');
  assert.ok(profileHtml.includes('Minerador'), 'profissão no HTML');
  assert.ok(profileHtml.includes('2.500'), 'saldo formatado');

  const invHtml = rpgHtmlViews.renderInventoryHtml([
    { emoji: '⚔️', name: 'Espada de Aço', quantity: 1 },
    { emoji: '🍎', name: 'Maçã', quantity: 5 },
  ], 'Guerreiro Teste');
  assert.ok(invHtml.includes('INVENTÁRIO • Guerreiro Teste'), 'título no HTML de inventário');
  assert.ok(invHtml.includes('Espada de Aço'), 'item renderizado');

  const rankHtml = rpgHtmlViews.renderRankingHtml('Top Ricos', [
    { name: 'Player 1', valueFormatted: '🪙 100.000 LC' },
    { name: 'Player 2', valueFormatted: '🪙 50.000 LC' },
  ], 'Saldo Total');
  assert.ok(rankHtml.includes('RANKING • Top Ricos'), 'título no HTML de ranking');
  assert.ok(rankHtml.includes('100.000 LC'), 'valores no ranking');
  console.log('✅ 2: Telas HTML de Perfil, Inventário e Ranking geradas com segurança e estilização');

  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(TEST_DB + s)) fs.unlinkSync(TEST_DB + s);
  }
  console.log('=== ETAPA 5 VALIDADA COM SUCESSO! 🎉 ===\n');
}

testEtapa5().catch((err) => {
  console.error('Falha no teste da Etapa 5:', err);
  process.exit(1);
});
