/**
 * utils/groupSchedule.js — abertura/fechamento automático e diário dos grupos.
 *
 * O QUE FAZ
 *   Cada grupo pode ter UMA programação diária: abrir (todos enviam) às HH:MM e
 *   fechar (só administradores enviam) às HH:MM, no fuso do bot
 *   (CONFIG.bot.timezone, padrão America/Sao_Paulo — ver utils/tzTime.js).
 *
 * ARMAZENAMENTO (o do projeto: JSON `settings` da tabela `groups`)
 *   settings.horarioGrupo = {
 *     enabled   : boolean          programação ativa?
 *     open      : 'HH:MM' | null   horário de abertura
 *     close     : 'HH:MM' | null   horário de fechamento
 *     tz        : string           fuso usado nos cálculos
 *     version   : number           sobe a cada alteração (invalida tarefas antigas)
 *     updatedAt : ISO
 *     lastEvent : { key, at, by }  último evento reivindicado (anti-duplicação)
 *     last      : { ok, code, expected, changed, at, reason }  último resultado
 *     notified  : code | null      último aviso enviado ao grupo (não repete)
 *   }
 *
 * AGENDAMENTO (sem varrer grupos a cada segundo)
 *   - UM temporizador por grupo, apontando para o PRÓXIMO evento (abertura ou
 *     fechamento), calculado pelo calendário local do fuso — nunca "+24h".
 *   - Cada temporizador leva um `token` e a `version` da configuração. Ao
 *     disparar, confere os dois: tarefa substituída/antiga não faz nada.
 *   - O estado mora em `globalThis` → recarregar o módulo (reload de plugins)
 *     reaproveita o mesmo mapa e não duplica temporizadores; `arm()` sempre
 *     cancela o anterior do grupo antes de criar outro.
 *
 * RECONCILIAÇÃO (ativar, alterar, reiniciar, reconectar, evento)
 *   Calcula o estado que o grupo DEVERIA ter agora, consulta o estado real
 *   (groupMetadata → `announce`), e só chama groupSettingUpdate se houver
 *   diferença. Eventos perdidos enquanto o bot estava offline NÃO são
 *   executados em sequência: uma única reconciliação resolve.
 *
 * FALHAS
 *   desconectado · bot sem admin · bot fora do grupo · erro/timeout na consulta ·
 *   erro/timeout ao alterar. Em timeout, o estado é CONSULTADO antes de repetir
 *   (a alteração pode ter sido aplicada). Novas tentativas: no máximo 3, com
 *   espera crescente, e só se a programação continua ativa, com a mesma
 *   versão e o mesmo estado esperado. Um aviso por tipo de falha (não repete
 *   até voltar a funcionar).
 *
 * VÁRIAS INSTÂNCIAS
 *   O projeto já impede duas instâncias no mesmo diretório
 *   (utils/singleInstance.js). Como reforço, cada evento é REIVINDICADO no banco
 *   com compare-and-swap (UPDATE ... WHERE settings = <valor lido>): se dois
 *   processos compartilharem o mesmo arquivo SQLite, só um executa o evento.
 *
 * LIMITE HONESTO: o bot precisa estar rodando, conectado e ser admin do grupo
 * na hora do evento. A persistência só permite RECUPERAR a programação quando
 * ele volta — o WhatsApp não executa nada sozinho enquanto o bot está offline.
 */

'use strict';

const tzTime = require('./tzTime');
const logger = require('./logger').child('horarioGrupo');

const KEY = 'horarioGrupo';
const PRAZO_MS = 15000;
const RETRY_DELAYS_MS = [20000, 60000, 180000];
const MAX_TIMER_MS = 6 * 60 * 60 * 1000; // re-arma em janelas de até 6h
const MARGEM_MS = 400; // dispara um pouco DEPOIS do minuto exato
const BOOT_ATRASO_MS = 5000;
const BOOT_INTERVALO_MS = 2000;

/* ------------------------- estado único do processo ------------------------ */

