/**
 * utils/sendGuard.js — FREIO DE ENVIO (proteção contra restrição de conta).
 *
 * PROBLEMA
 * --------
 * O bot enviava na velocidade da máquina: `sock.sendMessage` era chamado
 * direto, sem fila, sem intervalo e sem teto. Um único comando podia gerar
 * 3–4 mensagens instantâneas (imagem do menu + lista, aviso do anti + ação);
 * `!broadcast` mandava o MESMO texto para todos os grupos com 400 ms de
 * intervalo; o aniversário mandava para todos os grupos da pessoa em sequência.
 * Rajada + mensagem idêntica repetida = assinatura nº 1 de spam para o
 * WhatsApp — mesmo em conta antiga, e fatal em conta nova.
 *
 * O QUE ESTE MÓDULO FAZ
 * ---------------------
 * Todas as saídas do bot passam por UMA fila (FIFO por conversa, round-robin
 * entre conversas) com:
 *
 *   • intervalo mínimo global entre dois envios          (SEND_MIN_INTERVAL_MS)
 *   • intervalo mínimo por conversa                      (SEND_CHAT_INTERVAL_MS)
 *   • variação aleatória (jitter) — ritmo não mecânico   (SEND_JITTER_MS)
 *   • teto global por minuto                             (SEND_MAX_PER_MINUTE)
 *   • teto por conversa por minuto                       (SEND_CHAT_MAX_PER_MINUTE)
 *   • mídia espera mais                                   (SEND_MEDIA_MULTIPLIER)
 *   • "warmup": número recém-pareado tem limites ÷3 por 48h (SEND_WARMUP_HOURS)
 *   • trava de mensagem IDÊNTICA para vários chats       (SEND_DUP_MAX_CHATS)
 *   • bloqueio de conversa fria no PV                    (SEND_BLOCK_COLD_PV)
 *   • pausa automática ao detectar sinal de restrição     (SEND_PAUSE_MINUTES)
 *   • espera após (re)conectar antes do 1º envio          (SEND_CONNECT_GRACE_MS)
 *
 * A ordem das mensagens na mesma conversa é preservada — se o bot manda
 * "processando…" e depois o resultado, chega nessa ordem.
 *
 * O QUE ELE NÃO FAZ
 * -----------------
 * Não bloqueia o conteúdo certo (não é filtro de mensagem) e não substitui o
 * modo seguro (utils/safety.js), que trata os payloads inválidos. Um resolve
 * o RITMO, o outro resolve o FORMATO.
 *
 * ONDE É INSTALADO
 * ----------------
 * `attach(sock)` em connection/connect.js, imediatamente após criar o socket —
 * assim TODOS os caminhos (comandos, antis, automações, welcome, backup)
 * ficam cobertos sem precisar mudar cada chamada.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const CONFIG = require('../config');
const logger = require('./logger').child('sendguard');
const activity = require('./activity');
const safety = require('./safety');

const CFG = CONFIG.safety.send;
const STATE_DIR = CFG.stateDir;
const STATE_FILE = path.join(STATE_DIR, 'sendguard.json');
// AUDITORIA DE ENVIOS: uma linha por envio (sem conteúdo), usada pelo
// scripts/restricao.js para reconstruir o que o bot fez antes de uma
// restrição (ritmo, conversas, mensagens repetidas). É a evidência que faltava
// para descobrir a causa em vez de supor.
const AUDIT_FILE = path.join(STATE_DIR, 'sends.jsonl');
const AUDIT_MAX_BYTES = 2 * 1024 * 1024;
const WINDOW_MS = 60 * 1000;

/* ------------------------------ estado ---------------------------------- */

const state = {
  firstSeen: null, // ISO — 1ª vez que ESTE número rodou o bot (base do warmup)
  knownChats: [], // PVs que já falaram com o bot (quem pode receber resposta)
  totalSent: 0,
  totalBlocked: 0,
  totalQueued: 0,
  pauses: 0,
  lastRestriction: null, // { at, reason }
};

