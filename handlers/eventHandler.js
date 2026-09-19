/**
 * handlers/eventHandler.js — antis que dependem de EVENTOS do Baileys.
 *
 * Nem toda proteção pode ser decidida olhando só a mensagem recebida:
 *
 *   messages.update   → edição (MESSAGE_EDIT) e "apagar para todos" (REVOKE)
 *                       → anti editar mensagem / anti apagar mensagem
 *   messages.reaction → reação                                   → anti reação
 *   call              → chamada recebida                         → anti chamada
 *
 * Estas três são as únicas fontes confiáveis para esses recursos na versão
 * atual do Baileys (@lucasmod/boruto-vk7-baileys 2.1.0) — confirmado em
 * lib/Utils/process-message.js (emissão dos eventos) e
 * vendor/.../WAProto/Web/Web.proto (REVOKE = 1).
 *
 * Deduplicação: um REVOKE pode chegar por `messages.update` e a mensagem de
 * protocolo também passar pelo `messages.upsert`. Um mapa com TTL curto
 * garante que a ação é aplicada UMA única vez por mensagem.
 */

'use strict';

const logger = require('../utils/logger').child('events');
const groups = require('../database/groups');
const autobot = require('../utils/autobot');
const antiManager = require('../utils/antiManager');
const permissions = require('../utils/permissions');
const groupMeta = require('../utils/groupMeta');
const janitor = require('../utils/janitor');

const REVOKE = 1; // WAMessageStubType.REVOKE

/* ----------------------------- deduplicação ---------------------------- */

const seen = new Map(); // "tipo|id" -> timestamp
const SEEN_TTL_MS = 5 * 60 * 1000;

function alreadyHandled(kind, id) {
  if (!id) return false;
  const key = `${kind}|${id}`;
  if (seen.has(key)) return true;
  if (seen.size > 5000) seen.delete(seen.keys().next().value);
  seen.set(key, Date.now());
  return false;
}

janitor.register(
  'events-seen',
  () => {
    const cutoff = Date.now() - SEEN_TTL_MS;
    for (const [k, ts] of seen) if (ts < cutoff) seen.delete(k);
  },
  5 * 60 * 1000
);

/* -------------------------------- helpers ------------------------------ */

/** Contexto mínimo para reaproveitar o antiManager (que só precisa destes campos). */
async function eventContext(sock, jid, sender, key, extra = {}) {
  const isGroup = String(jid || '').endsWith('@g.us');
  let isBotAdmin = false;
  let participants = [];
  if (isGroup) {
    const meta = await groupMeta.get(sock, jid);
    participants = (meta && meta.participants) || [];
    const botJid = (sock.user && sock.user.id) || '';
    const botLid = (sock.user && sock.user.lid) || '';
    isBotAdmin = permissions.isBotAdmin(participants, botLid ? [botJid, botLid] : botJid);
  }
  return {
    socket: sock,
    message: { key },
    remoteJid: jid,
    sender: sender || jid,
    isGroup,
    isCommunity: false,
    isAdmin: isGroup ? permissions.isAdmin(participants, sender) : false,
    isOwner: permissions.isOwner(sender),
    isBotAdmin,
    isBot: sender === ((sock.user && sock.user.id) || '') || sender === ((sock.user && sock.user.lid) || ''),
    isPrivate: !isGroup,
    mentionedJid: [],
    text: '',
    mediaType: null,
    ...extra,
  };
}

/** Avisa no grupo + registra no log. Nunca lança. */
async function notify(sock, ctx, text) {
  if (!ctx.isGroup || !text) return;
  try {
    await sock.sendMessage(ctx.remoteJid, { text, mentions: [ctx.sender] });
  } catch (_) {}
}

/* --------------------------- messages.update --------------------------- */

/**
 * @param {object} sock
 * @param {Array} updates [{ key, update }]
 */
async function handleMessageUpdate(sock, updates) {
  for (const item of updates || []) {
    const key = item && item.key;
    const update = item && item.update;
    if (!key || !update || !key.remoteJid) continue;
    if (!key.remoteJid.endsWith('@g.us')) continue;
    if (key.fromMe) continue;

    const isEdit = !!(update.message && update.message.editedMessage);
    const isRevoke = update.messageStubType === REVOKE || (update.message === null && update.key);

    if (!isEdit && !isRevoke) continue;

    const jid = key.remoteJid;
    const sender = key.participant || key.participantAlt || key.remoteJid;
    const antiId = isEdit ? 'antieditarmensagem' : 'antiapagarmensagem';
    if (!autobot.isEnabled(jid, antiId)) continue;

    const kind = isEdit ? 'edit' : 'revoke';
    if (alreadyHandled(kind, `${jid}:${key.id}`)) continue;

    const ctx = await eventContext(sock, jid, sender, key);
    if (ctx.isOwner || ctx.isAdmin || ctx.isBot) continue;

    // edição: a mensagem editada ainda existe → pode ser apagada.
    // revoke: a mensagem já foi apagada pelo autor → só a ação sobre ele é possível.
    const result = await antiManager.executeAntiAction(sock, ctx, antiId, undefined, {
      skipDelete: !isEdit,
    });

    logger.info(
      { grupo: jid, usuario: sender, anti: antiId, acao: result.action, apagada: result.deleted },
      isEdit ? 'anti editar mensagem acionado' : 'anti apagar mensagem acionado'
    );

    const mention = `@${String(sender).split('@')[0]}`;
    const base = isEdit ? '✏️ Edição de mensagem não é permitida' : '🗑️ Apagar mensagem não é permitido';
    if (!result.deleted) await notify(sock, ctx, `${base}, ${mention}.`);
    if (result.action && result.action !== 'delete') {
      const reason = antiManager.reasonFor(antiId);
      const labels = {
        warn: `⚠️ ${mention} advertido por: ${reason}`,
        mute: `🔇 ${mention} mutado por: ${reason}`,
        ban: `🚫 ${mention} banido por: ${reason}`,
        kick: `👢 ${mention} removido por: ${reason}`,
      };
      if (labels[result.action]) await notify(sock, ctx, labels[result.action]);
    }
  }
}

