/**
 * test/fotomenubot.test.js — !fotomenubot (troca o cabeçalho dos menus).
 *
 * Roda contra caminhos temporários (CONFIG é sobrescrito ANTES do loadCommands,
 * porque o módulo captura o diretório de backup no require). Assim o teste não
 * encosta no assets/menu.jpg real.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-fotomenu.db');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const CONFIG = require('../config');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lua-fotomenu-'));
const MENU_FILE = path.join(TMP, 'menu.jpg');
// sobrescreve ANTES de carregar os comandos (BACKUP_DIR é capturado no require)
CONFIG.paths.backupDir = path.join(TMP, 'backup');
CONFIG.menu.images.main = MENU_FILE;

const database = require('../database/database');
database.open();
const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

const Jimp = require('jimp');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

function fakeCtx(overrides = {}) {
  const replies = [];
  return Object.assign(
    {
      args: [],
      prefix: '!',
      remoteJid: '5511999999999@s.whatsapp.net',
      sender: '5511999999999@s.whatsapp.net',
      isOwner: true,
      replies,
      reply: async (t) => {
        replies.push(String(t));
        return true;
      },
      downloadMedia: async () => null,
      socket: { user: { id: 'bot@s.whatsapp.net' }, sendMessage: async () => ({ key: { id: 'K' } }) },
      message: { key: { id: 'M' }, message: {} },
    },
    overrides
  );
}

async function pngBuffer(w, h, color) {
  const img = new Jimp(w, h, color);
  return img.getBufferAsync(Jimp.MIME_PNG);
}

(async () => {
  const cmd = registry.resolveTrigger('fotomenubot');
  assert.ok(cmd, '!fotomenubot registrado');
  assert.strictEqual(cmd.ownerOnly, true, 'só o dono troca a imagem do menu');
  assert.ok(registry.resolveTrigger('menufoto'), 'alias !menufoto');

  // ---- 1) sem mídia: mostra o estado e as chaves
  const c1 = fakeCtx();
  await cmd.execute(c1);
  const t1 = c1.replies.join('\n');
  assert.match(t1, /Imagens do menu/, 'lista as imagens');
  for (const key of ['main', 'admin', 'sticker', 'life', 'download', 'profile']) {
    assert.ok(t1.includes(key), `chave ${key} aparece no status`);
  }
  assert.match(t1, /fotomenubot reset/, 'ensina o reset');
  ok('!fotomenubot: sem mídia lista as 6 chaves com tamanho e nº de backups');

  // ---- 2) chave inválida
  const c2 = fakeCtx({ downloadMedia: async () => ({ type: 'image', buffer: await pngBuffer(64, 64, 0xff0000ff) }) , args: ['naoexiste'] });
  await cmd.execute(c2);
  assert.match(c2.replies.join('\n'), /não existe/, 'chave inválida recusada');
  assert.ok(!fs.existsSync(MENU_FILE), 'não grava nada com chave inválida');
  ok('!fotomenubot: chave inválida é recusada sem gravar arquivo');

  // ---- 3) imagem válida: grava JPEG de verdade no caminho da chave
  const first = await pngBuffer(640, 360, 0x00ff00ff);
  const c3 = fakeCtx({ downloadMedia: async () => ({ type: 'image', buffer: first }) });
  await cmd.execute(c3);
  const t3 = c3.replies.join('\n');
  assert.ok(fs.existsSync(MENU_FILE), 'arquivo gravado');
  const magic = fs.readFileSync(MENU_FILE).slice(0, 2);
  assert.strictEqual(magic[0], 0xff, 'assinatura JPEG (0xFF…)');
  assert.strictEqual(magic[1], 0xd8, 'assinatura JPEG (…0xD8)');
  assert.match(t3, /Cabeçalho do menu atualizado/, 'confirma');
  assert.match(t3, /640x360/, 'informa as dimensões');
  assert.match(t3, /não havia imagem anterior/, 'primeira vez não inventa backup');
  ok('!fotomenubot: converte e grava JPEG real (640x360) no assets da chave');

  // ---- 4) trocar de novo cria backup do anterior
  const sizeBefore = fs.statSync(MENU_FILE).size;
  const second = await pngBuffer(300, 300, 0x0000ffff);
  const c4 = fakeCtx({ downloadMedia: async () => ({ type: 'image', buffer: second }) });
  await cmd.execute(c4);
  const t4 = c4.replies.join('\n');
  assert.match(t4, /Backup: backup\/menu\/main-.*\.jpg/, 'informa o backup criado');
  const backups = fs.readdirSync(path.join(CONFIG.paths.backupDir, 'menu')).filter((f) => f.startsWith('main-'));
  assert.strictEqual(backups.length, 1, `1 backup, vieram ${backups.length}`);
  assert.strictEqual(fs.statSync(path.join(CONFIG.paths.backupDir, 'menu', backups[0])).size, sizeBefore, 'backup é a imagem anterior');
  ok('!fotomenubot: sobrescrever guarda a imagem anterior em backup/menu/');

  // ---- 5) reset restaura
  const c5 = fakeCtx({ args: ['reset'] });
  await cmd.execute(c5);
  assert.match(c5.replies.join('\n'), /restaurado/, 'confirma o restore');
  assert.strictEqual(fs.statSync(MENU_FILE).size, sizeBefore, 'arquivo voltou ao tamanho anterior');
  ok('!fotomenubot reset: restaura o backup mais recente');

  // ---- 6) buffer corrompido não vira cabeçalho quebrado
  const antesDoCorrompido = fs.statSync(MENU_FILE).size;
  const c6 = fakeCtx({ downloadMedia: async () => ({ type: 'image', buffer: Buffer.from('isso não é imagem') }) });
  await cmd.execute(c6);
  assert.match(c6.replies.join('\n'), /Não reconheci essa imagem/, 'rejeita imagem inválida');
  assert.strictEqual(fs.statSync(MENU_FILE).size, antesDoCorrompido, 'arquivo intacto após falha');
  ok('!fotomenubot: imagem inválida é rejeitada e o arquivo atual permanece intacto');

  // ---- 7) limite de tamanho
  const c7 = fakeCtx({ downloadMedia: async () => ({ type: 'image', buffer: Buffer.alloc(9 * 1024 * 1024) }) });
  await cmd.execute(c7);
  assert.match(c7.replies.join('\n'), /grande demais/, 'rejeita acima de 8 MB');
  ok('!fotomenubot: recusa imagem acima de 8 MB');

  database.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
  }
  console.log(`\n✅ fotomenubot: ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ fotomenubot: ${err.stack || err.message}`);
  process.exit(1);
});
