/**
 * test/command-reactions.test.js — o bot reage a cada comando com o emoji
 * temático do comando/categoria (utils/commandEmoji).
 *
 * Cobre:
 *   1) !ping reage com 🏓 (emoji do comando).
 *   2) a reação é exatamente commandEmoji(cmd) (wiring correto).
 *   3) diversidade: comandos diferentes → emojis diferentes.
 *   4) comando bloqueado pelo gate (admin p/ não-admin) → NÃO reage.
 *   5) CONFIG.ui.commandReactions=false → NÃO reage.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

process.env.OWNER_NUMBER = '5511999999999';
process.env.DATABASE_FILE = require('./dbtmp').tmpFile('lua-cmd-reactions-test.db');

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

const USER = '5511111111111@s.whatsapp.net'; // membro comum (não-admin)
const BOT = '5511000000000@s.whatsapp.net';
const G = '120363000050@g.us';

function makeSock(reactions, replies) {
  return {
    user: { id: BOT },
    groupMetadata: async () => ({ id: G, participants: [
      { id: USER, admin: null }, { id: BOT, admin: 'admin' },
    ] }),
    sendMessage: async (jid, c) => {
      if (c && c.react) reactions.push(c.react.text);
      if (c && c.text) replies.push(c.text);
      return { key: { id: 'k' } };
    },
    sendPresenceUpdate: async () => {},
  };
}

async function run(text, cmdName) {
  const reactions = [];
  const replies = [];
  const s = makeSock(reactions, replies);
  const handler = require('../handlers/commandHandler');
  const cooldown = require('../utils/cooldown');
  if (cmdName) {
    cooldown.reset('user', USER, cmdName);
    cooldown.reset('group', G, cmdName);
    cooldown.reset('global', '*', cmdName);
  }
  const msg = {
    key: { remoteJid: G, fromMe: false, id: 'M', participant: USER, participantAlt: USER },
    message: { conversation: text },
    pushName: 'U',
  };
  await handler.handleMessage(s, msg);
  return { reactions, replies };
}

async function main() {
  try { fs.rmSync(process.env.DATABASE_FILE, { force: true }); } catch (_) {}
  require('../database/database').open();
  require('../commands/loader').loadCommands(true);
  const { registry } = require('../engine/plugins');
  const { commandEmoji } = require('../utils/commandEmoji');

  /* 1) !ping reage com 🏓 */
  try {
    const r = await run('!ping', 'ping');
    assert.ok(r.reactions.includes('🏓'), 'reagiu com 🏓: ' + JSON.stringify(r.reactions));
    ok('1: !ping reage com o emoji temático 🏓');
  } catch (e) { fail('1', e); }

  /* 2) a reação é exatamente commandEmoji(cmd) */
  try {
    const cmd = registry.resolveTrigger('ping');
    const expected = commandEmoji(cmd);
    const r = await run('!ping', 'ping');
    assert.ok(r.reactions.includes(expected), `reagiu com ${expected}: ` + JSON.stringify(r.reactions));
    ok('2: reação = commandEmoji(cmd) → ' + expected);
  } catch (e) { fail('2', e); }

  /* 3) diversidade: comandos diferentes → emojis diferentes */
  try {
    const a = commandEmoji('ping');   // 🏓
    const b = commandEmoji('mute');   // 🔇
    const c = commandEmoji('kick');   // 👢
    assert.notStrictEqual(a, b, 'ping ≠ mute');
    assert.notStrictEqual(a, c, 'ping ≠ kick');
    assert.notStrictEqual(b, c, 'mute ≠ kick');
    ok(`3: diversidade — ping ${a} · mute ${b} · kick ${c}`);
  } catch (e) { fail('3', e); }

  /* 4) comando bloqueado pelo gate (admin p/ não-admin) → NÃO reage */
  try {
    const r = await run('!kick', 'kick');
    assert.strictEqual(r.reactions.length, 0, 'não reage em comando bloqueado: ' + JSON.stringify(r.reactions));
    ok('4: comando bloqueado pelo gate não reage');
  } catch (e) { fail('4', e); }

  /* 5) desativado → NÃO reage */
  try {
    const CONFIG = require('../config');
    const old = CONFIG.ui.commandReactions;
    CONFIG.ui.commandReactions = false;
    const r = await run('!ping', 'ping');
    CONFIG.ui.commandReactions = old;
    assert.strictEqual(r.reactions.length, 0, 'não reage quando desativado: ' + JSON.stringify(r.reactions));
    ok('5: commandReactions=false → não reage');
  } catch (e) { fail('5', e); }

  require('../database/database').close();
  if (failures) { console.error(`\n❌ CMD-REACTIONS TEST: ${failures} falha(s)`); process.exit(1); }
  console.log('\n=== CMD-REACTIONS TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
