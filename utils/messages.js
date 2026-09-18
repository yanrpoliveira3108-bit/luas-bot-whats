/**
 * utils/messages.js — parsing e extração de conteúdo de mensagens Baileys.
 *
 * Centraliza os detalhes internos do Baileys para que comandos e handlers
 * não precisem conhecer a estrutura da mensagem.
 */

'use strict';

const CONFIG = require('../config');

/**
 * Remove as camadas de "visualização única" / efêmera de uma mensagem.
 * O WhatsApp embrulha a mídia em `viewOnceMessage.message`,
 * `viewOnceMessageV2.message` ou `viewOnceMessageV2Extension.message`.
 * Devolve a mensagem interna (com imageMessage/videoMessage/audioMessage).
 */
function unwrapViewOnce(msg) {
  let m = msg;
  for (let i = 0; i < 4 && m && typeof m === 'object'; i++) {
    if (m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension) {
      m = (m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension).message || null;
    } else if (m.ephemeralMessage) {
      m = m.ephemeralMessage.message || null;
    } else {
      break;
    }
  }
  return m || null;
}

/** A mensagem (ou a citada) é de visualização única? */
function isViewOnce(m) {
  let msg = m && m.message ? m.message : m;
  if (!msg || typeof msg !== 'object') return false;
  if (msg.viewOnceMessage || msg.viewOnceMessageV2 || msg.viewOnceMessageV2Extension) return true;
  // alguns fluxos entregam a mídia sem o wrapper, mas com a flag viewOnce: true
  const inner = unwrapViewOnce(msg);
  const media = inner && (inner.imageMessage || inner.videoMessage || inner.audioMessage);
  return !!(media && media.viewOnce === true);
}

/** Encontra o contextInfo em qualquer subtipo de mensagem conhecido. */
function findContextInfo(msg) {
  if (!msg || typeof msg !== 'object') return null;
  msg = unwrapViewOnce(msg) || msg;
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
  let msg = m && m.message;
  if (!msg) return '';
  msg = unwrapViewOnce(msg) || msg;
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

/**
 * JID do AUTOR da mensagem citada (a mensagem respondida), canonizado p/ PN.
 *
 * Permite que comandos de alvo usem "responder à mensagem" em vez de digitar
 * @número. Em grupos LID, `contextInfo.participant` pode vir como @lid; o PN
 * fica em `participantAlt` — preferimos o PN (o bot é chaveado por PN).
 *
 * @returns {string} JID do autor citado, ou '' se a mensagem não é uma resposta.
 */
function getQuotedSender(m) {
  const ctx = findContextInfo(m && m.message);
  if (!ctx) return '';
  const p = String(ctx.participant || '');
  const alt = String(ctx.participantAlt || '');
  if (p.endsWith('@lid') && alt && !alt.endsWith('@lid')) return alt;
  return p;
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
  let msg = m && m.message;
  if (!msg) return null;
  msg = unwrapViewOnce(msg) || msg;
  if (msg.imageMessage) return 'image';
  if (msg.videoMessage) return 'video';
  if (msg.audioMessage) return 'audio';
  if (msg.stickerMessage) return 'sticker';
  if (msg.documentMessage || msg.documentWithCaptionMessage) return 'document';
  if (msg.locationMessage) return 'location';
  if (msg.contactMessage) return 'contact';
  return null;
}

/**
 * JID do remetente de uma mensagem, canonizado para PN (número de telefone).
 *
 * O WhatsApp está migrando grupos para endereçamento LID: nessas mensagens
 * `key.participant` vem como LID (ex.: 123456789@lid) e o PN fica em
 * `key.participantAlt`. Como o bot (banco, XP, admins, dono) é todo chaveado
 * por PN, preferimos o PN sempre que disponível.
 */
function resolveSender(m) {
  const key = m && m.key;
  if (!key) return '';
  const remoteJid = key.remoteJid || '';
  if (!isGroupJid(remoteJid)) return remoteJid;
  const p = String(key.participant || '');
  const alt = String(key.participantAlt || '');
  if (p.endsWith('@lid') && alt && !alt.endsWith('@lid')) return alt;
  return p || remoteJid;
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
  // LISTA nativa (native flow single_select) com cabeçalho de mídia: o clique
  // chega como interactiveResponseMessage → nativeFlowResponseMessage
  // (name: 'single_select') com o id da linha em paramsJson (JSON).
  if (msg.interactiveResponseMessage) {
    const nf = msg.interactiveResponseMessage.nativeFlowResponseMessage;
    if (nf && nf.paramsJson) {
      try {
        const p = JSON.parse(nf.paramsJson);
        return { type: 'list', id: p.id || p.title || null };
      } catch (_) {
        return { type: 'list', id: null };
      }
    }
    return { type: 'list', id: null };
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

/**
 * Devolve as args SEM os tokens de menção.
 *
 * O parser (`splitCommand`) só corta por espaços: "!pagar @fulano 100" gera
 * `args = ['@fulano', '100']`, enquanto `mentionedJid` vem do `contextInfo` da
 * mensagem, por outro caminho. Ler o valor em `args[0]` quando há menção
 * significa ler "@fulano" — e `parseInt('@fulano')` é NaN. Esse foi o bug real
 * de !pagar/!presente (e dos comandos de economia do Life).
 *
 * Remover o token (em vez de só pular uma posição) é robusto: vale para
 * "!pagar @fulano 100" e para "!pagar 100 @fulano". Sem menção, nada muda.
 *
 * Regra: havendo ao menos uma menção, todo token que começa com "@" é tratado
 * como menção. Nos comandos que usam isto o que sobra é valor/quantidade/item,
 * e nenhum deles começa com "@" — então nada útil é perdido, e funciona tanto
 * com o texto real do WhatsApp (@<número>) quanto com um apelido digitado.
 *
 * @param {string[]} args        args do contexto (já sem o comando)
 * @param {string[]} mentionedJid JIDs mencionados
 * @returns {string[]} novo array — nunca muta o original
 */
function dropMentionArgs(args, mentionedJid) {
  const list = Array.isArray(args) ? args : [];
  const jids = Array.isArray(mentionedJid) ? mentionedJid : [];
  if (!jids.length) return list.slice();
  // toda menção começa com "@" (o texto real do WhatsApp é "@<número>"; um
  // apelido digitado também). Como o que sobra é valor/quantidade/item — nada
  // disso começa com "@" — filtrar por prefixo cobre os casos sem heurística.
  return list.filter((a) => !String(a).trim().startsWith('@'));
}

/**
 * Inteiro POSITIVO a partir de uma arg textual.
 *
 * `parseInt('1.5')` devolve 1 — truncamento silencioso que fazia !pagar cobrar
 * um valor diferente do digitado. Aqui só passa número inteiro sem sinal:
 * '150' → 150; '1.5', 'abc', '-5', '1e3', '' → null (o chamador decide o aviso).
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
function toPositiveInt(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
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
  getQuotedSender,
  getQuotedText,
  getMentionedJids,
  detectMediaType,
  resolveSender,
  unwrapViewOnce,
  isViewOnce,
  getInteractivePayload,
  splitCommand,
  dropMentionArgs,
  toPositiveInt,
  isGroupJid,
  isStatusJid,
  toJid,
};