const queues = new Map(); // jid -> [item]
const chatOrder = []; // FIFO dos jids com fila (round-robin)
const chatLast = new Map(); // jid -> ts do último envio
const chatWindow = new Map(); // jid -> [ts] (últimos 60s)
const dupWindow = new Map(); // hash -> [{ jid, ts }]
let globalWindow = []; // [ts] (últimos 60s)
let lastSendAt = 0;

let paused = false;
let pausedUntil = 0;
let pauseReason = '';
let graceUntil = 0;
let pumping = false;
// Contexto assíncrono do envio em andamento. Serve para detectar chamada
// ANINHADA: o motor de álbum chama socket.relayMessage() DENTRO de
// sendMessage() — se a chamada interna entrasse na fila, ela esperaria a
// própria mensagem externa terminar e a fila travava (deadlock).
// Precisa ser contexto assíncrono (e não um contador global), senão qualquer
// outro envio disparado na mesma volta do event loop "furaria" a fila.
const sendingContext = new AsyncLocalStorage();
let timer = null;
let saveTimer = null;
let dirty = false;
let attached = false;
let ready = false;
let currentSend = null; // envio em andamento (usado pelo watchdog do janitor)

/* ------------------------------ persistência ---------------------------- */

let auditBytes = null;

/** Uma linha de auditoria por envio/bloqueio (sem nenhum conteúdo de mensagem). */
function audit(entry) {
  try {
    if (auditBytes === null) {
      auditBytes = fs.existsSync(AUDIT_FILE) ? fs.statSync(AUDIT_FILE).size : 0;
    }
    if (auditBytes > AUDIT_MAX_BYTES) {
      fs.renameSync(AUDIT_FILE, `${AUDIT_FILE}.1`);
      auditBytes = 0;
    }
    const line = JSON.stringify(entry) + '\n';
    fs.appendFile(AUDIT_FILE, line, () => {});
    auditBytes += line.length;
  } catch (_) {
    /* auditoria nunca pode atrapalhar o envio */
  }
}

function auditBlock(jid, reason, kind) {
  audit({ t: Date.now(), jid: String(jid), kind: kind || null, blocked: reason });
}

function mkdirp(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    /* sem permissão: segue só em memória */
  }
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      if (typeof data.firstSeen === 'string') state.firstSeen = data.firstSeen;
      if (Array.isArray(data.knownChats)) state.knownChats = data.knownChats.slice(-3000);
      if (Number.isFinite(data.totalSent)) state.totalSent = data.totalSent;
      if (Number.isFinite(data.totalBlocked)) state.totalBlocked = data.totalBlocked;
      if (Number.isFinite(data.pauses)) state.pauses = data.pauses;
      if (data.lastRestriction && typeof data.lastRestriction === 'object') {
        state.lastRestriction = data.lastRestriction;
      }
    }
  } catch (_) {
    /* primeiro boot ou arquivo corrompido */
  }
  if (!state.firstSeen) {
    // Primeira execução: começa o warmup AGORA (conservador para número novo;
    // para número já quente, o dono pode zerar com !freio warmup reset).
    state.firstSeen = new Date().toISOString();
    dirty = true;
  }
}

