/**
 * connection/sessionRecovery.js — restauração e recuperação de sessão.
 *
 * - verifica/valida a pasta de sessão
 * - faz backup periódico do creds.json
 * - trata logout (remove credenciais invalidadas para permitir novo pairing)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const CONFIG = require('../config');
const logger = require('../utils/logger').child('session');

function credsFile() {
  return path.join(CONFIG.paths.sessionDir, 'creds.json');
}

/** A sessão existe e está registrada? */
function hasRegisteredSession() {
  try {
    if (!fs.existsSync(credsFile())) return false;
    const creds = JSON.parse(fs.readFileSync(credsFile(), 'utf8'));
    return !!(creds && creds.registered && creds.me);
  } catch (_) {
    return false;
  }
}

/** Backup do creds.json para a pasta backup/ (sem logar conteúdo). */
async function backupCreds() {
  try {
    if (!fs.existsSync(credsFile())) return null;
    const dest = path.join(CONFIG.paths.backupDir, `creds-backup-${Date.now()}.json`);
    fs.copyFileSync(credsFile(), dest);
    // mantém apenas os 5 backups mais recentes
    const files = fs
      .readdirSync(CONFIG.paths.backupDir)
      .filter((f) => f.startsWith('creds-backup-'))
      .sort();
    while (files.length > 5) {
      fs.unlinkSync(path.join(CONFIG.paths.backupDir, files.shift()));
    }
    logger.info('backup de credenciais criado');
    return dest;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao criar backup de credenciais');
    return null;
  }
}

/** Remove credenciais invalidadas após logout (permite novo pairing). */
async function handleLogout() {
  try {
    for (const f of ['creds.json', 'creds.json.bak']) {
      const p = path.join(CONFIG.paths.sessionDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    logger.warn('credenciais removidas após logout — será necessário novo pairing code');
  } catch (err) {
    logger.error({ err: err.message }, 'falha ao remover credenciais invalidadas');
  }
}

module.exports = { hasRegisteredSession, backupCreds, handleLogout, credsFile };
