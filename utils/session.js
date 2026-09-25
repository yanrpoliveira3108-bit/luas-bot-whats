/**
 * utils/session.js — estado de conversa em memória (para jogos e confirmações).
 *
 * Sessões por (chat, usuário) com TTL. Usado por jogos (adivinhação, jokenpô,
 * batalha, etc.) e por confirmações de comandos perigosos (!eval).
 */

'use strict';

const TTL = 5 * 60 * 1000; // 5 minutos

const sessions = new Map();

function key(chatJid, userJid) {
  return `${chatJid}|${userJid}`;
}

/** Define uma sessão ativa. */
function set(chatJid, userJid, data, ttl = TTL) {
  const k = key(chatJid, userJid);
  const timer = setTimeout(() => sessions.delete(k), ttl);
  const prev = sessions.get(k);
  if (prev && prev.timer) clearTimeout(prev.timer);
  sessions.set(k, { data, timer, expiresAt: Date.now() + ttl });
}

/** Recupera a sessão ativa (sem remover). */
function get(chatJid, userJid) {
  const s = sessions.get(key(chatJid, userJid));
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    clearTimeout(s.timer);
    sessions.delete(key(chatJid, userJid));
    return null;
  }
  return s.data;
}

/** Remove a sessão ativa. */
function clear(chatJid, userJid) {
  const k = key(chatJid, userJid);
  const s = sessions.get(k);
  if (s && s.timer) clearTimeout(s.timer);
  sessions.delete(k);
}

function size() {
  return sessions.size;
}

/* --------------------- identidade com mais de uma forma ------------------ *
 * Em grupo LID o MESMO remetente pode chegar ora como telefone (PN), ora como
 * LID — e o código do dispositivo (`5511...:12@s.whatsapp.net`) muda conforme o
 * aparelho. Uma confirmação gravada com uma forma e respondida com a outra
 * "sumia" (o bot pedia sim/não e depois parecia ignorar a resposta — reclamação
 * de que "alguns comandos de dono não funcionam").
 *
 * Estas funções gravam/procuram a sessão por TODAS as formas conhecidas do
 * remetente, então a resposta casa independentemente de qual veio.
 * ------------------------------------------------------------------------- */

/** Formas equivalentes de um JID (com/sem código de dispositivo, PN e LID). */
function variacoes(jid) {
  const j = String(jid || '');
  if (!j) return [];
  const out = [j];
  // O código do dispositivo aparece em DUAS posições, dependendo de onde veio:
  //   `5511999999999:12@s.whatsapp.net` (mensagens enviadas pela própria conta)
  //   `5511999999999@s.whatsapp.net:12` (participante de grupo / remoteJidAlt)
  // As duas formas são a MESMA pessoa — normalizar as duas é o que faz a
  // resposta do "sim/não" encontrar a confirmação gravada.
  const m = j.match(/^(\d+)(?::\d+)?@([^:@]+)(?::\d+)?$/);
  if (m) {
    const so = `${m[1]}@${m[2]}`;
    if (!out.includes(so)) out.push(so);
  }
  return out;
}

/** Define a sessão para TODAS as formas do remetente (e devolve a principal). */
function setAny(chatJid, ids, data, ttl = TTL) {
  const lista = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!lista.length) return [];
  const chaves = [];
  for (const id of lista) {
    for (const v of variacoes(id)) if (!chaves.includes(v)) chaves.push(v);
  }
  for (const v of chaves) set(chatJid, v, data, ttl);
  // `data` é o mesmo objeto em todas as chaves: `clear` de uma limpa só aquela,
  // então guardamos a lista de chaves para limpar todas de uma vez.
  data.__chaves = chaves.map((v) => key(chatJid, v));
  return chaves;
}

/** Recupera a sessão pela primeira forma que existir. */
function getAny(chatJid, ids) {
  const lista = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  for (const id of lista) {
    for (const v of variacoes(id)) {
      const s = get(chatJid, v);
      if (s) return s;
    }
  }
  return null;
}

/** Remove a sessão de TODAS as formas do remetente. */
function clearAny(chatJid, ids) {
  const lista = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  for (const id of lista) for (const v of variacoes(id)) clear(chatJid, v);
}

/** Remove a sessão por todas as chaves por onde ela foi gravada. */
function clearTodas(chatJid, data) {
  const chaves = (data && data.__chaves) || [];
  for (const k of chaves) {
    const s = sessions.get(k);
    if (s && s.timer) clearTimeout(s.timer);
    sessions.delete(k);
  }
}

module.exports = { set, get, clear, size, setAny, getAny, clearAny, clearTodas, variacoes };
