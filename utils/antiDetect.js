/**
 * utils/antiDetect.js — detecção PURA dos antis.
 *
 * Cada função responde "esta mensagem aciona este anti?" sem efeito colateral,
 * sem banco e sem rede. Isso permite testar cada detecção isoladamente e deixa
 * o handler (groupHandler) só com a responsabilidade de aplicar a ação.
 *
 * Os tipos usados aqui são os que a versão do Baileys do projeto realmente
 * entrega — checados em vendor/boruto-vk7-baileys/WAProto/E2E/E2E.proto:
 *   pagamento  → requestPaymentMessage, sendPaymentMessage, paymentInviteMessage,
 *                invoiceMessage, orderMessage, decline/cancelPaymentRequestMessage
 *   catálogo   → productMessage
 *   enquete    → pollCreationMessage(V2..V5), pollResultSnapshotMessage
 *   canal      → newsletterAdminInviteMessage + forwardedNewsletterMessageInfo
 *   status     → statusMentionMessage, groupStatusMentionMessage,
 *                groupStatusMessage(V2), statusNotificationMessage, statusAddYours
 *   comunidade → commentMessage, encCommentMessage, parentGroupJid
 *   bot        → botInvokeMessage, botForwardedMessage, botTaskMessage
 *   eventos    → eventMessage (live), liveLocationMessage (localização real)
 */

'use strict';

const CONFIG = require('../config');
const { unwrapViewOnce, isViewOnce, findContextInfo, detectMediaType } = require('./messages');
const toxicFilter = require('./toxicFilter');

/* ------------------------------- helpers ------------------------------- */

/** Mensagem interna (já desembrulhada de view-once/efêmera). */
function inner(ctx) {
  const m = ctx && ctx.message && ctx.message.message;
  if (!m) return null;
  return unwrapViewOnce(m) || m;
}

function ctxInfo(ctx) {
  const m = inner(ctx);
  return m ? findContextInfo(m) : null;
}

function textOf(ctx) {
  return String((ctx && ctx.text) || '');
}

function has(m, key) {
  return !!(m && m[key]);
}

/* ------------------------------- links --------------------------------- */

const URL_RE = /(?:https?:\/\/|www\.)[^\s]+/gi;
const SHORTENERS = [
  'bit.ly', 'tinyurl.com', 'cutt.ly', 'shorte.st', 'is.gd', 't.co', 'goo.gl',
  'ow.ly', 'rb.gy', 'shorturl.at', 'encurta.net', 'abre.ai', 'linktr.ee',
];
const KNOWN_TLDS = [
  'com', 'net', 'org', 'br', 'io', 'me', 'tv', 'xyz', 'info', 'app', 'online',
  'site', 'shop', 'link', 'live', 'cloud', 'gg', 'tk', 'ml', 'ga', 'cf', 'gq',
  'store', 'blog', 'dev', 'edu', 'gov', 'pw', 'top', 'cc', 'us', 'uk',
];
const DOMAIN_RE = new RegExp(
  `\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${KNOWN_TLDS.join('|')})\\b`,
  'i'
);

/** Remove ofuscações comuns (hxxp, site[.]com, site(.)com, " dot "). */
function deobfuscate(text) {
  return String(text || '')
    .replace(/h\s*x\s*x\s*p/gi, 'http')
    .replace(/\[\s*\.\s*\]/g, '.')
    .replace(/\(\s*\.\s*\)/g, '.')
    .replace(/\{\s*\.\s*\}/g, '.')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+dot\s*$/gi, '.');
}

function findLinks(text) {
  const out = [];
  for (const m of String(text || '').matchAll(URL_RE)) out.push(m[0]);
  return out;
}

function hasLink(text) {
  return findLinks(text).length > 0;
}

/** Link sem protocolo ("site.com.br"), encurtador ou ofuscado. */
function hasLooseLink(text) {
  const t = deobfuscate(text);
  if (hasLink(t)) return true;
  if (DOMAIN_RE.test(t)) return true;
  const lower = t.toLowerCase();
  return SHORTENERS.some((d) => lower.includes(d));
}

const INVITE_RE = /(chat\.whatsapp\.com\/|wa\.me\/|whatsapp\.com\/(?:channel|join|c)\/|whatsapp\.com\/c\/)/i;

function hasInvite(ctx) {
  const m = inner(ctx);
  if (has(m, 'groupInviteMessage')) return true;
  return INVITE_RE.test(textOf(ctx));
}

const CATALOG_RE = /(wa\.me\/c\/|whatsapp\.com\/c\/|\/catalog\b|catalog\?)/i;

