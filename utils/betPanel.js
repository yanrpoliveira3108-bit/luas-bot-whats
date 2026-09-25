/**
 * utils/betPanel.js — PAINEL DE CARTEIRA E APOSTA compartilhado pelos jogos.
 *
 * O mesmo painel é usado pelo 🗺️ CAÇA AO TESOURO e pelo 🐯 TIGRINHO: saldo,
 * comprometido, disponível, mínimo, máximo, campo do valor, atalhos, prévia do
 * saldo restante, botão de atualizar e o botão de confirmar.
 *
 * Regras que valem para os dois jogos:
 *   - os NÚMEROS vêm sempre do bot (carteira real, lida no servidor no momento
 *     do envio). O HTML NÃO é fonte de saldo e NÃO decide prêmio;
 *   - o campo editável é só o VALOR da aposta; o saldo é somente leitura;
 *   - abrir a tela, consultar o saldo ou digitar o valor NÃO debita nada — a
 *     cobrança acontece quando o bot processa o comando copiado;
 *   - este card não tem canal de volta ao bot (é o limite do formato), então
 *     confirmar COPIA o comando completo; quem executa é o bot, que revalida
 *     carteira, limites, partida e permissões;
 *   - a validação daqui é só conveniência: as MESMAS regras (e os mesmos
 *     motivos) são revalidadas no servidor por utils/gameWallet.js.
 *
 * Nada de segredo aqui: este módulo recebe apenas números de carteira, limites e
 * textos — nunca mapa oculto, semente, rodada futura ou dado de outro jogador.
 */

'use strict';

const fmt = require('./formatter');

/** Formata inteiro em pt-BR (mesmo formato da moeda do projeto). */
function valor(n) {
  return fmt.formatNumber(Math.max(0, Math.floor(Number(n) || 0)));
}

