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
    const raw = String(theme.cssVars() || '').replace(/[<>]/g, '');
    const activeId = theme.activeId ? theme.activeId() : '';
    // Se o tema ativo for LUA_NIGHT (o padrão de fábrica), aplicamos a paleta
    // moderna solicitada: fundo grafite escuro refinado (#121316 / #1A1B1F),
    // cartões ligeiramente mais claros (#1E2025), texto de alto contraste (#F8FAFC)
    // e destaque violeta suave (#9333EA / #A855F7), mantendo a compatibilidade do sistema.
    if (activeId === 'LUA_NIGHT') {
      return [
        '--lua-bg:#121316',
        '--lua-bg-amoled:#0B0C0E',
        '--lua-bg-secondary:#1A1B20',
        '--lua-card:#1E2026',
        '--lua-primary:#8B5CF6',
        '--lua-primary-light:#A78BFA',
        '--lua-neon:#C084FC',
        '--lua-primary-dark:#581C87',
        '--lua-text:#F8FAFC',
        '--lua-text-secondary:#94A3B8',
        '--lua-accent:#A855F7',
        '--lua-chart:#A78BFA',
        '--lua-glow:rgba(139,92,246,.25)',
      ].join(';');
    }
    return raw;
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
function buildCss(opts = {}) {
  // Aparência personalizada (!temahtml): variáveis que SOBRESCREVEM as do
  // !tema. Vazio = visual padrão do projeto (nada muda para quem não configurou).
  let extra = '';
  try {
    extra = require('../../utils/htmlTheme').cssOverrides(opts.visual);
  } catch (_) {
    extra = '';
  }
  return `
:root{${themeVars()};--lua-radius:14px;--lua-radius-sm:8px;--lua-radius-pill:999px;--lua-gap:10px;--lua-space-xs:4px;--lua-space-sm:8px;--lua-space-md:12px;--lua-space-lg:16px${extra ? ';' + extra : ''}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
/* [hidden] tem que vencer o display:flex dos componentes (senão a tela fica
   "sobreposta": o JS esconde e o CSS mostra de novo). */
[hidden]{display:none!important}
html,body{margin:0;padding:0;background:var(--lua-bg,#05030A);color:var(--lua-text,#fff)}
body{font-family:var(--lua-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);font-size:${s(15)};line-height:1.45}
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
.head{flex:0 0 auto;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 0 6px;
  border-bottom:1px solid var(--lua-line,rgba(255,255,255,.10))}
.logo{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-size:${s(16)};
  background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  box-shadow:0 2px 8px var(--lua-glow,rgba(139,92,246,.35))}
.head-txt{flex:1;min-width:0}
.head-line{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.bot-name{font-weight:700;font-size:${s(16)};letter-spacing:.2px;color:var(--lua-text,#fff)}
.bot-meta{font-size:${s(11.5)};font-weight:500;color:var(--lua-text-secondary,#94A3B8);margin-left:4px}
.cat-name{font-size:${s(12.5)};font-weight:600;color:var(--lua-neon,#C084FC);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50%;
  background:var(--lua-chip,rgba(255,255,255,.06));padding:2px 8px;border-radius:999px;border:1px solid var(--lua-border-soft,rgba(255,255,255,.08))}
/* painel de identificação (solicitante · prefixo · dono · bot): 2x2 compacto,
   cada célula em UMA linha com reticências — nome longo nunca empurra o layout */
.idp{flex:1 0 100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:3px 8px;
  font-size:${s(10)};line-height:1.35;letter-spacing:-.1px;color:var(--lua-text-secondary,#94A3B8);
  margin-top:2px;padding:5px 8px;border-radius:var(--lua-radius-sm,8px);background:var(--lua-bg-secondary,#1A1B20);
  border:1px solid var(--lua-border-soft,rgba(255,255,255,.06))}
.idp-c{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.idp-c b{color:var(--lua-text,#fff);font-weight:600}
.idp-c i{font-style:italic;opacity:.85}
.idp-c.idp-sec{font-size:${s(9.2)};opacity:.9}
.idp-c .pfx-tag, .idp-c.idp-prefix b{display:inline-block;padding:0 5px;border-radius:4px;
  background:var(--lua-chip,rgba(255,255,255,.12));color:var(--lua-neon,#C084FC);border:1px solid var(--lua-border,rgba(255,255,255,.14))}
.head.sem-emoji{padding-left:2px}

/* ---------- abas de categoria (faixa rolável entre as setas) ---------- */
.tabsrow{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:2px 0}
.tabs{flex:1 1 auto;min-width:0;display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;padding:7px 0;
  scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;touch-action:pan-x}
/* setas: fora das áreas que rolam (nunca cobrem conteúdo) */
.snav,.vnav{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;
  border:1px solid var(--lua-border,rgba(255,255,255,.16));background:var(--lua-card,#1E2026);color:var(--lua-text,#fff);
  font-weight:700;line-height:1;cursor:pointer;transition:background .15s ease,border-color .15s ease,opacity .15s ease}
.snav{flex:0 0 auto;width:${DIM.snav}px;min-height:${DIM.snav}px;font-size:${s(16)}}
.snav:active,.vnav:active{transform:translateY(1px)}
.snav[disabled],.vnav[disabled]{opacity:.25;cursor:default;transform:none}
.tab{flex:0 0 auto;min-height:${DIM.tabAltura}px;display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;
  border:1px solid var(--lua-border,rgba(255,255,255,.12));background:var(--lua-card,#1E2026);color:var(--lua-text-secondary,#94A3B8);
  font-size:${s(12.5)};font-weight:600;cursor:pointer;white-space:nowrap;transition:background .15s ease,color .15s ease,border-color .15s ease}
.tab.active{background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  color:var(--lua-on-primary,#fff);border-color:var(--lua-secondary,transparent);box-shadow:0 2px 10px var(--lua-glow,rgba(139,92,246,.35))}
/* O contador por aba sai da faixa: com ele, só UMA categoria cabia na largura
   da tela. O número continua logo abaixo, no título da seção ("GERAL 30
   COMANDOS"), sem ocupar a faixa. */
.tab .count{display:none}

/* ---------- busca (fixa) ---------- */
.searchbar{flex:0 0 auto;min-width:0;padding:2px 0 6px}
.searchbar input{width:100%;min-width:0;min-height:${DIM.busca}px;padding:9px 14px;border-radius:var(--lua-radius);
  border:1px solid var(--lua-border,rgba(255,255,255,.14));background:var(--lua-bg-secondary,#1A1B20);color:var(--lua-text,#fff);
  font-size:${s(14.5)};outline:none;transition:border-color .15s ease}
.searchbar input:focus{border-color:var(--lua-primary,#8B5CF6)}

/* ---------- área de rolagem dos comandos + barra de setas ---------- */
#lua-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 2px 6px 0;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:none}
.vrail{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:10px;width:${DIM.rail}px}
.vnav{width:${DIM.rail}px;min-height:${dim.tam(52)}px;font-size:${s(19)}}

/* ---------- seção ---------- */
.sec{margin:8px 0 4px}
.sec-title{display:flex;align-items:center;gap:7px;font-size:${s(12.5)};font-weight:700;text-transform:uppercase;
  letter-spacing:.5px;color:var(--lua-primary-light,#A78BFA);margin:4px 0 6px;min-width:0}
/* a descrição da categoria entra na MESMA linha do título, com reticências:
   antes era um parágrafo próprio e, com o aviso de corte, empurrava o primeiro
   comando ~120px para baixo (num WebView baixo, nenhum comando inteiro aparecia) */
.sec-desc{font-size:${s(12)};font-weight:400;text-transform:none;letter-spacing:0;
  color:var(--lua-text-secondary,#94A3B8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.foot-corte{display:block;margin-top:4px;color:var(--lua-warn-text,#FDE68A)}
.sec-desc{font-size:${s(12.5)};color:var(--lua-text-secondary,#94A3B8);margin:0 0 10px}
.pill{font-size:${s(10.5)};padding:2px 8px;border-radius:999px;background:var(--lua-chip,rgba(255,255,255,.08));font-weight:600;color:var(--lua-text,#fff)}

/* ---------- comando ---------- */
.cmd{display:flex;gap:10px;align-items:flex-start;padding:${DIM.cartaoPadding}px;margin-bottom:7px;border-radius:var(--lua-radius);
  background:var(--lua-card,#1E2026);border:1px solid var(--lua-border-soft,rgba(255,255,255,.08));
  box-shadow:0 1px 3px rgba(0,0,0,.15);transition:border-color .15s ease}
.cmd .ico{font-size:${s(16)};line-height:1.3;flex:0 0 ${DIM.icone}px;text-align:center;padding-top:1px}
.cmd .body{flex:1;min-width:0}
.cmd .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cmd code{font-family:var(--lua-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:${s(14)};font-weight:700;
  color:var(--lua-neon,#C084FC);word-break:break-all}
/* A descrição é limitada a ${DIM.descLinhas} linhas e o texto completo aparece no painel do "Usar":
   é isso que mantém o cartão baixo e vários comandos visíveis por tela. */
.cmd .desc{margin:3px 0 0;font-size:${s(12.5)};line-height:1.35;color:var(--lua-text-secondary,#94A3B8);
  display:-webkit-box;-webkit-line-clamp:${DIM.descLinhas};-webkit-box-orient:vertical;overflow:hidden}
.cmd .ex{margin:4px 0 0;font-size:${s(11.5)};color:var(--lua-text-secondary,#94A3B8);opacity:.85;
  display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.cmd .ex code{font-size:${s(11.5)};font-weight:500;color:var(--lua-text-secondary,#94A3B8)}
.cmd .top .go{margin-left:auto}
.go{flex:0 0 auto;min-height:${DIM.botaoUsar}px;display:inline-flex;align-items:center;padding:0 14px;border:0;
  border-radius:999px;font-size:${s(13)};font-weight:700;color:var(--lua-on-primary,#fff);cursor:pointer;
  background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  box-shadow:0 2px 6px var(--lua-glow,rgba(139,92,246,.3));transition:transform .1s ease,box-shadow .15s ease}
.go:active{transform:translateY(1px)}
.go:focus-visible,.tab:focus-visible,.pn-copy:focus-visible,.pn-back:focus-visible,#lua-top:focus-visible,
#lua-q:focus-visible,.vnav:focus-visible,.snav:focus-visible,.vtop:focus-visible{
  outline:2px solid var(--lua-secondary,var(--lua-neon,#C084FC));outline-offset:2px}
.tag{font-size:${s(10)};font-weight:700;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.4px}
.tag.dono{background:rgba(250,204,21,.16);color:var(--lua-tag-dono,#FACC15)}
.tag.grupo{background:rgba(96,165,250,.16);color:var(--lua-tag-grupo,#93C5FD)}
.tag.admin{background:rgba(248,113,113,.16);color:var(--lua-tag-admin,#FCA5A5)}
.tag.pv{background:rgba(52,211,153,.16);color:var(--lua-tag-pv,#6EE7B7)}

/* ---------- painel do "Usar" ---------- */
.pn-top{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:8px 0 6px;
  border-bottom:1px solid var(--lua-line,rgba(255,255,255,.10))}
#lua-panel-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:2px;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:none}
.tabs::-webkit-scrollbar,#lua-list::-webkit-scrollbar,#lua-panel-body::-webkit-scrollbar{width:0;display:none}
.pn-title{font-size:${s(15)};font-weight:700;flex:1;min-width:0;color:var(--lua-text,#fff)}
.pn-cmd{margin:10px 0 0;padding:8px 12px;border-radius:var(--lua-radius-sm,8px);background:var(--lua-card,#1E2026);border:1px solid var(--lua-border-soft,rgba(255,255,255,.08))}
.pn-cmd code{font-family:var(--lua-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:${s(15)};font-weight:700;
  color:var(--lua-neon,#C084FC);word-break:break-all}
.pn-desc{margin:6px 0 0;font-size:${s(12.5)};line-height:1.4;color:var(--lua-text-secondary,#94A3B8)}
.pn-req{margin:8px 0 0;padding:8px 12px 8px 24px;border-radius:var(--lua-radius-sm,8px);background:rgba(253,230,138,.07);border:1px solid rgba(253,230,138,.18);font-size:${s(12)};color:var(--lua-warn-text,#FDE68A)}
.pn-req li{margin:3px 0}
.pn-fields{margin:12px 0 0}
.pn-field{display:block;margin:0 0 10px}
.pn-field>span{display:block;font-size:${s(12)};font-weight:600;color:var(--lua-text-secondary,#94A3B8);margin-bottom:4px}
.pn-field input,.pn-field select{width:100%;min-height:${DIM.toque}px;padding:10px 12px;border-radius:10px;font-size:${s(15)};
  border:1px solid var(--lua-border,rgba(255,255,255,.14));background:var(--lua-bg-secondary,#1A1B20);color:var(--lua-text,#fff);outline:none;transition:border-color .15s ease}
.pn-field input:focus,.pn-field select:focus{border-color:var(--lua-primary,#8B5CF6)}
.pn-field.bad input,.pn-field.bad select{border-color:var(--lua-bad-text,#FCA5A5)}
.pn-err{display:block;font-size:${s(11.5)};color:var(--lua-bad-text,#FCA5A5);min-height:15px;margin-top:3px}
.pn-prev{margin:12px 0 4px;font-size:${s(12)};font-weight:600;color:var(--lua-text-secondary,#94A3B8)}
.pn-out{margin:0;padding:10px 12px;border-radius:10px;background:var(--lua-bg-secondary,#1A1B20);
  border:1px dashed var(--lua-border-strong,rgba(255,255,255,.2));font-family:var(--lua-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);
  font-size:${s(14)};color:var(--lua-text,#fff);white-space:pre-wrap;word-break:break-all;
  -webkit-user-select:text;user-select:text}
.pn-actions{display:flex;gap:8px;margin:12px 0 0;flex-wrap:wrap}
.pn-copy{flex:1 1 auto;min-height:${DIM.toque}px;border:0;border-radius:999px;font-size:${s(13.5)};font-weight:700;color:var(--lua-on-primary,#fff);
  cursor:pointer;background:linear-gradient(135deg,var(--lua-primary,#8B5CF6),var(--lua-primary-dark,#4C1D95));
  box-shadow:0 2px 6px var(--lua-glow,rgba(139,92,246,.3));transition:transform .1s ease}
.pn-copy[disabled]{opacity:.5}
.pn-back{flex:0 0 auto;min-height:${DIM.toque}px;padding:0 18px;border-radius:999px;border:1px solid var(--lua-border,rgba(255,255,255,.16));
  background:var(--lua-card,#1E2026);color:var(--lua-text,#fff);font-size:${s(13.5)};font-weight:600;cursor:pointer}
.pn-status{margin:8px 0 0;font-size:${s(12.5)};min-height:16px;color:var(--lua-ok-text,#6EE7B7)}
.pn-tip{margin:8px 0 0;font-size:${s(11.5)};color:var(--lua-text-secondary,#94A3B8)}

/* ---------- rodapé ---------- */
.foot{margin-top:10px;padding:8px 6px 4px;border-top:1px solid var(--lua-line,rgba(255,255,255,.10));font-size:${s(11)};
  line-height:1.35;color:var(--lua-text-secondary,#94A3B8)}
.foot code{color:var(--lua-neon,#C084FC);font-weight:700}
/* diagnóstico de área: aparece SÓ quando o host deu menos altura que a pedida */
.foot-medida{display:block;margin-top:4px;color:var(--lua-neon,#C084FC)}
.empty{padding:26px 8px;text-align:center;color:var(--lua-text-secondary,#94A3B8);font-size:${s(13)}}
/* atalho "topo": mora na barra (fora da área que rola), por isso nunca some no
   meio da lista — antes ele ficava no fim do conteúdo e só aparecia no final */
.vtop{width:${DIM.rail}px;min-height:${DIM.snav}px;display:inline-flex;align-items:center;justify-content:center;
  border-radius:12px;border:1px dashed var(--lua-border-strong,rgba(255,255,255,.22));background:transparent;
  color:var(--lua-text-secondary,#94A3B8);font-size:${s(17)};line-height:1;cursor:pointer}
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
body.curto .logo{width:26px;height:26px;font-size:${s(14)}}
body.curto .bot-meta{display:none}
body.curto .idp{font-size:${s(9.2)};line-height:1.25;margin-top:1px}
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
