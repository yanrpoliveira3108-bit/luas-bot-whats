/**
 * test/moderation.test.js — moderação de grupo ponta a ponta (socket fake).
 *
 * Cobre as regressões que deixavam "anti/mute/ADV só de decoração":
 *  1) MUTE: mensagem de usuário mutado é apagada (bot admin) e não é
 *     processada como comando; admin/dono ficam imunes.
 *  2) MUTE sem bot admin: mensagem bloqueada silenciosamente (sem crash).
 *  3) ADV: advertência persiste nos campos certos (group_id/user_id) e
 *     applyWarningFlow usa a assinatura (sock, groupJid, userJid, reason, adminId).
 *  4) ANTILINK: ponta a ponta via handleMessage (liga → link apagado).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-moderation-test.db');

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
  const groupHandler = require('../handlers/groupHandler');
  const groups = require('../database/groups');

  const GID = '551100000000@g.us';
  const BOT = '551188888888@s.whatsapp.net';
  const ADMIN = '5511999999999@s.whatsapp.net'; // dono + admin
  const MEMBER = '552277777777@s.whatsapp.net';

  const sent = [];
  const sock = {
    user: { id: BOT },
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: '3EB0' + 'A'.repeat(18), remoteJid: jid } };
    },
    sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({
      id: GID, subject: 'Grupo Teste', isCommunity: false,
      participants: [
        { id: BOT, admin: 'admin' },
        { id: ADMIN, admin: 'admin' },
        { id: MEMBER, admin: null },
      ],
    }),
  };

  const mkMsg = (from, message) => ({
    key: { remoteJid: GID, fromMe: false, participant: from, id: 'M' + Math.random().toString(36).slice(2) },
    message,
    pushName: from.split('@')[0],
  });

  groups.ensure(GID, 'Grupo Teste');

  /* 1) MUTE: membro mutado tem a mensagem apagada e não usa comando */
  try {
    groupHandler.muteUser(GID, MEMBER);
    assert.strictEqual(groupHandler.isMuted(GID, MEMBER), true, 'membro na lista de mutados');

    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(MEMBER, { conversation: '!ping' }));
    assert.strictEqual(sent.length, 1, 'exatamente uma ação (o delete)');
    assert.ok(sent[0].content.delete, 'mensagem do mutado foi apagada (delete)');
    assert.ok(!sent.some((s) => s.content.text && /Pong/.test(s.content.text)), 'comando do mutado NÃO executou');

    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(MEMBER, { conversation: 'oi gente' }));
    assert.strictEqual(sent.length, 1, 'mensagem de texto do mutado também apagada');
    assert.ok(sent[0].content.delete, 'delete enviado');
    groupHandler.unmuteUser(GID, MEMBER);
    ok('1: mute apaga e bloqueia o mutado');
  } catch (e) { fail('1: mute', e); }

  /* 2) MUTE: admin/dono são imunes */
  try {
    groupHandler.muteUser(GID, ADMIN);
    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(ADMIN, { conversation: '!ping' }));
    assert.ok(sent.some((s) => s.content.text && /Pong/.test(s.content.text)), 'admin mutado continua usando comando');
    assert.ok(!sent.some((s) => s.content.delete), 'mensagem do admin não é apagada');
    groupHandler.unmuteUser(GID, ADMIN);
    ok('2: admin imune ao mute');
  } catch (e) { fail('2: mute admin', e); }

  /* 3) MUTE sem bot admin: bloqueia silenciosamente, sem crash */
  try {
    const GID2 = '551100000001@g.us'; // id novo → evita cache de metadados
    groups.ensure(GID2, 'Grupo Teste 2');
    const sockNoAdmin = Object.assign({}, sock, {
      groupMetadata: async () => ({
        id: GID2, subject: 'Grupo Teste 2', isCommunity: false,
        participants: [
          { id: BOT, admin: null },
          { id: ADMIN, admin: 'admin' },
          { id: MEMBER, admin: null },
        ],
      }),
    });
    groupHandler.muteUser(GID2, MEMBER);
    sent.length = 0;
    await commandHandler.handleMessage(sockNoAdmin, {
      key: { remoteJid: GID2, fromMe: false, participant: MEMBER, id: 'M' + Math.random().toString(36).slice(2) },
      message: { conversation: 'oi' },
      pushName: 'Membro',
    });
    assert.strictEqual(sent.length, 0, 'sem bot admin: nada é enviado (bloqueio silencioso)');
    groupHandler.unmuteUser(GID2, MEMBER);
    ok('3: mute sem bot admin não derruba e bloqueia');
  } catch (e) { fail('3: mute sem admin', e); }

  /* 4) ADV: advertência persiste com group_id/user_id corretos */
  try {
    const r = await groupHandler.applyWarningFlow(sock, GID, MEMBER, 'flood', ADMIN);
    assert.strictEqual(r.count, 1, 'contagem retornada');
    const rows = groups.getWarnings(GID, MEMBER);
    assert.strictEqual(rows.length, 1, 'advertência persistida');
    assert.strictEqual(rows[0].group_id, GID, 'group_id correto (não o usuário)');
    assert.strictEqual(rows[0].user_id, MEMBER, 'user_id correto (não o motivo)');
    assert.strictEqual(rows[0].reason, 'flood', 'motivo correto (não o admin)');
    assert.strictEqual(rows[0].admin_id, ADMIN, 'admin_id correto');
    ok('4: adv persiste nos campos certos');
  } catch (e) { fail('4: adv', e); }

  /* 5) ADV ponta a ponta: !adv @membro grava no banco */
  try {
    sent.length = 0;
    await commandHandler.handleMessage(sock, {
      key: { remoteJid: GID, fromMe: false, participant: ADMIN, id: 'M' + Math.random().toString(36).slice(2) },
      message: { extendedTextMessage: { text: `!adv @${MEMBER.split('@')[0]} repetição`, contextInfo: { mentionedJid: [MEMBER] } } },
      pushName: 'Owner',
    });
    assert.ok(sent.some((s) => s.content.text && /Advertência aplicada/.test(s.content.text)), 'resposta de confirmação');
    assert.strictEqual(groups.countWarnings(GID, MEMBER), 2, 'warning contado após o comando');
    ok('5: !adv grava e confirma');
  } catch (e) { fail('5: !adv', e); }

  /* 6) ANTILINK ponta a ponta: liga → link de membro é apagado */
  try {
    groups.updateFilter(GID, 'antilink', true);
    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(ADMIN, { conversation: '!antilink on' }));
    assert.ok(sent.some((s) => s.content.text && /Anti-link ligado/.test(s.content.text)), '!antilink on confirma');
    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(MEMBER, { conversation: 'vejam https://exemplo.com' }));
    assert.ok(sent.some((s) => s.content.delete), 'link do membro apagado');
    assert.strictEqual(sent.length, 1, 'somente o delete, sem processar o link');
    ok('6: antilink ponta a ponta');
  } catch (e) { fail('6: antilink', e); }

  database.close();
  if (failures) {
    console.error(`\n❌ MODERATION TEST: ${failures} falha(s)`);
    process.exit(1);
  }
  console.log('\n=== MODERATION TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
