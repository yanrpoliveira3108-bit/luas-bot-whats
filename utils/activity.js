'use strict';

const os = require('os');
const terminal = require('./terminal');
const phoneParser = require('../connection/phoneParser');

const MAX = 200;
const buffer = [];
const RUNTIME = `${process.platform} • ${os.release()}`;

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(now) {
  const d = new Date(now || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function maskJid(jid) {
  const digits = String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!digits) return 'grupo';
  try { return phoneParser.maskPhoneNumber('+' + digits); } catch (_) { return '+' + digits.slice(0, 2) + '••••' + digits.slice(-4); }
}
function redact(text) {
  return String(text || '')
    .replace(/gsk_[a-z0-9_-]+/ig, '[REDACTED]')
    .replace(/(bearer\s+)[a-z0-9._-]+/ig, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|token|senha|password|cookie)\s*[:=]\s*)\S+/ig, '$1[REDACTED]');
}
function wrap(text, max) {
  const out = [];
  let rest = redact(text);
  while (terminal.width(rest) > max) {
    const chars = Array.from(rest);
    let cut = Math.min(chars.length, max);
    while (cut > Math.floor(max * 0.55) && terminal.width(chars.slice(0, cut).join('')) > max) cut -= 1;
    const candidate = chars.slice(0, cut).join('');
    const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
    const end = boundary > Math.floor(cut * 0.55) ? boundary : cut;
    out.push(chars.slice(0, end).join('').trimEnd());
    rest = chars.slice(end).join('').trimStart();
  }
  out.push(rest);
  return out;
}
function panelWidth() {
  const columns = Number(process.stdout.columns) || 100;
  return Math.max(70, Math.min(120, columns - 2));
}
function renderPanel(data) {
  const total = panelWidth();
  const inner = total - 2;
  const labelWidth = 12;
  const valueWidth = inner - labelWidth - 1;
  const rows = [
    ['DATA/HORA', stamp(data.time)],
    ['TIPO', data.isGroup ? 'GRUPO' : 'PV'],
    ...(data.isGroup ? [['CHAT', data.chatName || data.chat || 'GRUPO']] : []),
    ['REMETENTE', maskJid(data.sender || data.jid)],
    ['JID/LID', data.jid || data.chat || '-'],
    ['FONTE', 'WhatsApp'],
    ['RUNTIME', RUNTIME],
  ];
  const lines = [];
  const top = '╔' + '═'.repeat(total - 2) + '╗';
  const sep = '╠' + '═'.repeat(labelWidth) + '╬' + '═'.repeat(valueWidth) + '╣';
  const bottom = '╚' + '═'.repeat(total - 2) + '╝';
  lines.push(top, `║${terminal.center('🤖 LUA • WHATSAPP', total - 2)}║`, sep);
  for (const [label, value] of rows) {
    const wrapped = wrap(value, valueWidth);
    lines.push(`║${(' ' + label).padEnd(labelWidth)}║${(' ' + wrapped[0]).padEnd(valueWidth)}║`);
    for (const extra of wrapped.slice(1)) lines.push(`║${' '.repeat(labelWidth)}║${(' ' + extra).padEnd(valueWidth)}║`);
  }
  lines.push(sep);
  const input = data.input == null ? '' : data.input;
  const wrappedInput = wrap(input, valueWidth);
  lines.push(`║${' ENTRADA'.padEnd(labelWidth)}║${(' ' + wrappedInput[0]).padEnd(valueWidth)}║`);
  for (const extra of wrappedInput.slice(1)) lines.push(`║${' '.repeat(labelWidth)}║${(' ' + extra).padEnd(valueWidth)}║`);
  lines.push(bottom);
  return lines.join('\n');
}
function printWhatsAppPanel(data) {
  if (!terminal.isInteractive()) return;
  try { process.stdout.write(renderPanel(data) + '\n'); } catch (_) {}
}
function log({ jid, chat, isGroup, command, args, prefix, name, chatName, time }) {
  const entry = { t: time || Date.now(), jid, chat, isGroup: !!isGroup, command, args: args || [], prefix: prefix || '!', name: name || null, chatName: chatName || null };
  buffer.push(entry); if (buffer.length > MAX) buffer.shift();
  printWhatsAppPanel({ time: entry.t, sender: jid, jid: chat, chat: chatName || chat, chatName: entry.chatName, isGroup: entry.isGroup, input: `${entry.prefix}${entry.command}${entry.args.length ? ' ' + entry.args.join(' ') : ''}` });
  return entry;
}
function logMessage({ sender, chat, isGroup, text, chatName, time }) {
  printWhatsAppPanel({ time, sender, jid: chat, chat, chatName, isGroup, input: text });
}
function who(e) { const masked = maskJid(e.jid); return e.name ? `${e.name} ${masked}` : masked; }
function formatLine(e) { const icon = e.isGroup ? '👥' : '👤'; const args = e.args && e.args.length ? ' ' + e.args.join(' ') : ''; return `[${stamp(e.t)}] ${icon} ${who(e)} → ${e.prefix}${e.command}${args}`; }
function recent(n = 15) { return buffer.slice(-n); }
function clear() { buffer.length = 0; }
function terminalLine(text) { if (terminal.isInteractive()) { try { process.stdout.write(String(text) + '\n'); } catch (_) {} } }
module.exports = { log, logMessage, recent, formatLine, clear, stamp, maskJid, terminalLine, renderPanel, printWhatsAppPanel };
