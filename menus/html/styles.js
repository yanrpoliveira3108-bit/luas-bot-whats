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
// Todos os números de tamanho vêm de dimensoes.js (um lugar só para ajustar).
// `s(base)` = px já escalado pela ESCALA de lá (ex.: s(13) -> '15px').
const dim = require('./dimensoes');
const { DIM } = dim;
const s = dim.px;

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
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:${s(15)};line-height:1.45}
#__wrap{padding:0 ${DIM.folgaLateral}px ${DIM.folgaInferior}px;align-items:center}
/* CAUSA (corrigida): com margin:0 auto num flex em COLUNA, o item deixa de ser
   esticado e passa a ser dimensionado pelo conteúdo (fit-content). Como o
   conteúdo tem min-content da ordem de 588px, este bloco saía com 640px numa
   janela de 360px: tudo era desenhado fora da área visível, inclusive a barra
   das setas ↑↓ e a seta →. Agora a largura é 100% (limitada por max-width) e o
   #__wrap centraliza com align-items:center. */
.wrap{flex:1 1 auto;min-height:0;min-width:0;width:100%;max-width:${DIM.larguraMax}px;
  display:flex;flex-direction:row;align-items:stretch;gap:8px}
.screens{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column}

/* ---------- telas (troca local, sem reenviar nada) ---------- */
.screen{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;will-change:opacity,transform}
.screen.sai{opacity:0;transform:translateY(4px);transition:opacity .11s ease,transform .11s ease}
.screen.entra{animation:lua-entra .17s ease both}
@keyframes lua-entra{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){
  .screen.sai,.screen.entra{transition:none!important;animation:none!important;opacity:1;transform:none}
}

/* ---------- cabeçalho ---------- */
.head{flex:0 0 auto;min-width:0;display:flex;align-items:center;gap:9px;padding:8px 0 6px;
  border-bottom:1px solid rgba(255,255,255,.10)}
.logo{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:${s(20)};
  background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  box-shadow:0 0 14px var(--lua-glow,rgba(139,92,246,.5))}
