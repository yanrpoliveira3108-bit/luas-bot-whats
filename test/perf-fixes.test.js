/**
 * test/perf-fixes.test.js — regressões das correções de memória/índices.
 *
 * 1) plugins/welcome/templates.js: o cache de artes-base era ilimitado e retinha
 *    8 bitmaps 1280×720 (3,52 MB cada). Agora é LRU com teto pequeno.
 * 2) handlers/commandHandler.js: afkNotified crescia para sempre.
 * 3) database/database.js: migração 38 cria os índices das tabelas de alto
 *    volume — as consultas precisam usar índice, não varrer a tabela.
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-perf.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
const db = database.open();
const users = require('../database/users');
const handler = require('../handlers/commandHandler');
const templates = require('../plugins/welcome/templates');

const results = [];
function check(label, fn) {
  return Promise.resolve().then(fn)
    .then(() => { results.push([label, true]); console.log('  ✔ ' + label); })
    .catch((err) => { results.push([label, false, err.message]); console.log('  ✘ ' + label + ' → ' + err.message); });
}

(async () => {
  console.log('══════════ PERF-FIXES TEST ══════════');

  /* ------------------------------------------- 1. cache de artes (LRU) */
  await check('templates: cache de artes-base é limitado (LRU)', async () => {
    const ids = ['welcome-01', 'welcome-02', 'welcome-03', 'welcome-04',
      'goodbye-01', 'goodbye-02', 'goodbye-03', 'goodbye-04'];
    for (const id of ids) {
      const img = await templates.load(id);
      assert.ok(img && img.bitmap, 'load(' + id + ') não devolveu imagem');
    }
    assert.ok(templates.baseCacheSize() <= templates.BASE_CACHE_MAX,
      `cache com ${templates.baseCacheSize()} artes (teto ${templates.BASE_CACHE_MAX})`);
  });

  await check('templates: o template mais recente continua em cache (caminho rápido)', async () => {
    const antes = templates.baseCacheSize();
    await templates.load('goodbye-04');
    assert.strictEqual(templates.baseCacheSize(), antes, 'recarregar o item quente mudou o tamanho do cache');
    assert.ok(templates.BASE_CACHE_MAX >= 1, 'o teto não pode ser zero');
  });

  await check('templates: o avatar padrão continua funcionando', async () => {
    const buf = await templates.ensureAvatar();
    assert.ok(Buffer.isBuffer(buf) && buf.length > 1000, 'avatar inválido');
    // avatar tem slot próprio: não pode ser expulso pelos templates
    const buf2 = await templates.ensureAvatar();
    assert.strictEqual(buf2.length, buf.length);
  });

  /* ---------------------------------------------- 2. afkNotified (poda) */
  await check('afkNotified: tabela não cresce sem limite', async () => {
    const alvo = '5511900000001@s.whatsapp.net';
    users.upsert(alvo, 'Afk');
    users.setAfk(alvo, 1, 'viajando');

    const sock = { sendMessage: async () => ({ key: { id: 'k' } }) };
    const ctxBase = { mentionedJid: [alvo], message: {}, remoteJid: '' };
    // chaves distintas = chats distintos (a chave é chat|usuário)
    for (let i = 0; i < 1200; i++) {
      await handler.notifyAfk(sock, Object.assign({}, ctxBase, { remoteJid: `1203630${i}@g.us` }));
    }
    assert.ok(handler.afkNotifiedSize() <= 1000,
      'afkNotified ficou com ' + handler.afkNotifiedSize() + ' entradas (teto 1000)');
    users.setAfk(alvo, 0, '');
  });

  await check('afkNotified: a supressão de 60s continua valendo', async () => {
    const alvo = '5511900000002@s.whatsapp.net';
    users.upsert(alvo, 'Afk2');
    users.setAfk(alvo, 1, 'ocupado');
    let enviadas = 0;
    const sock = { sendMessage: async () => { enviadas += 1; return { key: { id: 'k' } }; } };
    const ctx = { mentionedJid: [alvo], message: {}, remoteJid: '120363099999@g.us' };
    await handler.notifyAfk(sock, ctx);
    await handler.notifyAfk(sock, ctx);
    await handler.notifyAfk(sock, ctx);
    assert.strictEqual(enviadas, 1, 'a mesma notificação foi enviada ' + enviadas + 'x em 60s');
    users.setAfk(alvo, 0, '');
  });

  /* --------------------------------------- 3. índices (migração 38) */
  await check('migração 38: os 7 índices existem', () => {
    const esperados = {
      transactions: 'idx_tx_user',
      group_logs: 'idx_group_logs_group',
      warnings: 'idx_warnings_group_user',
      plantations: 'idx_plantations_user',
      animals: 'idx_animals_user',
      life_market: 'idx_life_market_status',
      economy_logs: 'idx_economy_logs_action',
    };
    for (const [tabela, indice] of Object.entries(esperados)) {
      const nomes = db.prepare(`PRAGMA index_list(${tabela})`).all().map((i) => i.name);
      assert.ok(nomes.includes(indice), `${tabela}: índice ${indice} ausente (tem: ${nomes.join(', ') || 'nenhum'})`);
    }
  });

  await check('migração 38: as consultas críticas usam índice (EXPLAIN)', () => {
    const consultas = [
      `SELECT * FROM transactions WHERE user_id = 'x' ORDER BY id DESC LIMIT 10`,
      `SELECT * FROM group_logs WHERE group_id = 'g' AND type IN ('a') ORDER BY id DESC LIMIT 10`,
      `SELECT * FROM warnings WHERE group_id = 'g' AND user_id = 'u' ORDER BY id ASC`,
      `SELECT * FROM plantations WHERE user_id = 'u' AND harvested = 0 ORDER BY id ASC`,
      `SELECT * FROM animals WHERE user_id = 'u' AND sold = 0 ORDER BY id ASC`,
      `SELECT * FROM life_market WHERE status = 'active' ORDER BY id DESC LIMIT 5`,
      `SELECT COUNT(*) AS c FROM economy_logs WHERE action = 'compra'`,
    ];
    for (const sql of consultas) {
      const plano = db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((r) => r.detail).join(' | ');
      assert.match(plano, /USING (COVERING )?INDEX/, 'consulta varre a tabela: ' + sql + ' → ' + plano);
    }
  });

  await check('migração 38: idempotente ao reabrir o banco', () => {
    const versaoAntes = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    database.close();
    database.open();
    // a conexão antiga morreu com o close(): é preciso pedir a nova
    const nova = database.get();
    const versao = nova.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    assert.strictEqual(versao, versaoAntes, 'a migração foi reaplicada ao reabrir');
    assert.ok(versao >= 38, 'versão esperada >= 38, veio ' + versao);
  });

  const falhas = results.filter(([, ok]) => !ok);
  console.log(`\n=== PERF-FIXES TEST: ${results.length - falhas.length} passou, ${falhas.length} falhou ===`);
  if (falhas.length) { for (const [l, , e] of falhas) console.log('  FALHA: ' + l + ' — ' + e); process.exitCode = 1; }
  else console.log('=== PERF-FIXES TEST: TUDO OK ===');
})().catch((err) => { console.error('PERF-FIXES TEST quebrou:', err); process.exitCode = 1; });
