/**
 * menus/html/styles.js — CSS compartilhado dos menus HTML.
 *
 * Regras (exigidas pelo projeto):
 *   - NENHUM recurso externo: sem CDN, sem fonte remota, sem imagem remota.
 *     O WebView do card é sandboxed (origem opaca) e recurso remoto não carrega
 *     (ver menus/html/actions.js, com a origem de cada afirmação).
 *   - Paleta vem do tema ATIVO (config/themes.js via utils/theme.cssVars()),
 *     então `!tema` continua valendo também nos menus HTML.
 *   - Layout pensado para tela de celular: coluna única, alvos de toque ≥44px,
 *     contraste alto.
 *   - ALTURA FIXA: quem injeta o `height` e o contêiner `#__wrap` é o
 *     templates.travarAltura(); aqui só cuidamos do visual dele. Sem isso o
 *     host mede o conteúdo e o conteúdo mede o host, e o card "treme"
 *     (comportamento relatado no upstream).
 *   - ROLAGEM: a página NÃO rola (html/body/#__wrap com overflow:hidden). Cada
 *     área rolável é um contêiner próprio — #lua-tabs (horizontal),
 *     #lua-list (comandos) e #lua-panel-body (painel do "Usar"). Todo
 *     flex/grid que contém área rolável precisa de `min-height:0`/`min-width:0`,
 *     senão o filho cresce e nunca rola.
 *   - As setas (↑ ↓ ← →) são irmãs das áreas roláveis, com espaço reservado no
 *     layout: ficam sempre visíveis e não cobrem conteúdo.
 *   - Transições curtas (opacity/transform) e `prefers-reduced-motion`.
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

/**
 * Contêineres de rolagem (ver templates.js): #lua-tabs (categorias, eixo X),
 * #lua-list (comandos, eixo Y) e #lua-panel-body (painel do "Usar", eixo Y).
 * A página não rola. As setas (.snav na faixa, .vnav na barra vertical) são
 * irmãs dessas áreas, com espaço reservado — nunca posicionadas sobre elas.
 */
