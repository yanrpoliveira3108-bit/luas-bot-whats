'use strict';

const rental = require('../database/rental');
const richHtml = require('./richHtml');
const menuFormat = require('./menuFormat');
const poster = require('./rentalPoster');

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function buildHtml(items = rental.getCatalog()) {
  const cards = items.map((i) => `<article><small>${esc(i.label)}</small><strong>${esc(rental.formatMoney(i.price_cents, i.currency))}</strong><p>${esc(i.description)}</p></article>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#070711;color:#f8fafc;font:15px system-ui;padding:20px}main{max-width:640px;margin:auto}h1{color:#c084fc;letter-spacing:.08em}p{color:#a5b4fc}section{display:grid;gap:10px}article{background:#171629;border:1px solid #3b2d61;border-radius:16px;padding:16px}small{display:block;color:#a5b4fc;text-transform:uppercase;letter-spacing:.12em}strong{display:block;font-size:24px;color:#e9d5ff;margin-top:5px}article p{margin:8px 0 0;color:#cbd5e1}footer{margin-top:18px;color:#94a3b8}code{color:#c084fc;font-weight:700}</style></head><body><main><h1>🌙 LUA • SERVIÇOS</h1><p>Catálogo comercial atualizado</p><section>${cards}</section><footer>Suporte: use <code>,suporte</code></footer></main></body></html>`;
}
async function send(ctx) {
  const items = rental.getCatalog(false);
  const state = menuFormat.status();
  if (state.active) {
    try { await richHtml.sendHtml(ctx.socket, ctx.remoteJid, buildHtml(items), { title: 'LUA • VALORES' }); return 'html'; } catch (_) {}
  }
  const p = poster.current();
  if (p && typeof ctx.sendImage === 'function') { await ctx.sendImage(p.path, '🌙 LUA • VALORES', { mimetype: 'image/jpeg' }); return 'image'; }
  await ctx.reply('🌙 *LUA • VALORES*\n\n' + items.map((i) => `${i.label}: ${rental.formatMoney(i.price_cents, i.currency)}`).join('\n'));
  return 'text';
}
module.exports = { buildHtml, send };