const STATE =
  globalThis.__luaGroupSchedule ||
  (globalThis.__luaGroupSchedule = {
    timers: new Map(), // jid -> { token, version, due, kind, handle }
    retries: new Map(), // jid -> { token, handle, attempt }
    locks: new Map(), // jid -> Promise (serializa por grupo)
    seq: 0,
    bootToken: 0,
  });

/* ------------------------------ dependências ------------------------------ */

const deps = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
  getSocket: () => require('../connection/connect').getSocket(),
  isConnected: () => require('../connection/connect').isConnected(),
  prazoMs: PRAZO_MS,
  retryDelays: RETRY_DELAYS_MS,
};

/** "Agora" do agendador (o mesmo relógio usado nos cálculos). */
function agora() {
  return deps.now();
}

/** Troca dependências (testes com relógio/socket controlados). */
function _setDeps(over = {}) {
  Object.assign(deps, over);
}

const socketIds = new WeakMap();
let nextSocketId = 1;
function socketDiagnostic(contextSocket = null) {
  const current = deps.getSocket();
  const id = (s) => {
    if (!s || (typeof s !== 'object' && typeof s !== 'function')) return null;
    if (!socketIds.has(s)) socketIds.set(s, nextSocketId++);
    return socketIds.get(s);
  };
  const connectionState = (() => {
    try { return deps.isConnected() ? 'open' : 'not-open'; } catch (_) { return 'unknown'; }
  })();
  const result = {
    hasContextSocket: !!contextSocket,
    hasCurrentSocket: !!current,
    sameSocket: !!contextSocket && contextSocket === current,
    hasSocketUser: !!(current && current.user),
    connectionState,
    contextSocketId: id(contextSocket),
    currentSocketId: id(current),
  };
  logger.info(result, '[GROUP_SCHEDULE_RUNTIME] connection-check');
  return result;
}

/* ------------------------------- utilidades ------------------------------- */

function groupsDb() {
  return require('../database/groups');
}

function comPrazo(promise, ms, rotulo) {
  let timer = null;
  const prazo = new Promise((_, rej) => {
    timer = setTimeout(() => {
      const e = new Error(`timeout: ${rotulo}`);
      e.code = 'TIMEOUT';
      rej(e);
    }, ms);
  });
  return Promise.race([Promise.resolve().then(() => promise), prazo]).finally(() => clearTimeout(timer));
}

function withLock(jid, fn) {
  const prev = STATE.locks.get(jid) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  STATE.locks.set(jid, tail);
  tail.then(() => {
    if (STATE.locks.get(jid) === tail) STATE.locks.delete(jid);
  });
  return run;
}

/** Classifica um erro da biblioteca/rede em um código curto (sem dados sensíveis). */
function classificar(err, fase) {
  if (err && err.code === 'TIMEOUT') return fase === 'update' ? 'timeout-update' : 'timeout-query';
  const status = Number(
    (err && err.output && err.output.statusCode) || (err && err.data && err.data.status) || (err && err.status) || 0
  );
  const msg = String((err && err.message) || '').toLowerCase();
  if (status === 403 || status === 404 || /forbidden|not-authorized|item-not-found|not.*participant|not in group/.test(msg)) {
    return 'bot-removed';
  }
  if (/connection closed|connection lost|not open|socket|ws closed|disconnect/.test(msg) || status === 428) {
    return 'disconnected';
  }
  return fase === 'update' ? 'update-failed' : 'query-failed';
}

const MOTIVOS = {
  ok: 'estado conferido',
  inactive: 'programação desativada',
  incomplete: 'programação incompleta',
  disconnected: 'o bot está desconectado do WhatsApp',
  'bot-not-admin': 'o bot não é administrador do grupo',
  'bot-removed': 'o bot não está mais no grupo (ou não tem acesso a ele)',
  'query-failed': 'erro ao consultar o grupo',
  'timeout-query': 'o WhatsApp demorou demais para responder a consulta',
  'update-failed': 'erro ao alterar quem pode enviar mensagens',
  'timeout-update': 'o WhatsApp demorou demais para confirmar a alteração',
  'save-failed': 'falha ao salvar no banco',
  'already-done': 'evento já executado',
  stale: 'tarefa antiga (programação alterada)',
};