function buildCss() {
  return `
:root{${themeVars()};--lua-radius:14px;--lua-gap:10px}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
/* [hidden] tem que vencer o display:flex dos componentes (senão a tela fica
   "sobreposta": o JS esconde e o CSS mostra de novo). */
[hidden]{display:none!important}
html,body{margin:0;padding:0;background:var(--lua-bg,#05030A);color:var(--lua-text,#fff)}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.45}
#__wrap{padding:0 12px 28px}
.wrap{flex:1 1 auto;min-height:0;min-width:0;max-width:640px;margin:0 auto;
  display:flex;flex-direction:row;align-items:stretch;gap:8px}
.screens{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column}

/* ---------- telas (troca local, sem reenviar nada) ---------- */
.screen{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;will-change:opacity,transform}
.screen.sai{opacity:0;transform:translateY(4px);transition:opacity .11s ease,transform .11s ease}
.screen.entra{animation:lua-entra .17s ease both}
@keyframes lua-entra{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){
  .screen.sai,.screen.entra{transition:none!important;animation:none!important;opacity:1;transform:none}
}

/* ---------- cabeçalho ---------- */
.head{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:14px 0 8px;
  border-bottom:1px solid rgba(255,255,255,.10)}
.logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:20px;
  background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  box-shadow:0 0 14px var(--lua-glow,rgba(139,92,246,.5))}
.head-txt{flex:1;min-width:0}
.bot-name{font-weight:700;font-size:16px;letter-spacing:.3px}
.bot-meta{font-size:12px;color:var(--lua-text-secondary,#B8A9D9)}
.cat-name{font-size:13px;font-weight:600;color:var(--lua-neon,#C084FC);margin-top:2px}

/* ---------- abas de categoria (faixa rolável entre as setas) ---------- */
.tabsrow{flex:0 0 auto;display:flex;align-items:center;gap:6px}
.tabs{flex:1 1 auto;min-width:0;display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding:12px 0;
  scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;touch-action:pan-x}
/* setas: fora das áreas que rolam (nunca cobrem conteúdo) */
.snav,.vnav{display:inline-flex;align-items:center;justify-content:center;border-radius:13px;
  border:1px solid rgba(255,255,255,.16);background:var(--lua-card,#120A1F);color:var(--lua-text,#fff);
  font-weight:700;line-height:1;cursor:pointer}
.snav{flex:0 0 auto;width:44px;min-height:44px;font-size:17px}
.snav:active,.vnav:active{transform:translateY(1px)}
.snav[disabled],.vnav[disabled]{opacity:.32;cursor:default;transform:none}
.tab{flex:0 0 auto;min-height:44px;display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;
  border:1px solid rgba(255,255,255,.14);background:var(--lua-card,#120A1F);color:var(--lua-text,#fff);
  font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.tab.active{background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  border-color:transparent;box-shadow:0 0 12px var(--lua-glow,rgba(139,92,246,.45))}
.tab .count{font-size:11px;opacity:.75;font-weight:500}

/* ---------- busca (fixa) ---------- */
.searchbar{flex:0 0 auto;padding:4px 0 10px}
.searchbar input{width:100%;min-height:44px;padding:10px 14px;border-radius:var(--lua-radius);
  border:1px solid rgba(255,255,255,.14);background:var(--lua-bg-secondary,#0B0614);color:var(--lua-text,#fff);
  font-size:15px;outline:none}
.searchbar input:focus{border-color:var(--lua-primary,#8B5CF6)}

/* ---------- área de rolagem dos comandos + barra de setas ---------- */
#lua-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 2px 6px 0;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:none}
.vrail{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:10px;width:48px}
.vnav{width:48px;min-height:56px;font-size:20px}

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
.go{flex:0 0 auto;min-height:44px;display:inline-flex;align-items:center;padding:0 16px;border:0;
  border-radius:999px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;
  background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95))}
.go:active{transform:translateY(1px)}
.go:focus-visible,.tab:focus-visible,.pn-copy:focus-visible,.pn-back:focus-visible,#lua-top:focus-visible,
#lua-q:focus-visible,.vnav:focus-visible,.snav:focus-visible{
  outline:2px solid var(--lua-neon,#C084FC);outline-offset:2px}
.tag{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.4px}
.tag.dono{background:rgba(250,204,21,.16);color:#FACC15}
.tag.grupo{background:rgba(96,165,250,.16);color:#93C5FD}
.tag.admin{background:rgba(248,113,113,.16);color:#FCA5A5}
.tag.pv{background:rgba(52,211,153,.16);color:#6EE7B7}

/* ---------- painel do "Usar" ---------- */
.pn-top{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:14px 0 8px;
  border-bottom:1px solid rgba(255,255,255,.10)}
#lua-panel-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:2px;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:none}
.tabs::-webkit-scrollbar,#lua-list::-webkit-scrollbar,#lua-panel-body::-webkit-scrollbar{width:0;display:none}
.pn-title{font-size:15px;font-weight:700;flex:1;min-width:0}
.pn-cmd{margin:12px 0 0}
.pn-cmd code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;font-weight:700;
  color:var(--lua-neon,#C084FC);word-break:break-all}
.pn-desc{margin:6px 0 0;font-size:13px;color:var(--lua-text-secondary,#B8A9D9)}
.pn-req{margin:10px 0 0;padding-left:18px;font-size:12.5px;color:#FDE68A}
.pn-req li{margin:3px 0}
.pn-fields{margin:14px 0 0}
.pn-field{display:block;margin:0 0 12px}
.pn-field>span{display:block;font-size:12.5px;font-weight:600;color:var(--lua-text-secondary,#B8A9D9);margin-bottom:5px}
.pn-field input,.pn-field select{width:100%;min-height:46px;padding:10px 12px;border-radius:12px;font-size:16px;
  border:1px solid rgba(255,255,255,.14);background:var(--lua-bg-secondary,#0B0614);color:var(--lua-text,#fff);outline:none}
.pn-field input:focus,.pn-field select:focus{border-color:var(--lua-primary,#8B5CF6)}
.pn-field.bad input,.pn-field.bad select{border-color:#FCA5A5}
.pn-err{display:block;font-size:12px;color:#FCA5A5;min-height:15px;margin-top:4px}
.pn-prev{margin:14px 0 4px;font-size:12.5px;font-weight:600;color:var(--lua-text-secondary,#B8A9D9)}
.pn-out{margin:0;padding:12px;border-radius:12px;background:var(--lua-bg-secondary,#0B0614);
  border:1px dashed rgba(255,255,255,.18);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:15px;color:var(--lua-text,#fff);white-space:pre-wrap;word-break:break-all;
  -webkit-user-select:text;user-select:text}
.pn-actions{display:flex;gap:10px;margin:14px 0 0;flex-wrap:wrap}
.pn-copy{flex:1 1 auto;min-height:48px;border:0;border-radius:999px;font-size:14px;font-weight:700;color:#fff;
  cursor:pointer;background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95))}
.pn-copy[disabled]{opacity:.6}
.pn-back{flex:0 0 auto;min-height:48px;padding:0 18px;border-radius:999px;border:1px solid rgba(255,255,255,.16);
  background:var(--lua-bg-secondary,#0B0614);color:var(--lua-text,#fff);font-size:14px;font-weight:600;cursor:pointer}
.pn-status{margin:10px 0 0;font-size:13px;min-height:18px;color:#6EE7B7}
.pn-tip{margin:10px 0 0;font-size:12px;color:var(--lua-text-secondary,#B8A9D9)}

/* ---------- rodapé ---------- */
.foot{margin-top:22px;padding-top:14px;border-top:1px solid rgba(255,255,255,.10);font-size:12px;
  color:var(--lua-text-secondary,#B8A9D9)}
.foot code{color:var(--lua-neon,#C084FC);font-weight:700}
.empty{padding:26px 8px;text-align:center;color:var(--lua-text-secondary,#B8A9D9);font-size:13.5px}
.top{display:flex;justify-content:center;margin-top:16px}
.top button{min-height:44px;padding:0 18px;border-radius:999px;border:1px solid rgba(255,255,255,.16);
  background:var(--lua-bg-secondary,#0B0614);color:var(--lua-text,#fff);font-size:13px;font-weight:600;cursor:pointer}
/* Telas estreitas: setas continuam com 44px de toque, só o resto encolhe. */
@media (max-width:360px){body{font-size:14.5px}.cmd code{font-size:13px}.vrail{width:44px}.vnav{width:44px}}
/* Card baixo (MENU_HTML_HEIGHT pequeno): aperta o topo para sobrar área de
   comandos — as setas nunca encolhem. */
@media (max-height:430px){.head{padding:8px 0 5px}.tabs{padding:6px 0}.searchbar{padding:2px 0 6px}
  .logo{width:32px;height:32px;font-size:17px}.vnav{min-height:46px}}
`.trim();
}

module.exports = { buildCss, themeVars };
