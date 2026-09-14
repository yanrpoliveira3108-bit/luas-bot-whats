/**
 * test/pix.test.js — comando !pix (Payment Message real do Baileys).
 *
 * Cobre:
 *  1) trigger `pix` = Payment Message; `transferir`/`enviar` preservados
 *  2) casos válidos produzem o objeto `{ payment: {...} }` EXATO
 *     (note/amount/currency dinâmicos + offset/expiry/from/image fixos)
 *  3) campos faltando são apontados individualmente ([texto]/[valor]/[moeda])
 *  4) valores claramente inválidos são rejeitados
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-pix-test.db');

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

async function main() {
  try { fs.rmSync(DB, { force: true }); } catch (_) {}
  process.env.OWNER_NUMBER = '5511999999999';
  process.env.DATABASE_FILE = DB;
  process.env.BUTTONS_ENABLED = 'true';

  const database = require('../database/database');
  database.open();
  require('../commands/loader').loadCommands(true);

  const commandHandler = require('../handlers/commandHandler');
  const cooldown = require('../utils/cooldown');
  const { registry } = require('../engine/plugins');

  const ME = '5511999999998@s.whatsapp.net';
  const PRIV = '5511999999999@s.whatsapp.net';
  const sent = [];
  const sock = {
    user: { id: ME },
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: 'k' + sent.length } };
    },
    sendPresenceUpdate: async () => {},
  };
  const mkMsg = (text) => ({
    key: { remoteJid: PRIV, fromMe: false, id: 'M' + Math.random().toString(36).slice(2) },
    message: { conversation: text },
    pushName: 'Owner',
  });

  async function run(text) {
    cooldown.reset('user', PRIV, 'pix');
    cooldown.reset('global', '*', 'pix');
    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(text));
    return sent.slice();
  }

  const EXACT_IMAGE = JSON.stringify({
    placeholderArgb: 'your_background',
    textArgb: 'your_text',
    subtextArgb: 'your_subtext',
  });

  /* 1) registro de triggers */
  try {
    assert.strictEqual((registry.resolveTrigger('pix') || {}).name, 'pix', 'pix → Payment Message');
    assert.strictEqual((registry.resolveTrigger('transferir') || {}).name, 'transferir', 'transferir preservado');
    assert.strictEqual((registry.resolveTrigger('enviar') || {}).name, 'transferir', 'enviar preservado');
    ok('1: trigger pix = payment; transferir/enviar intactos');
  } catch (e) { fail('1: registro', e); }

  /* 2) casos válidos → objeto exato */
  try {
    const cases = [
      ['!pix Teste|10000|BRL', 'Teste', '10000', 'BRL'],
      ['!pix Pagamento do pedido|25000|BRL', 'Pagamento do pedido', '25000', 'BRL'],
      ['!pix 🌙 Lua Premium|50000|BRL', '🌙 Lua Premium', '50000', 'BRL'],
      ['!pix Teste internacional|10000|IDR', 'Teste internacional', '10000', 'IDR'],
      ['!pix Obrigado pela compra!|100|USD', 'Obrigado pela compra!', '100', 'USD'],
    ];
    for (const [cmd, note, amount, currency] of cases) {
      const out = await run(cmd);
      const p = out.find((s) => s.content && s.content.payment);
      assert.ok(p, cmd + ' envia payment');
      assert.strictEqual(Object.keys(p.content).length, 1, cmd + ' usa SOMENTE a chave payment');
      const pay = p.content.payment;
      assert.strictEqual(pay.note, note, cmd + ' → note');
      assert.strictEqual(pay.amount, amount, cmd + ' → amount');
      assert.strictEqual(pay.currency, currency, cmd + ' → currency');
      assert.strictEqual(pay.offset, 0, 'offset fixo 0');
      assert.strictEqual(pay.expiry, 0, 'expiry fixo 0');
      assert.strictEqual(pay.from, '628xxxx@s.whatsapp.net', 'from fixo');
      assert.strictEqual(JSON.stringify(pay.image), EXACT_IMAGE, 'image fixa');
    }
    ok('2: casos válidos → objeto payment exato (sem text/buttons/listMessage)');
  } catch (e) { fail('2: válidos', e); }

  /* 3) campos faltando apontados individualmente */
  try {
    const expect = [
      ['!pix', '[texto]'],
      ['!pix Teste||', '[valor]'],
      ['!pix Teste|10000|', '[moeda]'],
      ['!pix Teste||BRL', '[valor]'],
    ];
    for (const [cmd, field] of expect) {
      const out = await run(cmd);
      const txt = out.filter((s) => s.content && s.content.text).map((s) => s.content.text).join('\n');
      assert.ok(/Uso correto:/.test(txt), cmd + ' mostra o uso correto');
      assert.ok(txt.includes(field), cmd + ' aponta o campo ' + field);
      assert.ok(!out.some((s) => s.content && s.content.payment), cmd + ' não envia payment');
    }
    ok('3: campos faltando apontados ([texto]/[valor]/[moeda])');
  } catch (e) { fail('3: faltando', e); }

  /* 4) valores claramente inválidos rejeitados */
  try {
    const bad = [
      ['!pix Teste|abc|BRL', /Valor inválido/],
      ['!pix Teste|10000|BR', /Moeda inválida/],
      ['!pix Teste|10000|BRL|extra', /Formato incorreto/],
    ];
    for (const [cmd, re] of bad) {
      const out = await run(cmd);
      const txt = out.filter((s) => s.content && s.content.text).map((s) => s.content.text).join('\n');
      assert.ok(re.test(txt), cmd + ' rejeitado com explicação');
      assert.ok(!out.some((s) => s.content && s.content.payment), cmd + ' não envia payment');
    }
    ok('4: valores inválidos rejeitados (sem conversões silenciosas)');
  } catch (e) { fail('4: inválidos', e); }

  database.close();
  if (failures) {
    console.error(`\n❌ PIX TEST: ${failures} falha(s)`);
    process.exit(1);
  }
  console.log('\n=== PIX TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