function motivo(code) {
  return MOTIVOS[code] || code;
}

/* ------------------------------ configuração ------------------------------ */

function normalizar(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === true,
    open: tzTime.parseHHMM(r.open) ? r.open : null,
    close: tzTime.parseHHMM(r.close) ? r.close : null,
    tz: tzTime.isValidTimezone(r.tz) ? r.tz : tzTime.botTimezone(),
    version: Number.isInteger(r.version) ? r.version : 0,
    updatedAt: r.updatedAt || null,
    lastEvent: r.lastEvent || null,
    last: r.last || null,
    notified: r.notified || null,
  };
}

/** Configuração salva (sempre um objeto normalizado; `exists` diz se há algo salvo). */
function getConfig(jid) {
  let raw = null;
  try {
    raw = groupsDb().getSettings(jid)[KEY];
  } catch (_) {
    raw = null;
  }
  const cfg = normalizar(raw);
  cfg.exists = !!raw;
  return cfg;
}

function completa(cfg) {
  return !!(cfg && cfg.open && cfg.close && cfg.open !== cfg.close);
}

/** Lê direto do banco (sem cache) — usado para provar a persistência. */
function lerDoBanco(jid) {
  const g = groupsDb();
  g.invalidateSettings(jid);
  return normalizar(g.getSettings(jid)[KEY]);
}

/**
 * Salva alterações da PROGRAMAÇÃO (horários/ativo). Sobe a `version`, o que
 * invalida temporizadores e novas tentativas pendentes. Relê do banco e só
 * devolve se o que ficou gravado confere — senão lança (o chamador NÃO pode
 * dizer "salvo").
 * @param {string} jid
 * @param {{enabled?:boolean, open?:string|null, close?:string|null}} patch
 */
function saveConfig(jid, patch) {
  const atual = getConfig(jid);
  const next = {
    enabled: patch.enabled !== undefined ? !!patch.enabled : atual.enabled,
    open: patch.open !== undefined ? patch.open : atual.open,
    close: patch.close !== undefined ? patch.close : atual.close,
    tz: tzTime.botTimezone(),
    version: atual.version + 1,
    updatedAt: new Date(deps.now()).toISOString(),
    lastEvent: atual.lastEvent,
    last: atual.last,
    notified: atual.notified,
  };
  if (next.enabled && !completa(next)) {
    const e = new Error('programação incompleta não pode ser ativada');
    e.code = 'incomplete';
    throw e;
  }
  groupsDb().patchSettings(jid, (s) => {
    s[KEY] = next;
  });
  const salvo = lerDoBanco(jid);
  if (
    salvo.version !== next.version ||
    salvo.enabled !== next.enabled ||
    salvo.open !== next.open ||
    salvo.close !== next.close
  ) {
    const e = new Error('a configuração relida do banco não confere');
    e.code = 'save-failed';
    throw e;
  }
  // tarefas da versão anterior deixam de valer imediatamente
  cancelRetry(jid);
  if (salvo.enabled) arm(jid, salvo);
  else cancel(jid);
  return salvo;
}

/** Grava só metadados de execução (não mexe na versão). Nunca lança. */
function registrar(jid, mutate) {
  try {
    groupsDb().patchSettings(jid, (s) => {
      const cur = s[KEY];
      if (!cur || typeof cur !== 'object') return;
      mutate(cur);
    });
  } catch (err) {
    logger.warn({ err: err && err.message, grupo: jid }, 'não consegui registrar o resultado da execução');
  }
}

/**
 * Reivindica um evento (compare-and-swap no banco). Só uma instância/execução
 * consegue gravar `lastEvent.key = key`. Devolve false se já foi reivindicado.
 */
