/**
 * plugins/welcome/index.js — orquestrador do sistema Welcome/Goodbye visual.
 *
 * Fluxo por evento:
 *   EVENTO → DADOS REAIS → FOTO → FAKE ID → TEMPLATE ALEATÓRIO → RENDER → ENVIO
 *
 * - Fila por grupo (utils/keyedMutex.withLock): várias entradas simultâneas
 *   são processadas em série, sem corromper imagem nem estourar RAM.
 * - Se a card visual falhar por qualquer motivo, devolve `false` e o
 *   groupHandler mantém o fallback textual antigo (nunca deixa o grupo mudo).
 * - Logs estruturados [WELCOME]/[GOODBYE]/[WELCOME ERROR].
 */

'use strict';

const CONFIG = require('./config');
const store = require('../../database/welcome');
const templates = require('./templates');
const profile = require('./profile');
const renderer = require('./renderer');
const { generateFakeId } = require('./fakeId');
const { withLock } = require('../../utils/keyedMutex');
const permissions = require('../../utils/permissions');
const logger = require('../../utils/logger').child('welcome');

const pad2 = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const clock = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Metadados do grupo com fallback seguro. */
async function safeMeta(sock, groupJid) {
  try {
    return await sock.groupMetadata(groupJid);
  } catch (_) {
    return { id: groupJid, subject: '', participants: [] };
  }
}

function findMember(participants, userJid) {
  const keys = new Set([String(userJid), String(userJid).split(':')[0]]);
  for (const p of participants || []) {
    const ids = [p.id, p.lid, p.phoneNumber].filter(Boolean).map(String);
    if (ids.some((v) => keys.has(v))) return p;
  }
  return null;
}

function resolveName(participants, userJid, fallback) {
  const m = findMember(participants, userJid);
  if (m && (m.notify || m.name)) return m.notify || m.name;
  return fallback || null;
}

/** Renderiza + envia a card de um evento. */
async function emit(sock, groupJid, userJid, kind, opts = {}) {
  const meta = await safeMeta(sock, groupJid);
  const participants = meta.participants || [];
  const state = store.getState(groupJid);

  const pn = permissions.toPn(userJid, participants);
  const number = String(pn || userJid).split('@')[0].split(':')[0];
  const groupName = meta.subject || groupJid.split('@')[0];

  let name = resolveName(participants, userJid, null);
  if (!name) {
    try {
      const users = require('../../database/users');
      const u = users.get(userJid);
      name = (u && u.name) || number;
    } catch (_) {
      name = number;
    }
  }

  const fakeId = generateFakeId();
  const templateId = store.nextTemplate(groupJid, kind, CONFIG.templates[kind]);
  const photoBuffer = await profile.getPhoto(sock, userJid);
  const members = participants.length || store.countMembers(groupJid) || '—';

  const data = {
    kind,
    templateId,
    photoBuffer,
    name,
    number,
    fakeId,
    group: groupName,
    members,
    date: today(),
    time: clock(),
  };

  let buf;
  try {
    buf = await renderer.renderCard(data);
  } catch (err) {
    logger.error({ err: (err && err.message) || String(err), kind }, `[${kind.toUpperCase()} ERROR] render`);
    throw err;
  }

  const mention = state[`${kind}_mention`] && CONFIG.welcome ? true : state[`${kind}_mention`];
  const label = CONFIG.labels[kind];
  const caption = `${label.action}@${number}!`;
  const sendPayload = { image: buf, caption };
  if (mention) sendPayload.mentions = [userJid];

  try {
    await sock.sendMessage(groupJid, sendPayload);
  } catch (err) {
    logger.error({ err: (err && err.message) || String(err), kind }, `[${kind.toUpperCase()} ERROR] send`);
    throw err;
  }

  store.recordEvent(groupJid, userJid, kind, fakeId, templateId);

  const TAG = kind === 'welcome' ? 'WELCOME' : 'GOODBYE';
  logger.info(
    { usuario: name, grupo: groupName, template: templateId, fakeId, membros: members },
    `[${TAG}] OK`
  );
  return { sent: true, templateId, fakeId };
}

/* ------------------------- API pública ------------------------------ */

/**
 * Chamado quando alguém ENTRA no grupo.
 * @returns {Promise<boolean>} true se a card visual foi enviada (senão o
 *   chamador aplica o fallback textual).
 */
async function onMemberAdded(sock, groupJid, userJid) {
  const st = store.getState(groupJid);
  if (!st.welcome_enabled) return false;
  return withLock(groupJid, async () => {
    try {
      await emit(sock, groupJid, userJid, 'welcome');
      return true;
    } catch (err) {
      logger.error({ err: (err && err.message) || String(err) }, '[WELCOME ERROR] falha geral');
      return false;
    }
  });
}

/** Chamado quando alguém SAI do grupo. */
async function onMemberRemoved(sock, groupJid, userJid) {
  const st = store.getState(groupJid);
  if (!st.goodbye_enabled) return false;
  return withLock(groupJid, async () => {
    try {
      await emit(sock, groupJid, userJid, 'goodbye');
      return true;
    } catch (err) {
      logger.error({ err: (err && err.message) || String(err) }, '[GOODBYE ERROR] falha geral');
      return false;
    }
  });
}

/** Pré-visualização (!welcome preview / !goodbye preview) — não registra evento. */
async function preview(sock, groupJid, userJid, kind) {
  return emit(sock, groupJid, userJid, kind, { preview: true });
}

module.exports = {
  onMemberAdded,
  onMemberRemoved,
  preview,
  store,
  templates,
  generateFakeId,
};