/* --------------------------- messages.reaction ------------------------- */

/**
 * @param {object} sock
 * @param {Array} reactions [{ key, reaction }]
 */
async function handleReactions(sock, reactions) {
  for (const item of reactions || []) {
    const reaction = item && item.reaction;
    if (!reaction) continue;
    const target = item.key; // mensagem reagida
    const jid = (target && target.remoteJid) || (reaction.key && reaction.key.remoteJid);
    if (!jid || !String(jid).endsWith('@g.us')) continue;
    // reação removida (texto vazio) — o usuário desfez; não é infração
    if (!reaction.text) continue;
    if (reaction.key && reaction.key.fromMe) continue;
    if (!autobot.isEnabled(jid, 'antireacao')) continue;

    const sender =
      (reaction.key && (reaction.key.participant || reaction.key.participantAlt)) ||
      (reaction.senderJid || jid);

    if (alreadyHandled('reaction', `${jid}:${reaction.key && reaction.key.id}:${sender}`)) continue;

    const ctx = await eventContext(sock, jid, sender, reaction.key || target);
    if (ctx.isOwner || ctx.isAdmin || ctx.isBot) continue;

    // apagar a mensagem da REAÇÃO remove a reação do chat
    const result = await antiManager.executeAntiAction(sock, ctx, 'antireacao', undefined, {
      key: reaction.key,
      skipDelete: false,
    });

    logger.info(
      { grupo: jid, usuario: sender, apagada: result.deleted, acao: result.action },
      'anti reação acionado'
    );

    const mention = `@${String(sender).split('@')[0]}`;
    if (result.action && result.action !== 'delete') {
      const reason = antiManager.reasonFor('antireacao');
      const labels = {
        warn: `⚠️ ${mention} advertido por: ${reason}`,
        mute: `🔇 ${mention} mutado por: ${reason}`,
        ban: `🚫 ${mention} banido por: ${reason}`,
        kick: `👢 ${mention} removido por: ${reason}`,
      };
      if (labels[result.action]) await notify(sock, ctx, labels[result.action]);
    } else if (!result.deleted) {
      await notify(sock, ctx, `🚫 Reações não são permitidas, ${mention}.`);
    }
  }
}

/* --------------------------------- call -------------------------------- */

/**
 * @param {object} sock
 * @param {Array} calls [{ id, from, status, isVideo, isGroup, chatId }]
 */
async function handleCalls(sock, calls) {
  for (const call of calls || []) {
    if (!call || call.status !== 'offer') continue; // só a chamada recebida
    const from = call.from;
    if (!from || !autobot.isEnabled(call.chatId || from, 'antichamada')) continue;

    const jid = call.chatId || from;
    const groupJid = call.isGroup ? call.groupJid || call.chatId : null;
    const room = groupJid || jid;

    // grupos: o anti só vale no grupo onde a chamada aconteceu
    if (call.isGroup && groupJid && !autobot.isEnabled(groupJid, 'antichamada')) continue;

    try {
      if (typeof sock.rejectCall === 'function') await sock.rejectCall(call.id, from);
    } catch (err) {
      logger.warn({ err: err.message }, 'falha ao rejeitar chamada');
    }

    logger.info({ de: from, grupo: groupJid || '-', video: !!call.isVideo }, 'anti chamada: chamada rejeitada');

    if (groupJid && alreadyHandled('call', `${groupJid}:${call.id}`)) continue;
    const ctx = await eventContext(sock, room, from, { remoteJid: room, id: call.id });
    if (ctx.isOwner || ctx.isAdmin || ctx.isBot) continue;

    const result = await antiManager.executeAntiAction(sock, ctx, 'antichamada', undefined, {
      skipDelete: true,
      force: true,
    });
    const mention = `@${String(from).split('@')[0]}`;
    if (result.action && result.action !== 'delete') {
      const reason = antiManager.reasonFor('antichamada');
      const labels = {
        warn: `⚠️ ${mention} advertido por: ${reason}`,
        mute: `🔇 ${mention} mutado por: ${reason}`,
        ban: `🚫 ${mention} banido por: ${reason}`,
        kick: `👢 ${mention} removido por: ${reason}`,
      };
      if (labels[result.action]) await notify(sock, ctx, labels[result.action]);
    } else {
      await notify(sock, ctx, `📵 Chamadas não são permitidas aqui, ${mention}.`);
    }
  }
}

module.exports = {
  handleMessageUpdate,
  handleReactions,
  handleCalls,
  eventContext,
  alreadyHandled,
  REVOKE,
};
