/**
 * index.js — ponto de entrada do Lua.
 *
 * Fluxo:
 *   1. splash profissional no terminal
 *   2. configuração + diretórios
 *   3. banco de dados
 *   4. carregamento de comandos (plugins) e menus
 *   5. interface interativa de conexão (pairing code / restauração de sessão)
 */

'use strict';

// Detecta o modo interativo ANTES de carregar o logger:
// em terminal interativo, os logs JSON vão para o arquivo (terminal limpo).
// Usa tty.isatty() porque process.stdin.isTTY é undefined no Termux.
const terminal = require('./utils/terminal');
const INTERACTIVE = terminal.isInteractive() && !process.env.LUA_NO_UI;
if (INTERACTIVE) process.env.LOG_QUIET = '1';

// O libsignal (protocolo criptográfico usado pelo Baileys) escreve direto no
// console (console.warn/console.info) mensagens internas como
// "Closing open session in favor of incoming prekey bundle" e chega a
// despejar a sessão inteira (chaves) no terminal. Em modo interativo, filtra
// SOMENTE esse ruído — o restante do console (a UI) continua intacto.
if (INTERACTIVE) {
  const NOISE = /Closing open session|Closing session/i;
  const quiet = (orig) =>
    function (...args) {
      for (const a of args) {
        if (typeof a === 'string' && NOISE.test(a)) return;
      }
      return orig.apply(console, args);
    };
  for (const m of ['log', 'info', 'warn', 'debug']) {
    const orig = console[m].bind(console);
    console[m] = quiet(orig);
  }
}

const ui = require('./connection/connectionUI');
ui.splash();

const CONFIG = require('./config');
CONFIG.helpers.ensureDirs();
ui.ok('Configuração carregada');

// single instance lock (evita duplicar bot no Termux)
const singleInstance = require('./utils/singleInstance');
singleInstance.acquireLock();
ui.ok('Instância única verificada');

// ── validação do .env: nunca inicializar sem dono ──────────────────────
if (!CONFIG.owner.numbers.length) {
  console.error('ERRO: dono não configurado no .env');
  console.error('   Edite o .env e defina OWNER_NUMBER=5511999999999 (DDI+DDD+número).');
  console.error('   Para vários donos: OWNER_NUMBERS=5511999999999,5511988888888');
  process.exit(1);
}

const logger = require('./utils/logger');

// banco
const database = require('./database/database');
database.open();
ui.ok('Banco de dados conectado');

// resumo técnico do boot (stack + configuração efetiva)
const settings = require('./database/settings');
const BAILEYS_VERSION = require('@lucasmod/boruto-vk7-baileys/package.json').version;
console.log(`Baileys: @lucasmod/boruto-vk7-baileys@${BAILEYS_VERSION}`);
console.log(`Prefixo: ${CONFIG.bot.prefix}`);
console.log(`Owner: ${CONFIG.owner.numbers.length ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}`);
console.log(`Botões: ${settings.buttonsEnabled() ? 'ATIVADOS' : 'DESATIVADOS'}`);

// motores de download (YouTube) — aviso imediato se faltar yt-dlp/ffmpeg no Termux
const youtubeEngine = require('./downloaders/youtube');
console.log(`[MOTORES] yt-dlp: ${youtubeEngine.ytdlpAvailable() ? 'DISPONÍVEL ✔ (motor principal)' : 'AUSENTE ✘ (pkg install yt-dlp)'}`);
console.log(`[MOTORES] ffmpeg: ${youtubeEngine.ffmpegAvailable() ? 'DISPONÍVEL ✔ (mescla vídeo+áudio)' : 'AUSENTE ✘ (pkg install ffmpeg)'}`);

// comandos/plugins
const { loadCommands } = require('./commands/loader');
const { registry } = require('./engine/plugins');
loadCommands(true);
ui.ok('Plugins carregados');
ui.ok('Comandos carregados');
ui.ok('Menus carregados');
logger.info(`🌙 ${CONFIG.bot.name} v${CONFIG.bot.version} — ${registry.count()} comandos em ${registry.plugins.size} plugins`);
logger.info({ tag: 'BOOT' }, `[LUA][BOOT] Baileys: @lucasmod/boruto-vk7-baileys@${BAILEYS_VERSION}`);
logger.info({ tag: 'OWNER' }, '[LUA][OWNER] Owner carregado do .env');

// handlers
const commandHandler = require('./handlers/commandHandler');
const groupHandler = require('./handlers/groupHandler');
const connection = require('./connection/connect');
const { cleanupTmp } = require('./utils/download');
const autoBackup = require('./utils/autoBackup');
autoBackup.startAutoBackup();

// temporários órfãos (download/conversão interrompidos) + GC de estados de
// progresso/menus: nada pode ficar para sempre em tmp/ ou em memória
const tmpCleaner = require('./utils/tmpCleaner');
const progressMod = require('./utils/progress');
tmpCleaner
  .sweepOrphans()
  .then((r) => {
    if (r.removed) logger.info({ removed: r.removed, freedKB: Math.round(r.freedBytes / 1024) }, 'temporários órfãos limpos no boot');
  })
  .catch((err) => logger.warn({ err: err.message }, 'falha na limpeza de temporários'));
setInterval(() => {
  try {
    progressMod.sweep();
    tmpCleaner.sweepActive();
  } catch (_) {
    /* limpeza nunca derruba o bot */
  }
}, 10 * 60 * 1000).unref();

/* ------------------------- roteamento de eventos ------------------------ */

connection.onMessage((sock, messages) => {
  for (const msg of messages) {
    commandHandler.handleMessage(sock, msg).catch((err) => {
      logger.error({ err: err.message }, 'erro não tratado em mensagem');
    });
  }
});

connection.onGroupParticipants((sock, ev) => {
  groupHandler.handleGroupParticipants(sock, ev).catch((err) => {
    logger.error({ err: err.message }, 'erro em group-participants');
  });
});

connection.onGroupUpdate((sock, ev) => {
  groupHandler.handleGroupUpdate(sock, ev).catch((err) => {
    logger.error({ err: err.message }, 'erro em groups.update');
  });
});

/* --------------------------- limpeza de tmp ----------------------------- */

setInterval(() => {
  try {
    cleanupTmp(30 * 60 * 1000);
  } catch (_) {}
}, 15 * 60 * 1000).unref();

/* --------------------------- erros globais ------------------------------ */

process.on('unhandledRejection', (reason) => {
  logger.error({ err: (reason && reason.message) || String(reason) }, 'unhandledRejection');
});

process.on('uncaughtException', (err) => {
  // o bot NUNCA deve morrer por uma exceção não capturada
  logger.error({ err: err.message, stack: err.stack }, 'uncaughtException (ignorada)');
});

/* -------------------------- desligamento limpo -------------------------- */

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'desligando...');
  try {
    const autoBackup = require('./utils/autoBackup');
    autoBackup.stopAutoBackup();
  } catch (_) {}
  try {
    const singleInstance = require('./utils/singleInstance');
    singleInstance.releaseLock();
  } catch (_) {}
  try {
    await connection.shutdown();
  } catch (_) {}
  try {
    database.close();
  } catch (_) {}
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/* --------------------------- interface / conexão ------------------------ */

ui.ok('Sistema de conexão iniciado');
ui.run().catch((err) => {
  logger.error({ err: err.message }, 'erro na interface de terminal');
});