function reivindicar(jid, key) {
  try {
    const { prepare } = require('../database/database');
    const row = prepare('hg_get_raw', 'SELECT settings FROM groups WHERE id = ?').get(jid);
    if (!row) return false;
    let s;
    try {
      s = JSON.parse(row.settings || '{}');
    } catch (_) {
      return false;
    }
    const cur = s[KEY];
    if (!cur || typeof cur !== 'object') return false;
    if (cur.lastEvent && cur.lastEvent.key === key) return false;
    cur.lastEvent = { key, at: new Date(deps.now()).toISOString(), by: process.pid };
    const res = prepare('hg_cas', 'UPDATE groups SET settings = ? WHERE id = ? AND settings = ?').run(
      JSON.stringify(s),
      jid,
      row.settings
    );
    groupsDb().invalidateSettings(jid);
    return res.changes === 1;
  } catch (err) {
    logger.warn({ err: err && err.message, grupo: jid }, 'falha ao reivindicar o evento — seguindo sem trava');
    return true; // sem banco não há como coordenar; a instância única cobre
  }
}

/* ----------------------------- próximos eventos ----------------------------- */

/** Próximos eventos (ordenados) a partir de `fromMs`. */
function proximosEventos(cfg, fromMs, n = 2) {
  if (!completa(cfg)) return [];
  const out = [];
  let tOpen = fromMs;
  let tClose = fromMs;
  for (let i = 0; i < n; i++) {
    const o = tzTime.nextOccurrence(cfg.open, cfg.tz, tOpen);
    const c = tzTime.nextOccurrence(cfg.close, cfg.tz, tClose);
    out.push({ kind: 'open', at: o }, { kind: 'close', at: c });
    tOpen = o;
    tClose = c;
  }
  return out.filter((e) => e.at !== null).sort((a, b) => a.at - b.at);
}

function estadoEsperado(cfg, atMs) {
  if (!completa(cfg)) return null;
  return tzTime.expectedState(cfg.open, cfg.close, cfg.tz, atMs);
}

/* -------------------------------- temporizador ------------------------------ */

function cancelTimer(jid) {
  const t = STATE.timers.get(jid);
  if (t) {
    try {
      deps.clearTimeout(t.handle);
    } catch (_) {}
    STATE.timers.delete(jid);
  }
}

function cancelRetry(jid) {
  const r = STATE.retries.get(jid);
  if (r) {
    try {
      deps.clearTimeout(r.handle);
    } catch (_) {}
    STATE.retries.delete(jid);
  }
}

/** Cancela tudo do grupo (temporizador e novas tentativas). */
function cancel(jid) {
  cancelTimer(jid);
  cancelRetry(jid);
}

/**
 * Programa o PRÓXIMO evento do grupo (substitui o anterior).
 * @returns {{kind:string, due:number}|null}
 */
function arm(jid, cfg) {
  cancelTimer(jid);
  const c = cfg || getConfig(jid);
  if (!c.enabled || !completa(c)) return null;
  const agora = deps.now();
  const [prox] = proximosEventos(c, agora, 1);
  if (!prox) return null;
  const token = ++STATE.seq;
  const falta = prox.at - agora + MARGEM_MS;
  const espera = Math.max(0, Math.min(falta, MAX_TIMER_MS));
  const handle = deps.setTimeout(() => {
    const atual = STATE.timers.get(jid);
    if (!atual || atual.token !== token) return; // substituído
    STATE.timers.delete(jid);
    if (espera < falta) {
      arm(jid); // janela longa: só re-arma
      return;
    }
    dispararEvento(jid, { version: c.version, due: prox.at, kind: prox.kind }).catch((err) =>
      logger.warn({ err: err && err.message, grupo: jid }, 'erro no evento agendado')
    );
  }, espera);
  if (handle && typeof handle.unref === 'function') handle.unref();
  STATE.timers.set(jid, { token, version: c.version, due: prox.at, kind: prox.kind, handle });
  return { kind: prox.kind, due: prox.at };
}

