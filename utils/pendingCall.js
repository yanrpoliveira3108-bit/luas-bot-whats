/**
 * utils/pendingCall.js — chamadas de !call aguardando confirmação.
 *
 * REGRA PRINCIPAL: nenhuma chamada sai sem confirmação explícita de quem pediu.
 *
 * Estado isolado por QUEM PEDIU (senderJid), nunca pelo destino: assim a
 * confirmação de um usuário jamais autoriza a chamada criada por outro.
 *
 *   pendingCallConfirmations.get(senderJid) = {
 *     jid, callType, name, remoteJid, socket, createdAt, expiresAt, timer
 *   }
 *
 * Um único ponto de interceptação (handlers/commandHandler.js) consome a próxima
 * mensagem do autor — nada de listener novo por execução de comando.
 */

'use strict';

const logger = require('./logger').child('pendingcall');

/** Tempo de vida da confirmação, em ms. */
const CONFIRM_TTL_MS = 30 * 1000;

/** Nome padrão exibido na mensagem de chamada. */
const DEFAULT_CALL_NAME = 'Hay';

/**
 * Solicitações pendentes, chaveadas por senderJid.
 * (equivalente ao `local pendingCallConfirmations = {}` do fluxo pedido)
 */
const pendingCallConfirmations = new Map();

const CONFIRM_WORDS = new Set(['1', 'sim', 's', 'yes', 'y', 'confirmar', 'confirmo', 'confirm', 'ok']);
const CANCEL_WORDS = new Set(['2', 'nao', 'não', 'n', 'no', 'cancelar', 'cancel', 'cancela']);

/** 1 = voz, 2 = vídeo (é o callType do protocolo). */
function callTypeLabel(callType) {
  return Number(callType) === 2 ? 'vídeo' : 'voz';
}

/** Número legível a partir do JID. */
function displayTarget(jid) {
  const s = String(jid || '');
  return s.endsWith('@g.us') ? `o grupo ${s.split('@')[0]}` : s.split('@')[0];
}

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

/** Remove o estado pendente (e o timer) de um usuário. */
function clear(senderJid) {
  const pending = pendingCallConfirmations.get(senderJid);
  if (pending && pending.timer) clearTimeout(pending.timer);
  pendingCallConfirmations.delete(senderJid);
}

/**
 * Consulta a pendência. Estado expirado é descartado aqui — depois do prazo não
 * existe mais nada para confirmar.
 */
function get(senderJid) {
  const pending = pendingCallConfirmations.get(senderJid);
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

/** Registra (ou substitui) a solicitação pendente de um usuário. */
function set(senderJid, data, ttl = CONFIRM_TTL_MS) {
  clear(senderJid);
  const expiresAt = Date.now() + ttl;
  const pending = {
    jid: data.jid,
    callType: Number(data.callType) === 2 ? 2 : 1,
    name: data.name || DEFAULT_CALL_NAME,
    remoteJid: data.remoteJid,
    socket: data.socket || null,
    createdAt: Date.now(),
    expiresAt,
    ttl,
    timer: null,
  };
  pending.timer = setTimeout(() => onExpire(senderJid), ttl);
  if (typeof pending.timer.unref === 'function') pending.timer.unref();
  pendingCallConfirmations.set(senderJid, pending);
  return pending;
}

function secondsLeft(pending) {
  return Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
}

/** Cartão de confirmação (também usado quando a resposta é inválida). */
function promptText(pending, opts = {}) {
  const lines = [
    '⚠️ *CONFIRMAÇÃO*',
    '',
    `Você está prestes a enviar uma chamada de *${callTypeLabel(pending.callType)}* para:`,
    `📱 ${displayTarget(pending.jid)}`,
    `🏷️ Nome: *${pending.name}*`,
    '',
    'Deseja continuar?',
    '',
    '1️⃣ Confirmar  •  sim, s, confirmar',
    '2️⃣ Cancelar   •  não, n, cancelar',
    '',
    `⏳ Esta confirmação expira em ${secondsLeft(pending)} segundos.`,
  ];
  if (opts.invalid) {
    lines.unshift('❌ Resposta inválida. Use *1* para confirmar ou *2* para cancelar.', '');
  }
  return lines.join('\n');
}

/** Envia a Call Message de fato: { call: { name, type } } (API real do Baileys). */
async function sendCall(socket, pending) {
  await socket.sendMessage(pending.jid, {
    call: { name: pending.name, type: pending.callType },
  });
}

async function onExpire(senderJid) {
  const pending = pendingCallConfirmations.get(senderJid);
  if (!pending) return;
  clear(senderJid);
  if (!pending.socket || !pending.remoteJid) return;
  try {
    await pending.socket.sendMessage(pending.remoteJid, {
      text: `⌛ A confirmação da chamada para ${displayTarget(pending.jid)} expirou. Nada foi enviado.\nUse ${'!'}call novamente se quiser tentar de novo.`,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'aviso de expiração não enviado');
  }
}

/**
 * Consome a próxima mensagem do autor da chamada pendente.
 * @returns {Promise<boolean>} true se a mensagem foi tratada aqui.
 */
async function handleMessage(ctx) {
  const senderJid = ctx.sender;
  const pending = get(senderJid);
  if (!pending) return false;

  const verdict = parseAnswer(ctx.text);

  if (verdict === 'invalid') {
    await ctx.reply(promptText(pending, { invalid: true }));
    return true;
  }

  // confirmou ou cancelou: o estado some imediatamente
  clear(senderJid);

  if (verdict === 'cancel') {
    await ctx.reply('🚫 Cancelado. Nenhuma chamada foi enviada.');
    return true;
  }

  try {
    await sendCall(ctx.socket, pending);
    await ctx.reply(
      `📞 Chamada de *${callTypeLabel(pending.callType)}* enviada para ${displayTarget(pending.jid)}.`
    );
    logger.info(
      { sender: senderJid, target: pending.jid, callType: pending.callType },
      'chamada confirmada e enviada'
    );
  } catch (err) {
    logger.warn({ err: err.message, target: pending.jid }, 'falha ao enviar chamada');
    await ctx.reply(
      '⚠️ Não consegui enviar a chamada. O número precisa existir no WhatsApp e eu preciso poder enviar mensagem para ele.'
    );
  }
  return true;
}

function size() {
  return pendingCallConfirmations.size;
}

module.exports = {
  pendingCallConfirmations,
  CONFIRM_TTL_MS,
  DEFAULT_CALL_NAME,
  set,
  get,
  has,
  clear,
  size,
  parseAnswer,
  promptText,
  callTypeLabel,
  displayTarget,
  sendCall,
  handleMessage,
};
