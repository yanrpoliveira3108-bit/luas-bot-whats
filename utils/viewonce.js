/**
 * utils/viewonce.js — captura de mídias de visualização única.
 *
 * O WhatsApp geralmente NÃO inclui a mídia completa na mensagem citada
 * (quotedMessage) de uma view-once — então, responder com "!revelar" pode
 * não achar nada. Para contornar, toda mensagem de visualização única que
 * chega é registrada aqui (só os metadados: url/mediaKey/etc.) por um curto
 * período, e o comando !revelar revela a última recebida no chat.
 */

'use strict';

const { isViewOnce } = require('./messages');

const TTL = 15 * 60 * 1000; // 15 minutos

/** chatJid -> { message, key, at } */
const store = new Map();

/** Registra uma mensagem se ela for de visualização única. */
function capture(full) {
  if (!full || !isViewOnce(full)) return false;
  const jid = full.key && full.key.remoteJid;
  if (!jid) return false;
  store.set(String(jid), { message: full.message, key: full.key, at: Date.now() });
  // limpeza oportunista de entradas expiradas
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.at > TTL) store.delete(k);
  }
  return true;
}

/** Última view-once recebida no chat (ou null se não houver/expirada). */
function last(jid) {
  const v = store.get(String(jid));
  if (!v) return null;
  if (Date.now() - v.at > TTL) {
    store.delete(String(jid));
    return null;
  }
  return v;
}

module.exports = { capture, last, TTL };
