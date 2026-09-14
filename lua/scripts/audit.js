/**
 * scripts/audit.js — auditoria automática do projeto.
 *
 * Verifica:
 *  - comandos carregados (sem comandos falsos)
 *  - execute() real em todo comando
 *  - triggers duplicados
 *  - categorias dos menus têm comandos
 *  - arquivos/caminhos referenciados existem
 *
 * Uso: node scripts/audit.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const CONFIG = require('../config');
CONFIG.helpers.ensureDirs();

const database = require('../database/database');
database.open();

const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

let failures = 0;
let checks = 0;

function check(ok, label, extra = '') {
  checks++;
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
}

console.log(`\n=== AUDITORIA LUA v${CONFIG.bot.version} ===\n`);

/* 1. comandos carregados */
check(registry.count() > 0, 'Comandos carregados', `${registry.count()} comandos`);

/* 2. todo comando tem execute() */
let withoutExecute = 0;
for (const cmd of registry.all()) {
  if (typeof cmd.execute !== 'function') withoutExecute++;
}
check(withoutExecute === 0, 'Todo comando tem execute() real', withoutExecute ? `${withoutExecute} inválidos` : '');

/* 3. triggers duplicados */
const seen = new Map();
let dup = 0;
for (const cmd of registry.all()) {
  for (const t of [...cmd.commands, ...(cmd.aliases || [])]) {
    if (seen.has(t) && seen.get(t) !== cmd.name) dup++;
    seen.set(t, cmd.name);
  }
}
check(dup === 0, 'Sem triggers duplicados', dup ? `${dup} duplicados` : '');

/* 4. categorias dos menus têm comandos (menus não listam categorias vazias) */
const menus = require('../menus/index');
const cats = registry.categories();
const menuCats = menus.map((m) => m.id);
for (const m of menus) {
  if (m.id === 'settings') continue; // menu de configurações é especial
  const has = cats.includes(m.id);
  check(has, `Menu "${m.id}" tem comandos`, has ? `${registry.byCategory().get(m.id).length}` : 'SEM COMANDOS');
}

/* 5. arquivos essenciais existem */
const requiredFiles = [
  'index.js',
  'config.js',
  'package.json',
  'connection/connect.js',
  'connection/pairing.js',
  'connection/sessionRecovery.js',
  'handlers/commandHandler.js',
  'handlers/buttonHandler.js',
  'handlers/groupHandler.js',
  'handlers/mediaHandler.js',
  'handlers/errorHandler.js',
  'database/database.js',
  'database/users.js',
  'database/groups.js',
  'database/economy.js',
  'database/rpg.js',
  'database/games.js',
  'database/settings.js',
  'engine/plugins.js',
  'utils/permissions.js',
  'utils/messages.js',
  'utils/menu.js',
  'menus/main.js',
];
for (const f of requiredFiles) {
  check(fs.existsSync(path.join(ROOT, f)), `Arquivo existe: ${f}`);
}

/* 6. diretórios base existem */
for (const d of ['commands', 'menus', 'handlers', 'database', 'connection', 'utils', 'assets', 'tmp']) {
  check(fs.existsSync(path.join(ROOT, d)), `Diretório existe: ${d}/`);
}

/* 7. menus/index.js tem função run real em cada entrada */
for (const m of menus) {
  check(typeof m.run === 'function', `Menu "${m.id}" tem run()`);
}

/* 8. resumo */
console.log(`\n=== RESULTADO: ${checks} verificações, ${failures} falha(s) ===\n`);

database.close();
process.exit(failures > 0 ? 1 : 0);
