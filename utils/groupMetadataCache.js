/**
 * utils/groupMetadataCache.js — METADADOS DE GRUPO EM CACHE (destrava o envio).
 *
 * O DEFEITO (aparelho do dono, 25/09, grupo de comunidade/LID)
 * -----------------------------------------------------------
 * O comando executava (o terminal mostrava), o bot ficava "digitando…" e a
 * resposta NUNCA aparecia; a partir daí nenhuma outra mensagem saía.
 *
 * A causa está no caminho do envio da PRÓPRIA biblioteca, não no conteúdo:
 * para montar a mensagem de grupo, o Baileys precisa da lista de participantes
 * e faz
 *
 *     await groupMetadata(jid)     ← vendor/.../Socket/messages-send.js:837
 *
 * e essa função faz uma CONSULTA (IQ `w:g2`) **sem prazo**:
 *
 *     const groupMetadata = async (jid) => {
 *       const result = await groupQuery(jid, 'get', [...])   ← groups.js:24
 *     }
 *
 * Se o servidor não responde essa consulta (acontece em comunidade/LID), a
 * promessa NUNCA resolve: o envio fica pendurado para sempre. Resultado no
 * aparelho: "fica escrevendo e não manda nada", e a fila do freio (que espera
 * o envio terminar) trava atrás dele — por isso depois nada mais aparece.
 *
 * A SAÍDA JÁ EXISTE NA BIBLIOTECA
 * -------------------------------
 * Se o socket recebe `cachedGroupMetadata`, o Baileys usa esses metadados e
 * NÃO faz a consulta (messages-send.js:837 e :1534). É esta função:
 *
 *   • metadados frescos (dentro do TTL) → devolve na hora, sem rede;
 *   • vencidos → devolve o que tem e RENOVA em segundo plano (nunca segura o envio);
 *   • frios → busca com PRAZO (GROUP_META_TIMEOUT_MS). Se estourar, devolve
 *     undefined e registra — aí o Baileys cai na consulta sem prazo dele, mas
 *     o envio já vai ter prazo próprio no freio (utils/sendGuard.js).
 *
 * Além disso o cache é AQUECIDO na conexão (`groupFetchAllParticipating`, uma
 * consulta só para todos os grupos) e acompanha os eventos de grupo — assim o
 * grupo do relato entra no cache e o envio deixa de depender de uma consulta
 * que pode travar.
 *
 * O que é guardado: exatamente o objeto que a biblioteca devolve (id, subject,
 * participants, addressingMode, announce, restrict…). NADA de conteúdo de
 * mensagem, nada de credencial.
 */

'use strict';

const logger = require('./logger').child('grupometa');
const CONFIG = require('../config');

const CFG = (CONFIG.safety && CONFIG.safety.send) || {};

/** Validade dos metadados guardados (ms). */
const TTL_MS = Math.max(1000, Number(process.env.GROUP_META_TTL_MS) || 5 * 60 * 1000);
/** Prazo de uma busca de metadados (ms). 0 = sem prazo (não recomendado). */
const PRAZO_MS = Math.max(0, Number(process.env.GROUP_META_TIMEOUT_MS) || 12000);
/** Aquecer o cache na conexão (uma consulta para todos os grupos)? */
const AQUECER = String(process.env.GROUP_META_WARM || '1') !== '0';
/** Prazo do aquecimento (ms). */
const PRAZO_AQUECER_MS = Math.max(1000, Number(process.env.GROUP_META_WARM_TIMEOUT_MS) || 20000);

const cache = new Map(); // jid -> { at, data }
const renovando = new Set(); // jids com renovação em segundo plano
let sockRef = null;
let ultimoErro = null; // { at, jid, motivo }
let aquecido = false;
let travadas = 0; // buscas que estouraram o prazo (evidência para o doctor)

/* ------------------------------- utilidades ----------------------------- */

function chave(jid) {
  return String(jid || '');
}

function ehGrupo(jid) {
  return chave(jid).endsWith('@g.us');
}

