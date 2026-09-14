/**
 * utils/logger.js — Logger estruturado (pino).
 *
 * - Registra: conexão, reconexão, comandos, erros, plugins, admin, download, banco.
 * - NUNCA registra: senha, token, credenciais, pairing code, conteúdo privado.
 * - Opcionalmente grava em logs/lua-YYYY-MM-DD.log.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const CONFIG = require('../config');

function todayLogFile() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(CONFIG.paths.logsDir, `lua-${y}-${m}-${day}.log`);
}

fs.mkdirSync(CONFIG.paths.logsDir, { recursive: true });

// limpeza automática de logs antigos (>7 dias) e limite de 50MB por arquivo
(function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(CONFIG.paths.logsDir);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    const maxSize = 50 * 1024 * 1024;
    for (const f of files) {
      if (!f.startsWith('lua-') || !f.endsWith('.log')) continue;
      const fp = path.join(CONFIG.paths.logsDir, f);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAge) {
          fs.rmSync(fp, { force: true });
        } else if (stat.size > maxSize) {
          // trunca arquivo grande mantendo últimas 1000 linhas
          const content = fs.readFileSync(fp, 'utf-8').split('\n');
          const keep = content.slice(-1000).join('\n');
          fs.writeFileSync(fp, keep);
        }
      } catch (_) {}
    }
  } catch (_) {}
})();

// Em modo interativo (LOG_QUIET=1), os logs JSON vão apenas para o arquivo,
// mantendo a interface de terminal limpa. Em servidores/não-TTY, segue no stdout.
const quiet = process.env.LOG_QUIET === '1';
const streams = quiet ? [] : [{ stream: process.stdout }];

let fileStream = null;
if (CONFIG.logging.toFile) {
  fileStream = fs.createWriteStream(todayLogFile(), { flags: 'a' });
  streams.push({ stream: fileStream });
}

if (streams.length === 0) streams.push({ stream: process.stdout });

const logger = pino(
  {
    level: CONFIG.logging.level,
    base: undefined, // remove pid/hostname
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'password',
        'token',
        'secret',
        'credential',
        'credentials',
        'session',
        'apiKey',
        'apikey',
      ],
      censor: '[REDACTED]',
    },
  },
  pino.multistream(streams)
);

/** Cria um logger filho com escopo de módulo. */
const _pinoChild = logger.child.bind(logger);
function child(moduleName) {
  return _pinoChild({ module: moduleName });
}

/** Último arquivo de log (usado pelo comando !logs). */
function currentLogFile() {
  return todayLogFile();
}

module.exports = logger;
module.exports.child = child;
module.exports.currentLogFile = currentLogFile;
