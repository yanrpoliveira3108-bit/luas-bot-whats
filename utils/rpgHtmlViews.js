/**
 * utils/rpgHtmlViews.js — Renderizador de cards HTML para Perfil, Inventário e Ranking.
 *
 * Utiliza o mesmo motor comprovado de richHtml.js e o visual do menu HTML (cores, fontes, moldura).
 * Totalmente seguro: sem rede, escapa dados, não faz suposição de identidade no visualizador.
 */

'use strict';

const htmlTheme = require('./htmlTheme');
const richHtml = require('./richHtml');
const { formatMoney } = require('./formatter');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBaseHtml(title, bodyContent) {
  const visual = htmlTheme.get();
  const themeCss = htmlTheme.cssOverrides();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #121214;
      color: #e1e1e6;
      font-family: ${visual.fonte === 'monospace' ? 'monospace' : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'};
      padding: 16px;
      font-size: 14px;
    }
    .card {
      background: #202024;
      border: 1px solid #323238;
      border-radius: 12px;
      padding: 16px;
      max-width: 440px;
      margin: 0 auto;
    }
    .header {
      border-bottom: 1px solid #323238;
      padding-bottom: 12px;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .title { font-size: 16px; font-weight: bold; color: #a855f7; }
    .badge { background: #323238; padding: 3px 8px; border-radius: 6px; font-size: 11px; }
    .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #29292e; }
    .stat-label { color: #8d8d99; }
    .stat-val { font-weight: 600; color: #f4ede8; }
    .footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid #323238; font-size: 11px; color: #8d8d99; text-align: center; }
    ${themeCss || ''}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="title">${escapeHtml(title)}</span>
      <span class="badge">LUA RPG</span>
    </div>
    ${bodyContent}
    <div class="footer">
      Visualização protegida • Dados processados via WhatsApp
    </div>
  </div>
</body>
</html>`;
}

/** Renderiza card de perfil */
function renderProfileHtml(data) {
  const content = `
    <div style="margin-bottom: 12px; text-align: center;">
      <h3 style="color:#f4ede8; font-size:18px;">${escapeHtml(data.name)}</h3>
      <div style="color:#a855f7; font-size:12px;">Nível ${data.level} • ${escapeHtml(data.profession || 'Aventureiro')}</div>
    </div>
    <div class="stat-row"><span class="stat-label">⭐ Experiência (XP):</span><span class="stat-val">${data.xp}/${data.nextXp}</span></div>
    <div class="stat-row"><span class="stat-label">🪙 Carteira:</span><span class="stat-val">${formatMoney(data.wallet)}</span></div>
    <div class="stat-row"><span class="stat-label">🏦 Banco:</span><span class="stat-val">${formatMoney(data.bank)}</span></div>
    <div class="stat-row"><span class="stat-label">⭐ Reputação:</span><span class="stat-val">${data.reputation}</span></div>
    <div class="stat-row"><span class="stat-label">💬 Mensagens:</span><span class="stat-val">${data.messages}</span></div>
    <div class="stat-row"><span class="stat-label">🏆 Conquistas:</span><span class="stat-val">${data.achievementsCount}</span></div>
  `;
  return buildBaseHtml(`PERFIL • ${data.name}`, content);
}

/** Renderiza card de inventário */
function renderInventoryHtml(items, userName) {
  let list = '';
  if (!items.length) {
    list = '<div style="padding:20px; text-align:center; color:#8d8d99;">Inventário vazio. Compre itens na loja com !loja.</div>';
  } else {
    list = items.map((i) => `
      <div class="stat-row">
        <span class="stat-label">${escapeHtml(i.emoji || '📦')} ${escapeHtml(i.name || i.item_id)}</span>
        <span class="stat-val">x${i.quantity}</span>
      </div>
    `).join('');
  }
  const content = `
    <div style="margin-bottom: 10px; color:#8d8d99; font-size:12px;">Mochila de ${escapeHtml(userName)} (${items.length} itens):</div>
    ${list}
  `;
  return buildBaseHtml(`INVENTÁRIO • ${userName}`, content);
}

/** Renderiza card de ranking */
function renderRankingHtml(title, items, typeLabel) {
  let rows = items.map((it, idx) => `
    <div class="stat-row">
      <span class="stat-label">${idx + 1}. ${escapeHtml(it.name || it.user_id)}</span>
      <span class="stat-val" style="color:#a855f7;">${it.valueFormatted || it.value}</span>
    </div>
  `).join('');

  const content = `
    <div style="margin-bottom: 10px; color:#8d8d99; font-size:12px;">Critério: ${escapeHtml(typeLabel)} (Top 10)</div>
    ${rows}
  `;
  return buildBaseHtml(`RANKING • ${title}`, content);
}

module.exports = {
  renderProfileHtml,
  renderInventoryHtml,
  renderRankingHtml,
};
