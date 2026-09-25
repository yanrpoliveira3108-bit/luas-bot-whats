/**
 * utils/antiBan.js — camada de segurança, blindagem e anti-ban do Lua.
 *
 * Principais proteções contra restrição e banimento pelo WhatsApp:
 * 1. Simulação de presença humana ("digitando..." / "gravando...") antes do envio;
 * 2. Delays orgânicos proporcionais ao conteúdo, com jitter aleatório;
 * 3. Fila global de saída (outbound queue / throttle) que impede rajadas no WebSocket;
 * 4. Silenciador de privado (Silent PV): não responde estranhos no PV com menus/erros,
 *    eliminando a causa #1 de banimento (denúncias de usuários "Report & Block");
 * 5. Impressão digital de navegador realista (Windows 11 / macOS Chrome em vez de Ubuntu);
 * 6. Controle de status online (evita parecer um script rodando 24h ininterruptas).
 */

'use strict';

const CONFIG = require('../config');
const logger = require('./logger').child('antiban');

/* --------------------------- fila de saída ---------------------------- */

let lastSendTime = 0;
let queuePromise = Promise.resolve();

function isTestEnvironment() {
  if (process.env.NODE_ENV === 'test') return true;
  const script = String(process.argv[1] || '');
  return /\b(test|scripts|audit)\b/i.test(script);
}

/**
 * Enfileira um envio com controle de taxa global (throttle).
 * Garante que stanzas de mensagem não sejam despejadas no mesmo milissegundo.
 * Em ambiente de teste (NODE_ENV=test ou rodando suíte de testes), executa imediatamente sem delay.
 *
 * ⚠️ UNIFICAÇÃO: quem instala a fila de saída agora é o utils/sendGuard.js,
 * direto no socket (sendMessage/relayMessage), com intervalo, teto por minuto,
 * pausa automática e auditoria. Manter DUAS filas somava ~2s de espera por
 * mensagem e criava duas fontes de verdade sobre o ritmo. Por isso esta função
 * é um passthrough: o throttle real vive no sendGuard. A camada humana
 * (simulateTyping) segue no commandHandler, antes de cada resposta.
 */
function enqueueOutbound(fn) {
  // Ative com ANTI_BAN_OWN_QUEUE=1 se quiser a fila duplicada (não recomendado).
  if (!process.env.ANTI_BAN_OWN_QUEUE) {
    return Promise.resolve().then(fn);
  }
  if (isTestEnvironment()) {
    return Promise.resolve().then(fn);
  }

  const interval = Number(CONFIG.security?.outboundIntervalMs) || 1000;

  queuePromise = queuePromise
    .catch(() => {}) // erros em envios anteriores não travam a fila
    .then(async () => {
      const now = Date.now();
      const elapsed = now - lastSendTime;
      if (elapsed < interval) {
        const wait = interval - elapsed + Math.floor(Math.random() * 200);
        await sleep(wait);
      }
      try {
        const res = await fn();
        lastSendTime = Date.now();
        return res;
      } catch (err) {
        lastSendTime = Date.now();
        throw err;
      }
    });

  return queuePromise;
}

/* --------------------------- human typing ----------------------------- */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Calcula o delay de digitação humano baseado no conteúdo.
 * Retorna milissegundos a esperar.
 */
function calculateTypingDelay(text, isAudio = false) {
  if (isTestEnvironment() || !CONFIG.security?.humanDelays) {
    return 0;
  }
  const min = Number(CONFIG.security?.minTypingDelayMs) || 600;
  const max = Number(CONFIG.security?.maxTypingDelayMs) || 2200;

  if (isAudio) {
    return Math.min(max, min + 800 + Math.floor(Math.random() * 400));
  }

  const len = text ? String(text).length : 20;
  const charTime = Math.min(len * 12, max - min);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(max, min + charTime + jitter);
}

/**
 * Simula comportamento humano (envia presença e aguarda delay natural).
 */
async function simulateTyping(sock, jid, textOrContent = '', presenceType = 'composing') {
  if (isTestEnvironment() || !CONFIG.security?.humanDelays || !sock) {
    return;
  }
  const isAudio = presenceType === 'recording';
  const delay = calculateTypingDelay(textOrContent, isAudio);
  if (delay <= 0) return;

  try {
    if (typeof sock.sendPresenceUpdate === 'function') {
      await sock.sendPresenceUpdate(presenceType, jid).catch(() => {});
    }
  } catch (_) {}

  await sleep(delay);

  // SEMPRE encerra a presença ("paused"). Era isso que ficava ETERNO quando o
  // envio travava: o "digitando…" era enviado e ninguém o desfazia — no
  // aparelho o dono via o bot "escrevendo infinitamente" e nada chegando.
  // A presença vai DIRETO (não é mensagem, não passa pela fila do freio) e
  // nunca pode atrapalhar o envio.
  encerrarPresenca(sock, jid, presenceType);
}

/** Desfaz a presença de digitação/gravação (melhor esforço, nunca lança). */
function encerrarPresenca(sock, jid, presenceType) {
  try {
    if (!sock || typeof sock.sendPresenceUpdate !== 'function') return;
    Promise.resolve(sock.sendPresenceUpdate('paused', jid)).catch(() => {});
  } catch (_) {}
}

/* --------------------------- browser fingerprint ---------------------- */

/**
 * Retorna o array de navegador seguro para o Baileys.
 * Padrão: Windows Chrome (muito mais natural e menos visado que Ubuntu).
 */
function getBrowserConfig(Browsers) {
  if (!Browsers) {
    return ['Windows', 'Chrome', '10.0.22631'];
  }
  const name = String(CONFIG.security?.browserName || 'windows').toLowerCase();
  switch (name) {
    case 'macos':
    case 'mac':
    case 'darwin':
      return Browsers.macOS ? Browsers.macOS('Desktop') : ['Mac OS', 'Desktop', '14.4.1'];
    case 'ubuntu':
    case 'linux':
      return Browsers.ubuntu ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '20.0.04'];
    case 'windows':
    default:
      return Browsers.windows ? Browsers.windows('Chrome') : ['Windows', 'Chrome', '10.0.22631'];
  }
}

/* --------------------------- relatório de status ---------------------- */

function getStatus() {
  return {
    safeMode: !!CONFIG.security?.safeMode,
    humanDelays: !!CONFIG.security?.humanDelays,
    typingDelayRange: `${CONFIG.security?.minTypingDelayMs || 600}ms - ${CONFIG.security?.maxTypingDelayMs || 2200}ms`,
    outboundInterval: `${CONFIG.security?.outboundIntervalMs || 1000}ms`,
    silentPv: !!CONFIG.security?.silentPv,
    browser: CONFIG.security?.browserName || 'windows',
    markOnline: !!CONFIG.security?.markOnline,
  };
}

function isEnabled() {
  return !!CONFIG.security?.safeMode;
}

module.exports = {
  enqueueOutbound,
  simulateTyping,
  encerrarPresenca,
  calculateTypingDelay,
  getBrowserConfig,
  getStatus,
  isEnabled,
  sleep,
};