function saveState(force = false) {
  dirty = true;
  if (!force && saveTimer) return;
  const run = () => {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      mkdirp(STATE_DIR);
      fs.writeFileSync(
        STATE_FILE,
        JSON.stringify(
          {
            firstSeen: state.firstSeen,
            knownChats: state.knownChats.slice(-3000),
            totalSent: state.totalSent,
            totalBlocked: state.totalBlocked,
            pauses: state.pauses,
            lastRestriction: state.lastRestriction,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch (err) {
      logger.warn({ err: err && err.message }, 'não consegui salvar o estado do freio');
    }
  };
  if (force) {
    run();
    return;
  }
  saveTimer = setTimeout(run, 5000);
  if (saveTimer.unref) saveTimer.unref();
}

/* ------------------------------- limites -------------------------------- */

/** Warmup ativo? (número recém-pareado → limites mais duros) */
function warmupActive(now = Date.now()) {
  if (!CFG.warmupHours || !state.firstSeen) return false;
  const t = Date.parse(state.firstSeen);
  if (!Number.isFinite(t)) return false;
  return now - t < CFG.warmupHours * 3600 * 1000;
}

function warmupLeftMs(now = Date.now()) {
  if (!warmupActive(now)) return 0;
  return Math.max(0, Date.parse(state.firstSeen) + CFG.warmupHours * 3600 * 1000 - now);
}

function factor() {
  return warmupActive() ? CFG.warmupFactor : 1;
}

function multiplierFor(kind) {
  if (kind === 'media') return CFG.mediaMultiplier;
  if (kind === 'action' || kind === 'revoke') return 1.5;
  return 1;
}

function minIntervalFor(kind) {
  return Math.round(CFG.minIntervalMs * multiplierFor(kind) * factor());
}

function chatIntervalFor(kind) {
  return Math.round(CFG.chatIntervalMs * multiplierFor(kind) * factor());
}

function maxPerMinute() {
  return Math.max(1, Math.round(CFG.maxPerMinute / factor()));
}

function chatMaxPerMinute() {
  return Math.max(1, Math.round(CFG.chatMaxPerMinute / factor()));
}

/* ------------------------ ajuda: JID / dono / PV ------------------------- */

function isGroupJid(jid) {
  return String(jid || '').endsWith('@g.us');
}

function digitsOf(jid) {
  return String(jid || '').split('@')[0].split(':').pop().replace(/\D/g, '');
}

/** JID é do dono (o dono sempre pode falar no PV)? */
function isOwnerJid(jid) {
  const d = digitsOf(jid);
  if (!d) return false;
  return (CONFIG.owner.numbers || []).some((n) => d === n || (d.length >= 10 && d.endsWith(n)));
}

function isAllowedPv(jid) {
  const d = digitsOf(jid);
  if (!d) return false;
  return (CFG.allowJids || []).some((raw) => {
    const target = String(raw).replace(/\D/g, '');
    return target && (d === target || d.endsWith(target));
  });
}

function isKnownChat(jid) {
  return state.knownChats.includes(String(jid));
}

/** Registra que ESTE chat falou com o bot (libera resposta no PV). */
function noteInbound(jid) {
  const j = String(jid || '');
  if (!j || j === 'status@broadcast' || isGroupJid(j) || j.endsWith('@broadcast')) return false;
  if (state.knownChats.includes(j)) return false;
  state.knownChats.push(j);
  if (state.knownChats.length > 3000) state.knownChats.splice(0, state.knownChats.length - 3000);
  saveState();
  return true;
}

/* ------------------------------ janelas --------------------------------- */

function pruneWindows(now) {
  globalWindow = globalWindow.filter((t) => now - t < WINDOW_MS);
  for (const [jid, list] of chatWindow) {
    const kept = list.filter((t) => now - t < WINDOW_MS);
    if (kept.length) chatWindow.set(jid, kept);
    else chatWindow.delete(jid);
  }
  const dupMs = Math.max(1, CFG.dupWindowMin) * WINDOW_MS;
  for (const [hash, list] of dupWindow) {
    const kept = list.filter((e) => now - e.ts < dupMs);
    if (kept.length) dupWindow.set(hash, kept);
    else dupWindow.delete(hash);
  }
}

/* --------------------------- classificação ----------------------------- */

/** Tipo do envio (define o intervalo): text | media | interactive | revoke | react | action. */
function classify(content) {
  if (!content || typeof content !== 'object') return 'text';
  if (content.delete) return 'revoke';
  if (content.react) return 'react';
  if (content.interactiveButtons || content.sections || content.buttons || content.listMessage) return 'interactive';
  if (
    content.image ||
    content.video ||
    content.audio ||
    content.document ||
    content.sticker ||
    content.ptv
  ) {
    return 'media';
  }
  return 'text';
}

/** Texto "canônico" do conteúdo (para a trava de mensagem repetida). */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const c = content.caption || content.text || content.conversation || '';
  return String(c || '').trim();
}

function hashOf(kind, content) {
  const text = textOf(content);
  if (!text || text.length < 12) return null; // textos curtos não entram na trava
  return crypto.createHash('sha1').update(`${kind}|${text}`).digest('hex');
}

/** Bloqueio de mensagem idêntica repetida em muitos chats (broadcast). */
function isDuplicateBroadcast(hash, jid, now) {
  if (!hash) return false;
  const list = dupWindow.get(hash) || [];
  const chats = new Set(list.map((e) => e.jid));
  if (chats.has(String(jid))) return false; // repetir no MESMO chat não é broadcast
  return chats.size >= Math.max(1, CFG.dupMaxChats);
}

function noteDuplicate(hash, jid, now) {
  if (!hash) return;
  const list = dupWindow.get(hash) || [];
  list.push({ jid: String(jid), ts: now });
  if (list.length > 200) list.shift();
  dupWindow.set(hash, list);
}

/* ------------------------------- fila ----------------------------------- */

function queueSize() {
  let n = 0;
  for (const list of queues.values()) n += list.length;
  return n;
}

function enqueueChat(jid) {
  const j = String(jid);
  if (!chatOrder.includes(j)) chatOrder.push(j);
}

function dequeueChatIfEmpty(jid) {
  const j = String(jid);
  const list = queues.get(j);
  if (list && list.length === 0) {
    queues.delete(j);
    const i = chatOrder.indexOf(j);
    if (i >= 0) chatOrder.splice(i, 1);
  }
}

/** Resultado devolvido quando o freio bloqueia (nunca lança para o chamador). */
function blockedResult(jid, reason) {
  return {
    key: { id: null, remoteJid: jid, fromMe: true },
    guardBlocked: true,
    guardReason: reason,
  };
}

/**
 * Aguarda a vez e envia. Preserva a ORDEM dentro da mesma conversa.
 * @param {string} kind text | media | interactive | revoke | react | action
 * @param {string} jid conversa de destino
 * @param {() => Promise<any>} run envio real
 * @returns {Promise<any>} resultado do envio (ou resultado "bloqueado")
 */
function enqueue(kind, jid, run) {
  const j = String(jid || '');
  const now = Date.now();

  // 1) conversa fria no PV (iniciar conversa com quem nunca falou com o bot)
  if (CFG.blockColdPv && !isGroupJid(j) && !j.endsWith('@broadcast') && !isOwnerJid(j) && !isAllowedPv(j) && !isKnownChat(j)) {
    state.totalBlocked++;
    saveState();
    auditBlock(j, 'pv_frio', kind);
    logger.warn({ chat: j, tipo: kind }, '[FREIO] envio bloqueado: conversa fria no privado');
    activity.terminalLine(`[FREIO] bloqueado PV frio → ${j}`);
    return Promise.resolve(blockedResult(j, 'pv_frio'));
  }

  // 2) payload interativo quando o modo seguro proíbe (2ª camada de defesa)
  if (kind === 'interactive' && safety.blocksInteractive()) {
    state.totalBlocked++;
    saveState();
    auditBlock(j, 'interativo_safe_mode', kind);
    logger.info({ chat: j }, '[FREIO] payload interativo bloqueado (modo seguro)');
    return Promise.resolve(blockedResult(j, 'interativo_safe_mode'));
  }

  // 3) mensagem idêntica repetida em muitos chats (assinatura de broadcast)
  const hash = hashOf(kind, run && run.__content);
  if (hash && isDuplicateBroadcast(hash, j, now)) {
    state.totalBlocked++;
    saveState();
    auditBlock(j, 'broadcast_identico', kind);
    logger.warn({ chat: j }, '[FREIO] envio bloqueado: mesma mensagem em vários chats');
    activity.terminalLine(`[FREIO] bloqueado broadcast idêntico → ${j}`);
    return Promise.resolve(blockedResult(j, 'broadcast_identico'));
  }

  // 4) fila normal
  const list = queues.get(j) || [];
  if (list.length >= Math.max(1, CFG.maxQueuePerChat)) {
    state.totalBlocked++;
    saveState();
    auditBlock(j, 'fila_cheia', kind);
    logger.warn({ chat: j, fila: list.length }, '[FREIO] fila cheia — envio descartado');
    activity.terminalLine(`[FREIO] fila cheia, descartado → ${j}`);
    return Promise.resolve(blockedResult(j, 'fila_cheia'));
  }

  // 4) chamada ANINHADA (um envio dentro de outro): executa direto.
  // Sem isto, o envio de álbum (sendMessage → relayMessage interno) travaria
  // a fila esperando a si mesma.
  const ctx = sendingContext.getStore();
  if (ctx && ctx.sending) {
    return Promise.resolve().then(run);
  }

  state.totalQueued++;
  return new Promise((resolve, reject) => {
    const item = {
      kind,
      jid: j,
      run,
      hash,
      resolve,
      reject,
      enqueuedAt: now,
    };
    if (!queues.has(j)) queues.set(j, []);
    queues.get(j).push(item);
    enqueueChat(j);
    pump();
  });
}

/* ------------------------------ agendador ------------------------------- */

// ATENÇÃO: estes timers NÃO podem ser unref() — eles representam mensagens
// AINDA NA FILA. Se ficassem unref, o Node entenderia que não há mais trabalho
// pendente e encerraria o processo com a fila cheia (era exatamente o que
// acontecia: o bot "morria" sem enviar). O desligamento limpo do index.js
// resolve o caso do shutdown.
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function schedule(ms) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    pump();
  }, Math.max(15, Math.min(ms, 60 * 1000)));
}

