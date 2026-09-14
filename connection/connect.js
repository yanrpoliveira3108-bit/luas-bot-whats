/**
 * connection/connect.js — conexão principal do Lua (Baileys).
 *
 * - usa EXCLUSIVAMENTE pairing code (QR desabilitado)
 * - restaura sessão automaticamente (creds persistidas)
 * - reconexão automática com backoff (apenas quando há sessão registrada)
 * - proteção contra múltiplas conexões simultâneas
 * - eventos de status para a interface de terminal (connectionUI)
 * - nunca imprime credenciais
 * - erros de conexão do Baileys são gravados em logs/baileys-*.log (observáveis)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
} = require('@lucasmod/boruto-vk7-baileys');
const pino = require('pino');
const CONFIG = require('../config');
const logger = require('../utils/logger').child('connection');
const activity = require('../utils/activity');
const pairing = require('./pairing');
const sessionRecovery = require('./sessionRecovery');

let sock = null;
let connecting = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let shutdownRequested = false;
let skipCloseHandling = false;
let sessionWasRegistered = false;
let loggedOutDetected = false; // trava: impede reconexão após logout real
let pairingCodeRequested = false; // true após gerar o código (reconexão NÃO re-gera)
let pendingPhone = null;      // número para re-tentar pairing (se necessário)
let currentPhoneDigits = null;
let lastCloseReason = null;

// Limite de tentativas AUTOMÁTICAS de reconexão. Após esgotar, para de
// tentar sozinho e avisa (evita o loop infinito "reconectando...").
const MAX_RECONNECT_ATTEMPTS = 8;

const listeners = { message: null, groupParticipants: null, groupUpdate: null };
const statusListeners = new Set();

/* --------------------------- eventos de status ----------------------- */

function emitStatus(ev) {
  for (const fn of statusListeners) {
    try {
      fn(ev);
    } catch (_) {
      /* listener não pode derrubar a conexão */
    }
  }
}

/** Registra um listener de status. Retorna função de unsubscribe. */
function setStatusListener(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/* ------------------------- logger do Baileys ------------------------- */

// O Baileys NÃO pode ficar em 'silent': erros de handshake/stream precisam
// ser observáveis. Aqui os logs dele vão para logs/baileys-YYYY-MM-DD.log
// (terminal continua limpo). Nível via BAILEYS_LOG_LEVEL (padrão: warn).
// Com LUA_DEBUG_CONN=1 os logs também aparecem no terminal (diagnóstico).
let _baileysLogger = null;
function baileysLogger() {
  if (_baileysLogger) return _baileysLogger;
  fs.mkdirSync(CONFIG.paths.logsDir, { recursive: true });
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const file = path.join(CONFIG.paths.logsDir, `baileys-${y}-${m}-${day}.log`);
  const level = process.env.BAILEYS_LOG_LEVEL || 'warn';
  // fs.createWriteStream (mesmo padrão do logger do projeto): sem o
  // comportamento "sonic boom is not ready yet" do pino.destination
  // em saídas rápidas do processo.
  const streams = [{ stream: fs.createWriteStream(file, { flags: 'a' }) }];
  if (process.env.LUA_DEBUG_CONN === '1') {
    streams.push({ stream: process.stdout, level: 'debug' });
  }
  _baileysLogger = pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: ['password', 'token', 'secret', 'credential', 'credentials', 'noiseKey', 'signalIdentities'],
        censor: '[REDACTED]',
      },
    },
    pino.multistream(streams)
  );
  return _baileysLogger;
}

/* ------------------------------ listeners ---------------------------- */

function onMessage(fn) {
  listeners.message = fn;
}
function onGroupParticipants(fn) {
  listeners.groupParticipants = fn;
}
function onGroupUpdate(fn) {
  listeners.groupUpdate = fn;
}

/* ------------------------------ getters ------------------------------ */

function getSocket() {
  return sock;
}

function isConnected() {
  return !!(sock && sock.user && sock.ws && sock.ws.readyState === 1);
}

function markShutdown() {
  shutdownRequested = true;
}

function isShutdownRequested() {
  return shutdownRequested;
}

function resetReconnect() {
  reconnectAttempts = 0;
}

function phoneDigitsFromJid(jid) {
  const s = String(jid || '').split(':')[0].split('@')[0];
  return /\d/.test(s) ? s : null;
}

