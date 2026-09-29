'use strict';

function effectivePrefix() {
  try { return require('../../database/settings').effectivePrefix(); } catch (_) { return ','; }
}
function effectiveTimezone() {
  try { return require('../../config').bot.timezone; } catch (_) { return 'America/Sao_Paulo'; }
}

const MAX_TEMPLATE_LENGTH = 1000;
const DEFAULTS = {
  welcome: '🌙 Olá, {usuario}! Bem-vindo(a) ao {grupo}. Você entrou às {hora}. Agora somos {membros} membros.',
  goodbye: '👋 Até mais, {usuario}. Você saiu do {grupo} às {hora}.',
};
const VARIABLES = ['usuario', 'nome', 'numero', 'grupo', 'hora', 'data', 'membros', 'prefix', 'comunidade'];

function defaultTemplate(kind) {
  return DEFAULTS[kind] || DEFAULTS.welcome;
}

function normalizeGroupJid(jid) {
  const value = String(jid || '');
  return value.endsWith('@g.us') ? value : '';
}

function normalizeTemplate(value) {
  return String(value == null ? '' : value).replace(/\\n/g, '\n').trim();
}

function validateTemplate(value) {
  const text = normalizeTemplate(value);
  if (!text) return { ok: false, error: 'A mensagem não pode ficar vazia.' };
  if (text.length > MAX_TEMPLATE_LENGTH) return { ok: false, error: `A mensagem pode ter no máximo ${MAX_TEMPLATE_LENGTH} caracteres.` };
  return { ok: true, value: text };
}

function getGreetingSettings(groupJid, options = {}) {
  const gid = normalizeGroupJid(groupJid);
  if (!gid) return { welcomeText: DEFAULTS.welcome, goodbyeText: DEFAULTS.goodbye };
  const state = require('../../database/welcome').getState(gid, options);
  let legacy = {};
  try { legacy = require('../../database/groups').get(gid) || {}; } catch (_) {}
  return {
    welcomeText: state.welcome_text || (legacy.welcome_msg ? String(legacy.welcome_msg).replace(/\{user\}/g, '{usuario}') : DEFAULTS.welcome),
    goodbyeText: state.goodbye_text || (legacy.goodbye_msg ? String(legacy.goodbye_msg).replace(/\{user\}/g, '{usuario}') : DEFAULTS.goodbye),
  };
}

function setGreetingTemplate(groupJid, kind, value) {
  const gid = normalizeGroupJid(groupJid);
  if (!gid) throw new Error('grupo inválido');
  const checked = validateTemplate(value);
  if (!checked.ok) return checked;
  const store = require('../../database/welcome');
  store.setText(gid, kind, checked.value);
  return { ok: true, value: checked.value };
}

function resetGreetingTemplate(groupJid, kind) {
  const gid = normalizeGroupJid(groupJid);
  if (!gid) throw new Error('grupo inválido');
  require('../../database/welcome').setText(gid, kind, defaultTemplate(kind));
  return defaultTemplate(kind);
}

function friendlyNumber(jid) {
  const raw = String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!raw) return 'Identidade WhatsApp protegida';
  if (raw.length >= 10) return `+${raw.slice(0, 2)} ${raw.slice(2, 4)} *****-${raw.slice(-4)}`;
  return `+${raw}`;
}

function safeName(value, fallback = 'Novo membro') {
  const text = String(value == null ? '' : value).trim();
  if (!text || text === 'null' || text === 'undefined' || text.endsWith('@lid') || text.endsWith('@s.whatsapp.net')) return fallback;
  return text;
}

function buildGreetingContext(input = {}) {
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt || Date.now());
  const participantJid = String(input.participantJid || '');
  const participantName = safeName(input.participantName, 'Novo membro');
  const number = input.participantNumber && !String(input.participantNumber).endsWith('@lid')
    ? friendlyNumber(input.participantNumber)
    : friendlyNumber(input.pnJid || participantJid);
  const groupJid = normalizeGroupJid(input.groupJid);
  const groupSubject = safeName(input.groupSubject, groupJid ? groupJid.split('@')[0] : 'este grupo');
  const prefix = String(input.prefix || effectivePrefix() || ',');
  const locale = input.timeZone || effectiveTimezone();
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: locale, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(occurredAt);
  const hour = `${parts.find((p) => p.type === 'hour').value}:${parts.find((p) => p.type === 'minute').value}`;
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: locale }).format(occurredAt);
  return {
    type: input.type || 'WELCOME',
    participantJid,
    participantName,
    participantNumber: number,
    groupJid,
    groupSubject,
    memberCount: input.memberCount == null || input.memberCount === '' ? 'um número crescente de' : String(input.memberCount),
    prefix,
    communityName: safeName(input.communityName, ''),
    occurredAt,
    values: {
      usuario: participantName,
      nome: participantName,
      numero: number,
      grupo: groupSubject,
      hora: hour,
      data: date,
      membros: input.memberCount == null || input.memberCount === '' ? 'um número crescente de' : String(input.memberCount),
      prefix,
      comunidade: safeName(input.communityName, ''),
    },
  };
}

function resolveGreetingTemplate(template, context) {
  const values = context && context.values ? context.values : {};
  return normalizeTemplate(template).replace(/\{([A-Za-zÀ-ÿ][\wÀ-ÿ]*)\}/g, (full, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) && values[key] !== undefined && values[key] !== null
      ? String(values[key])
      : full;
  });
}

function availableVariables() {
  return VARIABLES.slice();
}

module.exports = {
  MAX_TEMPLATE_LENGTH,
  DEFAULTS,
  availableVariables,
  defaultTemplate,
  validateTemplate,
  getGreetingSettings,
  setGreetingTemplate,
  resetGreetingTemplate,
  buildGreetingContext,
  resolveGreetingTemplate,
};
