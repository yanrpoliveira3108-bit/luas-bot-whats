'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..');
const TEST_DB = path.join(RAIZ, 'tmp', 'etapa2-test.db');

async function testEtapa2() {
  console.log('=== TESTES DA ETAPA 2 (Config, Diagnóstico & Backup) ===');

  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DATABASE_FILE = TEST_DB;

  const db = require('../database/database');
  db.open();

  // 1. Config: Execução e verificação de escopos
  const configCmd = require('../commands/general/config')[0];
  let replyConfig = '';
  const mockCtxOwner = {
    isOwner: true,
    isGroup: true,
    remoteJid: '12345@g.us',
    prefix: '!',
    args: [],
    reply: async (msg) => { replyConfig = msg; },
  };

  await configCmd.execute(mockCtxOwner);
  assert.ok(replyConfig.includes('PAINEL CENTRAL DE CONFIGURAÇÕES'), 'título do painel central presente');
  assert.ok(replyConfig.includes('Escopo Global'), 'escopo global detalhado');
  assert.ok(replyConfig.includes('Escopo do Grupo'), 'escopo do grupo detalhado');
  assert.ok(replyConfig.includes('Escopo Pessoal'), 'escopo pessoal detalhado');
  console.log('✅ 1: Painel central de configurações com escopos diferenciados');

  // 2. Diagnóstico administrativo
  const diagCmd = require('../commands/owner/diagnostico')[0];
  let replyDiag = [];
  const mockCtxDiag = {
    isOwner: true,
    args: [],
    reply: async (msg) => { replyDiag.push(msg); },
  };

  await diagCmd.execute(mockCtxDiag);
  const diagText = replyDiag.join('\n');
  assert.ok(diagText.includes('DIAGNÓSTICO ADMINISTRATIVO'), 'cabeçalho de diagnóstico');
  assert.ok(diagText.includes('SQLite WAL: 🟢 OK'), 'conexão real com SQLite');
  assert.ok(diagText.includes('Uptime'), 'uptime do bot');
  console.log('✅ 2: Diagnóstico administrativo em tempo real funcional');

  // 3. Backup: listar, criar e integridade
  const backupCmd = require('../commands/owner/backup')[0];
  let replyBackup = '';
  const mockCtxBackup = {
    isOwner: true,
    args: ['listar'],
    prefix: '!',
    reply: async (msg) => { replyBackup = msg; },
  };

  await backupCmd.execute(mockCtxBackup);
  assert.ok(replyBackup.includes('LISTA DE BACKUPS'), 'lista de backups executada');

  // Criar backup
  const bDest = path.join(RAIZ, 'backup', `test-backup-${Date.now()}.db`);
  await db.backup(bDest);
  assert.ok(fs.existsSync(bDest), 'arquivo de backup criado com sucesso');

  // Checagem de integridade
  const Database = require('better-sqlite3');
  const conn = new Database(bDest, { readonly: true });
  const check = conn.prepare('PRAGMA integrity_check').get();
  conn.close();
  assert.strictEqual(check.integrity_check, 'ok', 'integridade do backup confirmada');

  if (fs.existsSync(bDest)) fs.unlinkSync(bDest);
  console.log('✅ 3: Criação de backup consistente e checagem de integridade PRAGMA');

  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(TEST_DB + s)) fs.unlinkSync(TEST_DB + s);
  }
  console.log('=== ETAPA 2 VALIDADA COM SUCESSO! 🎉 ===\n');
}

testEtapa2().catch((err) => {
  console.error('Falha no teste da Etapa 2:', err);
  process.exit(1);
});
