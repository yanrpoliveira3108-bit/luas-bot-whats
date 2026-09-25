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
 *   • "warmup": número recém-pareado tem o TETO POR MINUTO ÷3 por 48h
 *     (SEND_WARMUP_HOURS). O warmup NÃO mexe no espaçamento entre mensagens:
 *     quando ele multiplicava os intervalos (até 12s por mensagem na mesma
 *     conversa), um comando normal que responde "baixando...", o título e o
 *     arquivo entregava o arquivo só ~62s depois — e o dono, com razão,
 *     concluía que "o download não funciona". Medido: test/sendguard.test.js
 *     bloco 12.
 *   • mídia (arquivo/imagem/vídeo/áudio) NÃO consome a cota de mensagens da
 *     conversa: a rajada de texto é o sinal de spam, não o arquivo que o dono
 *     acabou de pedir. Mídia continua respeitando intervalo, teto global e o
 *     multiplicador próprio.
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
  // Bloqueios POR CONVERSA: { jid: { motivo: n } }. Serve para responder, na
  // hora, "por que o bot não falou NESTE chat?" sem depender de arquivo de log.
  blockedByChat: {},
  // ENVIOS QUE TRAVARAM: `sendMessage` que não concluiu dentro do prazo. Não é
  // erro de conteúdo nem de entrega — é o envio que fica pendurado (o servidor
  // não responde a consulta de participantes do grupo). Era invisível antes:
  // o bot "ficava digitando…" e nada aparecia no chat.
  travados: 0,
  lastTravado: null, // { at, jid, kind, ms, tentativa2 }
  // pausa REGISTRADA (a pausa em si é em memória; isto é o que permite o
  // diagnóstico responder "o bot está mudo porque está pausado") 
  pausedUntil: null,
  pauseReason: null,
};

const queues = new Map(); // jid -> [item]
const chatOrder = []; // FIFO dos jids com fila (round-robin)
const chatLast = new Map(); // jid -> ts do último envio
const chatWindow = new Map(); // jid -> [ts] (últimos 60s, só KINDS_DE_RAJADA)
// Tipos que contam para o teto POR CONVERSA. Mídia e reações ficam de fora:
// elas continuam limitadas pelo teto global, pelo intervalo e pelo multiplicador
// de mídia — mas não podem atrasar/limitar o arquivo que o usuário pediu.
const KINDS_DE_RAJADA = new Set(['text', 'interactive']);
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

/**
 * Erro de MONTAGEM da mensagem (bug de codificação nosso/da lib), não de
 * entrega: `Cannot read properties of undefined`, `x is not a function`,
 * `Invalid media`… Só nesse caso é seguro REENVIAR; um erro de rede/status pode
 * significar que a mensagem JÁ saiu e reenviar duplicaria (ver "timeout ≠ falha").
 */
