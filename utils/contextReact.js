/**
 * utils/contextReact.js — reações contextuais do bot à mensagem do usuário.
 *
 * QUANDO reage (decidido pelo pipeline em handlers/commandHandler.js):
 *   - comando reconhecido;
 *   - pedido direto já reconhecido pelos mecanismos existentes ("prefixo",
 *     "menu", menu numerado);
 *   - resposta (citação) a uma mensagem enviada PELO PRÓPRIO BOT.
 *   Conversa comum do grupo NÃO recebe reação.
 *
 * GARANTIAS
 *   - UMA reação temática por mensagem (chave real: chat + id da mensagem),
 *     mesmo que o evento chegue duas vezes (reconexão/reentrega).
 *   - Reações da MESMA mensagem são serializadas (inclusive as que os comandos
 *     já faziam com `ctx.react`): nada de reações concorrentes.
 *   - Nunca reage a eventos de reação, mensagens de protocolo, status ou sem id.
 *   - Falha ao reagir NUNCA interrompe o comando (nada é relançado) e o envio
 *     passa pelo mesmo socket/freio de envio (utils/sendGuard) de sempre.
 *   - Reação temática ≠ sucesso do comando: nenhum ✅ é colocado aqui.
 *
 * "Resposta ao bot" usa os METADADOS REAIS da citação (contextInfo.stanzaId +
 * contextInfo.participant) comparados com a identidade da conta conectada
 * (sock.user.id / sock.user.lid, sem o código de dispositivo). Citação sem
 * autor identificável não é tratada como resposta ao bot.
 */

'use strict';

const topics = require('./reactionTopics');
const { findContextInfo, isStatusJid } = require('./messages');
const logger = require('./logger').child('react');

const TTL_MS = 10 * 60 * 1000;
const MAX_VISTOS = 5000;

const vistos = new Map(); // "chat|id" -> ts (já recebeu a reação temática)
const cadeias = new Map(); // "chat|id" -> Promise (serializa reações da mensagem)

try {
  require('./janitor').register(
    'context-react',
    () => {
      const limite = Date.now() - TTL_MS;
      for (const [k, ts] of vistos) if (ts < limite) vistos.delete(k);
    },
    5 * 60 * 1000
  );
} catch (_) {
  /* janitor indisponível: o teto de tamanho ainda protege */
}

function chaveDe(msg) {
  const k = msg && msg.key;
  if (!k || !k.id || !k.remoteJid) return null;
  return `${k.remoteJid}|${k.id}`;
}

/** Mensagem que PODE receber reação (evita loops e eventos que não são conversa). */
function reagivel(msg) {
  if (!msg || !msg.message || !chaveDe(msg)) return false;
  if (isStatusJid(msg.key.remoteJid)) return false;
  const m = msg.message;
  if (m.reactionMessage || m.protocolMessage || (m.senderKeyDistributionMessage && Object.keys(m).length === 1)) {
    return false;
  }
  if (m.encReactionMessage || m.pollUpdateMessage) return false;
  return true;
}

/** "5511...:3@s.whatsapp.net" → "5511...@s.whatsapp.net" (c.us = s.whatsapp.net). */
function formaCanonica(jid) {
  const s = String(jid || '').trim();
  if (!s || !s.includes('@')) return '';
  const [userDev, server] = s.split('@');
  const user = userDev.split(':')[0];
  const srv = server === 'c.us' ? 's.whatsapp.net' : server;
  return user && srv ? `${user}@${srv}` : '';
}

/** A mensagem cita uma mensagem enviada pela conta conectada do bot? */
function respondeAoBot(sock, msg) {
  const ci = findContextInfo(msg && msg.message);
  if (!ci || !ci.stanzaId || !ci.participant) return false;
  const u = (sock && sock.user) || {};
  const doBot = new Set([formaCanonica(u.id), formaCanonica(u.lid)].filter(Boolean));
  if (!doBot.size) return false;
  return doBot.has(formaCanonica(ci.participant));
}

/**
 * Envia uma reação (serializada por mensagem). Nunca rejeita.
 * @returns {Promise<boolean>} true se o socket aceitou
 */
function enviar(sock, msg, emoji) {
  const chave = chaveDe(msg);
  if (!chave || !sock || typeof sock.sendMessage !== 'function' || !emoji) return Promise.resolve(false);
  const anterior = cadeias.get(chave) || Promise.resolve();
  const atual = anterior
    .then(() => sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }))
    .then(
      () => true,
      (err) => {
        logger.debug({ err: err && err.message }, 'reação não enviada (ignorado)');
        return false;
      }
    );
  cadeias.set(chave, atual);
  atual.then(() => {
    if (cadeias.get(chave) === atual) cadeias.delete(chave);
  });
  return atual;
}

/**
 * Reação TEMÁTICA (uma por mensagem). Não espera o envio: devolve na hora se
 * a reação foi disparada — o comando segue em paralelo.
 */
function reagirTema(sock, msg, emoji) {
  try {
    if (!reagivel(msg) || !emoji) return false;
    const chave = chaveDe(msg);
    if (vistos.has(chave)) return false;
    if (vistos.size >= MAX_VISTOS) vistos.delete(vistos.keys().next().value);
    vistos.set(chave, Date.now());
    enviar(sock, msg, emoji);
    return true;
  } catch (_) {
    return false;
  }
}

/** Comando reconhecido → emoji do comando/categoria. */
function reagirComando(ctx, cmd) {
  return reagirTema(ctx && ctx.socket, ctx && ctx.message, topics.emojiDe(topics.topicoDoComando(cmd)));
}

/** Pedido direto reconhecido (ex.: "prefixo", "menu") → emoji do tópico. */
function reagirTopico(ctx, topico) {
  return reagirTema(ctx && ctx.socket, ctx && ctx.message, topics.emojiDe(topico));
}

/** Resposta citando o bot, sem comando → tópico do texto ou 💬. */
function reagirResposta(ctx) {
  const topico = topics.topicoDoTexto(ctx && ctx.text) || 'conversa';
  return reagirTopico(ctx, topico);
}

/** Só para testes. */
function _reset() {
  vistos.clear();
  cadeias.clear();
}

module.exports = {
  reagivel,
  respondeAoBot,
  formaCanonica,
  enviar,
  reagirTema,
  reagirComando,
  reagirTopico,
  reagirResposta,
  _reset,
};