.head-txt{flex:1;min-width:0}
.head-line{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.bot-name{font-weight:700;font-size:${s(16)};letter-spacing:.3px}
.bot-meta{font-size:${s(12)};color:var(--lua-text-secondary,#B8A9D9)}
.cat-name{font-size:${s(13)};font-weight:600;color:var(--lua-neon,#C084FC);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52%}

/* ---------- abas de categoria (faixa rolável entre as setas) ---------- */
.tabsrow{flex:0 0 auto;display:flex;align-items:center;gap:4px}
.tabs{flex:1 1 auto;min-width:0;display:flex;gap:7px;overflow-x:auto;overflow-y:hidden;padding:8px 0;
  scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;touch-action:pan-x}
/* setas: fora das áreas que rolam (nunca cobrem conteúdo) */
.snav,.vnav{display:inline-flex;align-items:center;justify-content:center;border-radius:13px;
  border:1px solid rgba(255,255,255,.16);background:var(--lua-card,#120A1F);color:var(--lua-text,#fff);
  font-weight:700;line-height:1;cursor:pointer}
.snav{flex:0 0 auto;width:${DIM.snav}px;min-height:${DIM.snav}px;font-size:${s(16)}}
.snav:active,.vnav:active{transform:translateY(1px)}
.snav[disabled],.vnav[disabled]{opacity:.32;cursor:default;transform:none}
.tab{flex:0 0 auto;min-height:${DIM.tabAltura}px;display:flex;align-items:center;gap:5px;padding:8px 12px;border-radius:999px;
  border:1px solid rgba(255,255,255,.14);background:var(--lua-card,#120A1F);color:var(--lua-text,#fff);
  font-size:${s(12.5)};font-weight:600;cursor:pointer;white-space:nowrap}
.tab.active{background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  border-color:transparent;box-shadow:0 0 12px var(--lua-glow,rgba(139,92,246,.45))}
/* O contador por aba sai da faixa: com ele, só UMA categoria cabia na largura
   da tela. O número continua logo abaixo, no título da seção ("GERAL 30
   COMANDOS"), sem ocupar a faixa. */
.tab .count{display:none}

/* ---------- busca (fixa) ---------- */
.searchbar{flex:0 0 auto;min-width:0;padding:0 0 6px}
.searchbar input{width:100%;min-width:0;min-height:${DIM.busca}px;padding:9px 15px;border-radius:var(--lua-radius);
  border:1px solid rgba(255,255,255,.14);background:var(--lua-bg-secondary,#0B0614);color:var(--lua-text,#fff);
  font-size:${s(15)};outline:none}
.searchbar input:focus{border-color:var(--lua-primary,#8B5CF6)}

/* ---------- área de rolagem dos comandos + barra de setas ---------- */
#lua-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 2px 6px 0;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:none}
.vrail{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:11px;width:${DIM.rail}px}
.vnav{width:${DIM.rail}px;min-height:${dim.tam(52)}px;font-size:${s(19)}}

/* ---------- seção ---------- */
.sec{margin:10px 0 4px}
.sec-title{display:flex;align-items:center;gap:7px;font-size:${s(13)};font-weight:700;text-transform:uppercase;
  letter-spacing:.5px;color:var(--lua-primary-light,#A78BFA);margin:6px 0 6px;min-width:0}
/* a descrição da categoria entra na MESMA linha do título, com reticências:
   antes era um parágrafo próprio e, com o aviso de corte, empurrava o primeiro
   comando ~120px para baixo (num WebView baixo, nenhum comando inteiro aparecia) */
.sec-desc{font-size:${s(12)};font-weight:400;text-transform:none;letter-spacing:0;
  color:var(--lua-text-secondary,#B8A9D9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.foot-corte{display:block;margin-top:4px;color:#FDE68A}
.sec-desc{font-size:${s(12.5)};color:var(--lua-text-secondary,#B8A9D9);margin:0 0 10px}
.pill{font-size:${s(11)};padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.08);font-weight:600}

/* ---------- comando ---------- */
.cmd{display:flex;gap:9px;align-items:flex-start;padding:${DIM.cartaoPadding}px;margin-bottom:8px;border-radius:var(--lua-radius);
  background:var(--lua-card,#120A1F);border:1px solid rgba(255,255,255,.08)}
.cmd .ico{font-size:${s(17)};line-height:1.3;flex:0 0 ${DIM.icone}px;text-align:center}
.cmd .body{flex:1;min-width:0}
.cmd .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cmd code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:${s(14)};font-weight:700;
  color:var(--lua-neon,#C084FC);word-break:break-all}
/* A descrição é limitada a ${DIM.descLinhas} linhas e o texto completo aparece no painel do "Usar":
   é isso que mantém o cartão baixo e vários comandos visíveis por tela. */
.cmd .desc{margin:3px 0 0;font-size:${s(13)};line-height:1.3;color:var(--lua-text-secondary,#B8A9D9);
  display:-webkit-box;-webkit-line-clamp:${DIM.descLinhas};-webkit-box-orient:vertical;overflow:hidden}
.cmd .ex{margin:4px 0 0;font-size:${s(12)};color:var(--lua-text-secondary,#B8A9D9);opacity:.85;
  display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.cmd .ex code{font-size:${s(12)};font-weight:500;color:var(--lua-text-secondary,#B8A9D9)}
.cmd .top .go{margin-left:auto}
.go{flex:0 0 auto;min-height:${DIM.botaoUsar}px;display:inline-flex;align-items:center;padding:0 15px;border:0;
  border-radius:999px;font-size:${s(13)};font-weight:700;color:#fff;cursor:pointer;
  background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95))}
.go:active{transform:translateY(1px)}
.go:focus-visible,.tab:focus-visible,.pn-copy:focus-visible,.pn-back:focus-visible,#lua-top:focus-visible,
#lua-q:focus-visible,.vnav:focus-visible,.snav:focus-visible,.vtop:focus-visible{
  outline:2px solid var(--lua-neon,#C084FC);outline-offset:2px}
.tag{font-size:${s(10.5)};font-weight:700;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.4px}
.tag.dono{background:rgba(250,204,21,.16);color:#FACC15}
.tag.grupo{background:rgba(96,165,250,.16);color:#93C5FD}
.tag.admin{background:rgba(248,113,113,.16);color:#FCA5A5}
.tag.pv{background:rgba(52,211,153,.16);color:#6EE7B7}

/* ---------- painel do "Usar" ---------- */
.pn-top{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:10px 0 6px;
  border-bottom:1px solid rgba(255,255,255,.10)}
#lua-panel-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:2px;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:none}
.tabs::-webkit-scrollbar,#lua-list::-webkit-scrollbar,#lua-panel-body::-webkit-scrollbar{width:0;display:none}
.pn-title{font-size:${s(15)};font-weight:700;flex:1;min-width:0}
.pn-cmd{margin:12px 0 0}
.pn-cmd code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:${s(16)};font-weight:700;
  color:var(--lua-neon,#C084FC);word-break:break-all}
.pn-desc{margin:6px 0 0;font-size:${s(13)};color:var(--lua-text-secondary,#B8A9D9)}
.pn-req{margin:10px 0 0;padding-left:18px;font-size:${s(12.5)};color:#FDE68A}
.pn-req li{margin:3px 0}
.pn-fields{margin:14px 0 0}
.pn-field{display:block;margin:0 0 12px}
.pn-field>span{display:block;font-size:${s(12.5)};font-weight:600;color:var(--lua-text-secondary,#B8A9D9);margin-bottom:5px}
.pn-field input,.pn-field select{width:100%;min-height:${DIM.toque}px;padding:11px 13px;border-radius:12px;font-size:${s(16)};
  border:1px solid rgba(255,255,255,.14);background:var(--lua-bg-secondary,#0B0614);color:var(--lua-text,#fff);outline:none}
.pn-field input:focus,.pn-field select:focus{border-color:var(--lua-primary,#8B5CF6)}
.pn-field.bad input,.pn-field.bad select{border-color:#FCA5A5}
.pn-err{display:block;font-size:${s(12)};color:#FCA5A5;min-height:15px;margin-top:4px}
.pn-prev{margin:14px 0 4px;font-size:${s(12.5)};font-weight:600;color:var(--lua-text-secondary,#B8A9D9)}
.pn-out{margin:0;padding:12px;border-radius:12px;background:var(--lua-bg-secondary,#0B0614);
  border:1px dashed rgba(255,255,255,.18);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:${s(15)};color:var(--lua-text,#fff);white-space:pre-wrap;word-break:break-all;
  -webkit-user-select:text;user-select:text}
.pn-actions{display:flex;gap:10px;margin:14px 0 0;flex-wrap:wrap}
.pn-copy{flex:1 1 auto;min-height:${DIM.toque}px;border:0;border-radius:999px;font-size:${s(14)};font-weight:700;color:#fff;
  cursor:pointer;background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95))}
.pn-copy[disabled]{opacity:.6}
.pn-back{flex:0 0 auto;min-height:${DIM.toque}px;padding:0 20px;border-radius:999px;border:1px solid rgba(255,255,255,.16);
  background:var(--lua-bg-secondary,#0B0614);color:var(--lua-text,#fff);font-size:${s(14)};font-weight:600;cursor:pointer}
.pn-status{margin:10px 0 0;font-size:${s(13)};min-height:18px;color:#6EE7B7}
.pn-tip{margin:10px 0 0;font-size:${s(12)};color:var(--lua-text-secondary,#B8A9D9)}

/* ---------- rodapé ---------- */
.foot{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.10);font-size:${s(11.5)};
  line-height:1.35;color:var(--lua-text-secondary,#B8A9D9)}
.foot code{color:var(--lua-neon,#C084FC);font-weight:700}
/* diagnóstico de área: aparece SÓ quando o host deu menos altura que a pedida */
.foot-medida{display:block;margin-top:4px;color:var(--lua-neon,#C084FC)}
.empty{padding:26px 8px;text-align:center;color:var(--lua-text-secondary,#B8A9D9);font-size:${s(13.5)}}
/* atalho "topo": mora na barra (fora da área que rola), por isso nunca some no
   meio da lista — antes ele ficava no fim do conteúdo e só aparecia no final */
.vtop{width:${DIM.rail}px;min-height:${DIM.snav}px;display:inline-flex;align-items:center;justify-content:center;
  border-radius:13px;border:1px dashed rgba(255,255,255,.22);background:transparent;
  color:var(--lua-text-secondary,#B8A9D9);font-size:${s(17)};line-height:1;cursor:pointer}
.vtop:active{transform:translateY(1px)}
/* NOTA: aqui existia um @media (max-width:360px) que encolhia a fonte do
   comando. Ele saiu: a escala de dimensoes.js já define os tamanhos e o
   celular comum tem exatamente 360px de largura — encolher aí era justamente
   deixar o menu pequeno na tela mais comum. As áreas de toque nunca encolhem. */
/* Card baixo (MENU_HTML_HEIGHT pequeno): aperta o topo para sobrar área de
   comandos — as setas nunca encolhem. */
/* Card baixo: nada de @media de altura de viewport por aqui (não é confiável
   neste WebView). O client.js mede em runtime e liga body.curto. */
body.curto .head{padding:6px 0 4px}
body.curto .logo{width:32px;height:32px;font-size:${s(15)}}
body.curto .bot-meta{display:none}
body.curto .sec-desc{display:none}
body.curto .tabs{padding:4px 0}
body.curto .searchbar{padding:0 0 4px}
body.curto .searchbar input{min-height:${DIM.botaoUsar}px}
body.curto .cmd{padding:8px;margin-bottom:6px}
body.curto .cmd .desc{-webkit-line-clamp:${DIM.descLinhasCurto}}
body.curto .sec{margin:0}
body.curto .sec-title{display:none}
body.curto .vnav{min-height:${dim.tam(46)}px}
body.curto .sec{margin:12px 0 4px}
body.curto .sec-title{font-size:${s(12.5)}}
/* Card muito baixo: o rodapé comeria boa parte da área rolável e o último
   comando não caberia — ele sai. O aviso de que "Usar" só copia continua no
   painel (.pn-tip) e no rodapé dos cards normais. */
body.curto .foot{display:none}
`.trim();
}

module.exports = { buildCss, themeVars };
