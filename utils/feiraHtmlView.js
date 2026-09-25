/**
 * utils/feiraHtmlView.js — Card visual em HTML para a Feira de Itens.
 */

'use strict';

const htmlTheme = require('./htmlTheme');
const { formatMoney } = require('./formatter');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFeiraHtml(listings, { query = '', page = 1, totalPages = 1, prefix = '!' } = {}) {
  const visual = htmlTheme.get();
  const themeCss = htmlTheme.cssOverrides();

  const rows = listings.map((l) => {
    const emoji = visual.emojis ? (l.item_emoji || '📦') : '📦';
    const name = l.item_name || l.item_id;
    const seller = l.seller_id.split('@')[0];

    return `
      <div class="listing-item">
        <div class="item-header">
          <span class="item-name">${emoji} ${escapeHtml(name)}</span>
          <span class="item-qty">x${l.quantity}</span>
        </div>
        <div class="item-meta">
          <span>Anúncio #${l.id} • Vendedor: @${escapeHtml(seller)}</span>
          <span class="item-price">${formatMoney(l.unit_price)}/un</span>
        </div>
      </div>
    `;
  }).join('');

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
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .title { font-size: 16px; font-weight: bold; color: #a855f7; }
    .badge { background: #323238; padding: 3px 8px; border-radius: 6px; font-size: 11px; }
    .listing-item {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 8px;
    }
    .item-header { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 4px; }
    .item-name { color: #f4ede8; }
    .item-qty { color: #a855f7; }
    .item-meta { display: flex; justify-content: space-between; font-size: 11px; color: #a1a1aa; }
    .item-price { color: #10b981; font-weight: bold; }
    .footer {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid #323238;
      font-size: 11px;
      color: #8d8d99;
      text-align: center;
    }
    ${themeCss || ''}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="title">🏪 FEIRA DE ITENS</span>
      <span class="badge">Pág ${page}/${totalPages}</span>
    </div>
    <div style="margin-bottom: 10px; font-size: 12px; color: #a1a1aa;">
      ${query ? `Filtrando por: <b>"${escapeHtml(query)}"</b>` : 'Ofertas ativas de jogadores:'}
    </div>
    ${rows}
    <div class="footer">
      💡 Compre no WhatsApp: <b>${escapeHtml(prefix)}feira comprar &lt;id&gt;</b>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  renderFeiraHtml,
};