/** Espera (ms) até poder enviar o item do topo da fila desta conversa. */
function waitFor(jid, item, now) {
  let wait = 0;
  wait = Math.max(wait, lastSendAt + minIntervalFor(item.kind) - now);
  wait = Math.max(wait, (chatLast.get(jid) || 0) + chatIntervalFor(item.kind) - now);
  const cw = chatWindow.get(jid) || [];
  const chatCap = chatMaxPerMinute();
  if (cw.length >= chatCap) wait = Math.max(wait, cw[0] + WINDOW_MS - now);
  return Math.max(0, wait);
}

/** Escolhe a próxima conversa elegível (round-robin, ordem preservada). */
function pickNext(now) {
  for (let i = 0; i < chatOrder.length; i++) {
    const jid = chatOrder[i];
    const list = queues.get(jid);
    if (!list || !list.length) continue;
    const item = list[0];
    const wait = waitFor(jid, item, now);
    if (wait <= 0) {
      chatOrder.splice(i, 1);
      chatOrder.push(jid);
      return { jid, item };
    }
  }
  return null;
}

/** Menor espera entre as conversas da fila (usada para reagendar o timer). */
function nextWait(now) {
  let best = null;
  for (const jid of chatOrder) {
    const list = queues.get(jid);
    if (!list || !list.length) continue;
    const wait = waitFor(jid, list[0], now);
    if (best === null || wait < best) best = wait;
  }
  return best === null ? 0 : best;
}