/** Estado atual da conexão (para a UI). */
function getStatus() {
  const jid = (sock && sock.user && sock.user.id) || null;
  return {
    connected: isConnected(),
    jid,
    phoneDigits: jid ? phoneDigitsFromJid(jid) : currentPhoneDigits,
    lastReason: lastCloseReason,
  };
}

/* ------------------------------ conexão ------------------------------ */

/**
 * Encerra o socket anterior (se houver) ANTES de criar um novo.
 * Impede dois sockets simultâneos (que geram connectionReplaced/conflict).
 */
function disposeSocket() {
  if (!sock) return;
  const old = sock;
  sock = null;
  // remove listeners primeiro: o 'close' do socket antigo não deve disparar
  // a reconexão nem limpar o socket novo
  try {
    old.ev.removeAllListeners();
  } catch (_) {
    /* ignora */
  }
  try {
    if (old.ws && !old.ws.isClosed && !old.ws.isClosing) old.ws.close();
  } catch (_) {
    /* ignora */
  }
  logger.info('socket anterior encerrado');
}

/**
 * Conecta ao WhatsApp.
 * @param {object} opts { phone } — número normalizado (somente dígitos) para
 *   gerar o pairing code. Omitido quando há sessão registrada (restauração).
 */
async function connect({ phone } = {}) {
  if (connecting) {
    logger.warn('já existe uma conexão em andamento (protegendo contra dupla conexão)');
    return sock;
  }
  connecting = true;
  if (phone) {
    // novo pareamento solicitado explicitamente → libera a trava de logout
    // e zera o contador de reconexões (recomeço limpo)
    loggedOutDetected = false;
    reconnectAttempts = 0;
    pendingPhone = null;
    pairingCodeRequested = false;
    currentPhoneDigits = null;
  }
  emitStatus({ type: 'connecting' });
  try {
    // 1) nunca dois sockets ao mesmo tempo
    disposeSocket();

    // 2) carrega a sessão salva (se existir)
    const { state, saveCreds } = await useMultiFileAuthState(CONFIG.paths.sessionDir);
    sessionWasRegistered = !!state.creds.registered; // valor da TENTATIVA ATUAL
    logger.info({ registered: sessionWasRegistered }, 'auth state carregado');

    // 3) versão do protocolo — com timeout (evita travar em rede lenta).
    //    Prioridade: WA_VERSION do .env (fixa manualmente) → fetch automático
    //    (agora consulta o repositório OFICIAL do Baileys, que é atualizado
    //    diariamente) → versão embutida. A função NUNCA lança.
    let version;
    if (Array.isArray(CONFIG.waVersion)) {
      version = CONFIG.waVersion;
      logger.info({ version: version.join('.'), source: 'env' }, 'versão do WhatsApp definida (WA_VERSION)');
    } else {
      const versionInfo = await fetchLatestBaileysVersion({ signal: AbortSignal.timeout(15000) });
      version = versionInfo.version;
      if (!versionInfo.isLatest) {
        logger.warn('não foi possível obter a versão mais recente do WhatsApp — usando a versão embutida');
      }
      logger.info({ version: Array.isArray(version) ? version.join('.') : version }, 'versão do WhatsApp definida');
    }

    // 4) cria o socket
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger()),
      },
      printQRInTerminal: false, // QR desabilitado por design
      browser: Browsers.ubuntu('Chrome'),
      logger: baileysLogger(),
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });
    logger.info('socket criado — aguardando connection.update');
    // EXPERIMENTAL (selective payment/text): anexa a API de transporte
    // seletivo ao socket SEM substituí-lo (ver utils/selective.js).
    try {
      require('../utils/selective').attachToSocket(sock);
    } catch (_) {
      /* a API seletiva é opcional e nunca pode impedir a conexão */
    }
    wireEvents(sock, saveCreds);

    if (!state.creds.registered) {
      if (!phone && !pairingCodeRequested) {
        const err = new Error('Número não informado para o pairing code.');
        err.code = 'PHONE_REQUIRED';
        throw err;
      }
      if (phone) {
        pendingPhone = String(phone).replace(/\D/g, '');
        currentPhoneDigits = pendingPhone;
        pairingCodeRequested = false; // novo pareamento → vai re-pedir o código
        // ⚠️ IMPORTANTE: espera o websocket abrir e o handshake concluir
        // (evento 'qr') ANTES de pedir o código. O requestPairingCode chama
        // sendNode, que lança "Connection Closed" (428) se o websocket ainda
        // não estiver aberto — isso acontecia em redes lentas (Termux/dados
        // móveis) quando o pedido era feito imediatamente após makeWASocket.
        logger.info('aguardando handshake do websocket antes de pedir o código');
        try {
          await sock.waitForConnectionUpdate(
            (u) => Boolean(u.qr) || u.connection === 'open',
            60000
          );
        } catch (e) {
          // conexão fechou durante o handshake (ex.: rate-limit) — propaga
          throw e;
        }
        const code = await pairing.requestPairingCode(sock, pendingPhone);
        pairingCodeRequested = true;
        logger.info('pairing code gerado');
        emitStatus({ type: 'pairing-code', code, phone: pendingPhone });
      } else {
        // reconexão durante pareamento (após restartRequired): o código já
        // gerado continua válido — NÃO re-pede código, apenas reconecta e
        // aguarda o servidor concluir o login.
        currentPhoneDigits =
          phoneDigitsFromJid(state.creds.me && state.creds.me.id) || pendingPhone;
        logger.info('pareamento em andamento — reconectando (código continua válido)');
        emitStatus({ type: 'awaiting-pairing' });
      }
    } else {
      pendingPhone = null;
      currentPhoneDigits = state.creds.me ? phoneDigitsFromJid(state.creds.me.id) : null;
      emitStatus({ type: 'restoring' });
      logger.info({ jid: state.creds.me && state.creds.me.id }, 'sessão restaurada — reconectando');
    }

    return sock;
  } catch (err) {
    logger.error({ err: err.message }, 'falha ao iniciar conexão');
    sock = null;
    let reason = err.message || 'erro desconhecido';
    // mensagem amigável para os erros mais comuns de pareamento
    if (phone) {
      if (/rate|overlimit|429/i.test(reason)) {
        reason = 'O WhatsApp limitou as tentativas de pareamento (rate-limit). Isso acontece após várias tentativas seguidas. AGUARDE alguns minutos — às vezes horas — antes de tentar de novo.';
      } else if (/closed|close|econn|socket|reset|refused|timed ?out/i.test(reason)) {
        reason = 'O WhatsApp fechou a conexão ao pedir o código. Causas comuns: número já em uso em outro aparelho, muitas tentativas em pouco tempo (aguarde alguns minutos) ou internet instável.';
      }
    }
    emitStatus({ type: 'failed', reason });
    // só reconecta sozinho se esta tentativa era de restauração de sessão
    // (sessionWasRegistered já reflete a tentativa atual — sem valor obsoleto)
    if (sessionWasRegistered) scheduleReconnect();
    return null;
  } finally {
    connecting = false;
  }
}