/** Metadados utilizáveis? (a biblioteca exige participants em array) */
function valido(data) {
  return Boolean(data && Array.isArray(data.participants));
}

function guardar(jid, data, origem) {
  if (!ehGrupo(jid) || !valido(data)) return false;
  cache.set(chave(jid), { at: Date.now(), data });
  logger.debug({ jid: chave(jid), participantes: data.participants.length, origem }, 'metadados de grupo guardados');
  return true;
}

/** Corre uma promessa com prazo. Devolve { ok, res } | { prazo: true } | { err }. */
function comPrazo(promise, ms) {
  // uma promessa que "trava" não pode virar unhandled rejection depois
  promise.catch(() => {});
  if (!ms) {
    return promise.then(
      (res) => ({ ok: true, res }),
      (err) => ({ err })
    );
  }
  let timer = null;
  const prazo = new Promise((resolve) => {
    // ⚠️ NÃO usar unref(): este prazo representa um trabalho PENDENTE. Sem o
    // timer "segurando" o processo, o Node entende que não há mais nada a fazer
    // e encerra — foi o que fez o teste 4c terminar sem imprimir resultado.
    timer = setTimeout(() => resolve({ prazo: true }), ms);
  });
  return Promise.race([promise.then((res) => ({ ok: true, res }), (err) => ({ err })), prazo]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/* ------------------------------ busca real ------------------------------ */

/**
 * Busca os metadados de UM grupo usando o socket (com prazo).
 * Nunca lança: devolve os metadados ou undefined.
 */
async function buscar(jid) {
  const sock = sockRef;
  if (!sock) return undefined;
  const fn = (sock.__groupMetadataOriginal || sock.groupMetadata);
  if (typeof fn !== 'function') return undefined;
  const r = await comPrazo(Promise.resolve().then(() => fn.call(sock, jid)), PRAZO_MS);
  if (r && r.ok && valido(r.res)) {
    guardar(jid, r.res, 'busca');
    return r.res;
  }
  if (r && r.prazo) {
    travadas++;
    ultimoErro = { at: new Date().toISOString(), jid: chave(jid), motivo: 'a consulta de participantes não respondeu' };
    logger.warn(
      { jid: chave(jid), prazoMs: PRAZO_MS },
      '[GRUPO] a consulta de metadados NÃO respondeu dentro do prazo — é isso que travava o envio neste grupo'
    );
    return undefined;
  }
  if (r && r.err) {
    ultimoErro = { at: new Date().toISOString(), jid: chave(jid), motivo: (r.err && r.err.message) || String(r.err) };
    logger.debug({ jid: chave(jid), err: ultimoErro.motivo }, '[GRUPO] falha ao buscar metadados');
  }
  return undefined;
}

/** Renova em segundo plano (uma por jid). */
function renovar(jid) {
  const k = chave(jid);
  if (renovando.has(k)) return;
  renovando.add(k);
  Promise.resolve()
    .then(() => buscar(k))
    .catch(() => {})
    .finally(() => renovando.delete(k));
}

/* --------------------------- API principal ------------------------------ */

/**
 * Passada ao `makeWASocket` como `cachedGroupMetadata`.
 * É ESTA função que o Baileys usa DENTRO do envio — se ela responde, o envio
 * não faz a consulta que pode travar.
 */
function cachedGroupMetadata(jid) {
  const k = chave(jid);
  const item = cache.get(k);
  const agora = Date.now();
  if (item && agora - item.at < TTL_MS) return Promise.resolve(item.data);
  if (item) {
    renovar(k); // devolve o que tem AGORA e renova depois (envio nunca espera)
    return Promise.resolve(item.data);
  }
  // Sem nada guardado: buscar com prazo. Se estourar, devolve undefined (a
  // biblioteca tenta a consulta dela — mas o freio tem prazo próprio, então o
  // envio não fica pendurado para sempre).
  return buscar(k).then((data) => data || undefined);
}

/**
 * Garante metadados (busca com prazo se preciso). Usado antes de um reenvio.
 * Devolve os metadados ou null.
 */
async function garantir(jid, ms = PRAZO_MS) {
  const k = chave(jid);
  const item = cache.get(k);
  if (item) {
    if (Date.now() - item.at >= TTL_MS) renovar(k);
    return item.data;
  }
  if (!ehGrupo(k)) return null;
  const r = await comPrazo(buscar(k), Math.max(500, ms));
  return (r && r.ok && r.res) || null;
}

/** O que está guardado (para diagnóstico/testes) — sem conteúdo de mensagem. */
function stats() {
  const agora = Date.now();
  const porGrupo = [];
  for (const [jid, item] of cache) {
    porGrupo.push({ jid, idadeMin: Math.round((agora - item.at) / 60000), participantes: (item.data.participants || []).length });
  }
  return { grupos: cache.size, travadas, ultimoErro, aquecido, ttlMin: Math.round(TTL_MS / 60000), porGrupo };
}

/**
 * Aquece o cache com TODOS os grupos que o número participa — uma consulta só,
 * com prazo. É o que faz o grupo do relato entrar no cache já na conexão.
 */
async function aquecer() {
  const sock = sockRef;
  if (!sock || typeof sock.groupFetchAllParticipating !== 'function') return { ok: false, motivo: 'socket sem groupFetchAllParticipating' };
  const r = await comPrazo(Promise.resolve().then(() => sock.groupFetchAllParticipating()), PRAZO_AQUECER_MS);
  if (r && r.ok && r.res && typeof r.res === 'object') {
    let n = 0;
    for (const [jid, data] of Object.entries(r.res)) if (guardar(jid, data, 'aquecimento')) n++;
    aquecido = true;
    logger.info({ grupos: n }, '[GRUPO] cache de metadados aquecido (envio em grupo não depende de consulta ao vivo)');
    return { ok: true, grupos: n };
  }
  if (r && r.prazo) {
    travadas++;
    ultimoErro = { at: new Date().toISOString(), jid: '*', motivo: 'aquecimento do cache não respondeu' };
    logger.warn('[GRUPO] o aquecimento do cache não respondeu dentro do prazo (o envio segue com prazo próprio)');
    return { ok: false, motivo: 'prazo' };
  }
  return { ok: false, motivo: (r && r.err && r.err.message) || 'falha' };
}

/* ------------------------------- instalação ----------------------------- */

/**
 * Liga o cache ao socket:
 *  1. guarda o `groupMetadata` original e envolve o do socket (as chamadas dos
 *     NOSSOS comandos passam a ter prazo e a alimentar o cache — uma consulta
 *     que trava não pendura mais o comando);
 *  2. escuta os eventos de grupo para manter o cache fresco;
 *  3. aquece o cache (não bloqueia: roda em segundo plano).
 */
function attach(sock) {
  if (!sock) return null;
  sockRef = sock;
  if (typeof sock.groupMetadata === 'function' && !sock.__groupMetadataOriginal) {
    const original = sock.groupMetadata.bind(sock);
    sock.__groupMetadataOriginal = original;
    sock.groupMetadata = async (jid) => {
      const k = chave(jid);
      const item = cache.get(k);
      if (item && Date.now() - item.at < TTL_MS) return item.data;
      const r = await comPrazo(Promise.resolve().then(() => original(jid)), PRAZO_MS);
      if (r && r.ok && valido(r.res)) {
        guardar(k, r.res, 'comando');
        return r.res;
      }
      if (r && r.prazo) {
        travadas++;
        ultimoErro = { at: new Date().toISOString(), jid: k, motivo: 'a consulta de participantes não respondeu' };
        logger.warn({ jid: k, prazoMs: PRAZO_MS }, '[GRUPO] consulta de metadados travou (prazo estourado)');
        // erro explícito: melhor o comando falhar rápido do que ficar pendurado
        throw new Error(`metadados do grupo ${k} não responderam em ${PRAZO_MS}ms`);
      }
      throw (r && r.err) || new Error('falha ao buscar metadados do grupo');
    };
  }

  // O PRÓPRIO BOT mudando o grupo invalida o cache: quem acabou de adicionar ou
  // remover alguém não pode continuar enviando com a lista antiga.
  const MUDAM_GRUPO = [
    'groupParticipantsUpdate',
    'groupSettingUpdate',
    'groupUpdateSubject',
    'groupUpdateDescription',
    'groupLeave',
    'groupToggleEphemeral',
    'groupRevokeInvite',
  ];
  for (const nome of MUDAM_GRUPO) {
    if (typeof sock[nome] !== 'function' || sock[`__grupoOriginal_${nome}`]) continue;
    const original = sock[nome].bind(sock);
    sock[`__grupoOriginal_${nome}`] = original;
    sock[nome] = async (jid, ...resto) => {
      const res = await original(jid, ...resto);
      if (ehGrupo(jid)) invalidar(jid);
      return res;
    };
  }

  // groupFetchAllParticipating também alimenta o cache (uma consulta, todos os grupos)
  if (typeof sock.groupFetchAllParticipating === 'function' && !sock.__fetchAllOriginal) {
    const original = sock.groupFetchAllParticipating.bind(sock);
    sock.__fetchAllOriginal = original;
    sock.groupFetchAllParticipating = async () => {
      const res = await original();
      if (res && typeof res === 'object') {
        for (const [jid, data] of Object.entries(res)) guardar(jid, data, 'fetchAll');
      }
      return res;
    };
  }

  // event drivers: metadados novos chegam sem precisar de consulta
  try {
    const ev = sock.ev;
    if (ev && typeof ev.on === 'function') {
      ev.on('groups.upsert', (grupos) => {
        for (const g of Array.isArray(grupos) ? grupos : [grupos]) if (g && g.id) guardar(g.id, g, 'evento upsert');
      });
      ev.on('groups.update', (grupos) => {
        for (const g of Array.isArray(grupos) ? grupos : [grupos]) {
          if (!g || !g.id) continue;
          const item = cache.get(String(g.id));
          // atualização parcial: mantém os participantes que já temos
          if (item) guardar(g.id, Object.assign({}, item.data, g), 'evento update');
        }
      });
      const aoMudarParticipantes = (u) => {
        if (!u || !u.id) return;
        const item = cache.get(String(u.id));
        if (item) item.at = 0; // força renovação na próxima consulta/envio
        renovar(String(u.id));
      };
      ev.on('group-participants.update', aoMudarParticipantes);
      ev.on('groups.edge', aoMudarParticipantes);
    }
  } catch (err) {
    logger.debug({ err: err && err.message }, '[GRUPO] não consegui escutar eventos de grupo');
  }

  if (AQUECER) {
    // em segundo plano: a conexão não espera por isso
    Promise.resolve()
      .then(() => new Promise((r) => setTimeout(r, 1500)))
      .then(() => aquecer())
      .catch(() => {});
  }
  return module.exports;
}

/**
 * Esquece os metadados de um grupo (usado quando MUDAMOS o grupo: adicionar ou
 * remover participante, fechar/abrir, sair). Sem isto a lista de participantes
 * ficaria velha por até GROUP_META_TTL_MS.
 */
function invalidar(jid) {
  const k = chave(jid);
  if (!k) return;
  cache.delete(k);
  renovar(k); // já busca a lista nova em segundo plano (não segura ninguém)
}

/** Limpa tudo (testes / troca de sessão). */
function limpar() {
  cache.clear();
  renovando.clear();
  aquecido = false;
  travadas = 0;
  ultimoErro = null;
}

module.exports = {
  attach,
  limpar,
  invalidar,
  cachedGroupMetadata,
  garantir,
  aquecer,
  stats,
  // exposto para os testes
  _interno: { cache, guardar, valido, TTL_MS, PRAZO_MS, CFG },
};
