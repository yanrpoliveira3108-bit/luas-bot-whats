/**
 * utils/confirmFlow.js — fábrica de confirmações obrigatórias (30s).
 *
 * !call e !poll/!pollresult compartilham exatamente as mesmas regras:
 *   • estado isolado por senderJid (quem pediu), nunca pelo destino;
 *   • 1/sim/s/confirmar envia, 2/não/n/cancelar/cancel aborta, resto re-pergunta;
 *   • expirou → estado removido e confirmação tardia não faz nada;
 *   • um único ponto de interceptação em handlers/commandHandler.js.
 *
 * Cada uso cria a SUA tabela (pendingCallConfirmations, pendingPollConfirmations…)
 * por meio de createStore().
 */

'use strict';

const logger = require('./logger').child('confirmflow');

/** Tempo de vida de qualquer confirmação, em ms. */
const CONFIRM_TTL_MS = 30 * 1000;

const CONFIRM_WORDS = new Set(['1', 'sim', 's', 'yes', 'y', 'confirmar', 'confirmo', 'confirm', 'ok']);
const CANCEL_WORDS = new Set(['2', 'nao', 'não', 'n', 'no', 'cancelar', 'cancel', 'cancela']);

function normalize(text) {
  return String(text == null ? '' : text)
    .trim()
    .toLowerCase()
    .replace(/^[!./]+/, '')
    .replace(/\s+/g, ' ');
}

/** 'confirm' | 'cancel' | 'invalid' */
function parseAnswer(text) {
  const t = normalize(text);
  if (!t) return 'invalid';
  if (CONFIRM_WORDS.has(t)) return 'confirm';
  if (CANCEL_WORDS.has(t)) return 'cancel';
  return 'invalid';
}

/** Rodapé padrão dos cartões de confirmação. */
function confirmFooter(secondsLeft) {
  return [
    'Deseja continuar?',
    '',
    '1️⃣ Confirmar  •  sim, s, confirmar',
    '2️⃣ Cancelar   •  não, n, cancelar',
    '',
    `⏳ Esta confirmação expira em ${secondsLeft} segundos.`,
  ].join('\n');
}

/**
 * Cria uma loja de pendências.
 * @param {object} spec
 * @param {string} spec.name            rótulo para logs ("call", "poll")
 * @param {(entry:object, opts:object)=>string} spec.preview cartão de confirmação
 * @param {(socket:object, entry:object)=>Promise<any>} spec.send envio real
 * @param {(entry:object)=>string} [spec.success] mensagem de sucesso
 * @param {(entry:object)=>string} [spec.expired] aviso de expiração
 * @param {(entry:object, err:Error)=>string} [spec.failure] mensagem de falha do envio
 */
function createStore(spec) {
  const store = new Map();

  function clear(senderJid) {
    const pending = store.get(senderJid);
    if (pending && pending.timer) clearTimeout(pending.timer);
    store.delete(senderJid);
  }

  function get(senderJid) {
    const pending = store.get(senderJid);
    if (!pending) return null;
    if (Date.now() > pending.expiresAt) {
      clear(senderJid);
      return null;
    }
    return pending;
  }

  function has(senderJid) {
    return !!get(senderJid);
  }

  function secondsLeft(pending) {
    return Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
  }

  function onExpire(senderJid) {
    const pending = store.get(senderJid);
    if (!pending) return;
    clear(senderJid);
    if (!spec.expired || !pending.socket || !pending.remoteJid) return;
    pending
      .socket.sendMessage(pending.remoteJid, { text: spec.expired(pending) })
      .catch((err) => logger.warn({ err: err.message, kind: spec.name }, 'aviso de expiração não enviado'));
  }

  function set(senderJid, data, ttl = CONFIRM_TTL_MS) {
    clear(senderJid);
    const expiresAt = Date.now() + ttl;
    const pending = Object.assign({}, data, {
      remoteJid: data.remoteJid,
      socket: data.socket || null,
      createdAt: Date.now(),
      expiresAt,
      ttl,
      timer: null,
    });
    pending.timer = setTimeout(() => onExpire(senderJid), ttl);
    if (typeof pending.timer.unref === 'function') pending.timer.unref();
    store.set(senderJid, pending);
    return pending;
  }

  function promptText(pending, opts = {}) {
    const body = spec.preview(pending, opts);
    const footer = confirmFooter(secondsLeft(pending));
    const invalid = opts && opts.invalid ? '❌ Resposta inválida. Use *1* para confirmar ou *2* para cancelar.\n\n' : '';
    return `${invalid}${body}\n\n${footer}`;
  }

  async function handleMessage(ctx) {
    const pending = get(ctx.sender);
    if (!pending) return false;

    const verdict = parseAnswer(ctx.text);
    if (verdict === 'invalid') {
      await ctx.reply(promptText(pending, { invalid: true }));
      return true;
    }

    clear(ctx.sender); // confirmou ou cancelou: o estado some na hora

    if (verdict === 'cancel') {
      await ctx.reply('🚫 Cancelado. Nada foi enviado.');
      return true;
    }

    try {
      await spec.send(ctx.socket, pending);
      await ctx.reply(spec.success ? spec.success(pending) : '✅ Enviado.');
      logger.info({ sender: ctx.sender, kind: spec.name }, 'ação confirmada e enviada');
    } catch (err) {
      logger.warn({ err: err.message, kind: spec.name }, 'falha no envio');
      await ctx.reply(
        spec.failure
          ? spec.failure(pending, err)
          : '⚠️ Não consegui enviar. Verifique se o destino é válido e se eu tenho permissão de enviar mensagem nele.'
      );
    }
    return true;
  }

  return { store, set, get, has, clear, promptText, handleMessage, secondsLeft, size: () => store.size };
}

module.exports = { CONFIRM_TTL_MS, CONFIRM_WORDS, CANCEL_WORDS, parseAnswer, confirmFooter, createStore };