/** Evento agendado chegou. */
async function dispararEvento(jid, ev) {
  const cfg = getConfig(jid);
  if (!cfg.enabled || cfg.version !== ev.version) {
    return { ok: false, code: 'stale' };
  }
  return reconcile(jid, {
    reason: 'evento',
    at: Math.max(deps.now(), ev.due),
    eventKey: `${cfg.version}|${ev.due}`,
  });
}

/* ------------------------------ reconciliação ------------------------------ */

function idsDoBot(sock) {
  const u = (sock && sock.user) || {};
  return [u.id, u.lid].filter(Boolean);
}

function botNoGrupo(participants, sock) {
  const permissions = require('./permissions');
  const ids = idsDoBot(sock);
  const keys = new Set();
  for (const id of ids) for (const k of permissions.jidKeys(id)) keys.add(k);
  return (participants || []).some((p) =>
    [p.id, p.lid, p.phoneNumber].some((v) => v && [...permissions.jidKeys(v)].some((k) => keys.has(k)))
  );
}

async function consultar(sock, jid) {
  const meta = await comPrazo(sock.groupMetadata(jid), deps.prazoMs, 'groupMetadata');
  if (!meta || !Array.isArray(meta.participants)) {
    const e = new Error('metadados vazios');
    throw e;
  }
  try {
    require('./groupMeta').invalidate(jid); // o resto do bot também passa a ver o estado novo
  } catch (_) {}
  return meta;
}

/**
 * Consulta o grupo e valida o bot. Usado pela reconciliação e pelo comando.
 * @returns {Promise<{ok:boolean, code?:string, meta?:object, current?:'open'|'closed', botAdmin?:boolean}>}
 */
async function inspecionar(jid) {
  const sock = deps.getSocket();
  if (!sock || !deps.isConnected()) return { ok: false, code: 'disconnected' };
  let meta;
  try {
    meta = await consultar(sock, jid);
  } catch (err) {
    return { ok: false, code: classificar(err, 'query'), err };
  }
  const permissions = require('./permissions');
  const botAdmin = permissions.isBotAdmin(meta.participants, idsDoBot(sock));
  const current = meta.announce ? 'closed' : 'open';
  if (!botAdmin) {
    const code = botNoGrupo(meta.participants, sock) ? 'bot-not-admin' : 'bot-removed';
    return { ok: false, code, meta, current, botAdmin: false };
  }
  return { ok: true, meta, current, botAdmin: true, sock };
}

/**
 * Deixa o grupo no estado programado para AGORA (uma vez), e programa o
 * próximo evento. Nunca lança.
 * @param {string} jid
 * @param {{reason?:string, at?:number, eventKey?:string, attempt?:number, silent?:boolean}} opts
 */
function reconcile(jid, opts = {}) {
  return withLock(jid, () => reconcileAgora(jid, opts)).catch((err) => {
    logger.error({ err: err && err.message, grupo: jid }, 'erro inesperado na reconciliação');
    return { ok: false, code: 'query-failed' };
  });
}

