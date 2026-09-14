/**
 * utils/flood.js — proteção global contra flood (rate limiting leve).
 *
 * Limita a rajada de MENSAGENS por usuário num intervalo curto. Não bloqueia
 * admins/dono, não persiste nada e usa janelas deslizantes simples em
 * memória (com limpeza periódica). O objetivo é proteger o pipeline de spam
 * sem "bloquear por engano": os limiares são generosos.
 *
 * Apenas sinaliza — quem decide aplicar é o commandHandler.
 */

'use strict';

const WINDOW_MS = 8000; // janela de análise
const MAX_HITS = 14; // mensagens por janela (generoso)
const BLOCK_MS = 8000; // tempo de "silêncio" após estourar

const hits = new Map(); // jid -> { start, n, until }

/** Registra uma mensagem. Retorna true se o usuário estourou o limite. */
function hit(jid) {
  const now = Date.now();
  const key = String(jid || '');
  let e = hits.get(key);

  // já em bloqueio temporário?
  if (e && e.until > now) return true;

  if (!e || now - e.start > WINDOW_MS) {
    e = { start: now, n: 0, until: 0 };
    hits.set(key, e);
  }
  e.n += 1;

  if (e.n > MAX_HITS) {
    e.until = now + BLOCK_MS;
    return true;
  }

  // limpeza leve
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.until < now && now - v.start > WINDOW_MS) hits.delete(k);
    }
  }
  return false;
}

/** Libera um JID (admins/dono nunca chegam a ser bloqueados). */
function clear(jid) {
  hits.delete(String(jid || ''));
}

function isBlocked(jid) {
  const e = hits.get(String(jid || ''));
  return !!(e && e.until > Date.now());
}

function snapshot() {
  return { tracked: hits.size };
}

module.exports = { hit, clear, isBlocked, snapshot, WINDOW_MS, MAX_HITS, BLOCK_MS };
