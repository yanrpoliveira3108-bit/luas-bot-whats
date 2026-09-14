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

/* 8. todo trigger/alias resolve para o comando certo */
let badResolve = 0;
for (const cmd of registry.all()) {
  for (const t of [...cmd.commands, ...(cmd.aliases || [])]) {
    if (registry.resolveTrigger(t) !== cmd) badResolve++;
  }
}
check(badResolve === 0, 'Todos os triggers/aliases resolvem', badResolve ? `${badResolve} quebrados` : '');

/* 9. atalhos de menu (Parte 2) estão registrados */
const menuTriggers = [
  'menu', 'menucompleto', 'menudono', 'menuowner', 'menuadm', 'menuadmin',
  'menusticker', 'menudownload', 'menurpg', 'menulife', 'menuia', 'menuanime',
  'menugames', 'menuzoeira', 'menuutil', 'menumembros', 'menumedia', 'menuautomod',
];
const missingMenus = menuTriggers.filter((n) => !registry.resolveTrigger(n));
check(missingMenus.length === 0, 'Todos os atalhos de menu existem', missingMenus.length ? `faltando: ${missingMenus.join(', ')}` : '');

/* 10. downloaders carregam sem exceção */
let dlFail = 0;
for (const name of ['youtube', 'tiktok', 'instagram', 'facebook', 'pinterest', 'twitter', 'reddit', 'router', 'social']) {
  try {
    require(`../downloaders/${name}`);
  } catch (e) {
    dlFail++;
    console.log(`   downloader "${name}" falhou: ${e.message.split('\n')[0]}`);
  }
}
check(dlFail === 0, 'Todos os downloaders carregam', dlFail ? `${dlFail} quebrados` : '');

/* 11. camada central de permissões exporta as checagens */
const perms = require('../utils/permissions');
let permFail = 0;
for (const fn of ['isOwner', 'isAdmin', 'isBotAdmin', 'isGroup', 'isPrivate', 'isRegistered', 'getRole']) {
  if (typeof perms[fn] !== 'function') { permFail++; console.log(`   permissions.${fn} ausente`); }
}
check(permFail === 0, 'Camada de permissões completa (utils/permissions)', '');

/* 12. dono configurado via .env (NUNCA imprime o número) */
check(CONFIG.owner.numbers.length > 0, 'Dono configurado via .env', `${CONFIG.owner.numbers.length} dono(s)`);

/* 13. nenhum comando foi ignorado no load (trigger/alias duplicado) */
const skipped = registry.skippedCommands();
if (skipped.length) {
  for (const s of skipped) {
    console.log(`   ❌ "${s.name}" (plugin ${s.plugin}) — ${s.reason}`);
  }
}
check(skipped.length === 0, 'Nenhum comando ignorado no load', skipped.length ? `${skipped.length} ignorado(s)` : '');

/* resumo final */
console.log(`\n=== RESULTADO: ${checks} verificações, ${failures} falha(s) ===\n`);

database.close();
process.exit(failures > 0 ? 1 : 0);