function erroDeMontagem(err) {
  const msg = String((err && err.message) || '');
  if (err && err.name === 'TypeError') return true;
  return /Cannot read propert|is not a function|is not iterable|undefined \(reading|Invalid media|cannot be null/i.test(
    msg
  );
}

/** Primeiro frame do stack (arquivo:linha) do erro. */
function frameDoStack(err) {
  for (const l of String((err && err.stack) || '').split('\n')) {
    const t = l.trim();
    if (t.startsWith('at ') && !t.includes('node:internal') && !t.includes('internal/process')) return t;
  }
  return '';
}

/** Anota um envio barrado pelo freio (contador por conversa + auditoria). */
function notaBloqueio(jid, reason, kind) {
  const j = String(jid || '');
  state.totalBlocked++;
  if (j) {
    const m = state.blockedByChat[j] || (state.blockedByChat[j] = {});
    m[reason] = (m[reason] || 0) + 1;
    m._ultimo = new Date().toISOString();
  }
  saveState();
  auditBlock(j, reason, kind);
}

/** O que o freio bloqueou nesta conversa (motivo → quantas vezes). */
function bloqueiosDaConversa(jid) {
  const m = state.blockedByChat[String(jid || '')];
  if (!m) return null;
  const { _ultimo, ...motivos } = m;
  return { motivos, ultimo: _ultimo || null, total: Object.values(motivos).reduce((a, b) => a + b, 0) };
}

/** Conversas com mais bloqueios (para o painel !freio). */
function conversasBloqueadas(limite = 5) {
  return Object.entries(state.blockedByChat)
    .map(([jid, m]) => {
      const { _ultimo, ...motivos } = m;
      return { jid, motivos, ultimo: _ultimo || null, total: Object.values(motivos).reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.max(1, limite));
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
      if (data.blockedByChat && typeof data.blockedByChat === 'object') state.blockedByChat = data.blockedByChat;
      if (Number.isFinite(data.travados)) state.travados = data.travados;
      if (data.lastTravado && typeof data.lastTravado === 'object') state.lastTravado = data.lastTravado;
      if (typeof data.pausedUntil === 'string') state.pausedUntil = data.pausedUntil;
      if (typeof data.pauseReason === 'string') state.pauseReason = data.pauseReason;
      if (data.lastRestriction && typeof data.lastRestriction === 'object') {
        state.lastRestriction = data.lastRestriction;
      }
    }
  } catch (_) {
    /* primeiro boot ou arquivo corrompido */
  }
  if (typeof state.travados !== 'number') state.travados = 0;
  // PAUSA que estava valendo quando o bot parou: continua valendo. Ela é criada
  // por sinal de restrição do WhatsApp — voltar a enviar só porque o processo
  // reiniciou é exatamente o que transforma restrição temporária em banimento.
  if (state.pausedUntil) {
    const fim = Date.parse(state.pausedUntil);
    if (Number.isFinite(fim) && fim > Date.now()) {
      paused = true;
      pausedUntil = fim;
      pauseReason = state.pauseReason || 'pausa registrada';
    } else {
      state.pausedUntil = null;
      state.pauseReason = null;
      dirty = true;
    }
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
            blockedByChat: state.blockedByChat,
            travados: state.travados,
            lastTravado: state.lastTravado,
            pausedUntil: state.pausedUntil || null,
            pauseReason: state.pauseReason || null,
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

/**
 * Fator do warmup aplicado ao TETO POR MINUTO (volume). É a proteção que
 * realmente importa em número recém-pareado: menos mensagens por minuto.
 */
function factor() {
  return warmupActive() ? CFG.warmupFactor : 1;
}

/**
 * Fator do warmup aplicado ao ESPAÇAMENTO entre mensagens.
 *
 * Fica em 1 por padrão: ver o comentário no topo do arquivo (um download
 * levava 62s para chegar). Existe como configuração
 * (SEND_WARMUP_INTERVAL_FACTOR) para quem quiser ser mais conservador.
 */
function intervalFactor() {
  const f = Number(CFG.warmupIntervalFactor);
  return warmupActive() && f > 0 ? f : 1;
}

/** A conversa já estourou a cota de mensagens de rajada no último minuto? */
function chatWindowFull(jid, now) {
  const cw = chatWindow.get(jid) || [];
  if (cw.length < chatMaxPerMinute()) return false;
  return cw[0] + WINDOW_MS > now;
}

function multiplierFor(kind) {
  if (kind === 'media') return CFG.mediaMultiplier;
  if (kind === 'action' || kind === 'revoke') return 1.5;
  return 1;
}

function minIntervalFor(kind) {
  return Math.round(CFG.minIntervalMs * multiplierFor(kind) * intervalFactor());
}

function chatIntervalFor(kind) {
  return Math.round(CFG.chatIntervalMs * multiplierFor(kind) * intervalFactor());
}

function maxPerMinute() {
  return Math.max(1, Math.round(CFG.maxPerMinute / factor()));
}

/**
 * Teto de mensagens POR CONVERSA por minuto.
 *
 * Piso de 4: um comando normal responde 2 mensagens (aviso + resultado) antes
 * do arquivo, e o usuário costuma mandar mais um comando em seguida. Com o
 * warmup dividindo 6 por 3 (= 2), a terceira mensagem da conversa (o arquivo)
 * era empurrada para o minuto seguinte.
 */
function chatMaxPerMinute() {
  if (!warmupActive()) return Math.max(1, Math.round(CFG.chatMaxPerMinute));
  return Math.max(4, Math.round(CFG.chatMaxPerMinute / factor()));
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

/**
 * Bloqueio de mensagem idêntica repetida em muitos chats (broadcast).
 *
 * DEFEITO CORRIGIDO (25/09) — relatado como "nesse chat o bot não responde:
 * faz o comando, mas não manda a mensagem". `SEND_DUP_MAX_CHATS=0` quer dizer
 * DESLIGADO (é o padrão do bot e está escrito no config.js e no .env.example),
 * mas o código fazia `Math.max(1, 0)` → limite **1**: bastava o MESMO texto ter
 * sido enviado a QUALQUER outro chat nos últimos `dupWindowMin` minutos para o
 * envio ser descartado em silêncio. Reproduzido com o padrão: o texto
 * "🔒 Grupo fechado — ninguém manda mensagem até abrir." foi ENTREGUE no 1º chat
 * e BLOQUEADO (`broadcast_identico`) no 2º — o comando era executado e a
 * resposta não saía. Comandos de ação (add participante, fechar/abrir grupo)
 * continuavam funcionando: só a MENSAGEM sumia.
 *
 * Regra agora: 0 (ou ausente) = desligado. Ligado apenas com valor ≥ 2 (ex.: 3 =
 * a mesma mensagem pode ir para até 3 conversas; a 4ª é travada).
 */
function isDuplicateBroadcast(hash, jid, now) {
  if (!hash) return false;
  const limite = Number(CFG.dupMaxChats) || 0;
  if (limite <= 0) return false; // desligado (padrão)
  const list = dupWindow.get(hash) || [];
  const chats = new Set(list.map((e) => e.jid));
  if (chats.has(String(jid))) return false; // repetir no MESMO chat não é broadcast
  return chats.size >= limite;
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
    notaBloqueio(j, 'pv_frio', kind);
    logger.warn({ chat: j, tipo: kind }, '[FREIO] envio bloqueado: conversa fria no privado');
    activity.terminalLine(`[FREIO] bloqueado PV frio → ${j}`);
    return Promise.resolve(blockedResult(j, 'pv_frio'));
  }

  // 2) payload interativo quando o modo seguro proíbe (2ª camada de defesa)
  if (kind === 'interactive' && safety.blocksInteractive()) {
    notaBloqueio(j, 'interativo_safe_mode', kind);
    logger.info({ chat: j }, '[FREIO] payload interativo bloqueado (modo seguro)');
    return Promise.resolve(blockedResult(j, 'interativo_safe_mode'));
  }

  // 3) mensagem idêntica repetida em muitos chats (assinatura de broadcast)
  const hash = hashOf(kind, run && run.__content);
  if (hash && isDuplicateBroadcast(hash, j, now)) {
    notaBloqueio(j, 'broadcast_identico', kind);
    logger.warn({ chat: j }, '[FREIO] envio bloqueado: mesma mensagem em vários chats');
    activity.terminalLine(`[FREIO] bloqueado broadcast idêntico → ${j}`);
    return Promise.resolve(blockedResult(j, 'broadcast_identico'));
  }

  // 4) fila normal
  const list = queues.get(j) || [];
  if (list.length >= Math.max(1, CFG.maxQueuePerChat)) {
    notaBloqueio(j, 'fila_cheia', kind);
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
  if (KINDS_DE_RAJADA.has(item.kind) && chatWindowFull(jid, now)) {
    const cw = chatWindow.get(jid) || [];
    wait = Math.max(wait, cw[0] + WINDOW_MS - now);
  }
  return Math.max(0, wait);
}

/**
 * Escolhe a próxima conversa elegível (round-robin, ordem preservada).
 * `apenasDono` é usado durante a PAUSA: mesmo pausado, o dono precisa poder
 * falar com o bot (é assim que ele descobre o motivo e retoma) — e uma mensagem
 * para o próprio número não é risco de spam. O resto continua parado.
 */
function pickNext(now, apenasDono = false) {
  for (let i = 0; i < chatOrder.length; i++) {
    const jid = chatOrder[i];
    if (apenasDono && !isOwnerJid(jid)) continue;
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
  return Math.round(Math.random() * j * intervalFactor());
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const now = Date.now();

      let apenasDono = false;
      if (paused && now < pausedUntil) {
        // PAUSADO: tudo espera — menos a conversa do DONO. Sem isso o bot ficava
        // mudo até no privado do dono, que era justamente quem precisava ver o
        // motivo (`!freio`) e retomar. Para todos os outros chats, nada sai.
        apenasDono = true;
        if (!pickNext(now, true)) {
          schedule(Math.min(pausedUntil - now, 60 * 1000));
          return;
        }
      } else if (paused) {
        paused = false;
        pauseReason = '';
        state.pausedUntil = null;
        state.pauseReason = null;
        saveState(true);
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

      const picked = pickNext(now, apenasDono);
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
      if (KINDS_DE_RAJADA.has(picked.item.kind)) {
        if (!chatWindow.has(picked.jid)) chatWindow.set(picked.jid, []);
        chatWindow.get(picked.jid).push(ts);
      }
      noteDuplicate(picked.item.hash, picked.jid, ts);
      state.totalSent++;
      audit({ t: ts, jid: picked.jid, kind: picked.item.kind, h: picked.item.hash || undefined });

      const startedAt = Date.now();
      currentSend = { jid: picked.jid, kind: picked.item.kind, startedAt, warnAt: 0 };
      const prazoMs = Number(CFG.sendTimeoutMs) || 0;
      try {
        const r = await enviarComPrazo(picked.item, prazoMs);
        const ms = Date.now() - startedAt;
        if (r && r.ok) {
          audit({ t: Date.now(), jid: picked.jid, kind: picked.item.kind, fim: true, ms, resultado: 'ok' });
          picked.item.resolve(r.res);
        } else if (r && r.travou) {
          // ⚠️ PENDURADO ≠ erro. Reenvia UMA vez (sem citação + metadados em
          // cache) e NUNCA espera para sempre: a fila precisa continuar.
          const retry = await tentarDepoisDeTravar(picked, prazoMs);
          anotarTravamento(picked, prazoMs, retry);
          audit({ t: Date.now(), jid: picked.jid, kind: picked.item.kind, fim: true, ms, resultado: 'travou' });
          // Se o reenvio passou, quem chamou recebe o resultado DELE (o `key`
          // continua servindo para revogar/citar). Se não passou, null — antes
          // aqui a promessa simplesmente nunca resolvia.
          picked.item.resolve(retry && retry.ok ? retry.res : null);
        } else {
          // Repassa o erro: quem chamou pode tratar (ex.: menu cai no fallback).
          audit({ t: Date.now(), jid: picked.jid, kind: picked.item.kind, fim: true, ms, resultado: 'erro' });
          diagnose(r && r.err, picked);
          picked.item.reject(r && r.err);
        }
      } catch (err) {
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

/* ------------------------- envio com PRAZO (anti-travamento) ------------ */

const metadata = require('./groupMetadataCache');

/**
 * Executa UMA tentativa de envio com prazo.
 * Devolve { ok, res } | { err } | { travou: true }.
 *
 * Por que existe: em 25/09/2026 o aparelho do dono mostrou o comando rodando,
 * "digitando…" para sempre e NADA no grupo. O envio estava PENDURADO (a
 * biblioteca espera a consulta de participantes do grupo, que não tem prazo).
 * Pendurado não é erro: nenhum `catch` pegava. Sem prazo, uma única mensagem
 * nessa situação parava a fila inteira — e todas as outras respostas junto.
 */
function enviarComPrazo(item, ms) {
  const tentativa = sendingContext.run({ sending: true }, () => item.run());
  tentativa.catch(() => {}); // um envio travado não pode virar "unhandled rejection"
  if (!ms || ms <= 0) return tentativa.then((res) => ({ ok: true, res }), (err) => ({ err }));
  let timer = null;
  const prazo = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ travou: true }), ms);
  });
  return Promise.race([tentativa.then((res) => ({ ok: true, res }), (err) => ({ err })), prazo]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * O envio travou. Registra e — UMA vez — tenta de novo do jeito mais provável
 * de passar: sem citação e com os metadados do grupo já em cache (é a consulta
 * de metadados que pendura o envio em grupo).
 *
 * Não afirma entrega: o log diz o que aconteceu e a auditoria marca 'travou'.
 * Se a 1ª tentativa tiver saído, o reenvio duplicaria a mensagem — por isso ele
 * é a EXCEÇÃO (só depois de prazo estourado, quando o caminho normal falhou).
 */
async function tentarDepoisDeTravar(picked, ms) {
  const item = picked.item;
  const jid = String(picked.jid);
  if (!CFG.retryOnHang) return { reenviou: false, motivo: 'SEND_RETRY_ON_HANG=0' };

  // a função de envio fica em `item.run` (o item é o registro da fila)
  const funcao = item.run;
  if (funcao && typeof funcao.dropQuote === 'function') funcao.dropQuote();
  if (jid.endsWith('@g.us')) {
    // garante a lista de participantes ANTES: sem ela, o reenvio cairia na
    // mesma consulta que travou (e o Baileys não tem prazo nela)
    const meta = await metadata.garantir(jid);
    if (!meta) {
      return { reenviou: false, motivo: 'sem metadados do grupo (a consulta travou — não reenvio às cegas)' };
    }
  }
  const msReenvio = Number(CFG.sendRetryTimeoutMs) || 20000;
  const r = await enviarComPrazo(item, msReenvio);
  if (r && r.ok) return { reenviou: true, ok: true, res: r.res };
  if (r && r.travou) return { reenviou: true, ok: false, motivo: `travou de novo (${msReenvio}ms)` };
  return { reenviou: true, ok: false, motivo: (r && r.err && r.err.message) || 'erro' };
}

/** Registra o travamento (estado + auditoria + log). */
function anotarTravamento(picked, ms, retry) {
  state.travados++;
  state.lastTravado = {
    at: new Date().toISOString(),
    jid: String(picked.jid),
    kind: picked.item.kind,
    ms,
    tentativa2: retry && retry.reenviou ? (retry.ok ? 'ok' : `falhou: ${retry.motivo}`) : `não: ${retry && retry.motivo}`,
  };
  saveState(true);
  logger.error(
    {
      chat: String(picked.jid),
      tipo: picked.item.kind,
      prazoMs: ms,
      tentativa2: state.lastTravado.tentativa2,
    },
    '[FREIO] envio SEM RESPOSTA dentro do prazo — a mensagem não foi confirmada (o comando rodou, o envio ficou pendurado)'
  );
  activity.terminalLine(
    `[FREIO] envio travado em ${String(picked.jid)} (${picked.item.kind}) — prazo ${Math.round(ms / 1000)}s · reenvio: ${state.lastTravado.tentativa2}`
  );
  audit({
    t: Date.now(),
    jid: String(picked.jid),
    kind: picked.item.kind,
    travou: true,
    prazoMs: ms,
    tentativa2: state.lastTravado.tentativa2,
  });
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
    // o stack é o que permite achar a linha exata de um erro de montagem da
    // mensagem (foi o que faltou para explicar as 56 respostas perdidas em 25/09)
    logger.warn(
      { err: err && err.message, chat: picked && picked.jid, stack: err && err.stack },
      '[FREIO] falha ao enviar'
    );
    return false;
  }
  const minutes = Math.max(1, CFG.pauseMinutes);
  paused = true;
  pausedUntil = Date.now() + minutes * 60 * 1000;
  pauseReason = `sinal de restrição (${status || text.slice(0, 60)})`;
  state.pauses++;
  state.lastRestriction = { at: new Date().toISOString(), reason: pauseReason };
  state.pausedUntil = new Date(pausedUntil).toISOString();
  state.pauseReason = pauseReason;
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
    // registrado no estado: com a pausa ativa o bot fica MUDO em todos os chats,
    // e se isso não ficasse visível em algum lugar ninguém saberia por quê.
    state.pausedUntil = new Date(pausedUntil).toISOString();
    state.pauseReason = pauseReason;
    saveState(true);
    logger.warn({ minutos: m, reason: pauseReason }, '[FREIO] envios pausados');
  } else {
    paused = false;
    pausedUntil = 0;
    state.pausedUntil = null;
    state.pauseReason = null;
    saveState(true);
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
 * A pausa registrada no estado continua valendo depois de reiniciar? (usado
 * pelo boot para avisar alto: sem isso o dono veria o bot mudo sem explicação)
 */
function pausaDoEstado() {
  if (!isPaused()) return null;
  return { until: new Date(pausedUntil).toISOString(), reason: pauseReason, minutos: Math.ceil((pausedUntil - Date.now()) / 60000) };
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
      // opções da tentativa ATUAL — pode ser reduzida (sem citação) pelo
      // reenvio de erro de montagem aqui embaixo ou pelo freio, se travar
      let opcoes = opts || {};
      // PONTO ÚNICO DE SAÍDA: se a MONTAGEM da mensagem citada estourar (o que
      // acontecia no grupo de comunidade/LID do dono: `Cannot read properties of
      // undefined (reading 'toString')` — 56 respostas perdidas em 25/09), a
      // mensagem é REENVIADA sem a citação. Vale para TEXTO, MENU (lista/botões),
      // CARD HTML e MÍDIA — todos passam por aqui. O texto/configuração são
      // preservados; só o "responder citando" é abandonado.
      const run = async () => {
        try {
          return await origSendMessage(jid, content, opcoes);
        } catch (err) {
          if (!opcoes || !opcoes.quoted || !erroDeMontagem(err)) throw err;
          const semCitacao = Object.assign({}, opcoes);
          delete semCitacao.quoted;
          opcoes = semCitacao;
          const participante = String((opts && opts.quoted && opts.quoted.key && opts.quoted.key.participant) || '');
          logger.warn(
            {
              chat: String(jid),
              tipo: kind,
              err: err && err.message,
              frame: frameDoStack(err),
              quotedLid: participante.endsWith('@lid'),
              quotedParticipant: participante || undefined,
              stack: err && err.stack,
            },
            '[FREIO] falha ao MONTAR a mensagem citada — reenviando sem citação'
          );
          try {
            const res = await origSendMessage(jid, content, semCitacao);
            logger.info({ chat: String(jid) }, '[FREIO] reenvio sem citação funcionou (a mensagem saiu)');
            return res;
          } catch (err2) {
            logger.warn(
              { chat: String(jid), err: err2 && err2.message, frame: frameDoStack(err2), stack: err2 && err2.stack },
              '[FREIO] reenvio sem citação também falhou'
            );
            throw err2;
          }
        }
      };
      run.__content = content;
      // usado pelo freio quando o envio TRAVA: repete sem a citação (é o
      // "responder citando" que pendura/estoura em grupo de comunidade/LID)
      run.dropQuote = () => {
        if (opcoes && opcoes.quoted) {
          const copia = Object.assign({}, opcoes);
          delete copia.quoted;
          opcoes = copia;
        }
        return opcoes;
      };
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
        notaBloqueio(String(jid), `relay:${risky}`, 'media');
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
    pausedUntil: isPaused() ? new Date(pausedUntil).toISOString() : state.pausedUntil || null,
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
      intervalFactor: intervalFactor(),
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
    bloqueios: {
      porConversa: conversasBloqueadas(5),
      total: state.totalBlocked,
    },
    // envios que ficaram PENDURADOS (não concluíram no prazo). É o "o comando
    // roda e a mensagem não aparece": antes isso não aparecia em lugar nenhum.
    travados: {
      total: state.travados,
      ultimo: state.lastTravado,
      emAndamento: currentSend
        ? { jid: String(currentSend.jid), kind: currentSend.kind, ms: now - currentSend.startedAt }
        : null,
      prazoMs: Number(CFG.sendTimeoutMs) || 0,
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
  state.blockedByChat = {};
  globalWindow = [];
  lastSendAt = 0;
  paused = false;
  pausedUntil = 0;
  pauseReason = '';
  graceUntil = 0;
  currentSend = null;
}

module.exports = {
  pausaDoEstado,
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
  bloqueiosDaConversa,
  conversasBloqueadas,
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
    chatWindow,
    globalWindow: () => globalWindow,
    chatWindowFull,
    intervalFactor,
    config: CFG,
  },
};