async function reconcileAgora(jid, opts) {
  const cfg = getConfig(jid);
  if (!cfg.enabled) {
    cancel(jid);
    return { ok: false, code: 'inactive' };
  }
  if (!completa(cfg)) {
    cancel(jid);
    return { ok: false, code: 'incomplete' };
  }

  // o PRÓXIMO evento é programado antes de tudo: uma falha agora não pode
  // impedir as execuções futuras
  arm(jid, cfg);

  const at = opts.at || deps.now();
  const esperado = estadoEsperado(cfg, at);
  const base = { expected: esperado, version: cfg.version, reason: opts.reason || 'reconcile' };

  if (opts.eventKey && !reivindicar(jid, opts.eventKey)) {
    return { ...base, ok: true, code: 'already-done', changed: false };
  }

  const insp = await inspecionar(jid);
  if (!insp.ok) {
    return finalizar(jid, cfg, { ...base, ok: false, code: insp.code, current: insp.current }, opts);
  }
  if (insp.current === esperado) {
    return finalizar(jid, cfg, { ...base, ok: true, code: 'ok', current: insp.current, changed: false }, opts);
  }

  const ajuste = esperado === 'closed' ? 'announcement' : 'not_announcement';
  const action = esperado === 'closed' ? 'close' : 'open';
  logger.info({ group: String(jid).slice(-12), action }, '[GROUP_SCHEDULE] transition');
  try {
    await comPrazo(insp.sock.groupSettingUpdate(jid, ajuste), deps.prazoMs, 'groupSettingUpdate');
    logger.info({ action, success: true }, '[GROUP_SCHEDULE] transition-result');
    return finalizar(jid, cfg, { ...base, ok: true, code: 'ok', current: esperado, changed: true }, opts);
  } catch (err) {
    const code = classificar(err, 'update');
    logger.warn({ action, success: false, code, errorMessage: err && err.message }, '[GROUP_SCHEDULE_ERROR]');
    logger.warn({ group: String(jid).slice(-12), code }, 'falha ao alterar o grupo — conferindo o estado real');
    // a alteração pode ter sido aplicada mesmo com erro/timeout: CONFERE antes de repetir
    const conf = await inspecionar(jid);
    if (conf.ok && conf.current === esperado) {
      return finalizar(jid, cfg, { ...base, ok: true, code: 'ok', current: esperado, changed: true, confirmedAfter: code }, opts);
    }
    const codeFinal = conf.ok ? code : conf.code;
    return finalizar(jid, cfg, { ...base, ok: false, code: codeFinal, current: conf.current || insp.current }, opts);
  }
}

const REPETIVEIS = new Set(['query-failed', 'timeout-query', 'update-failed', 'timeout-update']);
const AVISAVEIS = new Set(['bot-not-admin', 'update-failed', 'timeout-update']);

function finalizar(jid, cfg, res, opts) {
  const agoraIso = new Date(deps.now()).toISOString();
  if (res.ok) {
    cancelRetry(jid);
    registrar(jid, (cur) => {
      cur.last = { ok: true, code: 'ok', expected: res.expected, changed: !!res.changed, at: agoraIso, reason: res.reason };
      cur.notified = null; // voltou a funcionar: um próximo problema pode ser avisado
    });
    logger.info(
      { grupo: jid, estado: res.expected, alterado: !!res.changed, motivo: res.reason },
      res.changed ? 'grupo ajustado ao horário programado' : 'grupo já estava no estado programado'
    );
    return res;
  }

  registrar(jid, (cur) => {
    cur.last = { ok: false, code: res.code, expected: res.expected, changed: false, at: agoraIso, reason: res.reason };
  });
  logger.warn({ grupo: jid, code: res.code, motivo: res.reason }, `programação não aplicada: ${motivo(res.code)}`);

  const tentativa = opts.attempt || 0;
  if (REPETIVEIS.has(res.code) && tentativa < deps.retryDelays.length) {
    res.retryInMs = agendarRetentativa(jid, cfg.version, res.expected, tentativa + 1);
  } else if (!opts.silent && AVISAVEIS.has(res.code)) {
    avisarUmaVez(jid, res.code, res.expected);
  }
  return res;
}

function agendarRetentativa(jid, version, esperado, attempt) {
  cancelRetry(jid);
  const espera = deps.retryDelays[attempt - 1];
  const token = ++STATE.seq;
  const handle = deps.setTimeout(() => {
    const r = STATE.retries.get(jid);
    if (!r || r.token !== token) return;
    STATE.retries.delete(jid);
    const cfg = getConfig(jid);
    // só repete se NADA mudou: ativa, mesma versão e o mesmo estado ainda vale
    if (!cfg.enabled || cfg.version !== version) return;
    if (estadoEsperado(cfg, deps.now()) !== esperado) return;
    reconcile(jid, { reason: 'nova tentativa', attempt }).catch(() => {});
  }, espera);
  if (handle && typeof handle.unref === 'function') handle.unref();
  STATE.retries.set(jid, { token, handle, attempt });
  logger.info({ grupo: jid, tentativa: attempt, emMs: espera }, 'nova tentativa agendada');
  return espera;
}