function jitter() {
  const j = Number(CFG.jitterMs) || 0;
  if (j <= 0) return 0;
  return Math.round(Math.random() * j * factor());
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const now = Date.now();

      if (paused && now < pausedUntil) {
        schedule(pausedUntil - now);
        return;
      }
      if (paused) {
        paused = false;
        pauseReason = '';
        logger.info('[FREIO] envios retomados');
        activity.terminalLine('[FREIO] pausa encerrada — envios retomados');
      }
      if (!queueSize()) return;

      pruneWindows(now);

      // espera após (re)conectar
      if (graceUntil && now < graceUntil) {
        schedule(graceUntil - now);
        return;
      }

      // teto global por minuto
      if (globalWindow.length >= maxPerMinute()) {
        schedule(globalWindow[0] + WINDOW_MS - now);
        return;
      }

      const picked = pickNext(now);
      if (!picked) {
        schedule(nextWait(now));
        return;
      }

      const wait = jitter();
      if (wait > 0) await sleep(wait);

      // remove da fila (ordem preservada) e registra o envio
      const list = queues.get(picked.jid) || [];
      const idx = list.indexOf(picked.item);
      if (idx >= 0) list.splice(idx, 1);
      dequeueChatIfEmpty(picked.jid);

      const ts = Date.now();
      lastSendAt = ts;
      chatLast.set(picked.jid, ts);
      globalWindow.push(ts);
      if (!chatWindow.has(picked.jid)) chatWindow.set(picked.jid, []);
      chatWindow.get(picked.jid).push(ts);
      noteDuplicate(picked.item.hash, picked.jid, ts);
      state.totalSent++;
      audit({ t: ts, jid: picked.jid, kind: picked.item.kind, h: picked.item.hash || undefined });

      currentSend = { jid: picked.jid, kind: picked.item.kind, startedAt: Date.now(), warnAt: 0 };
      try {
        const result = await sendingContext.run({ sending: true }, async () => picked.item.run());
        picked.item.resolve(result);
      } catch (err) {
        // Repassa o erro: quem chamou pode tratar (ex.: menu cai no fallback).
        diagnose(err, picked);
        picked.item.reject(err);
      } finally {
        currentSend = null;
      }
      if (state.totalSent % 20 === 0) saveState();
    }
  } catch (err) {
    logger.error({ err: err && err.message }, 'falha no agendador do freio');
  } finally {
    pumping = false;
  }
}

