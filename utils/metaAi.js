'use strict';

const crypto = require('crypto');
const logger = require('./logger').child('metaai');
const jidUtils = require('../vendor/boruto-vk7-baileys/lib/WABinary/jid-utils');

const DEBUG_KEY = 'metaai_debug';

function settings() { return require('../database/settings'); }
function isDebug() { return process.env.META_AI_PROBE === '1' || settings().getBool(DEBUG_KEY, false); }

function structuralKeys(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return [];
  return Object.keys(value).slice(0, 40).map((key) => {
    const child = value[key];
    return child && typeof child === 'object' ? `${key}{${structuralKeys(child, depth + 1).join(',')}}` : key;
  });
}

function probeMessage(msg) {
  if (!msg) return false;
  const message = msg.message || {};
  const context = message.messageContextInfo || message.extendedTextMessage?.contextInfo || null;
  const mentionedJids = context && Array.isArray(context.mentionedJid) ? context.mentionedJid : [];
  const botFields = [];
  const walk = (obj, path = '') => {
    if (!obj || typeof obj !== 'object' || path.split('.').length > 4) return;
    for (const key of Object.keys(obj)) {
      if (/bot|ai|assistant|invoke|metadata/i.test(key)) botFields.push(path ? `${path}.${key}` : key);
      if (obj[key] && typeof obj[key] === 'object') walk(obj[key], path ? `${path}.${key}` : key);
    }
  };
  walk(message);
  const detected = botFields.length > 0;
  if (isDebug()) logger.info({
    chatJid: sanitizeJid(msg.key && msg.key.remoteJid),
    messageType: Object.keys(message).filter((k) => k !== 'conversation' && k !== 'extendedTextMessage').slice(0, 20),
    mentionedJids: mentionedJids.slice(0, 10).map(sanitizeJid),
    participant: sanitizeJid(msg.key && (msg.key.participant || msg.key.participantAlt)),
    contextInfoPresent: !!context,
    botFields: [...new Set(botFields)].slice(0, 30),
    specialFields: structuralKeys(message).filter((k) => /bot|ai|assistant|invoke|metadata/i.test(k)).slice(0, 30),
    messageKeys: Object.keys(message).slice(0, 30),
  }, '[META_AI_PROBE]');
  return detected;
}

async function discover(sock) {
  if (!sock || typeof sock.getBotListV2 !== 'function') return { supported: false, bots: [], reason: 'fork_api_unavailable' };
  try {
    const bots = await Promise.race([
      Promise.resolve(sock.getBotListV2()),
      new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
    ]);
    if (!Array.isArray(bots)) return { supported: false, bots: [], reason: 'timeout_or_invalid_response' };
    return { supported: true, bots: bots.filter((b) => b && b.jid), bots };
  } catch (err) {
    return { supported: false, bots: [], reason: err && err.code ? err.code : 'query_failed' };
  }
}

function chooseBot(discovery) {
  const list = discovery && Array.isArray(discovery.bots) ? discovery.bots : [];
  const meta = list.find((b) => jidUtils.isJidMetaAI(b.jid) || /meta.?ai/i.test(`${b.jid} ${b.personaId || ''}`));
  return meta || null;
}

module.exports = { probeMessage, discover, chooseBot, isDebug };
