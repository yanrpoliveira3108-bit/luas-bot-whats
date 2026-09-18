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
    const finalRoot = path.join(AUTO_DIR, `backup_${ts}_${reason}`);
    // Estágio 1: monta tudo em <destino>.tmp. Enquanto não for validado, nenhum
    // consumidor enxerga o backup — e um backup incompleto nunca substitui um válido.
    const destRoot = `${finalRoot}.tmp`;
    fs.mkdirSync(destRoot, { recursive: true });

    let count = 0;

    // database
    if (fs.existsSync(CONFIG.paths.databaseFile)) {
      if (copyFileSafe(CONFIG.paths.databaseFile, path.join(destRoot, 'lua.db'))) count++;
    }
    // database dir (outros arquivos .db)
    if (fs.existsSync(CONFIG.paths.databaseDir)) {
      count += copyDirSafe(CONFIG.paths.databaseDir, path.join(destRoot, 'database'));
    }

    // .env (importante, mas sem expor no log)
    const envPath = path.join(CONFIG.paths.root, '.env');
    if (copyFileSafe(envPath, path.join(destRoot, '.env'))) count++;

    // session (apenas creds essenciais, não tudo)
    const sessionDir = CONFIG.paths.sessionDir;
    if (fs.existsSync(sessionDir)) {
      // copia só arquivos pequenos de creds, não cache grande
      const files = fs.readdirSync(sessionDir).slice(0, 20);
      const destSess = path.join(destRoot, 'session');
      fs.mkdirSync(destSess, { recursive: true });
      for (const f of files) {
        const src = path.join(sessionDir, f);
        try {
          const stat = fs.statSync(src);
          if (stat.isFile() && stat.size < 5 * 1024 * 1024) {
            fs.copyFileSync(src, destSess + '/' + f);
            count++;
          }
        } catch (_) {}
      }
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

    // Estágio 2: validação. Qualquer divergência descarta o staging.
    const problems = validateBackup(destRoot, count);
    if (problems.length) {
      logger.warn({ dest: destRoot, problems }, 'backup inválido — descartado');
      try { fs.rmSync(destRoot, { recursive: true, force: true }); } catch (_) {}
      return null;
    }

    // Estágio 3: rename atômico para o nome final.
    try {
      fs.renameSync(destRoot, finalRoot);
    } catch (err) {
      logger.warn({ err: err.message }, 'rename do backup falhou — staging removido');
      try { fs.rmSync(destRoot, { recursive: true, force: true }); } catch (_) {}
      return null;
    }

    logger.info({ dest: finalRoot, files: count, reason }, 'backup automático criado');

    // limpa backups antigos (mantém últimos 5) e stagings órfãos
    cleanupOldBackups();

    return finalRoot;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha no backup automático');
    return null;
  }
}

/**
 * Valida um staging antes do rename. Retorna lista de problemas (vazia = ok).
 * Não confia só no contador: confere tamanho real dos arquivos críticos.
 */
function validateBackup(dir, count) {
  const problems = [];
  if (!(count >= 1)) problems.push('nenhum arquivo copiado');

  let info = null;
  try { info = JSON.parse(fs.readFileSync(path.join(dir, 'info.json'), 'utf-8')); } catch (_) {}
  if (!info) problems.push('info.json ausente ou ilegível');
  else if (info.files !== count) problems.push(`info.json declara ${info.files} mas ${count} foram copiados`);

  const dbSrc = CONFIG.paths.databaseFile;
  if (fs.existsSync(dbSrc)) {
    const staged = path.join(dir, 'lua.db');
    const srcSize = (() => { try { return fs.statSync(dbSrc).size; } catch (_) { return -1; } })();
    const dstSize = (() => { try { return fs.statSync(staged).size; } catch (_) { return -1; } })();
    if (srcSize > 0 && dstSize !== srcSize) problems.push(`lua.db incompleto (${dstSize}/${srcSize} bytes)`);
  }

  const envSrc = path.join(CONFIG.paths.root, '.env');
  if (fs.existsSync(envSrc)) {
    const srcSize = (() => { try { return fs.statSync(envSrc).size; } catch (_) { return -1; } })();
    const dstSize = (() => { try { return fs.statSync(path.join(dir, '.env')).size; } catch (_) { return -1; } })();
    if (srcSize > 0 && dstSize !== srcSize) problems.push(`.env incompleto (${dstSize}/${srcSize} bytes)`);
  }

  return problems;
}

/** Remove stagings .tmp abandonados (crash no meio do backup). */
function sweepStaleTmp(maxAgeMs = 60 * 60 * 1000) {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(AUTO_DIR)) {
      if (!name.endsWith('.tmp')) continue;
      const full = path.join(AUTO_DIR, name);
      try {
        if (Date.now() - fs.statSync(full).mtimeMs > maxAgeMs) {
          fs.rmSync(full, { recursive: true, force: true });
          removed++;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return removed;
}

function cleanupOldBackups() {
  try {
    ensureDir();
    sweepStaleTmp();
    const dirs = fs.readdirSync(AUTO_DIR)
      .map((d) => ({ name: d, path: path.join(AUTO_DIR, d), stat: (() => { try { return fs.statSync(path.join(AUTO_DIR, d)); } catch (_) { return null; } })() }))
      .filter((x) => x.stat && x.stat.isDirectory() && !x.name.endsWith('.tmp'))
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
          // staging em andamento não é backup: nunca listar como disponível
          if (d.endsWith('.tmp')) return null;
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
  validateBackup,
  sweepStaleTmp,
  listBackups,
  startAutoBackup,
  stopAutoBackup,
  AUTO_DIR,
  MAX_BACKUPS,
};
