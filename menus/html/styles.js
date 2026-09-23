/**
 * menus/html/styles.js — CSS compartilhado dos menus HTML.
 *
 * Regras (exigidas pelo projeto):
 *   - NENHUM recurso externo: sem CDN, sem fonte remota, sem imagem remota.
 *     As webviews do WhatsApp podem bloquear rede e o card ficaria sem estilo.
 *   - Paleta vem do tema ATIVO (config/themes.js via utils/theme.cssVars()),
 *     então `!tema` continua valendo também nos menus HTML.
 *   - Layout pensado para tela de celular: coluna única, alvos de toque ≥44px,
 *     contraste alto (texto claro sobre fundo escuro do tema).
 *
 * O CSS é uma string exportada (não um arquivo .css) porque o HTML precisa ir
 * EMBUTIDO no payload da mensagem — ver menus/html/index.js.
 */

'use strict';

const theme = require('../../utils/theme');

/** Variáveis do tema ativo, já escapadas para uso dentro de <style>. */
function themeVars() {
  try {
    return String(theme.cssVars() || '').replace(/[<>]/g, '');
  } catch (_) {
    return '';
  }
}

function buildCss() {
  return `
:root{${themeVars()};--lua-radius:14px;--lua-gap:10px}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0;background:var(--lua-bg,#05030A);color:var(--lua-text,#fff)}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.45;padding:0 12px 28px}
.wrap{max-width:640px;margin:0 auto}

/* ---------- cabeçalho ---------- */
.head{display:flex;align-items:center;gap:10px;padding:14px 0 8px;border-bottom:1px solid rgba(255,255,255,.10)}
.logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:20px;
  background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  box-shadow:0 0 14px var(--lua-glow,rgba(139,92,246,.5))}
.head-txt{flex:1;min-width:0}
.bot-name{font-weight:700;font-size:16px;letter-spacing:.3px}
.bot-meta{font-size:12px;color:var(--lua-text-secondary,#B8A9D9)}
.cat-name{font-size:13px;font-weight:600;color:var(--lua-neon,#C084FC);margin-top:2px}

/* ---------- abas de categoria ---------- */
.tabs{display:flex;gap:8px;overflow-x:auto;padding:12px 0;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{flex:0 0 auto;min-height:40px;display:flex;align-items:center;gap:6px;padding:8px 13px;border-radius:999px;
  border:1px solid rgba(255,255,255,.14);background:var(--lua-card,#120A1F);color:var(--lua-text,#fff);
  font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.tab.active{background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  border-color:transparent;box-shadow:0 0 12px var(--lua-glow,rgba(139,92,246,.45))}
.tab .count{font-size:11px;opacity:.75;font-weight:500}

/* ---------- busca ---------- */
.searchbar{position:sticky;top:0;z-index:5;background:var(--lua-bg,#05030A);padding:4px 0 10px}
.searchbar input{width:100%;min-height:44px;padding:10px 14px;border-radius:var(--lua-radius);
  border:1px solid rgba(255,255,255,.14);background:var(--lua-bg-secondary,#0B0614);color:var(--lua-text,#fff);
  font-size:15px;outline:none}
.searchbar input:focus{border-color:var(--lua-primary,#8B5CF6)}

/* ---------- seção ---------- */
.sec{margin:18px 0 6px}
.sec-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;text-transform:uppercase;
  letter-spacing:.6px;color:var(--lua-primary-light,#A78BFA);margin-bottom:4px}
.sec-desc{font-size:12.5px;color:var(--lua-text-secondary,#B8A9D9);margin:0 0 10px}
.pill{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.08);font-weight:600}

/* ---------- comando ---------- */
.cmd{display:flex;gap:10px;align-items:flex-start;padding:12px;margin-bottom:8px;border-radius:var(--lua-radius);
  background:var(--lua-card,#120A1F);border:1px solid rgba(255,255,255,.08)}
.cmd .ico{font-size:19px;line-height:1.2;flex:0 0 24px;text-align:center}
.cmd .body{flex:1;min-width:0}
.cmd .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cmd code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:700;
  color:var(--lua-neon,#C084FC);word-break:break-all}
.cmd .desc{margin:3px 0 0;font-size:13px;color:var(--lua-text-secondary,#B8A9D9)}
.cmd .ex{margin:6px 0 0;font-size:12px;color:var(--lua-text-secondary,#B8A9D9);opacity:.85}
.cmd .ex code{font-size:12px;font-weight:500;color:var(--lua-text-secondary,#B8A9D9)}
.go{flex:0 0 auto;min-height:38px;display:inline-flex;align-items:center;padding:0 14px;border-radius:999px;
  text-decoration:none;font-size:13px;font-weight:700;color:#fff;
  background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95))}
.tag{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.4px}
.tag.dono{background:rgba(250,204,21,.16);color:#FACC15}
.tag.grupo{background:rgba(96,165,250,.16);color:#93C5FD}
.tag.admin{background:rgba(248,113,113,.16);color:#FCA5A5}
.tag.pv{background:rgba(52,211,153,.16);color:#6EE7B7}

/* ---------- rodapé ---------- */
.foot{margin-top:22px;padding-top:14px;border-top:1px solid rgba(255,255,255,.10);font-size:12px;
  color:var(--lua-text-secondary,#B8A9D9)}
.foot code{color:var(--lua-neon,#C084FC);font-weight:700}
.foot a{color:var(--lua-primary-light,#A78BFA)}
.empty{padding:26px 8px;text-align:center;color:var(--lua-text-secondary,#B8A9D9);font-size:13.5px}
.top{display:flex;justify-content:center;margin-top:16px}
.top button{min-height:42px;padding:0 18px;border-radius:999px;border:1px solid rgba(255,255,255,.16);
  background:var(--lua-bg-secondary,#0B0614);color:var(--lua-text,#fff);font-size:13px;font-weight:600}
@media (max-width:360px){body{font-size:14.5px}.cmd code{font-size:13px}}
`.trim();
}

module.exports = { buildCss, themeVars };