/* ---------------------- detecção de restrição (auto-pausa) -------------- */

const RESTRICTION_RE =
  /rate-?overlimit|too many (?:requests|messages)|rate limit|spam|restricted|restri[çc][ãa]o|account (?:blocked|banned|restricted)|not authorized to send|429/i;

/**
 * Analisa um erro de envio. Se o WhatsApp indicar restrição/limite,
 * PAUSA TODOS OS ENVIOS por SEND_PAUSE_MINUTES e registra — continuar
 * enviando depois desse aviso é o que transforma restrição temporária em
 * banimento.
 */
function diagnose(err, picked) {
  const status = (err && err.output && err.output.statusCode) || (err && err.statusCode) || 0;
  const text = `${(err && err.message) || ''} ${(err && err.data) || ''}`;
  const hit = status === 429 || RESTRICTION_RE.test(text);
  if (!hit) {
    logger.warn({ err: err && err.message, chat: picked && picked.jid }, '[FREIO] falha ao enviar');
    return false;
  }
  const minutes = Math.max(1, CFG.pauseMinutes);
  paused = true;
  pausedUntil = Date.now() + minutes * 60 * 1000;
  pauseReason = `sinal de restrição (${status || text.slice(0, 60)})`;
  state.pauses++;
  state.lastRestriction = { at: new Date().toISOString(), reason: pauseReason };
  saveState(true);
  audit({ t: Date.now(), jid: String((picked && picked.jid) || ''), kind: null, restriction: pauseReason });
  logger.error(
    { status, err: err && err.message, minutos: minutes },
    '🚫 SINAL DE RESTRIÇÃO detectado — envios pausados automaticamente'
  );
  activity.terminalLine(
    `🚫 [FREIO] sinal de restrição do WhatsApp — envios PAUSADOS por ${minutes} min. ` +
      'Desligue automações e NÃO fique reenviando; use !freio para ver o estado.'
  );
  return true;
}

/* ------------------------------- controles ------------------------------ */

/** Pausa (ou retoma) todos os envios. */
function setPaused(on, minutes, reason) {
  if (on) {
    const m = Math.max(1, Number(minutes) || CFG.pauseMinutes);
    paused = true;
    pausedUntil = Date.now() + m * 60 * 1000;
    pauseReason = reason || 'pausa manual';
    state.pauses++;
    state.lastRestriction = { at: new Date().toISOString(), reason: pauseReason };
    saveState(true);
    logger.warn({ minutos: m, reason: pauseReason }, '[FREIO] envios pausados');
  } else {
    paused = false;
    pausedUntil = 0;
    pauseReason = '';
    saveState(true);
    logger.info('[FREIO] envios retomados (manual)');
    pump();
  }
  return isPaused();
}

function isPaused() {
  return paused && Date.now() < pausedUntil;
}

/** Reinicia o warmup (ex.: número já aquecido, ou após liberar a restrição). */
function resetWarmup(reason) {
  state.firstSeen = new Date().toISOString();
  saveState(true);
  logger.info({ motivo: reason || 'manual' }, '[FREIO] warmup reiniciado');
  return state.firstSeen;
}

/**
 * Encerra o warmup na hora (número já é antigo/aquecido). Os limites voltam
 * aos valores normais do .env. É o oposto de resetWarmup().
 */
function skipWarmup(reason) {
  const hours = Math.max(1, Number(CFG.warmupHours) || 48);
  state.firstSeen = new Date(Date.now() - (hours + 1) * 3600 * 1000).toISOString();
  saveState(true);
  logger.info({ motivo: reason || 'manual' }, '[FREIO] warmup encerrado (limites normais)');
  return state.firstSeen;
}

