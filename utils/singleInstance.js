'use strict';

/**
 * utils/singleInstance.js — evita duplicar bot no Termux
 *
 * Cria um arquivo de lock em tmp/.lock com PID.
 * Se já existir e o PID ainda estiver vivo, aborta.
 * Limpa no shutdown.
 */

const fs = require('fs');
const path = require('path');
const CONFIG = require('../config');
const logger = require('./logger').child('instance');

const LOCK_FILE = path.join(CONFIG.paths.tmpDir, '.lock');

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function acquireLock() {
  try {
    fs.mkdirSync(CONFIG.paths.tmpDir, { recursive: true });
    if (fs.existsSync(LOCK_FILE)) {
      try {
        const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
        const pid = parseInt(content, 10);
        if (pid && isProcessAlive(pid) && pid !== process.pid) {
          logger.error({ existingPid: pid, currentPid: process.pid }, 'outra instância do bot já está rodando');
          console.error(`\n❌ Outra instância do bot já está rodando (PID ${pid})`);
          console.error(`   Se não estiver, remova manualmente: rm ${LOCK_FILE}`);
          console.error(`   Ou use: ./start.sh --force\n`);
          if (process.argv.includes('--force')) {
            console.log('⚠️  --force detectado, removendo lock antigo...');
            fs.rmSync(LOCK_FILE, { force: true });
          } else {
            process.exit(1);
          }
        } else {
          // lock obsoleto
          fs.rmSync(LOCK_FILE, { force: true });
        }
      } catch (_) {
        try { fs.rmSync(LOCK_FILE, { force: true }); } catch (_) {}
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    logger.info({ pid: process.pid, lock: LOCK_FILE }, 'lock adquirido');
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao adquirir lock, seguindo mesmo assim');
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
      if (parseInt(content, 10) === process.pid) {
        fs.rmSync(LOCK_FILE, { force: true });
        logger.info('lock liberado');
      }
    }
  } catch (_) {}
}

module.exports = {
  acquireLock,
  releaseLock,
  LOCK_FILE,
};
