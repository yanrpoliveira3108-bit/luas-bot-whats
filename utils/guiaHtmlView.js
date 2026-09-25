/**
 * utils/guiaHtmlView.js — Card visual em HTML para o Guia de Primeiros Passos.
 */

'use strict';

const htmlTheme = require('./htmlTheme');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderGuiaHtml(steps, prefix = '!') {
  const visual = htmlTheme.get();
  const themeCss = htmlTheme.cssOverrides();

  const stepRows = steps.map((s) => {
    const emoji = visual.emojis ? s.emoji : '🔹';
    return `
      <div class="step-card">
        <div class="step-header">
          <span class="step-badge">PASSO ${s.num}</span>
          <span class="step-title">${emoji} ${escapeHtml(s.title)}</span>
        </div>
        <div class="step-desc">${escapeHtml(s.desc)}</div>
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
    .step-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 8px;
    }
    .step-header { display: flex; align-items: center; margin-bottom: 4px; gap: 6px; }
    .step-badge {
      background: #a855f7;
      color: #fff;
      font-size: 10px;
      font-weight: bold;
      padding: 2px 5px;
      border-radius: 4px;
    }
    .step-title { font-size: 13px; font-weight: 600; color: #f4ede8; }
    .step-desc { font-size: 12px; color: #a1a1aa; line-height: 1.4; }
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
      <span class="title">🌟 GUIA DE PRIMEIROS PASSOS</span>
      <span class="badge">Iniciante</span>
    </div>
    <div style="margin-bottom: 12px; font-size: 12px; color: #a1a1aa;">
      Siga as instruções abaixo para começar a interagir com o bot:
    </div>
    ${stepRows}
    <div class="footer">
      💡 Toque nos comandos acima e envie no WhatsApp usando o prefixo <b>${escapeHtml(prefix)}</b>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  renderGuiaHtml,
};
