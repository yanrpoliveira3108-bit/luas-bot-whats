/**
 * utils/cryptoHtmlView.js — Card visual em HTML para o Mercado Fictício de Criptomoedas.
 *
 * Características:
 * - Ativos disponíveis, cotações determinísticas e variações percentuais
 * - Carteira do jogador com saldo em carteira e rendimento
 * - Data e hora exata da cotação (sem simulação falsa ao vivo)
 * - Identidade visual protegida e botões de comando prontos para copiar/usar
 */

'use strict';

const crypto = require('../database/crypto');
const economy = require('../database/economy');
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

function renderCryptoMarketHtml(userId, prefix = '!') {
  const visual = htmlTheme.get();
  const themeCss = htmlTheme.cssOverrides();
  const now = Date.now();
  const eco = economy.get(userId);
  const port = crypto.portfolio(userId);

  const marketRows = crypto.COINS.map((c) => {
    const p = crypto.price(c.symbol, now);
    const ch = crypto.changePct(c.symbol, now);
    const isUp = ch >= 0;
    const color = isUp ? '#10b981' : '#ef4444';
    const arrow = isUp ? '▲' : '▼';

    return `
      <div class="coin-row">
        <div class="coin-info">
          <span class="coin-emoji">${c.emoji}</span>
          <div>
            <div class="coin-name">${escapeHtml(c.name)} <span class="coin-symbol">${c.symbol}</span></div>
            <div class="coin-price">${formatMoney(p)}</div>
          </div>
        </div>
        <div class="coin-change" style="color: ${color};">
          ${arrow} ${Math.abs(ch)}%
        </div>
      </div>
    `;
  }).join('');

  let portTotal = 0;
  let portRows = '';
  if (!port.length) {
    portRows = '<div style="color:#8d8d99; font-size:12px; padding:8px 0;">Você ainda não possui ativos nesta carteira.</div>';
  } else {
    portRows = port.map((row) => {
      const p = crypto.price(row.symbol, now);
      const val = Math.floor(row.amount * p);
      portTotal += val;
      const profit = val - row.total_cost;
      const isUp = profit >= 0;
      return `
        <div class="stat-row">
          <span class="stat-label">${row.symbol} (${row.amount.toFixed(4)}):</span>
          <span class="stat-val">${formatMoney(val)} <small style="color:${isUp ? '#10b981' : '#ef4444'};">(${isUp ? '+' : ''}${formatMoney(profit)})</small></span>
        </div>
      `;
    }).join('');
  }

  const dateStr = new Date(now).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

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
    .section-title { font-size: 12px; text-transform: uppercase; color: #8d8d99; margin: 12px 0 6px 0; font-weight: bold; }
    .coin-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #29292e;
    }
    .coin-info { display: flex; align-items: center; gap: 8px; }
    .coin-emoji { font-size: 20px; }
    .coin-name { font-size: 13px; font-weight: 600; color: #f4ede8; }
    .coin-symbol { color: #8d8d99; font-size: 11px; }
    .coin-price { font-size: 12px; color: #a855f7; font-weight: 500; }
    .coin-change { font-size: 13px; font-weight: bold; }
    .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #29292e; font-size: 12px; }
    .stat-label { color: #8d8d99; }
    .stat-val { font-weight: 600; color: #f4ede8; }
    .footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid #323238; font-size: 11px; color: #8d8d99; text-align: center; }
    .cmd-hint { background: #121214; padding: 8px; border-radius: 6px; margin-top: 10px; font-size: 11px; color: #a855f7; }
    ${themeCss || ''}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="title">MERCADO CRIPTO</span>
      <span class="badge">Cotação: ${dateStr}</span>
    </div>

    <div class="section-title">Cotações (Atualizam a cada 15m)</div>
    ${marketRows}

    <div class="section-title">Sua Carteira</div>
    <div class="stat-row">
      <span class="stat-label">Saldo em Carteira:</span>
      <span class="stat-val">${formatMoney(eco.wallet)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total em Cripto:</span>
      <span class="stat-val">${formatMoney(portTotal)}</span>
    </div>
    ${portRows}

    <div class="cmd-hint">
      Comandos: <code>${prefix}comprarcripto BTC 500</code> • <code>${prefix}vendercripto BTC 0.001</code>
    </div>

    <div class="footer">
      Preços determinísticos • Operações confirmadas pelo chat
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  renderCryptoMarketHtml,
};
