/**
 * test/smoke.js — teste de fumaça (sem conexão WhatsApp).
 *
 * Valida: banco, economia (race), formatter, calculadora, cooldown,
 * mutex, validação de pairing e o motor de stickers (jimp/sharp).
 *
 * Uso: node test/smoke.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
process.chdir(path.resolve(__dirname, '..'));

// banco isolado para o teste (não usa o banco de produção)
const TEST_DB = path.resolve(__dirname, '..', 'database', 'lua-test.db');
process.env.DATABASE_FILE = TEST_DB;
for (const suf of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(TEST_DB + suf, { force: true });
  } catch (_) {}
}

const CONFIG = require('../config');
CONFIG.helpers.ensureDirs();

let pass = 0;
let fail = 0;
function t(ok, label, extra = '') {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${label}${extra ? ' — ' + extra : ''}`);
  if (ok) pass++;
  else fail++;
}

(async () => {
  console.log(`\n=== SMOKE TEST — Lua v${CONFIG.bot.version} ===\n`);

  /* ------------------------- banco ------------------------- */
  const db = require('../database/database');
  db.open();
  const users = require('../database/users');
  const economy = require('../database/economy');
  const rpg = require('../database/rpg');
  const groups = require('../database/groups');
  const games = require('../database/games');
  const blocked = require('../database/blocked');

  const testUser = '5511999990000@s.whatsapp.net';
  users.upsert(testUser, 'Teste');
  users.addXp(testUser, 500);
  const u = users.get(testUser);
  t(u && u.xp >= 500, 'users: upsert + XP');

  economy.addWallet(testUser, 1000);
  t(economy.get(testUser).wallet === 1000, 'economy: carteira 1000');
  economy.deposit(testUser, 400);
  t(economy.get(testUser).bank === 400, 'economy: depósito');
  try {
    economy.addWallet(testUser, -2000);
    t(false, 'economy: bloqueia saldo negativo');
  } catch (_) {
    t(true, 'economy: bloqueia saldo negativo');
  }

  // race condition: 20 depósitos concorrentes
  const { withLock } = require('../utils/keyedMutex');
  const raceUser = '5511888880000@s.whatsapp.net';
  await Promise.all(Array.from({ length: 20 }, () => withLock(raceUser, () => economy.addWallet(raceUser, 5))));
  t(economy.get(raceUser).wallet === 100, 'economy: race condition (20x5 = 100)', String(economy.get(raceUser).wallet));

  rpg.ensurePlayer(testUser);
  rpg.setProfession(testUser, 'Programador');
  t(rpg.getPlayer(testUser).profession === 'Programador', 'rpg: profissão');

  groups.ensure('120363000000000000@g.us', 'Teste');
  groups.addWarning('120363000000000000@g.us', testUser, 'motivo', 'admin');
  t(groups.countWarnings('120363000000000000@g.us', testUser) === 1, 'groups: advertência');

  const qcount = games.countQuizQuestions(null);
  t(qcount > 0, 'quiz: perguntas no banco', `${qcount} perguntas`);
  const cats = games.getQuizCategories();
  t(cats.length >= 6, 'quiz: categorias', cats.join(','));

  blocked.block(testUser, 'teste');
  t(blocked.isBlocked(testUser), 'blocked: bloquear');
  blocked.unblock(testUser);

  /* ------------------------- utils ------------------------- */
  const { formatMoney, formatDuration, parseDuration } = require('../utils/formatter');
  t(formatMoney(1234) === '🪙 1.234 LC', 'formatter: formatMoney', formatMoney(1234));
  t(formatDuration(65000) === '1m 5s', 'formatter: formatDuration', formatDuration(65000));
  t(parseDuration('2m') === 120000, 'formatter: parseDuration');

  // safeCalc não é exportado; testa via leitura do módulo
  const calcMod = require('fs').readFileSync(require.resolve('../commands/utility/calc.js'), 'utf8');
  t(calcMod.includes('function safeCalc'), 'calc: avaliador próprio (sem eval)');
  t(!/eval\(/.test(calcMod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')), 'calc: sem uso de eval()');

  const phoneParser = require('../connection/phoneParser');
  t(phoneParser.parsePhoneNumber('5511999999999', 'BR').valid, 'phone: número válido');
  t(!phoneParser.parsePhoneNumber('123').valid, 'phone: rejeita número curto');

  const cooldown = require('../utils/cooldown');
  const fakeCtx = { sender: testUser, isGroup: false, remoteJid: testUser };
  const fakeCmd = { name: 'ping', cooldown: 500 };
  t(cooldown.check(fakeCmd, fakeCtx).allowed, 'cooldown: permite primeiro uso');
  t(!cooldown.check(fakeCmd, fakeCtx).allowed, 'cooldown: bloqueia segundo uso');

  /* --------------------- motor de stickers --------------------- */
  const engine = require('../utils/stickerEngine');
  try {
    const webp = await engine.textToSticker('Lua Teste');
    const magic = webp.slice(0, 4).toString('ascii');
    t(magic === 'RIFF', 'sticker: textToSticker gera webp', `magic=${magic}`);
  } catch (err) {
    t(false, 'sticker: textToSticker', err.message);
  }

  const metadados = await engine.setStickerMetadata(Buffer.from('RIFFxxxxWEBP'), { packname: 'Lua', author: 'Dev' });
  t(Buffer.isBuffer(metadados), 'sticker: setStickerMetadata retorna buffer');

  /* --------------------- plugins/registry --------------------- */
  const { loadCommands } = require('../commands/loader');
  loadCommands(true);
  const { registry } = require('../engine/plugins');
  t(registry.count() > 0, 'registry: comandos registrados', `${registry.count()} comandos`);
  t(registry.resolveTrigger('ping') !== null, 'registry: resolve trigger "ping"');
  t(registry.resolveTrigger('menu') !== null, 'registry: resolve trigger "menu"');
  t(registry.resolveTrigger('prefixo') !== null, 'registry: resolve trigger "prefixo"');

  /* --------------------- registro de atividade --------------------- */
  const activity = require('../utils/activity');
  const line = activity.formatLine({
    t: Date.now(),
    jid: '5511999999999@s.whatsapp.net',
    isGroup: false,
    command: 'ping',
    args: [],
    prefix: '!',
    name: 'Dono',
  });
  t(/\[20\d\d-\d\d-\d\d \d\d:\d\d:\d\d\]/.test(line), 'activity: carimbo de data/hora', line);
  t(line.includes('!ping') && !line.includes('5511999999999'), 'activity: comando visível e número mascarado', line);

  /* --------------------- resultado --------------------- */
  console.log(`\n=== SMOKE: ${pass} passou, ${fail} falhou ===\n`);
  db.close();
  for (const suf of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(TEST_DB + suf, { force: true });
    } catch (_) {}
  }
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('ERRO no smoke test:', err);
  process.exit(1);
});
