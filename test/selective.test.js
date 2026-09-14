/**
 * test/selective.test.js — transporte seletivo de recipients (EXPERIMENTAL).
 *
 * Cobre:
 *  1) resolveSelectiveRecipients — admins/members/custom/normal + validações
 *  2) normalizeUserJid — PN/LID/device
 *  3) sendSelective (texto) — restringe selectiveParticipants no relayMessage
 *  4) sendSelective (payment) — payload gera requestPaymentMessage legítimo
 *  5) patch vendor presente (selectiveParticipants + fallback full list)
 *  6) rejeições de segurança (grupo apenas, custom fora do grupo, modo inválido)
 *
 * NÃO testa descriptografia em dispositivo real (impossível neste sandbox).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.OWNER_NUMBER = '5511999999999';

const selective = require('../utils/selective');

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

const GROUP = '120363411784060909@g.us';
const A = '5511900000001@s.whatsapp.net'; // admin
const B = '5511900000002@s.whatsapp.net'; // admin
const C = '5511900000003@s.whatsapp.net'; // membro
const D = '5511900000004@s.whatsapp.net'; // membro
const A_LID = '72400000000001@lid';
const C_LID = '72400000000003@lid';

const META = {
  id: GROUP,
  participants: [
    { id: A, admin: 'admin' },
    { id: B, admin: 'admin' },
    { id: C },
    { id: D },
  ],
};

/* 1) resolução de recipients */
try {
  assert.deepStrictEqual(
    selective.resolveSelectiveRecipients(META, { mode: 'normal' }),
    [A, B, C, D],
    'normal = todos'
  );
  assert.deepStrictEqual(
    selective.resolveSelectiveRecipients(META, { mode: 'admins' }),
    [A, B],
    'admins = A+B'
  );
  assert.deepStrictEqual(
    selective.resolveSelectiveRecipients(META, { mode: 'members' }),
    [C, D],
    'members = C+D'
  );
  assert.deepStrictEqual(
    selective.resolveSelectiveRecipients(META, { mode: 'custom', recipients: [C] }),
    [C],
    'custom C'
  );
  assert.deepStrictEqual(
    selective.resolveSelectiveRecipients(META, { mode: 'custom', recipients: [A] }),
    [A],
    'custom A'
  );
  ok('1: resolveSelectiveRecipients — normal/admins/members/custom');
} catch (e) { fail('1: resolução', e); }

/* 2) normalização PN/LID/device */
try {
  assert.strictEqual(selective.normalizeUserJid('5511900000003:12@s.whatsapp.net'), C, 'device → user PN');
  assert.strictEqual(selective.normalizeUserJid('5511900000003@s.whatsapp.net'), C, 'PN puro');
  assert.strictEqual(selective.normalizeUserJid('72400000000003@lid'), '72400000000003@lid', 'LID puro');
  assert.strictEqual(selective.normalizeUserJid('72400000000003:7@lid'), '72400000000003@lid', 'LID device → LID');
  assert.strictEqual(selective.normalizeUserJid(' 5511900000003@s.whatsapp.net '), C, 'trim');
  assert.strictEqual(selective.normalizeUserJid(null), null, 'null → null');
  assert.strictEqual(selective.normalizeUserJid('lixo'), null, 'sem @ → null');

  // custom aceitando LID/device, resolvendo para o id canônico (PN)
  const metaLid = {
    id: GROUP,
    participants: [
      { id: A, admin: 'admin', lid: A_LID },
      { id: B, admin: 'admin' },
      { id: C, lid: C_LID },
      { id: D },
    ],
  };
  assert.deepStrictEqual(
    selective.resolveSelectiveRecipients(metaLid, { mode: 'custom', recipients: ['72400000000003:7@lid'] }),
    [C],
    'custom via LID+device → PN canônico'
  );
  ok('2: normalizeUserJid — PN/LID/device');
} catch (e) { fail('2: normalização', e); }

/* 3) rejeições de segurança */
try {
  assert.throws(
    () => selective.resolveSelectiveRecipients(META, { mode: 'laranja' }),
    (e) => e.code === 'SELECTIVE_BAD_MODE',
    'modo inválido'
  );
  assert.throws(
    () => selective.resolveSelectiveRecipients(META, { mode: 'custom', recipients: [] }),
    (e) => e.code === 'SELECTIVE_NO_RECIPIENTS',
    'custom sem recipients'
  );
  assert.throws(
    () => selective.resolveSelectiveRecipients(META, { mode: 'custom', recipients: ['5599999999999@s.whatsapp.net'] }),
    (e) => e.code === 'SELECTIVE_NOT_MEMBER',
    'custom com estranho fora do grupo'
  );
  ok('3: rejeições — modo inválido / custom vazio / não-membro');
} catch (e) { fail('3: rejeições', e); }