/* --------------------------- eventos Baileys ------------------------- */

function wireEvents(sockRef, saveCreds) {
  sockRef.ev.on('creds.update', saveCreds);
  sockRef.ev.on('connection.update', (update) => handleConnectionUpdate(update, sockRef));

  sockRef.ev.on('messages.upsert', ({ messages, type }) => {
    // Diagnóstico de recepção em comunidades/grupos LID (baixo ruído: só
    // dispara para mensagens LID ou stubs de cifra — o caso que investigamos).
    for (const m of messages || []) {
      const jid = m.key && m.key.remoteJid;
      const participant = m.key && m.key.participant;
      const participantAlt = m.key && m.key.participantAlt;
      const lidGroup = String(jid || '').endsWith('@g.us') && (
        String(participant || '').endsWith('@lid') ||
        String(participantAlt || '').endsWith('@lid')
      );
      const isStub = typeof m.messageStubType === 'number' && m.messageStubType !== 0;
      if (lidGroup || isStub) {
        logger.info(
          { chat: jid, participant, participantAlt, type, stub: m.messageStubType },
          '[RECV] mensagem LID/cifra recebida no socket'
        );
        activity.terminalLine(
          `[RECV] socket: chat=${jid} lid=${lidGroup ? 'sim' : 'nao'} stub=${typeof m.messageStubType === 'number' ? m.messageStubType : '-'} type=${type}`
        );
      }
    }
    if (listeners.message) listeners.message(sockRef, messages, type);
  });

  sockRef.ev.on('group-participants.update', (ev) => {
    if (listeners.groupParticipants) listeners.groupParticipants(sockRef, ev);
  });

  sockRef.ev.on('groups.update', (ev) => {
    if (listeners.groupUpdate) listeners.groupUpdate(sockRef, ev);
  });
}