function hasCatalog(ctx) {
  const m = inner(ctx);
  if (has(m, 'productMessage')) return true;
  return CATALOG_RE.test(textOf(ctx));
}

/* ---------------------------- pagamento -------------------------------- */

const PAYMENT_TYPES = [
  'requestPaymentMessage',
  'sendPaymentMessage',
  'paymentInviteMessage',
  'invoiceMessage',
  'orderMessage',
  'declinePaymentRequestMessage',
  'cancelPaymentRequestMessage',
];

const PIX_DOMAINS = [
  'pix.gg', 'livepix.gg', 'nubank.com.br', 'picpay.me', 'picpay.com', 'paypal.me',
  'paypal.com', 'mpago.la', 'mercadopago', 'pagseguro', 'pag.ae', 'doa.re',
  'pay.kiwi', 'ko-fi.com', 'buymeacoffee.com', 'iti.itau', 'efi.com.br',
  'gerencianet', 'bb.com.br', 'caixa.gov.br', 'santander.com.br', 'inter.co',
  'bradesco.com.br', 'stone.com.br', 'infinitepay', 'pagbank', 'asaas',
];

const PIX_TEXT_RE = [
  /br\.gov\.bcb\.pix/i,
  /\bpix\b/i,
  /chave\s*(?:pix)?\s*[:=]/i,
  /c[óo]digo\s*(?:do\s*)?pix/i,
  /qr\s*code\s*(?:do\s*)?pix/i,
  /copia\s*e\s*cola/i,
  /transfer[êe]ncia\s+(?:via\s+)?(?:pix|ted|doc)/i,
  /comprovante\s+de\s+(?:pagamento|transfer[êe]ncia|pix)/i,
  /me\s+(?:manda|paga|envia)\s+(?:o\s+)?pix/i,
  /pagar?\s+(?:no|via)\s+pix/i,
  /(?:nubank|picpay|mercado\s*pago|pagseguro|paypal|inter|caixa|itau|ita[úu]|bradesco|santander|banco\s*do\s*brasil)[^\n]{0,40}(?:pix|chave|conta|ag[êe]ncia|transfer)/i,
  /(?:ag[êe]ncia|conta|cpf|cnpj)\s*[:=]?\s*\d/i,
];

/** Chave PIX no formato bruto (email, telefone, CPF/CNPJ, chave aleatória). */
function looksLikePix(text) {
  const t = String(text || '');
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(t)) return true; // chave aleatória
  if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(t)) return true; // CPF
  if (/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/.test(t)) return true; // CNPJ
  if (/(?:^|\s)\+?\d{2}\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}(?:\s|$)/.test(t)) return true; // telefone
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(t) && /\bpix\b|chave/i.test(t)) return true;
  return false;
}

function isPayment(ctx) {
  const m = inner(ctx);
  if (!m) return false;
  if (PAYMENT_TYPES.some((k) => has(m, k))) return true;

  // comprovante / QR enviado como arquivo ou imagem
  const doc = (m.documentMessage || (m.documentWithCaptionMessage && m.documentWithCaptionMessage.message
    && m.documentWithCaptionMessage.message.documentMessage)) || null;
  if (doc) {
    const name = String(doc.fileName || '').toLowerCase();
    if (/(comprovante|recibo|pix|pagamento|transferencia|transferência|pagar)/.test(name)) return true;
  }

  // fluxos interativos de pagamento (native flow)
  const rich = m.interactiveMessage || m.buttonsMessage || m.templateMessage || m.listMessage;
  if (rich) {
    const raw = JSON.stringify(rich).toLowerCase();
    if (raw.includes('payment_request') || raw.includes('review_and_pay') || raw.includes('pix')) return true;
  }

  const text = `${textOf(ctx)}`;
  if (!text) return false;
  const lower = text.toLowerCase();
  if (PIX_DOMAINS.some((d) => lower.includes(d))) return true;
  if (PIX_TEXT_RE.some((re) => re.test(text))) return true;
  if (/\bpix\b|chave|comprovante|pagamento|cobran[çc]a/i.test(text) && looksLikePix(text)) return true;
  return false;
}

/* ------------------------------ status --------------------------------- */

const STATUS_TYPES = [
  'statusMentionMessage',
  'groupStatusMentionMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
  'statusNotificationMessage',
  'statusAddYours',
  'statusQuestionAnswerMessage',
  'statusMentionMessage',
];

