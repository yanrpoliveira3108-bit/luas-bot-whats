/**
 * test/migration.test.js — regressões da migração @lucasmod/boruto-vk7-baileys 2.1.0.
 *
 * Cobre:
 *  1) normalizeJid (sufixo de dispositivo, grupo, formatos variados)
 *  2) owner normalizado (OWNER_NUMBER em formatos razoáveis + JID :device)
 *  3) shouldProcessMessage (fromMe do dono/eco/não-dono/terceiros)
 *  4) persistência do estado dos botões (!botao on/off)
 *  5) payload de seleção de LISTA (listResponseMessage)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');

function clearCache() {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
}

async function main() {
  /* 1) normalizeJid — puro, não precisa de banco */
  const phoneParser = require('../connection/phoneParser');
  assert.strictEqual(phoneParser.normalizeJid('5511999999999:12@s.whatsapp.net').digits, '5511999999999');
  assert.strictEqual(phoneParser.normalizeJid('5511999999999@s.whatsapp.net').digits, '5511999999999');
  assert.strictEqual(phoneParser.normalizeJid('120363000000000000@g.us').isGroup, true);
  assert.strictEqual(phoneParser.normalizeJid('+55 (11) 99999-9999').digits, '5511999999999');
  console.log('✅ 1/5: normalizeJid (dispositivo, grupo, formatos)');

  /* 2) owner normalizado */
  clearCache();
  process.env.OWNER_NUMBER = '+55 (11) 99999-9999';
  let CONFIG = require('../config');
  assert.strictEqual(CONFIG.helpers.isOwnerNumber('5511999999999@s.whatsapp.net'), true);
  assert.strictEqual(CONFIG.helpers.isOwnerNumber('5511999999999:12@s.whatsapp.net'), true);
  assert.strictEqual(CONFIG.helpers.isOwnerNumber('5511888888888@s.whatsapp.net'), false);
  clearCache();
  process.env.OWNER_NUMBER = '5511999999999@s.whatsapp.net';
  CONFIG = require('../config');
  assert.strictEqual(CONFIG.helpers.isOwnerNumber('5511999999999@s.whatsapp.net'), true);
  console.log('✅ 2/5: OWNER_NUMBER normalizado (formatos + :device)');

  /* 3) shouldProcessMessage — precisa do banco (lê o prefixo efetivo) */
  clearCache();
  process.env.OWNER_NUMBER = '5511999999999';
  const dbtmp = require('./dbtmp');
  process.env.DATABASE_FILE = dbtmp.tmpFile('lua-migration-test.db');
  dbtmp.rm(process.env.DATABASE_FILE);
  CONFIG = require('../config');
  const db3 = require('../database/database');
  db3.open();
  const ch = require('../handlers/commandHandler');
  const ownerJid = '5511999999999@s.whatsapp.net';
  const mk = (over) => Object.assign(
    { key: { remoteJid: ownerJid, fromMe: false, id: 'AAA' }, message: { conversation: '!ping' } },
    over
  );
  assert.strictEqual(ch.shouldProcessMessage(mk({ key: { remoteJid: '5521999998888@s.whatsapp.net', fromMe: false, id: 'B1' } })), true, 'terceiros');
  assert.strictEqual(ch.shouldProcessMessage(mk({ key: { remoteJid: ownerJid, fromMe: true, id: '3EB0' + 'A'.repeat(18) } })), false, 'eco 3EB0');
  assert.strictEqual(ch.shouldProcessMessage(mk({ key: { remoteJid: '5521999998888@s.whatsapp.net', fromMe: true, id: 'B2', participant: '5521999998888@s.whatsapp.net' } })), false, 'fromMe não-dono');
  assert.strictEqual(ch.shouldProcessMessage(mk({ key: { remoteJid: ownerJid, fromMe: true, id: 'B3' } })), true, 'dono comando');
  assert.strictEqual(
    ch.shouldProcessMessage(mk({
      key: { remoteJid: ownerJid, fromMe: true, id: 'B4' },
      message: { listResponseMessage: { singleSelectReply: { selectedRowId: 'lua_nav_lua_main_menu_admin' } } },
    })),
    true,
    'dono clicando lista'
  );
  db3.close();
  console.log('✅ 3/5: shouldProcessMessage (terceiros, eco 3EB0, dono, não-dono, clique)');

  /* 4) persistência dos botões */
  clearCache();
  delete process.env.OWNER_NUMBER;
  process.env.DATABASE_FILE = dbtmp.tmpFile('lua-migration-test2.db');
  dbtmp.rm(process.env.DATABASE_FILE);
  CONFIG = require('../config');
  const db = require('../database/database');
  db.open();
  const settings = require('../database/settings');
  settings.setButtonsEnabled(false);
  assert.strictEqual(settings.buttonsEnabled(), false, '!botao off deve persistir');
  settings.setButtonsEnabled(true);
  assert.strictEqual(settings.buttonsEnabled(), true, '!botao on deve persistir');
  settings.setButtonsEnabled(false);
  assert.strictEqual(settings.get('buttons_enabled'), 'false', 'valor gravado no banco');
  db.close();
  console.log('✅ 4/5: persistência de !botao on/off (banco)');

  /* 5) seleção de LISTA (listResponseMessage) + native flow (single_select) */
  const { getInteractivePayload } = require('../utils/messages');
  const p = getInteractivePayload({
    message: {
      listResponseMessage: {
        singleSelectReply: { selectedRowId: 'lua_nav_lua_main_menu_admin' },
        title: '🌙 LUA BOT',
        description: 'x',
      },
    },
  });
  assert.strictEqual(p && p.type, 'list');
  assert.strictEqual(p && p.id, 'lua_nav_lua_main_menu_admin');
  const pNative = getInteractivePayload({
    message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          name: 'single_select',
          paramsJson: JSON.stringify({ id: 'lua_nav_lua_jobs_job_faxineiro' }),
        },
      },
    },
  });
  assert.strictEqual(pNative && pNative.type, 'list');
  assert.strictEqual(pNative && pNative.id, 'lua_nav_lua_jobs_job_faxineiro');
  console.log('✅ 5/5: seleção de lista → listResponseMessage + single_select nativo');

  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