/** Mensagem amigável (pt-BR) para um código de fechamento da conexão. */
function friendlyCloseReason(statusCode) {
  switch (statusCode) {
    case 429:
      return 'O WhatsApp limitou as tentativas de pareamento (rate-limit). Aguarde alguns minutos — às vezes horas — antes de tentar de novo.';
    case DisconnectReason.connectionClosed:
      return 'O WhatsApp fechou a conexão (connectionClosed). Causas comuns: muitas tentativas em pouco tempo, número em uso em outro aparelho, ou internet instável.';
    case DisconnectReason.connectionLost: // 408 (timedOut tem o mesmo código)
      return 'Conexão perdida / tempo esgotado (timeout). Verifique a internet (prefira Wi-Fi) e tente de novo.';
    case DisconnectReason.connectionReplaced:
      return 'A conexão foi substituída (connectionReplaced) — outra sessão assumiu este número.';
    case DisconnectReason.badSession:
      return 'A sessão salva é inválida (badSession). O WhatsApp não aceita essas credenciais — use "Trocar sessão" e refaça o pareamento.';
    case DisconnectReason.multideviceMismatch:
      return 'Este número não aceita multi-dispositivo (multideviceMismatch).';
    case DisconnectReason.forbidden:
      return 'Acesso negado pelo WhatsApp (forbidden).';
    case DisconnectReason.unavailableService:
      return 'Serviço do WhatsApp indisponível no momento (unavailableService). Tente de novo em instantes.';
    default:
      return 'A conexão fechou sem um código de erro identificável (possível falha de rede). Verifique a internet.';
  }
}

/**
 * Trata atualizações de conexão (abertura, fechamento, logout, restart).
 */
function handleConnectionUpdate(update, sockRef) {
  const { connection, lastDisconnect } = update;

  if (connection === 'connecting') {
    logger.info('connection.update: connecting (handshake em andamento)');
    return;
  }

  if (connection === 'open') {
    resetReconnect();
    sessionWasRegistered = true;
    pendingPhone = null;
    pairingCodeRequested = false;
    currentPhoneDigits = phoneDigitsFromJid(sockRef.user && sockRef.user.id) || currentPhoneDigits;
    logger.info({ jid: sockRef.user && sockRef.user.id }, '✅ conectado ao WhatsApp (connection = open)');
    // Diagnóstico de identidade LID (comunidades dependem do LID da sessão).
    logger.info(
      { id: sockRef.user && sockRef.user.id, lid: sockRef.user && sockRef.user.lid, hasLid: !!(sockRef.user && sockRef.user.lid) },
      'identidade do bot (id + lid)'
    );
    sessionRecovery.backupCreds().catch(() => {});
    emitStatus({ type: 'open', jid: sockRef.user && sockRef.user.id });
    return;
  }

  if (connection === 'close') {
    const statusCode = lastDisconnect && lastDisconnect.error
      ? lastDisconnect.error.output && lastDisconnect.error.output.statusCode
      : null;
    const reason = statusCode ? DisconnectReason[statusCode] || String(statusCode) : 'unknown';
    lastCloseReason = reason;
    logger.warn({ reason, statusCode }, 'conexão fechada');
    if (sockRef === sock) sock = null; // só limpa se for o socket ATUAL (evita soquete antigo apagar o novo)

    if (skipCloseHandling) {
      skipCloseHandling = false;
      return;
    }
    if (shutdownRequested) return;

    if (statusCode === 429) {
      // WhatsApp limitou tentativas de pareamento
      logger.warn('rate-limit (429) — WhatsApp limitou tentativas de pareamento');
      emitStatus({ type: 'failed', reason: friendlyCloseReason(429) });
      if (!sessionWasRegistered) {
        pendingPhone = null;
        pairingCodeRequested = false;
        return;
      }
      // sessão registrada: 429 é recuperável → cai no bloco de reconexão abaixo
    }

    if (statusCode === DisconnectReason.loggedOut) {
      // logout real: credenciais invalidadas — NUNCA reconecta sozinho
      loggedOutDetected = true;
      pendingPhone = null;
      pairingCodeRequested = false;
      currentPhoneDigits = null;
      logger.warn('sessão encerrada (loggedOut) — credenciais invalidadas');
      sessionRecovery.handleLogout().catch(() => {});
      reconnectAttempts = 0;
      emitStatus({ type: 'logged-out' });
      return;
    }

    if (statusCode === DisconnectReason.restartRequired) {
      // O WhatsApp pede reinício APÓS o pareamento dar certo (o código foi
      // aceito). Reconecta — o login então conclui e vira 'open'. NUNCA
      // tratar isso como falha (era o bug que abortava o pareamento).
      logger.info('servidor pediu reinício (pareamento concluído) — reconectando');
      scheduleReconnect(3000);
      return;
    }

    // fechamentos NÃO recuperáveis sem novo pareamento: mostra a causa e PARA
    if (
      statusCode === DisconnectReason.badSession ||
      statusCode === DisconnectReason.forbidden ||
      statusCode === DisconnectReason.multideviceMismatch
    ) {
      logger.warn({ reason }, 'fechamento não recuperável — encerrando tentativas');
      pendingPhone = null;
      pairingCodeRequested = false;
      emitStatus({ type: 'failed', reason: friendlyCloseReason(statusCode) });
      return;
    }

    // fechamento recuperável COM sessão registrada: reconecta
    if (sessionWasRegistered) {
      emitStatus({ type: 'close', reason });
      scheduleReconnect();
      return;
    }

    // pareamento em andamento (sem sessão registrada) e a conexão fechou por
    // um motivo NÃO tratado acima: mostra a causa clara e PARA (não fica
    // pendurado em "Aguardando autenticação" nem entra em loop).
    pendingPhone = null;
    pairingCodeRequested = false;
    emitStatus({ type: 'failed', reason: friendlyCloseReason(statusCode) });
  }
}