function isStatusContent(ctx) {
  const m = inner(ctx);
  if (!m) return false;
  if (STATUS_TYPES.some((k) => has(m, k))) return true;
  const info = ctxInfo(ctx);
  if (info) {
    if (String(info.remoteJid || '') === 'status@broadcast') return true;
    if (info.isGroupStatus) return true;
    if (info.statusSourceType) return true;
  }
  const t = textOf(ctx);
  return /(?:wa\.me\/s\/|whatsapp\.com\/status|status@broadcast)/i.test(t);
}

/* --------------------------- comunidade/canal -------------------------- */

function isCommunityContent(ctx) {
  const m = inner(ctx);
  if (!m) return false;
  if (has(m, 'commentMessage') || has(m, 'encCommentMessage')) return true;
  const info = ctxInfo(ctx);
  // parentGroupJid aparece em TODA mensagem de grupo vinculado a comunidade;
  // só é sinal de "conteúdo de comunidade" quando o grupo NÃO é comunidade.
  if (info && info.parentGroupJid && !(ctx && ctx.isCommunity)) return true;
  return false;
}

function isChannelContent(ctx) {
  const m = inner(ctx);
  if (!m) return false;
  if (has(m, 'newsletterAdminInviteMessage')) return true;
  const info = ctxInfo(ctx);
  if (info && info.forwardedNewsletterMessageInfo) return true;
  return /whatsapp\.com\/channel\//i.test(textOf(ctx));
}

/* ------------------------------ enquetes ------------------------------- */

function isPoll(ctx) {
  const m = inner(ctx);
  if (!m) return false;
  return !!(
    m.pollCreationMessage ||
    m.pollCreationMessageV2 ||
    m.pollCreationMessageV3 ||
    m.pollCreationMessageV4 ||
    m.pollCreationMessageV5 ||
    m.pollResultSnapshotMessage ||
    m.pollUpdateMessage
  );
}

/* ------------------------------- eventos ------------------------------- */

function isForwarded(ctx) {
  const info = ctxInfo(ctx);
  if (!info) return false;
  if (info.isForwarded) return true;
  return Number(info.forwardingScore || 0) > 0;
}

function isMassMention(ctx, limit = 5) {
  const info = ctxInfo(ctx);
  if (info && Array.isArray(info.groupMentions) && info.groupMentions.length > 0) return true;
  const mentioned = (ctx && ctx.mentionedJid) || [];
  return mentioned.length >= limit;
}

function isGif(ctx) {
  const m = inner(ctx);
  return !!((m && m.videoMessage) && m.videoMessage.gifPlayback === true);
}

function isLiveLocation(ctx) {
  const m = inner(ctx);
  return has(m, 'liveLocationMessage');
}

function isEvent(ctx) {
  const m = inner(ctx);
  return has(m, 'eventMessage');
}

function isBotContent(ctx) {
  const m = inner(ctx);
  if (!m) return false;
  if (has(m, 'botInvokeMessage') || has(m, 'botForwardedMessage') || has(m, 'botTaskMessage')) return true;
  const info = ctxInfo(ctx);
  return !!(info && info.forwardedAiBotMessageInfo);
}

/* ------------------------------- arquivos ------------------------------ */

const FILE_KINDS = {
  antiapk: ['.apk', '.xapk', '.apks', '.aab'],
  antizip: ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'],
  antiexe: ['.exe', '.bat', '.cmd', '.msi', '.com', '.scr', '.sh', '.jar', '.vbs'],
  antipdf: ['.pdf'],
};

function documentName(ctx) {
  const m = inner(ctx);
  if (!m) return '';
  const doc =
    m.documentMessage ||
    (m.documentWithCaptionMessage &&
      m.documentWithCaptionMessage.message &&
      m.documentWithCaptionMessage.message.documentMessage) ||
    null;
  return doc ? String(doc.fileName || '') : '';
}

function fileKind(ctx) {
  const name = documentName(ctx).toLowerCase();
  if (!name) return null;
  for (const [kind, exts] of Object.entries(FILE_KINDS)) {
    if (exts.some((e) => name.endsWith(e))) return kind;
  }
  return null;
}

/* ------------------------------- texto --------------------------------- */

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function emojiCount(text) {
  const m = String(text || '').match(EMOJI_RE);
  return m ? m.length : 0;
}

function isSymbolHeavy(text) {
  const t = String(text || '');
  if (t.length <= 2) return false;
  const symbols = (t.match(/[^\w\sà-úÀ-Ú]/g) || []).length;
  return symbols / t.length > 0.7;
}

function isToxic(text) {
  const check = toxicFilter.containsToxic(text || '');
  return { toxic: !!check.toxic, level: Number(check.level) || 0 };
}

