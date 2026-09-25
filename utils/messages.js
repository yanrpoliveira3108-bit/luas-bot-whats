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

/**
 * Chave da mensagem citada (para marcar/citar/deletar/apagar).
 *
 * `fromMe` importa para APAGAR: revogar a mensagem que o PRÓPRIO BOT enviou exige
 * `fromMe: true` — antes esse campo era sempre `false` e por isso apagar a
 * mensagem do bot falhava. Passe os JIDs do bot (`botJids`) para que a chave
 * identifique corretamente de quem é a mensagem citada.
 */
function getQuotedKey(m, botJids = []) {
  const ctx = findContextInfo(m && m.message);
  if (!ctx || !ctx.stanzaId) return null;
  const participant = ctx.participant || m.key.participant || undefined;
  const donos = (Array.isArray(botJids) ? botJids : [botJids]).filter(Boolean).map(String);
  const doBot = donos.length > 0 && donos.includes(String(participant || ''));
  return {
    remoteJid: m.key.remoteJid,
    fromMe: doBot,
    id: ctx.stanzaId,
    participant,
  };
}

/** A mensagem citada foi enviada pelo bot? (usa a chave montada acima) */
function quotedEdoBot(chave) {
  return !!(chave && chave.fromMe);
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
  const cands = resolveSenderCandidates(m);
  return cands[0] || '';
}

/**
 * TODAS as formas plausíveis de identificar quem mandou a mensagem, da mais
 * confiável para a menos: PN conhecido (`participantAlt`/`remoteJidAlt`), o
 * campo bruto do WhatsApp (`participant`) e o próprio chat.
 *
 * Por que existe: grupos em modo LID mandam `participant` como LID e o PN pode
 * faltar; comandos de dono/admin passavam a ser recusados mesmo vindo do dono.
 * Com a lista, o contexto aceita QUALQUER forma que resolva para o dono — e o
 * `,dono` mostra exatamente o que o bot viu.
 */
function resolveSenderCandidates(m) {
  const key = m && m.key;
  if (!key) return [];
  const remoteJid = String(key.remoteJid || '');
  const out = [];
  const push = (v) => {
    const x = String(v || '');
    if (x && !out.includes(x)) out.push(x);
  };
  if (isGroupJid(remoteJid)) {
    push(key.participantAlt);
    push(key.participant);
    // o JID do GRUPO nunca é identidade de quem mandou: só entra se o WhatsApp
    // não informou participante nenhum (mensagem antiga/estranha)
    if (!out.length) push(remoteJid);
  } else {
    push(key.remoteJidAlt);
    push(remoteJid);
  }
  // PN primeiro: em grupo LID o `participant` vem como LID e o telefone, quando
  // existe, vem no campo *Alt. Ordenar aqui garante que `sender` seja o PN.
  const pn = out.filter((j) => !j.endsWith('@lid'));
  const lid = out.filter((j) => j.endsWith('@lid'));
  return pn.concat(lid);
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
  quotedEdoBot,
  getQuotedText,
  getMentionedJids,
  detectMediaType,
  resolveSender,
  resolveSenderCandidates,
  unwrapViewOnce,
  isViewOnce,
  getInteractivePayload,
  splitCommand,
  isGroupJid,
  isStatusJid,
  toJid,
};