function esc(txt) {
  return String(txt == null ? '' : txt)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {object} o
 * @param {string} o.id            identificador único do painel na página
 * @param {object} o.moeda         { emoji, simbolo }
 * @param {object} o.saldo         { wallet, disponivel, comprometido, pendentes, quando }
 * @param {object} o.limites       { min, max, tetoJogo }
 * @param {string} o.comando       template do comando com `{valor}`
 * @param {string} o.comandoRefresh comando que reenvia o painel com saldo novo
 * @param {string[]} o.regras      regras de pagamento (mostradas antes de confirmar)
 * @param {string[]} o.avisos      avisos (ex.: aposta não é devolvida)
 * @param {string} [o.rodada]      id da partida/rodada em andamento (se houver)
 * @param {string} [o.bloqueio]    motivo para bloquear a confirmação (sem cadastro, falha de consulta)
 * @param {boolean} [o.indisponivel] true = saldo NÃO pôde ser lido agora (mostra "—", nunca 0 inventado)
 * @param {string} [o.titulo]
 * @param {number} [o.passo]       passo dos botões +/− (padrão 10 LC)
 * @param {number} [o.valorInicial] valor já preenchido no campo (ex.: a aposta
 *   PADRÃO do jogo) — nunca o saldo inteiro; só vale se estiver entre o mínimo e
 *   o máximo do momento (fora da faixa o campo abre vazio)
 * @param {string} [o.rotuloConfirmar]
 */
function montar(o) {
  const id = String(o.id || 'bp');
  const moeda = o.moeda || { emoji: '🪙', simbolo: 'LC' };
  const saldo = o.saldo || { wallet: 0, disponivel: 0, comprometido: 0, pendentes: [] };
  const lim = o.limites || { min: 1, max: 0, tetoJogo: null };
  const passo = Number(o.passo) > 0 ? Math.floor(Number(o.passo)) : 10;
  const bloqueio = o.bloqueio ? String(o.bloqueio) : '';
  // Saldo indisponível NUNCA vira zero: mostra "—" e explica o motivo.
  const indisponivel = o.indisponivel === true;
  const comando = String(o.comando || '').replace(/"/g, '&quot;');
  const comandoRefresh = String(o.comandoRefresh || '').replace(/"/g, '&quot;');
  const pendentes = Array.isArray(saldo.pendentes) ? saldo.pendentes : [];
  /**
   * Valor já preenchido (opcional). Quem monta o painel decide o número — a
   * regra do jogo é NUNCA pré-selecionar o saldo todo; aqui só entra valor
   * inteiro dentro da faixa válida do momento (senão o campo abre vazio).
   */
  const inicialBruto = Number(o.valorInicial);
  const valorInicial =
    Number.isFinite(inicialBruto) && inicialBruto >= lim.min && (lim.max <= 0 || inicialBruto <= lim.max)
      ? Math.floor(inicialBruto)
      : null;
  const temComprometido = saldo.comprometido > 0;

  const fmt = (n) => (indisponivel ? '—' : `${moeda.emoji} ${valor(n)} ${moeda.simbolo}`);

  const linha = (rotulo, valorTxt, id2) =>
    `<div class="bp-row"><span class="bp-k">${esc(rotulo)}</span>` +
    `<b class="bp-v"${id2 ? ` id="${esc(id2)}"` : ''}>${valorTxt}</b></div>`;

  const chips = [10, 25, 50]
    .map((p) => `<button type="button" class="bp-chip" data-pct="${p}" aria-label="Apostar ${p}% do disponível">${p}%</button>`)
    .join('');

  const css = `
.bp{margin:12px 0 0;padding:12px;border-radius:16px;background:rgba(0,0,0,.42);
  border:1px solid rgba(255,190,60,.35);color:#ffe9ad;font-family:Arial,sans-serif}
.bp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:bold;
  font-size:14px;color:#ffc63c;margin-bottom:8px}
.bp-tag{font-size:9px;font-weight:normal;letter-spacing:1px;text-transform:uppercase;color:rgba(255,196,60,.7)}
.bp-grid{display:grid;grid-template-columns:1fr auto;gap:4px 10px;font-size:13px;margin-bottom:10px}
.bp-row{display:contents}
.bp-k{color:rgba(255,233,173,.85)}
.bp-v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#ffd54a}
.bp-v.dim{color:rgba(255,213,74,.75)}
.bp-lbl{display:block;font-size:12px;font-weight:bold;margin:2px 0 6px;color:#ffd54a}
.bp-field{display:flex;align-items:stretch;gap:8px}
.bp-field input{flex:1 1 auto;min-width:0;min-height:48px;text-align:center;border-radius:12px;
  border:1px solid rgba(255,190,60,.5);background:rgba(0,0,0,.55);color:#fff;
  font:700 18px ui-monospace,SFMono-Regular,Menlo,monospace;padding:0 10px}
.bp-field input::placeholder{color:rgba(255,255,255,.35);font-weight:400;font-size:14px}
.bp-menos,.bp-mais{flex:0 0 54px;min-height:48px;border-radius:12px;font-size:22px;font-weight:bold;
  border:1px solid rgba(255,190,60,.5);background:rgba(0,0,0,.5);color:#ffd54a;cursor:pointer}
.bp-lim{font-size:11px;color:rgba(255,233,173,.8);margin-top:6px}
.bp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.bp-chip{min-height:44px;padding:0 12px;border-radius:999px;font-size:12px;font-weight:bold;
  border:1px solid rgba(255,190,60,.35);background:rgba(255,190,60,.12);color:#ffe9ad;cursor:pointer}
.bp-est{margin-top:10px;font-size:12px;color:#a7f3d0}
.bp-erro{margin-top:8px;font-size:12px;min-height:16px;color:#fca5a5}
.bp-erro.ok{color:#a7f3d0}
.bp-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.bp-refresh,.bp-go{min-height:52px;border-radius:14px;font-size:14px;font-weight:bold;cursor:pointer;
  border:1px solid rgba(255,190,60,.6);background:rgba(0,0,0,.45);color:#ffe9ad}
.bp-refresh{flex:0 0 auto;padding:0 14px}
.bp-go{flex:1 1 220px;background:linear-gradient(135deg,rgba(255,190,60,.85),rgba(139,0,0,.65));
  color:#fff;letter-spacing:.5px}
.bp-go[disabled]{opacity:.45;cursor:not-allowed;letter-spacing:normal}
.bp-cmd{margin-top:8px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#a7f3d0;
  min-height:16px;word-break:break-all}
.bp-regras{margin-top:10px;font-size:12px;color:rgba(255,233,173,.9)}
.bp-regras summary{cursor:pointer;font-weight:bold;min-height:44px;display:flex;align-items:center;color:#ffc63c}
.bp-regras ul{margin:6px 0 0;padding-left:18px}
.bp-regras li{margin:3px 0}
.bp-aviso{margin:8px 0 0;font-size:11px;color:rgba(255,233,173,.75)}
.bp-pend{margin-top:6px;font-size:11px;color:#fde68a}
.bp-resumo{margin:2px 0 8px;font-size:13px;color:#ffe9ad}
.bp-resumo b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#ffd54a}
.bp-mais{margin-top:10px;font-size:12px;color:#ffc63c}
.bp-mais summary{cursor:pointer;font-weight:bold;min-height:44px;display:flex;align-items:center;color:#ffc63c}
.bp-mais .bp-grid{margin:6px 0 0}
@media (prefers-reduced-motion: reduce){.bp *{animation:none!important;transition:none!important}}
`;

  // ---------------------------------------------------------------- markup --
  // `compacto` (usado nos CARDS dos jogos): a parte acionável — valor, prévia e
  // os botões — fica no topo, e o detalhamento da carteira (grade, limites e
  // atalhos) vai para um <details>. Motivo medido no aparelho (25/09): o WebView
  // do card dimensiona a viewport pelo CONTEÚDO, mas o host ainda limita a área;
  // com o detalhamento aberto, o botão de jogar/escavar caía fora da parte
  // visível. Em modo normal (o painel de abertura do caça) nada muda.
  const compacto = o.compacto === true;
  const bHead =
    `<div class="bp-head"><span>${esc(o.titulo || '💼 Carteira e aposta')}</span>` +
    `<span class="bp-tag">saldo do bot · ${esc(saldo.quando || 'agora')}</span></div>`;
  const bResumo =
    `<div class="bp-resumo">💼 Saldo <b>${fmt(saldo.wallet)}</b> · disponível <b>${fmt(saldo.disponivel)}</b>` +
    (temComprometido ? ` · comprometido <b>${fmt(saldo.comprometido)}</b>` : '') +
    '</div>' +
    (o.rodada ? `<div class="bp-pend">▸ Partida em andamento: <b>${esc(o.rodada)}</b></div>` : '') +
    (pendentes.length
      ? `<div class="bp-pend">▸ Já comprometido em: ${pendentes
          .map((p) => esc(`${p.game} (${valor(p.bet)})`))
          .join(' · ')}</div>`
      : '');
  const bGrade =
    '<div class="bp-grid">' +
    linha('Saldo na carteira', fmt(saldo.wallet)) +
    (temComprometido ? linha('Comprometido agora', fmt(saldo.comprometido)) : '') +
    linha('Disponível para apostar', fmt(saldo.disponivel)) +
    linha('Aposta mínima', fmt(lim.min)) +
    linha('Máximo neste jogo', fmt(lim.max)) +
    (lim.tetoJogo != null ? linha('Limite do jogo', fmt(lim.tetoJogo)) : '') +
    '</div>' +
    (o.rodada ? `<div class="bp-pend">▸ Partida em andamento: <b>${esc(o.rodada)}</b></div>` : '') +
    (pendentes.length
      ? `<div class="bp-pend">▸ Já comprometido em: ${pendentes
          .map((p) => esc(`${p.game} (${valor(p.bet)})`))
          .join(' · ')}</div>`
      : '');
  const bCampo =
    `<label class="bp-lbl" for="bp-in-${esc(id)}">Valor da aposta</label>` +
    '<div class="bp-field">' +
    `<button type="button" class="bp-menos" id="bp-menos-${esc(id)}" aria-label="Diminuir aposta">−</button>` +
    `<input id="bp-in-${esc(id)}" type="text" inputmode="numeric" autocomplete="off" aria-label="Valor da aposta"` +
    (valorInicial === null ? '' : ` value="${esc(valorInicial)}"`) +
    (indisponivel ? ' disabled' : '') +
    ` placeholder="ex.: ${esc(lim.min)}" aria-describedby="bp-lim-${esc(id)}">` +
    `<button type="button" class="bp-mais" id="bp-mais-${esc(id)}" aria-label="Aumentar aposta">+</button>` +
    '</div>' +
    `<div class="bp-lim" id="bp-lim-${esc(id)}">Mínimo ${valor(lim.min)} · Máximo ${valor(lim.max)} ${esc(moeda.simbolo)}` +
    (lim.tetoJogo != null ? ` · limite do jogo ${valor(lim.tetoJogo)}` : '') +
    '</div>';
  const bChips =
    `<div class="bp-chips">${chips}` +
    `<button type="button" class="bp-chip" data-pct="100" aria-label="Apostar o máximo permitido">Máx (${valor(lim.max)})</button>` +
    '</div>';
  const bEst = `<div class="bp-est" id="bp-est-${esc(id)}">Saldo estimado depois da aposta: —</div>`;
  const bErro =
    `<div class="bp-erro" id="bp-erro-${esc(id)}" role="alert">${
      bloqueio ? esc(bloqueio) : 'Digite um valor para continuar.'
    }</div>`;
  const bBtns =
    '<div class="bp-btns">' +
    `<button type="button" class="bp-refresh" id="bp-ref-${esc(id)}" aria-label="Atualizar saldo">🔄 Atualizar saldo</button>` +
    `<button type="button" class="bp-go" id="bp-go-${esc(id)}" disabled>` +
    `${esc(o.rotuloConfirmar || '✅ Confirmar aposta e iniciar')}</button>` +
    '</div>';
  const bCmd = `<div class="bp-cmd" id="bp-cmd-${esc(id)}" aria-live="polite"></div>`;
  const bRegras =
    `<details class="bp-regras"><summary>Regras de pagamento</summary><ul>${
      (o.regras || []).map((r) => `<li>${esc(r)}</li>`).join('')
    }</ul></details>`;
  const bAviso =
    `<p class="bp-aviso">O saldo é lido pelo bot na sua carteira — o card só mostra. ` +
    'Nada é cobrado ao abrir a tela ou ao digitar: a aposta só entra quando você envia o comando. ' +
    'Os valores do card vêm do momento em que ele foi enviado; o bot confere tudo de novo ao receber o comando.</p>';

  const markup =
    `<div class="bp" id="bp-${esc(id)}" data-min="${esc(lim.min)}" data-max="${esc(lim.max)}"` +
    ` data-disp="${esc(saldo.disponivel)}" data-teto="${lim.tetoJogo == null ? '' : esc(lim.tetoJogo)}"` +
    ` data-passo="${esc(passo)}" data-cmd="${comando}" data-refresh="${comandoRefresh}"` +
    ` data-bloqueio="${esc(bloqueio)}" data-indisponivel="${indisponivel ? '1' : ''}">` +
    (compacto
      ? bHead +
        bResumo +
        bCampo +
        bChips +
        bEst +
        bErro +
        bBtns +
        bCmd +
        `<details class="bp-mais"><summary>💼 Carteira e limites (toque para abrir)</summary>${bGrade}</details>` +
        bRegras +
        bAviso
      : bHead + bGrade + bCampo + bChips + bEst + bErro + bBtns + bCmd + bRegras + bAviso) +
    '</div>';
  // JS do painel: validação de conveniência (o servidor revalida), prévia,
  // atalhos e cópia do comando. Sem template literal e sem `${` para poder ser
  // embutido no payload sem surpresa de escape.
  const js =
    '(function(){\n' +
    'var box=document.getElementById("bp-' + id + '");if(!box)return;\n' +
    'var MIN=Number(box.getAttribute("data-min"))||1,\n' +
    '    MAX=Number(box.getAttribute("data-max"))||0,\n' +
    '    DISP=Number(box.getAttribute("data-disp"))||0,\n' +
    '    TETO=box.getAttribute("data-teto"),\n' +
    '    PASSO=Number(box.getAttribute("data-passo"))||10,\n' +
    '    CMD=box.getAttribute("data-cmd")||"",\n' +
    '    REFRESH=box.getAttribute("data-refresh")||"",\n' +
    '    BLOQUEIO=box.getAttribute("data-bloqueio")||"";\n' +
    'if(TETO!=="")TETO=Number(TETO);else TETO=null;\n' +
    'var inp=document.getElementById("bp-in-' + id + '"),\n' +
    '    erro=document.getElementById("bp-erro-' + id + '"),\n' +
    '    est=document.getElementById("bp-est-' + id + '"),\n' +
    '    saida=document.getElementById("bp-cmd-' + id + '"),\n' +
    '    go=document.getElementById("bp-go-' + id + '");\n' +
    'function num(n){return (Math.max(0,Math.floor(n||0))).toLocaleString("pt-BR")}\n' +
    'function limpa(t){return String(t==null?"":t).replace(/[.\\s](?=\\d{3}\\b)/g,"")}\n' +
    // validação idêntica à do servidor (mesmos motivos, mesmo texto)
    'function validar(txt){\n' +
    '  var t=String(txt==null?"":txt).trim();\n' +
    '  if(!t)return{ok:false,m:"Informe um valor para apostar."};\n' +
    '  if(/^-/.test(t))return{ok:false,m:"O valor não pode ser negativo."};\n' +
    '  if(/^\\d+[,.]\\d+$/.test(t))return{ok:false,m:"A moeda é inteira: use um valor sem centavos."};\n' +
    '  var s=limpa(t);\n' +
    '  if(!/^\\d+$/.test(s))return{ok:false,m:"Valor inválido. Use apenas números inteiros (ex.: 100)."};\n' +
    '  var n=Number(s);\n' +
    '  if(!isFinite(n))return{ok:false,m:"Valor inválido."};\n' +
    '  if(n===0)return{ok:false,m:"O valor precisa ser maior que zero."};\n' +
    '  if(n<MIN)return{ok:false,m:"Valor abaixo da aposta mínima (mín "+num(MIN)+")."};\n' +
    '  if(TETO!==null&&n>TETO)return{ok:false,m:"Valor acima do limite deste jogo (máx "+num(TETO)+")."};\n' +
    '  if(n>MAX)return{ok:false,m:"Saldo insuficiente para esta aposta (máx "+num(MAX)+" agora)."};\n' +
    '  return{ok:true,v:n};\n' +
    '}\n' +
    'function pintar(){\n' +
    '  var r=validar(inp.value);\n' +
    '  if(BLOQUEIO){go.disabled=true;erro.textContent=BLOQUEIO;erro.className="bp-erro";est.textContent="Saldo estimado depois da aposta: —";return}\n' +
    '  if(!r.ok){go.disabled=true;erro.textContent=r.m;erro.className="bp-erro";est.textContent="Saldo estimado depois da aposta: —";return}\n' +
    '  go.disabled=false;erro.textContent="Valor válido. Confirme para copiar o comando.";erro.className="bp-erro ok";\n' +
    '  est.textContent="Saldo estimado depois da aposta: "+num(DISP-r.v)+" (estimativa até o bot confirmar)";\n' +
    '}\n' +
    'function copiar(texto,cb){\n' +
    '  var fim=false;function pronto(ok){if(!fim){fim=true;cb(ok)}}\n' +
    '  function legado(){\n' +
    '    try{var ta=document.createElement("textarea");ta.value=texto;ta.setAttribute("readonly","");\n' +
    '      ta.style.position="absolute";ta.style.left="-9999px";document.body.appendChild(ta);ta.select();\n' +
    '      if(ta.setSelectionRange)ta.setSelectionRange(0,texto.length);\n' +
    '      var ok=!!(document.execCommand&&document.execCommand("copy"));document.body.removeChild(ta);return ok;\n' +
    '    }catch(e){return false}\n' +
    '  }\n' +
    '  try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(texto).then(function(){pronto(true)},function(){pronto(legado())});return}}catch(e){}\n' +
    '  pronto(legado());\n' +
    '}\n' +
    'function comandoCom(v){return CMD.replace("{valor}",String(v))}\n' +
    'function confirma(){\n' +
    '  var r=validar(inp.value);if(!r.ok||BLOQUEIO)return;\n' +
    '  var cmd=comandoCom(r.v);\n' +
    '  copiar(cmd,function(ok){\n' +
    '    saida.textContent=(ok?"✅ Comando copiado: ":"⚠️ Copie manualmente: ")+cmd+" — envie esta mensagem no chat para o bot processar.";\n' +
    '  });\n' +
    '}\n' +
    'function passo(d){var r=validar(inp.value);var base=r.ok?r.v:(Number(limpa(inp.value))||0);\n' +
    '  var n=base+d*PASSO;if(n<0)n=0;inp.value=String(n);pintar()}\n' +
    'var menos=document.getElementById("bp-menos-' + id + '"),mais=document.getElementById("bp-mais-' + id + '");\n' +
    'if(menos)menos.addEventListener("click",function(){passo(-1)});\n' +
    'if(mais)mais.addEventListener("click",function(){passo(1)});\n' +
    'inp.addEventListener("input",pintar);\n' +
    '[].slice.call(box.querySelectorAll(".bp-chip")).forEach(function(b){\n' +
    '  b.addEventListener("click",function(){\n' +
    '    var pct=Number(b.getAttribute("data-pct"))||0;\n' +
    '    var v=Math.floor(MAX*pct/100);if(v<MIN)v=MIN;if(v>MAX)v=MAX;\n' +
    '    inp.value=String(v);pintar();\n' +
    '  });\n' +
    '});\n' +
    'go.addEventListener("click",confirma);\n' +
    'var ref=document.getElementById("bp-ref-' + id + '");\n' +
    'if(ref)ref.addEventListener("click",function(){\n' +
    '  copiar(REFRESH,function(ok){\n' +
    '    saida.textContent=(ok?"✅ Comando copiado: ":"⚠️ Copie manualmente: ")+REFRESH+" — envie no chat para o bot reenviar o painel com o saldo atualizado.";\n' +
    '  });\n' +
    '});\n' +
    'pintar();\n' +
    'window.__bp' + id.replace(/[^a-zA-Z0-9]/g, '') + '={validar:validar,comando:comandoCom,pintar:pintar,valor:function(){return inp.value}};\n' +
    '})();';

  return { css, markup, js };
}

module.exports = { montar, valor, esc };