/* 4) sendSelective (texto) restringe o transporte */
(async () => {
  try {
    const relayed = [];
    let debugSeen = null;
    const sock = {
      user: { id: '5511900000000@s.whatsapp.net' },
      groupMetadata: async () => META,
      relayMessage: async (jid, message, opts) => {
        relayed.push({ jid, message, opts });
        if (typeof opts.onSelectiveDebug === 'function') {
          opts.onSelectiveDebug({ resolvedDevices: 4, senderKeyRecipients: 4, messageId: opts.messageId });
        }
        return opts.messageId;
      },
    };
    const summary = await selective.sendSelectiveTextMessage(sock, GROUP, 'oi', { mode: 'members' });
    assert.strictEqual(relayed.length, 1, 'uma única mensagem de grupo');
    assert.strictEqual(relayed[0].jid, GROUP, 'para o grupo');
    assert.deepStrictEqual(relayed[0].opts.selectiveParticipants, [C, D], 'selectiveParticipants = C+D');
    assert.strictEqual(relayed[0].opts.useCachedGroupMetadata, true, 'usa metadado em cache');
    assert.strictEqual(summary.mode, 'members', 'resumo.mode');
    assert.strictEqual(summary.originalParticipants, 4, 'resumo.originalParticipants');
    assert.deepStrictEqual(summary.selectedParticipants, [C, D], 'resumo.selectedParticipants');
    assert.strictEqual(summary.resolvedDevices, 4, 'resumo.resolvedDevices (do callback)');
    assert.strictEqual(summary.senderKeyRecipients, 4, 'resumo.senderKeyRecipients (do callback)');
    assert.ok(summary.messageId, 'resumo.messageId');
    assert.ok(
      relayed[0].message.extendedTextMessage && relayed[0].message.extendedTextMessage.text === 'oi',
      'conteúdo de texto preservado (extendedTextMessage)'
    );

    // admins
    await selective.sendSelectiveTextMessage(sock, GROUP, 'oi', { mode: 'admins' });
    assert.deepStrictEqual(relayed[1].opts.selectiveParticipants, [A, B], 'admins = A+B');

    // normal → sem selectiveParticipants (não restringe)
    await selective.sendSelectiveTextMessage(sock, GROUP, 'oi', { mode: 'normal' });
    assert.deepStrictEqual(relayed[2].opts.selectiveParticipants, [A, B, C, D], 'normal = todos (explícito)');
    ok('4: sendSelective (texto) — transporte restrito + resumo do debug');
  } catch (e) { fail('4: sendSelective texto', e); }

  /* 5) payment → requestPaymentMessage legítimo via generateWAMessage real */
  try {
    const { generateWAMessage } = selective.loadBaileys();
    const full = await generateWAMessage(GROUP, {
      payment: { amount: '1000', currency: 'BRL', note: 'TESTE SELETIVO LUA' },
    }, { userJid: '5511900000000@s.whatsapp.net', timestamp: new Date() });
    const rpm = full.message && full.message.requestPaymentMessage;
    assert.ok(rpm, 'requestPaymentMessage gerado');
    const amt = rpm.amount1000 && typeof rpm.amount1000.toNumber === 'function'
      ? rpm.amount1000.toNumber()
      : Number(rpm.amount1000);
    assert.ok(amt === 1000, `amount1000 preservado (fork não escala ×1000; veio ${amt})`);
    assert.strictEqual(rpm.currencyCodeIso4217, 'BRL', 'moeda BRL');
    assert.ok(rpm.noteMessage && rpm.noteMessage.extendedTextMessage && /TESTE SELETIVO/.test(rpm.noteMessage.extendedTextMessage.text || ''), 'note preservada');
    ok('5: payment → requestPaymentMessage legítimo (controle do payload)');
  } catch (e) { fail('5: payment payload', e); }

  /* 6) patch vendor presente */
  try {
    const p = path.join(__dirname, '..', 'vendor', 'boruto-vk7-baileys', 'lib', 'Socket', 'messages-send.js');
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(src.includes('selectiveParticipants'), 'relayMessage aceita selectiveParticipants');
    assert.ok(src.includes('onSelectiveDebug'), 'relayMessage expõe onSelectiveDebug');
    assert.ok(src.includes(': fullParticipantsList'), 'fallback preserva lista completa (caminho normal intacto)');
    ok('6: patch vendor presente (selectiveParticipants + fallback full list)');
  } catch (e) { fail('6: patch vendor', e); }

  /* 7) API anexada ao socket (sem substituí-lo) */
  try {
    const sock = { user: { id: 'x@s.whatsapp.net' }, existing: true };
    selective.attachToSocket(sock);
    assert.strictEqual(typeof sock.sendSelectivePaymentMessage, 'function', 'sendSelectivePaymentMessage anexado');
    assert.strictEqual(typeof sock.sendSelectiveTextMessage, 'function', 'sendSelectiveTextMessage anexado');
    assert.strictEqual(sock.existing, true, 'socket não substituído');
    ok('7: attachToSocket — API anexada sem substituir o socket');
  } catch (e) { fail('7: attachToSocket', e); }

  console.log(failures === 0 ? '\n=== SELECTIVE TEST: TUDO OK ===' : `\n=== SELECTIVE TEST: ${failures} falha(s) ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  failures++;
  console.error('❌ falha fatal:', e && e.message);
  console.log(`\n=== SELECTIVE TEST: ${failures} falha(s) ===`);
  process.exit(1);
});
