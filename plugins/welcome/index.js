'use strict';

const CONFIG = require('./config');
const store = require('../../database/welcome');
const templates = require('./templates');
const profile = require('./profile');
const renderer = require('./renderer');
const greeting = require('./greetingEngine');
const { generateFakeId } = require('./fakeId');
const { withLock } = require('../../utils/keyedMutex');
const permissions = require('../../utils/permissions');
const logger = require('../../utils/logger').child('welcome');

function safeMeta(sock, groupJid, provided) {
  if (provided && typeof provided === 'object') return Promise.resolve(provided);
  return Promise.resolve().then(async () => {
    try { return await sock.groupMetadata(groupJid); } catch (_) { return { id: groupJid, subject: '', participants: [] }; }
  });
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
  const member = findMember(participants, userJid);
  return (member && (member.notify || member.name || member.pushName)) || fallback || null;
}

function eventTime(opts) {
  return opts && opts.occurredAt ? new Date(opts.occurredAt) : new Date();
}

async function buildData(sock, groupJid, userJid, kind, opts = {}) {
  const metaStarted = Date.now();
  const meta = await safeMeta(sock, groupJid, opts.meta);
  if (opts.metrics) opts.metrics.metadataMs = Date.now() - metaStarted;
  const participants = Array.isArray(meta.participants) ? meta.participants : [];
  const pn = permissions.toPn(userJid, participants);
  let name = resolveName(participants, userJid, null);
  if (!name) {
    try {
      const user = require('../../database/users').get(userJid);
      name = user && user.name;
    } catch (_) {}
  }
  const contextStarted = Date.now();
  const context = greeting.buildGreetingContext({
    type: kind.toUpperCase(),
    participantJid: userJid,
    participantName: name,
    participantNumber: pn,
    pnJid: pn,
    groupJid,
    groupSubject: meta.subject,
    memberCount: participants.length || store.countMembers(groupJid),
    prefix: require('../../database/settings').effectivePrefix(),
    communityName: opts.communityName,
    occurredAt: eventTime(opts),
  });
  if (opts.metrics) opts.metrics.contextMs = Date.now() - contextStarted;
  const configStarted = Date.now();
  const settings = greeting.getGreetingSettings(groupJid, opts.preview ? { create: false } : {});
  if (opts.metrics) opts.metrics.configMs = Date.now() - configStarted;
  const template = kind === 'goodbye' ? settings.goodbyeText : settings.welcomeText;
  const greetingPayload = greeting.buildGreetingPayload(template, context, { template });
  const renderedText = greetingPayload.renderedText;
  const profileStarted = Date.now();
  const photoBuffer = await profile.getPhoto(sock, userJid);
  if (opts.metrics) opts.metrics.profileMs = Date.now() - profileStarted;
  return {
    meta,
    context,
    renderedText,
    messageText: renderedText,
    kind,
    templateId: opts.preview
      ? store.peekTemplate(groupJid, kind, CONFIG.templates[kind])
      : store.nextTemplate(groupJid, kind, CONFIG.templates[kind]),
    photoBuffer,
    name: context.participantName,
    number: context.participantNumber,
    fakeId: generateFakeId(),
    group: context.groupSubject,
    members: context.memberCount,
    date: context.values.data,
    time: context.values.hora,
  };
}

async function resolveText(sock, groupJid, userJid, kind, opts = {}) {
  const data = await buildData(sock, groupJid, userJid, kind, Object.assign({}, opts, { meta: opts.meta }));
  return { text: data.renderedText, context: data.context };
}

async function emit(sock, groupJid, userJid, kind, opts = {}) {
  const totalStarted = Date.now();
  const metrics = opts.preview ? {} : null;
  const data = await buildData(sock, groupJid, userJid, kind, Object.assign({}, opts, { metrics }));
  if (metrics) data.metrics = metrics;
  const state = store.getState(groupJid, opts.preview ? { create: false } : {});
  const buf = await renderer.renderCard(data);
  const label = CONFIG.labels[kind];
  const sendPayload = {
    image: buf,
    // Evita duplicar o texto completo da imagem. O fallback usa renderedText.
    caption: `${label.title} • ${data.name}`,
  };
  if (state.welcome_mention && userJid) sendPayload.mentions = [userJid];
  const sendStarted = Date.now();
  await sock.sendMessage(groupJid, sendPayload);
  if (metrics) {
    metrics.sendMs = Date.now() - sendStarted;
    metrics.totalMs = Date.now() - totalStarted;
    logger.info(metrics, '[WELCOME_PREVIEW_PERF]');
  }
  if (!opts.preview) store.recordEvent(groupJid, userJid, kind, data.fakeId, data.templateId);
  logger.info({ usuario: data.name, grupo: data.group, template: data.templateId, fakeId: data.fakeId, membros: data.members }, `[${kind.toUpperCase()}] OK`);
  return { sent: true, templateId: data.templateId, fakeId: data.fakeId, text: data.renderedText };
}

async function onMemberAdded(sock, groupJid, userJid, opts = {}) {
  const st = store.getState(groupJid);
  if (!st.welcome_enabled) return false;
  return withLock(groupJid, async () => {
    try { await emit(sock, groupJid, userJid, 'welcome', opts); return true; }
    catch (err) { logger.error({ err: err && err.message }, '[WELCOME ERROR] falha geral'); return false; }
  });
}

async function onMemberRemoved(sock, groupJid, userJid, opts = {}) {
  const st = store.getState(groupJid);
  if (!st.goodbye_enabled) return false;
  return withLock(groupJid, async () => {
    try { await emit(sock, groupJid, userJid, 'goodbye', opts); return true; }
    catch (err) { logger.error({ err: err && err.message }, '[GOODBYE ERROR] falha geral'); return false; }
  });
}

async function preview(sock, groupJid, userJid, kind) {
  return emit(sock, groupJid, userJid, kind, { preview: true, occurredAt: new Date() });
}

module.exports = {
  onMemberAdded,
  onMemberRemoved,
  preview,
  resolveText,
  store,
  templates,
  greeting,
  generateFakeId,
};
