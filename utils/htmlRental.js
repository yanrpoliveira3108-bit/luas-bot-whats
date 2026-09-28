'use strict';

const rental = require('../database/rental');
const richHtml = require('./richHtml');
const menuFormat = require('./menuFormat');
const poster = require('./rentalPoster');

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function price(item) { return item.active ? rental.formatMoney(item.price_cents, item.currency) : 'Em breve'; }
function badge(item) { return item.active ? 'DISPONÍVEL' : 'EM BREVE'; }
function buildHtml(items = rental.getCatalog(true)) {
  const order = ['RENTAL', 'VIP', 'BOT', 'NUMBER', 'DATABASE', 'HOST'];
  const sorted = [...items].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const cards = sorted.map((i) => `<article class="card ${i.key === 'RENTAL' ? 'featured' : ''}"><div class="cardtop"><span>${esc(i.label)}</span><b>${esc(badge(i))}</b></div><strong>${esc(price(i))}</strong><p>${esc(i.description)}</p><small>${i.key === 'RENTAL' ? 'Ativa o grupo • use uma key de aluguel' : i.key === 'VIP' ? 'Ativa sua conta • use uma key VIP' : 'Serviço Lua'}</small></article>`).join('');
  const currentPoster = poster.current();
  const posterNote = currentPoster ? '<div class="posterhint">Cartaz comercial atualizado disponível no fallback de imagem.</div>' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#050611;color:#f8fafc;font:15px system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}main{max-width:680px;margin:auto}.hero{padding:18px 16px;border:1px solid #403078;border-radius:22px;background:radial-gradient(circle at 85% 10%,#30205c 0,#111329 38%,#090a18 100%);box-shadow:0 10px 30px #0008}.eyebrow{display:inline-block;color:#d8b4fe;border:1px solid #7651bd;border-radius:999px;padding:5px 9px;font-size:10px;letter-spacing:.14em}.hero h1{margin:14px 0 2px;font-size:27px;letter-spacing:.08em;color:#f1ddff}.hero p{margin:0;color:#9ca9e8}.section{margin:22px 0 10px;color:#c4b5fd;letter-spacing:.12em;font-size:12px;text-transform:uppercase}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card{min-width:0;padding:14px;border:1px solid #25284a;border-radius:17px;background:linear-gradient(145deg,#15172c,#0d0f20)}.card.featured{border-color:#8b5cf6;box-shadow:0 0 22px #6d28d933}.cardtop{display:flex;justify-content:space-between;gap:8px;align-items:center;color:#dbeafe;font-weight:700}.cardtop b{font-size:9px;color:#a7f3d0;background:#12352d;border-radius:999px;padding:4px 6px;white-space:nowrap}.card:not(.featured) .cardtop b{color:#c4b5fd;background:#241d45}.card strong{display:block;margin-top:13px;color:#f0abfc;font-size:22px}.card p{min-height:42px;color:#aeb8db;line-height:1.35;margin:8px 0;font-size:13px}.card small{color:#7782aa;font-size:11px}.info{padding:14px;border-left:3px solid #8b5cf6;background:#101327;border-radius:10px;color:#cbd5e1;line-height:1.5}.info strong{color:#e9d5ff}.posterhint{margin-top:12px;color:#7782aa;font-size:11px}.footer{margin:20px 0 5px;color:#94a3b8;line-height:1.6}.code{color:#d8b4fe;font-weight:700}@media(max-width:480px){body{padding:11px}.grid{grid-template-columns:1fr}.hero h1{font-size:24px}}
</style></head><body><main><section class="hero"><span class="eyebrow">PLANOS &amp; SERVIÇOS</span><h1>LUA • PREMIUM SERVICES</h1><p>Automação • Gestão • Tecnologia</p>${posterNote}</section><div class="section">Serviços Lua</div><section class="grid">${cards}</section><div class="section">Como contratar</div><div class="info"><strong>1.</strong> Escolha o serviço.<br><strong>2.</strong> Fale com o suporte.<br><strong>3.</strong> Receba sua key.<br><strong>4.</strong> Use <span class="code">,resgate SUA-KEY</span>.</div><div class="section">Grupo ou pessoal?</div><div class="info"><strong>ALUGUEL VIP</strong> ativa o grupo.<br><strong>VIP PESSOAL</strong> ativa sua conta.</div><footer class="footer">Precisa de ajuda? Use <span class="code">,suporte</span>.<br>Já tem uma key? Use <span class="code">,resgate SUA-KEY</span>.</footer></main></body></html>`;
}
async function send(ctx) {
  const state = menuFormat.status();
  if (state.active) { try { await richHtml.sendHtml(ctx.socket, ctx.remoteJid, buildHtml(), { title: 'LUA • PREMIUM SERVICES' }); return 'html'; } catch (_) {} }
  const p = poster.current();
  if (p && typeof ctx.sendImage === 'function') { await ctx.sendImage(p.path, '🌙 LUA • VALORES', { mimetype: 'image/jpeg' }); return 'image'; }
  await ctx.reply('🌙 *LUA • VALORES*\n\n' + rental.getCatalog(false).map((i) => `${i.label}: ${rental.formatMoney(i.price_cents, i.currency)}`).join('\n'));
  return 'text';
}
module.exports = { buildHtml, send };