/* ------------------------- detecção principal -------------------------- */

/**
 * Lista TODOS os antis acionados pela mensagem, em ordem de prioridade.
 * @param {object} ctx contexto construído pelo commandHandler
 * @param {(id:string)=>boolean} isOn quais antis estão ligados
 * @param {object} [opts] { limiteCaracteres, limiteTexto, limiteEmoji, limiteMencao }
 * @returns {string[]}
 */
function detect(ctx, isOn, opts = {}) {
  const hits = [];
  const on = (id) => (typeof isOn === 'function' ? !!isOn(id) : false);

  const text = textOf(ctx);
  const media = (ctx && ctx.mediaType) || detectMediaType(ctx && ctx.message);

  /* --- prioridade 1: dinheiro e convites (mais críticos) --- */
  if (on('antipix') && isPayment(ctx)) hits.push('antipix');
  if (on('antilinkgp') && hasInvite(ctx)) hits.push('antilinkgp');
  if (on('antilink') && hasLink(text)) hits.push('antilink');
  else if (on('antilink2') && hasLooseLink(text)) hits.push('antilink2');
  if (on('anticatalogo') && hasCatalog(ctx)) hits.push('anticatalogo');

  /* --- prioridade 2: tipos de mensagem perigosos --- */
  if (on('antibot') && isBotContent(ctx)) hits.push('antibot');
  if (on('antienquete') && isPoll(ctx)) hits.push('antienquete');
  if (on('anticomunidade') && isCommunityContent(ctx)) hits.push('anticomunidade');
  if (on('anticanal') && isChannelContent(ctx)) hits.push('anticanal');
  if (on('antistatus') && isStatusContent(ctx)) hits.push('antistatus');
  if (on('antiencaminhamento') && isForwarded(ctx)) hits.push('antiencaminhamento');
  if (on('antimencaomassa') && isMassMention(ctx, opts.limiteMencao || 5)) hits.push('antimencaomassa');

  /* --- prioridade 3: mídia específica --- */
  if (on('antiviewonce') && isViewOnce(ctx && ctx.message)) hits.push('antiviewonce');
  if (on('antigif') && isGif(ctx)) hits.push('antigif');
  if (on('antilive') && isEvent(ctx)) hits.push('antilive');
  if (on('antilocalizacaotemp') && isLiveLocation(ctx)) hits.push('antilocalizacaotemp');

  const kind = fileKind(ctx);
  if (kind && on(kind)) hits.push(kind);

  if (on('antimedia')) hits.push('antimedia');
  if (media === 'image' && on('antiimagem')) hits.push('antiimagem');
  if (media === 'video' && on('antivideo')) hits.push('antivideo');
  if (media === 'audio' && on('antiaudio')) hits.push('antiaudio');
  if (media === 'document' && on('antidocumento')) hits.push('antidocumento');
  if (media === 'sticker' && on('antisticker')) hits.push('antisticker');
  if (media === 'location' && on('antilocalizacao')) hits.push('antilocalizacao');
  if (media === 'contact' && on('anticontato')) hits.push('anticontato');

  /* --- prioridade 4: texto --- */
  const len = text.length;
  if (on('limitecaracteres') && len > (opts.limiteCaracteres || 1200)) hits.push('limitecaracteres');
  else if (on('antitextogigante') && len > (opts.limiteTexto || 4000)) hits.push('antitextogigante');
  if (on('antiemojispam') && emojiCount(text) >= (opts.limiteEmoji || 10)) hits.push('antiemojispam');
  if (on('antiparentese') && isSymbolHeavy(text)) hits.push('antiparentese');

  if (on('antipalavrao') || on('antitoxic')) {
    const t = isToxic(text);
    if (t.toxic && t.level >= 1) {
      if (on('antipalavrao')) hits.push('antipalavrao');
      else if (on('antitoxic')) hits.push('antitoxic');
    }
  }

  return hits;
}

module.exports = {
  detect,
  findLinks,
  inner,
  ctxInfo,
  hasLink,
  hasLooseLink,
  hasInvite,
  hasCatalog,
  isPayment,
  isStatusContent,
  isCommunityContent,
  isChannelContent,
  isPoll,
  isForwarded,
  isMassMention,
  isGif,
  isLiveLocation,
  isEvent,
  isBotContent,
  isViewOnce,
  documentName,
  fileKind,
  emojiCount,
  isSymbolHeavy,
  isToxic,
  looksLikePix,
  deobfuscate,
  URL_RE,
  INVITE_RE,
  PIX_DOMAINS,
  FILE_KINDS,
};
