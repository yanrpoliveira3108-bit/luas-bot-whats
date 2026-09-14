/**
 * utils/messages.js — parsing e extração de conteúdo de mensagens Baileys.
 *
 * Centraliza os detalhes internos do Baileys para que comandos e handlers
 * não precisem conhecer a estrutura da mensagem.
 */

'use strict';

const CONFIG = require('../config');

/** Encontra o contextInfo em qualquer subtipo de mensagem conhecido. */
function findContextInfo(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.extendedTextMessage) return msg.extendedTextMessage.contextInfo || null;
  if (msg.imageMessage) return msg.imageMessage.contextInfo || null;
  if (msg.videoMessage) return msg.videoMessage.contextInfo || null;
  if (msg.audioMessage) return msg.audioMessage.contextInfo || null;
  if (msg.documentMessage) return msg.documentMessage.contextInfo || null;
  if (msg.documentWithCaptionMessage) return msg.documentWithCaptionMessage.message?.documentMessage?.contextInfo || null;
  if (msg.stickerMessage) return msg.stickerMessage.contextInfo || null;
  if (msg.contactMessage) return msg.contactMessage.contextInfo || null;
  if (msg.locationMessage) return msg.locationMessage.contextInfo || null;
  if (msg.reactionMessage) return msg.reactionMessage.contextInfo || null;
  return null;
}

/**
 * Extrai o texto de uma mensagem (conversa, legenda de mídia etc.).
 * Retorna string vazia quando não há texto.
 */
function extractText(m) {
  const msg = m && m.message;
  if (!msg) return '';
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage) return msg.extendedTextMessage.text || '';
  if (msg.imageMessage) return msg.imageMessage.caption || '';
  if (msg.videoMessage) return msg.videoMessage.caption || '';
  if (msg.documentMessage) return msg.documentMessage.caption || '';
  if (msg.documentWithCaptionMessage) {
    const doc = msg.documentWithCaptionMessage.message?.documentMessage;
    return (doc && doc.caption) || '';
  }
  if (msg.editedMessage) return extractText(msg.editedMessage);
  if (msg.ephemeralMessage) return extractText({ message: msg.ephemeralMessage.message });
  if (msg.viewOnceMessage) return extractText({ message: msg.viewOnceMessage.message });
  if (msg.viewOnceMessageV2) return extractText({ message: msg.viewOnceMessageV2.message });
  if (msg.viewOnceMessageV2Extension) return extractText({ message: msg.viewOnceMessageV2Extension.message });
  return '';
}

/** Mensagem citada (quotedMessage), se existir. */
function getQuoted(m) {
  const ctx = findContextInfo(m && m.message);
  return (ctx && ctx.quotedMessage) || null;
}

/** Chave da mensagem citada (para marcar/citar/deletar). */
function getQuotedKey(m) {
  const ctx = findContextInfo(m && m.message);
  if (!ctx || !ctx.stanzaId) return null;
  return {
    remoteJid: m.key.remoteJid,
    fromMe: false,
    id: ctx.stanzaId,
    participant: ctx.participant || m.key.participant || undefined,
  };
}

/** Texto da mensagem citada. */
function getQuotedText(m) {
  const q = getQuoted(m);
  return q ? extractText({ message: q }) : '';
}

/** Lista de JIDs mencionados. */
function getMentionedJids(m) {
  const ctx = findContextInfo(m && m.message);
  return (ctx && ctx.mentionedJid) || [];
}

/** Subtipo de mídia da mensagem, ou null. */
function detectMediaType(m) {
  const msg = m && m.message;
  if (!msg) return null;
  if (msg.imageMessage) return 'image';
  if (msg.videoMessage) return 'video';
  if (msg.audioMessage) return 'audio';
  if (msg.stickerMessage) return 'sticker';
  if (msg.documentMessage || msg.documentWithCaptionMessage) return 'document';
  return null;
}

/**
 * Detecta payload de resposta interativa (botão ou lista).
 * Retorna { type, id } ou null.
 */
function getInteractivePayload(m) {
  const msg = m && m.message;
  if (!msg) return null;
  if (msg.buttonsResponseMessage) {
    return { type: 'button', id: msg.buttonsResponseMessage.selectedButtonId || null };
  }
  if (msg.listResponseMessage) {
    const s = msg.listResponseMessage.singleSelectReply;
    return { type: 'list', id: (s && s.selectedRowId) || null };
  }
  if (msg.templateButtonReplyMessage) {
    return { type: 'template', id: msg.templateButtonReplyMessage.selectedId || null };
  }
  // Botões nativos (native flow) do @innovatorssoft/baileys 7:
  // o clique chega como interactiveResponseMessage → nativeFlowResponseMessage
  // com o id do botão em paramsJson (JSON).
  if (msg.interactiveResponseMessage) {
    const nf = msg.interactiveResponseMessage.nativeFlowResponseMessage;
    if (nf && nf.paramsJson) {
      try {
        const p = JSON.parse(nf.paramsJson);
        return { type: 'nativeflow', id: p.id || nf.name || null };
      } catch (_) {
        return { type: 'nativeflow', id: nf.name || null };
      }
    }
    return { type: 'nativeflow', id: (nf && nf.name) || null };
  }
  return null;
}

/** Divide texto de comando em [comando, ...args]. */
function splitCommand(text, prefix) {
  const t = String(text || '').trim();
  if (!t.startsWith(prefix)) return null;
  const parts = t.slice(prefix.length).trim().split(/\s+/);
  const command = (parts.shift() || '').toLowerCase();
  const args = parts.filter(Boolean);
  return { command, args, raw: t };
}

/** Verifica se o JID é um grupo. */
function isGroupJid(jid) {
  return String(jid || '').endsWith('@g.us');
}

/** Verifica se o JID é de status/broadcast (ignorar). */
function isStatusJid(jid) {
  return String(jid || '').endsWith('@broadcast') || String(jid || '').endsWith('@status');
}

/** Normaliza "55119... @s.whatsapp.net" -> JID completo. */
function toJid(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (s.includes('@')) return s;
  s = s.replace(/[^\d]/g, '');
  if (!s) return null;
  return `${s}@s.whatsapp.net`;
}

module.exports = {
  findContextInfo,
  extractText,
  getQuoted,
  getQuotedKey,
  getQuotedText,
  getMentionedJids,
  detectMediaType,
  getInteractivePayload,
  splitCommand,
  isGroupJid,
  isStatusJid,
  toJid,
};
