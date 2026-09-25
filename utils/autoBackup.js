'use strict';

/**
 * utils/autoBackup.js — backup automático de banco, .env, session, etc
 *
 * - Roda a cada 6h e no shutdown
 * - Guarda últimos 5 backups em backup/auto/
 * - Nunca inclui node_modules, tmp, logs grandes
 * - Loga sem expor segredos
 */

const fs = require('fs');
const path = require('path');
const CONFIG = require('../config');
const logger = require('./logger').child('backup');

const AUTO_DIR = path.join(CONFIG.paths.backupDir, 'auto');
const MAX_BACKUPS = 5;
const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

function ensureDir() {
  fs.mkdirSync(AUTO_DIR, { recursive: true });
}

function timestamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}_${h}-${min}`;
}

function copyFileSafe(src, dest) {
  try {
    if (!fs.existsSync(src)) return false;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) return false;
    if (stat.size > 100 * 1024 * 1024) return false; // não copia arquivos >100MB
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return true;
  } catch (_) {
    return false;
  }
}

function copyDirSafe(srcDir, destDir, maxFiles = 100) {
  try {
    if (!fs.existsSync(srcDir)) return 0;
    fs.mkdirSync(destDir, { recursive: true });
    const files = fs.readdirSync(srcDir);
    let copied = 0;
    for (const f of files.slice(0, maxFiles)) {
      if (f.startsWith('.')) continue;
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      try {
        const stat = fs.statSync(src);
        if (stat.isFile() && stat.size < 20 * 1024 * 1024) {
          fs.copyFileSync(src, dest);
          copied++;
        }
      } catch (_) {}
    }
    return copied;
  } catch (_) {
    return 0;
  }
}

function doBackup(reason = 'auto') {
  try {
    ensureDir();
    const ts = timestamp();
    const destRoot = path.join(AUTO_DIR, `backup_${ts}_${reason}`);
    fs.mkdirSync(destRoot, { recursive: true });

    let count = 0;

    // database com checkpoint WAL preventivo para garantir consistência
    try {
      const dbModule = require('../database/database');
      const dbc = dbModule.get();
      if (dbc) dbc.pragma('wal_checkpoint(TRUNCATE)');
    } catch (_) {}

    if (fs.existsSync(CONFIG.paths.databaseFile)) {
      if (copyFileSafe(CONFIG.paths.databaseFile, path.join(destRoot, 'lua.db'))) count++;
    }
    // database dir (outros arquivos .db)
    if (fs.existsSync(CONFIG.paths.databaseDir)) {
      count += copyDirSafe(CONFIG.paths.databaseDir, path.join(destRoot, 'database'));
    }

    // config.js e settings
    copyFileSafe(path.join(CONFIG.paths.root, 'config.js'), path.join(destRoot, 'config.js'));

    // assets/menu.jpg
    copyFileSafe(CONFIG.paths.menuImage, path.join(destRoot, 'menu.jpg'));

    // salva info
    const info = {
      timestamp: new Date().toISOString(),
      reason,
      files: count,
      botVersion: CONFIG.bot.version,
    };
    fs.writeFileSync(path.join(destRoot, 'info.json'), JSON.stringify(info, null, 2));

    logger.info({ dest: destRoot, files: count, reason }, 'backup automático criado');

    // limpa backups antigos (mantém últimos 5)
    cleanupOldBackups();

    return destRoot;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha no backup automático');
    return null;
  }
}

function cleanupOldBackups() {
  try {
    ensureDir();
    const dirs = fs.readdirSync(AUTO_DIR)
      .map((d) => ({ name: d, path: path.join(AUTO_DIR, d), stat: (() => { try { return fs.statSync(path.join(AUTO_DIR, d)); } catch (_) { return null; } })() }))
      .filter((x) => x.stat && x.stat.isDirectory())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (dirs.length > MAX_BACKUPS) {
      for (const old of dirs.slice(MAX_BACKUPS)) {
        try {
          fs.rmSync(old.path, { recursive: true, force: true });
          logger.info({ old: old.name }, 'backup antigo removido');
        } catch (_) {}
      }
    }
  } catch (_) {}
}

function listBackups() {
  try {
    ensureDir();
    const dirs = fs.readdirSync(AUTO_DIR)
      .map((d) => {
        const p = path.join(AUTO_DIR, d);
        try {
          const stat = fs.statSync(p);
          if (!stat.isDirectory()) return null;
          const infoPath = path.join(p, 'info.json');
          let info = {};
          if (fs.existsSync(infoPath)) {
            try { info = JSON.parse(fs.readFileSync(infoPath, 'utf-8')); } catch (_) {}
          }
          return { name: d, path: p, mtime: stat.mtime, size: 0, info };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    return dirs;
  } catch (_) {
    return [];
  }
}

let interval = null;

function startAutoBackup() {
  if (interval) return;
  ensureDir();
  // primeiro backup 10 min após iniciar
  setTimeout(() => doBackup('startup'), 10 * 60 * 1000);
  interval = setInterval(() => doBackup('interval'), INTERVAL_MS);
  logger.info({ intervalH: INTERVAL_MS / 3600000 }, 'auto backup iniciado');
}

function stopAutoBackup() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  // backup no shutdown
  doBackup('shutdown');
}

module.exports = {
  doBackup,
  listBackups,
  startAutoBackup,
  stopAutoBackup,
  AUTO_DIR,
};