function avisarUmaVez(jid, code, esperado) {
  const cfg = getConfig(jid);
  if (cfg.notified === code) return;
  registrar(jid, (cur) => {
    cur.notified = code;
  });
  const sock = deps.getSocket();
  if (!sock || !deps.isConnected() || typeof sock.sendMessage !== 'function') return;
  const acao = esperado === 'closed' ? 'fechar' : 'abrir';
  const texto =
    `⏰ *Horário do grupo*\n` +
    `▸ Não consegui ${acao} o grupo no horário programado: ${motivo(code)}.\n` +
    (code === 'bot-not-admin' ? '▸ Torne o bot administrador para a programação voltar a funcionar.\n' : '') +
    '▸ A programação continua salva. Este aviso não se repete até voltar a funcionar.';
  Promise.resolve()
    .then(() => sock.sendMessage(jid, { text: texto }))
    .catch((err) => logger.warn({ grupo: jid, err: err && err.message }, 'não consegui enviar o aviso'));
}

/* ------------------------------- boot/conexão ------------------------------- */

/** Grupos com programação ATIVA salva no banco. */
function gruposAtivos() {
  try {
    const { prepare } = require('../database/database');
    const rows = prepare(
      'hg_list',
      `SELECT id, settings FROM groups WHERE settings LIKE '%"${KEY}"%'`
    ).all();
    const out = [];
    for (const r of rows) {
      try {
        const cfg = normalizar(JSON.parse(r.settings || '{}')[KEY]);
        if (cfg.enabled && completa(cfg)) out.push(r.id);
      } catch (_) {}
    }
    return out;
  } catch (err) {
    logger.warn({ err: err && err.message }, 'não consegui listar as programações salvas');
    return [];
  }
}

/**
 * Chamado a cada `connection = open` (boot e reconexões). Re-arma todos os
 * grupos (sem duplicar: arm() substitui) e reconcilia cada um UMA vez, com
 * intervalo entre grupos. Uma reconexão nova invalida a rodada anterior.
 */
function onConnected() {
  const token = ++STATE.bootToken;
  const lista = gruposAtivos();
  for (const jid of lista) arm(jid);
  if (!lista.length) return { grupos: 0 };
  logger.info({ grupos: lista.length }, 'programações recuperadas — reconciliando');
  lista.forEach((jid, i) => {
    const h = deps.setTimeout(() => {
      if (STATE.bootToken !== token) return; // outra conexão assumiu
      reconcile(jid, { reason: 'reinício/reconexão' }).catch(() => {});
    }, BOOT_ATRASO_MS + i * BOOT_INTERVALO_MS);
    if (h && typeof h.unref === 'function') h.unref();
  });
  return { grupos: lista.length };
}

/** Informações do agendamento em memória (para o status). */
function agendado(jid) {
  const t = STATE.timers.get(jid);
  const r = STATE.retries.get(jid);
  return {
    timer: t ? { kind: t.kind, due: t.due, version: t.version } : null,
    retry: r ? { attempt: r.attempt } : null,
  };
}

/** Só para testes: zera o estado em memória. */
function _reset() {
  for (const jid of [...STATE.timers.keys()]) cancelTimer(jid);
  for (const jid of [...STATE.retries.keys()]) cancelRetry(jid);
  STATE.locks.clear();
  STATE.bootToken++;
}

module.exports = {
  KEY,
  agora,
  getConfig,
  saveConfig,
  completa,
  proximosEventos,
  estadoEsperado,
  reconcile,
  inspecionar,
  arm,
  cancel,
  onConnected,
  gruposAtivos,
  agendado,
  motivo,
  classificar,
  dispararEvento,
  _setDeps,
  socketDiagnostic,
  _reset,
  _STATE: STATE,
};