/* --------------------------- reconexão ------------------------------- */

/** Reconexão com backoff exponencial (5s → 60s). */
function scheduleReconnect(minDelay = 0) {
  if (shutdownRequested || reconnectTimer || loggedOutDetected) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error('muitas tentativas de reconexão sem sucesso — encerrando tentativas automáticas');
    emitStatus({
      type: 'failed',
      reason: 'Não foi possível reconectar após várias tentativas. A sessão pode estar inválida — troque a sessão (menu) ou apague a pasta session/ e refaça o pareamento.',
    });
    return;
  }
  const base = 5000;
  const delay = minDelay || Math.min(base * Math.pow(2, reconnectAttempts), 60000);
  reconnectAttempts++;
  logger.info({ delayMs: delay, tentativa: reconnectAttempts }, 'reconexão agendada');
  emitStatus({ type: 'reconnecting', delay, attempt: reconnectAttempts });
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      // reconecta SEM pedir código: se a sessão foi registrada, restaura;
      // se o pareamento está em andamento, continua aguardando o login.
      await connect({});
    } catch (err) {
      logger.error({ err: err.message }, 'erro na reconexão');
      scheduleReconnect();
    }
  }, delay);
}

/* ---------------------- trocar / restaurar sessão -------------------- */

/**
 * Encerra a sessão atual e remove as credenciais salvas
 * (o usuário deverá fazer novo pairing code).
 */
async function changeSession() {
  skipCloseHandling = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sock) {
    try {
      await sock.logout(); // invalida a sessão no servidor
    } catch (_) {
      /* ignora */
    }
    try {
      sock.ev.removeAllListeners();
    } catch (_) {
      /* ignora */
    }
    try {
      sock.ws && sock.ws.close();
    } catch (_) {
      /* ignora */
    }
    sock = null;
  }
  await sessionRecovery.handleLogout();
  pendingPhone = null;
  pairingCodeRequested = false;
  currentPhoneDigits = null;
  sessionWasRegistered = false;
  loggedOutDetected = false;
  skipCloseHandling = false; // não deixar a trava pendurada para o próximo fechamento
  emitStatus({ type: 'logged-out' });
}

/** Reconecta usando a sessão salva (se existir). */
async function restoreSession() {
  return connect({});
}

/* ----------------------------- desligamento -------------------------- */

async function shutdown() {
  markShutdown();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sock) {
    try {
      sock.ev.removeAllListeners();
    } catch (_) {
      /* ignora */
    }
    // NÃO chama logout(): preserva a sessão para o próximo boot
    try {
      sock.ws && sock.ws.close();
    } catch (_) {
      /* ignora */
    }
    sock = null;
  }
  logger.info('conexão encerrada');
}

module.exports = {
  connect,
  shutdown,
  changeSession,
  restoreSession,
  getSocket,
  isConnected,
  onMessage,
  onGroupParticipants,
  onGroupUpdate,
  setStatusListener,
  getStatus,
  markShutdown,
  isShutdownRequested,
  handleConnectionUpdate,
  resetReconnect,
};
