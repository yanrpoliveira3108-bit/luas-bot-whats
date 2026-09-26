'use strict';

const logger = require('./logger').child('quoteForward');

function unwrapMessage(message) {
  let current = message && typeof message === 'object' ? message : null;
  for (let i = 0; i < 6 && current; i++) {
    const wrapper = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage', 'deviceSentMessage']
      .find((key) => current[key] && current[key].message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current || message;
}

function findContextInfo(message) {
  const raw = message && typeof message === 'object' ? message : {};
  for (const value of Object.values(raw)) {
    if (!value || typeof value !== 'object') continue;
    if (value.contextInfo) return value.contextInfo;
    if (value.message) {
      const nested = findContextInfo(value.message);
      if (nested) return nested;
    }
  }
  return null;
}

function safeForwardContext(message) {
  const source = findContextInfo(message);
  if (!source) return undefined;
  // A quote inside the quoted message identifies the original incoming message;
  // carrying it to the new publication would create an unintended nested reply.
  const { stanzaId, quotedMessage, participant, remoteJid, ...preserved } = source;
  return preserved;
}

function quotedContent(ctx) {
  const raw = ctx && ctx.quoted;
  if (!raw || typeof raw !== 'object') return null;
  // buildContext normally exposes quotedMessage (IMessage). Accept a complete
  // WAMessage too, because some fork paths attach the key around it.
  return raw.key && raw.message ? raw.message : raw;
}

function buildForwardContent(ctx, mentions = []) {
  const quoted = quotedContent(ctx);
  if (!quoted) return null;
  const content = {
    forward: { message: { message: quoted } },
    force: false,
  };
  const contextInfo = safeForwardContext(quoted);
  if (contextInfo && Object.keys(contextInfo).length) content.contextInfo = contextInfo;
  if (mentions.length) content.mentions = mentions;
  return content;
}

async function forwardQuoted({ ctx, command, mentions: mentionList = [] }) {
  const quoted = quotedContent(ctx);
  const normalized = quoted && unwrapMessage(quoted);
  const quotedType = normalized ? Object.keys(normalized)[0] || 'unknown' : 'none';
  const context = quoted && findContextInfo(quoted);
  const input = {
    command,
    hasQuoted: Boolean(quoted),
    quotedType,
    hasQuotedMessage: Boolean(quoted),
    quotedMessageKeys: quoted && typeof quoted === 'object' ? Object.keys(quoted) : [],
    hasContextInfo: Boolean(context),
  };
  logger.info(input, '[QUOTE_FORWARD] input');
  const hasNewsletterInfo = Boolean(context && context.forwardedNewsletterMessageInfo);
  logger.info({ command, quotedType, hasContextInfo: Boolean(context), hasNewsletterInfo }, '[QUOTE_FORWARD] prepare');
  if (!quoted) return { sent: false, mode: 'none' };
  const mentions = Array.isArray(mentionList) ? mentionList.filter(Boolean) : [];
  let content;
  try {
    content = buildForwardContent(ctx, mentions);
  } catch (err) {
    logger.error({ command, stage: 'prepare', quotedType, errorName: err && err.name, errorCode: err && err.code, errorMessage: err && err.message, stack: err && err.stack }, '[QUOTE_FORWARD_ERROR]');
    throw err;
  }
  try {
    await ctx.socket.sendMessage(ctx.remoteJid, content);
    logger.info({ command, mode: 'forward', mentionsCount: mentions.length }, '[QUOTE_FORWARD] send');
    logger.info({ success: true }, '[QUOTE_FORWARD] result');
    return { sent: true, mode: 'forward' };
  } catch (err) {
    logger.error({ command, stage: 'send', quotedType, errorName: err && err.name, errorCode: err && err.code, errorMessage: err && err.message, stack: err && err.stack }, '[QUOTE_FORWARD_ERROR]');
    logger.warn({ command, mode: 'forward', success: false, errorCode: err && err.code, errorMessage: err && err.message }, '[QUOTE_FORWARD] result');
    throw err;
  }
}

module.exports = { unwrapMessage, findContextInfo, buildForwardContent, forwardQuoted };