/** Chamado a cada conexão aberta: reseta janelas e aplica a espera inicial. */
function markConnected() {
  lastSendAt = 0;
  globalWindow = [];
  chatWindow.clear();
  chatLast.clear();
  graceUntil = Date.now() + Math.max(0, Number(CFG.connectGraceMs) || 0);
  logger.info(
    {
      limites: {
        msgsPorMinuto: maxPerMinute(),
        msgsPorMinutoPorChat: chatMaxPerMinute(),
        intervaloGlobalMs: minIntervalFor('text'),
        intervaloPorChatMs: chatIntervalFor('text'),
        warmup: warmupActive(),
      },
    },
    '[FREIO] ativo'
  );
}

/* --------------------------------- attach ------------------------------- */

function isRiskyPayload(message) {
  if (!message || typeof message !== 'object') return null;
  const keys = [
    'botForwardedMessage',
    'interactiveMessage',
    'buttonsMessage',
    'templateMessage',
    'listMessage',
    'requestPaymentMessage',
    'sendPaymentMessage',
  ];
  for (const k of keys) {
    if (message[k]) return k;
  }
  return null;
}

/**
 * Instala o freio no socket. Todas as saídas conhecidas passam a ser
 * enfileiradas. Devolve o próprio socket (encadeável).
 */
function attach(sock) {
  if (!sock || attached) return sock;

  // Sockets de teste (e versões futuras do motor) podem não expor todos os
  // métodos — cada um é envolvido só se existir; o freio nunca pode impedir
  // a conexão.
  if (typeof sock.sendMessage === 'function') {
    const origSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = (jid, content, opts = {}) => {
      const kind = classify(content);
      const run = () => origSendMessage(jid, content, opts);
      run.__content = content;
      return enqueue(kind, jid, run);
    };
  }

  if (typeof sock.relayMessage === 'function') {
    const origRelay = sock.relayMessage.bind(sock);
    sock.relayMessage = (jid, message, opts = {}) => {
      const risky = isRiskyPayload(message);
      const blockedBySafety =
        risky &&
        ((risky === 'botForwardedMessage' && safety.blocksRichCards()) ||
          ((risky === 'interactiveMessage' || risky === 'buttonsMessage' || risky === 'templateMessage' || risky === 'listMessage') &&
            safety.blocksInteractive()) ||
          ((risky === 'requestPaymentMessage' || risky === 'sendPaymentMessage') && safety.blocksPaymentTest()));
      if (blockedBySafety) {
        state.totalBlocked++;
        saveState();
        logger.info({ chat: String(jid), payload: risky }, '[FREIO] relayMessage bloqueado (modo seguro)');
        return Promise.resolve(blockedResult(String(jid), `relay:${risky}`));
      }
      return enqueue(risky ? 'media' : 'text', jid, () => origRelay(jid, message, opts));
    };
  }

  if (typeof sock.groupParticipantsUpdate === 'function') {
    const orig = sock.groupParticipantsUpdate.bind(sock);
    sock.groupParticipantsUpdate = (jid, users, action) =>
      enqueue('action', jid, () => orig(jid, users, action));
  }

  if (typeof sock.updateBlockStatus === 'function') {
    const orig = sock.updateBlockStatus.bind(sock);
    sock.updateBlockStatus = (jid, action) => enqueue('action', jid, () => orig(jid, action));
  }

  if (typeof sock.sendPresenceUpdate === 'function') {
    const orig = sock.sendPresenceUpdate.bind(sock);
    const lastPresence = new Map();
    sock.sendPresenceUpdate = (state2, jid) => {
      // presença não entra na fila (é sensível ao tempo), mas não pode virar
      // rajada: no máximo 1 envio a cada 5s por conversa.
      const key = `${state2}|${jid || ''}`;
      const now = Date.now();
      if (now - (lastPresence.get(key) || 0) < 5000) return Promise.resolve();
      lastPresence.set(key, now);
      return orig(state2, jid).catch(() => {});
    };
  }

  attached = true;
  sock.__luaSendGuard = true;
  logger.info('[FREIO] instalado no socket (fila + limites + pausa automática)');
  return sock;
}

