/**
 * utils/activity.js — registro de atividade de comandos (organizado).
 *
 * - guarda as últimas execuções de comando em memória (ring buffer)
 * - imprime UMA linha organizada no terminal quando interativo:
 *     [2026-09-07 14:32:05] 👤 João +55 *******9999 → !ping
 *     [2026-09-07 14:32:20] 👥 Grupo | 👤 João +55 *******9999 → !menu
 * - expõe recent() para o comando !logs mostrar o mesmo formato no WhatsApp
 *
 * NUNCA guarda conteúdo sensível (só nome/numero mascarado, comando e args).
 */

'use strict';

const terminal = require('./terminal');
const phoneParser = require('../connection/phoneParser');

const MAX = 200;
const buffer = [];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Carimbo de data/hora: YYYY-MM-DD HH:MM:SS. */
function stamp(now) {
  const d = new Date(now || Date.now());
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Máscara do número: "+55 *******9999" (nunca vaza o número completo). */
function maskJid(jid) {
  const digits = String(jid || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
  if (!digits) return 'grupo';
  try {
    return phoneParser.maskPhoneNumber('+' + digits);
  } catch (_) {
    return '+' + digits.slice(0, 2) + '••••' + digits.slice(-4);
  }
}

/**
 * Registra um comando executado.
 * @param {object} e { jid, chat, isGroup, command, args, prefix, name }
 */
function log({ jid, chat, isGroup, command, args, prefix, name }) {
  const entry = {
    t: Date.now(),
    jid,
    chat,
    isGroup: !!isGroup,
    command,
    args: (args || []).slice(0, 4),
    prefix: prefix || '!',
    name: name || null,
  };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();

  // terminal organizado (uma linha por comando)
  if (terminal.isInteractive()) {
    try {
      process.stdout.write(formatLine(entry) + '\n');
    } catch (_) {
      /* nunca derruba o bot por causa do log */
    }
  }
  return entry;
}

function who(e) {
  const masked = maskJid(e.jid);
  return e.name ? `${e.name} ${masked}` : masked;
}

/** Linha única organizada. */
function formatLine(e) {
  const icon = e.isGroup ? '👥' : '👤';
  const args = e.args && e.args.length ? ' ' + e.args.join(' ') : '';
  return `[${stamp(e.t)}] ${icon} ${who(e)} → ${e.prefix}${e.command}${args}`;
}

/** Últimas n entradas (mais recente por último). */
function recent(n = 15) {
  return buffer.slice(-n);
}

function clear() {
  buffer.length = 0;
}

/**
 * Escreve uma linha de diagnóstico direto no terminal (modo interativo),
 * independente de LOG_QUIET — igual às linhas de atividade. Nunca derruba.
 */
function terminalLine(text) {
  if (terminal.isInteractive()) {
    try {
      process.stdout.write(String(text) + '\n');
    } catch (_) {
      /* nunca derruba o bot por causa do log */
    }
  }
}

module.exports = { log, recent, formatLine, clear, stamp, maskJid, terminalLine };
