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

// Diretório temporário UTILIZÁVEL antes de qualquer coisa do Baileys: no
// Android/Termux o padrão do Node (/tmp) pode não existir e TODO envio de
// mídia (ou seja: todo download) falha com ENOENT. Ver utils/tmpdir.js.
try {
  const tmp = require('./utils/tmpdir').ensureTmpDir(CONFIG.paths.tmpDir);
  if (tmp.changed) console.log(`⚠️  TMPDIR ajustado: ${tmp.motivo}`);
} catch (_) {
  /* nunca impede o boot */
}

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
console.log(
  `[MOTORES] yt-dlp: ${
    youtubeEngine.ytdlpAvailable()
      ? 'DISPONÍVEL ✔ (motor principal do YouTube)'
      : 'AUSENTE ✘ → pkg install python && pip install -U yt-dlp'
  }`
);
console.log(
  `[MOTORES] ffmpeg: ${
    youtubeEngine.ffmpegAvailable()
      ? 'DISPONÍVEL ✔ (mescla vídeo+áudio e converte)'
      : 'AUSENTE ✘ → pkg install ffmpeg'
  }`
);
if (!youtubeEngine.ytdlpAvailable()) {
  console.log('[MOTORES] Sem yt-dlp, o YouTube usa o motor reserva (ytdl-core), que hoje costuma falhar');
  console.log('[MOTORES] com "Sign in to confirm you are not a bot". Rode: node scripts/downloads-doctor.js');
}

// comandos/plugins
const { loadCommands } = require('./commands/loader');
const { registry } = require('./engine/plugins');
loadCommands(true);
ui.ok('Plugins carregados');
ui.ok('Comandos carregados');
ui.ok('Menus carregados');
logger.info(`🌙 ${CONFIG.bot.name} v${CONFIG.bot.version} — ${registry.count()} comandos em ${registry.plugins.size} plugins`);
logger.info({ tag: 'BOOT' }, `[LUA][BOOT] Baileys: @lucasmod/boruto-vk7-baileys@${BAILEYS_VERSION}`);
// QUAL CÓDIGO ESTE PROCESSO CARREGOU. O doctor compara com o disco e diz se
// falta reiniciar (o `git pull` muda o disco, não o processo em execução — foi
// exatamente o que confundiu em 25/09/2026). Ver utils/buildInfo.js.
try {
  const info = require('./utils/buildInfo');
  const marca = info.assinatura();
  logger.info(
    { tag: 'BOOT', rev: marca.rev, mtimeMs: marca.mtimeMs },
    `[LUA][BOOT] código carregado: ${marca.rev || 'sem git'}`
  );
  ui.ok(`Código no ar: ${marca.rev || 'sem git'}`);
} catch (_) {
  /* nunca impede o boot */
}
logger.info({ tag: 'OWNER' }, '[LUA][OWNER] Owner carregado do .env');

// handlers
const commandHandler = require('./handlers/commandHandler');
const groupHandler = require('./handlers/groupHandler');
const eventHandler = require('./handlers/eventHandler');
const janitor = require('./utils/janitor');
const autobot = require('./utils/autobot');
const sendGuard = require('./utils/sendGuard');
const safety = require('./utils/safety');
const connection = require('./connection/connect');
const { cleanupTmp } = require('./utils/download');
const autoBackup = require('./utils/autoBackup');
autoBackup.startAutoBackup();

/* ------------------------- roteamento de eventos ------------------------ */

connection.onMessage((sock, messages, type) => {
  for (const msg of messages) {
    // Freio de envio: saber QUEM falou com o bot é o que autoriza responder no
    // privado. Sem isso, o freio trata o PV como "conversa fria" e não deixa o
    // bot iniciar conversa com estranho (gatilho clássico de restrição).
    try {
      if (msg && msg.key && msg.key.remoteJid) sendGuard.noteInbound(msg.key.remoteJid);
    } catch (_) {
      /* o freio nunca pode atrapalhar o pipeline */
    }
    commandHandler.handleMessage(sock, msg, type).catch((err) => {
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

// Eventos usados pelos antis que não podem ser decididos pela mensagem:
// edição/revogação (anti editar/apagar), reação (anti reação) e chamada.
connection.onMessageUpdate((sock, updates) => {
  eventHandler.handleMessageUpdate(sock, updates).catch((err) => {
    logger.error({ err: err.message }, 'erro em messages.update');
  });
});

connection.onReaction((sock, reactions) => {
  eventHandler.handleReactions(sock, reactions).catch((err) => {
    logger.error({ err: err.message }, 'erro em messages.reaction');
  });
});

connection.onCall((sock, calls) => {
  eventHandler.handleCalls(sock, calls).catch((err) => {
    logger.error({ err: err.message }, 'erro em call');
  });
});

/* ---------------------- AutoBot + faxina de memória ---------------------- */

// Cria as chaves padrão dos recursos globais e garante que o núcleo do
// AutoBot está carregado antes de qualquer mensagem chegar.
autobot.boot();
ui.ok(`AutoBot pronto (${autobot.FEATURES.length} recursos)`);

// Freio de envio: fila + intervalo + teto por minuto + pausa automática.
// O attach() acontece em connection/connect.js (assim que o socket nasce);
// aqui só carregamos o estado (warmup, chats conhecidos, contadores).
const guardStats = sendGuard.init();
const policy = safety.summary();
ui.ok(
  `Freio de envio ativo — ${guardStats.limits.maxPerMinute} msg/min ` +
    `(${guardStats.limits.chatMaxPerMinute}/min por conversa)`
);
if (guardStats.warmup.active) {
  console.log(
    `   ⚠️  WARMUP: número em aquecimento — limites ÷${guardStats.warmup.factor} por mais ` +
      `${guardStats.warmup.remainingHours}h (definido em ${guardStats.warmup.since}).`
  );
}
if (policy.safeMode) {
  console.log('   🛡️  MODO SEGURO ligado: sem cards HTML, sem menu por lista/botões e sem pagamento.');
} else {
  console.log('   🖼️  Cards HTML e menu por botões ATIVOS (padrão). Para bloquear: !freio seguro on');
}

// UM timer para todas as limpezas de memória (utils/janitor).
janitor.start();

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