/* --------------------------------- boot --------------------------------- */

function init() {
  if (ready) return stats();
  mkdirp(STATE_DIR);
  loadState();
  saveState(true);
  const janitor = require('./janitor');
  janitor.register(
    'sendguard',
    () => {
      pruneWindows(Date.now());
      saveState();
      // watchdog: um envio que não termina prende a fila atrás dele. Não
      // cancelamos nada (o upload pode ser lento em dados móveis) — só
      // avisamos no terminal para o dono saber o que está acontecendo.
      if (currentSend) {
        const mins = (Date.now() - currentSend.startedAt) / 60000;
        if (mins >= 2 && Date.now() - currentSend.warnAt > 60000) {
          currentSend.warnAt = Date.now();
          logger.warn(
            { chat: currentSend.jid, tipo: currentSend.kind, minutos: Number(mins.toFixed(1)) },
            '[FREIO] envio demorando — a fila está presa atrás dele'
          );
          activity.terminalLine(
            `⏳ [FREIO] envio para ${currentSend.jid} há ${mins.toFixed(1)} min — fila presa atrás dele`
          );
        }
      }
    },
    60 * 1000
  );
  ready = true;
  return stats();
}

/* -------------------------------- relatório ----------------------------- */

function stats() {
  const now = Date.now();
  const left = warmupLeftMs(now);
  return {
    safeMode: (() => {
      try {
        return require('./safety').safeMode();
      } catch (_) {
        return !!CONFIG.safety.safeMode;
      }
    })(),
    paused: isPaused(),
    pausedUntil: isPaused() ? new Date(pausedUntil).toISOString() : null,
    pauseRemainingMin: isPaused() ? Math.ceil((pausedUntil - now) / 60000) : 0,
    pauseReason,
    pausedTotal: state.pauses,
    lastRestriction: state.lastRestriction,
    warmup: {
      active: warmupActive(now),
      since: state.firstSeen,
      hours: CFG.warmupHours,
      remainingHours: left ? Number((left / 3600000).toFixed(1)) : 0,
      factor: factor(),
    },
    limits: {
      minIntervalMs: minIntervalFor('text'),
      chatIntervalMs: chatIntervalFor('text'),
      jitterMs: CFG.jitterMs,
      maxPerMinute: maxPerMinute(),
      chatMaxPerMinute: chatMaxPerMinute(),
      mediaMultiplier: CFG.mediaMultiplier,
      dupMaxChats: CFG.dupMaxChats,
      dupWindowMin: CFG.dupWindowMin,
      blockColdPv: !!CFG.blockColdPv,
      pauseMinutes: CFG.pauseMinutes,
    },
    counters: {
      sent: state.totalSent,
      blocked: state.totalBlocked,
      queuedNow: queueSize(),
      lastMinute: globalWindow.filter((t) => now - t < WINDOW_MS).length,
    },
    chatsConhecidos: state.knownChats.length,
    graceMs: Math.max(0, graceUntil - now),
  };
}

/** Aguarda a fila esvaziar (testes e desligamento limpo). */
async function flush() {
  while (queueSize()) {
    pump();
    await sleep(25);
  }
}

function reset() {
  // limpa o timer agendado também: sem isto um "acorda em 60s" continuaria
  // segurando o processo depois que a fila já foi esvaziada.
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  queues.clear();
  chatOrder.length = 0;
  chatLast.clear();
  chatWindow.clear();
  dupWindow.clear();
  globalWindow = [];
  lastSendAt = 0;
  paused = false;
  pausedUntil = 0;
  pauseReason = '';
  graceUntil = 0;
  currentSend = null;
}

module.exports = {
  init,
  attach,
  auditFile: AUDIT_FILE,
  noteInbound,
  enqueue,
  stats,
  setPaused,
  isPaused,
  resetWarmup,
  skipWarmup,
  markConnected,
  flush,
  reset,
  classify,
  hashOf,
  warmupActive,
  __test: {
    state,
    queues,
    diagnose,
    isOwnerJid,
    isKnownChat,
    isDuplicateBroadcast,
    noteDuplicate,
    waitFor,
    config: CFG,
  },
};
