/**
 * menus/html/client.js — JavaScript compartilhado dos menus HTML.
 *
 * O que ele faz (SÓ o que o ambiente suporta):
 *   - troca de tela LOCAL (lista ↔ painel do "Usar"): nada é reenviado, nada é
 *     reconstruído — só se mostra/esconde o que já está no documento;
 *   - histórico: "Voltar" retorna para a tela anterior com categoria, busca,
 *     campos preenchidos e rolagem restaurados;
 *   - ROLAGEM POR BOTÕES: ↑ ↓ movem SÓ o contêiner de comandos (#lua-list) — ou
 *     o painel (#lua-panel-body), quando ele está aberto — e ← → revelam
 *     categorias na faixa (#lua-tabs). Cada toque anda PASSO × área visível.
 *     A página e a conversa do WhatsApp não se movem: quem rola é sempre um
 *     contêiner interno, com `overflow` próprio;
 *   - ALTURA: o CSS entrega px FIXO (nunca `vh`/`min()`: a altura de viewport
 *     deste WebView não é confiável — ver templates.travarAltura). Aqui, em
 *     runtime, o card pode ENCOLHER se a área disponível medida for plausível
 *     (>=240px) e menor que a desenhada; medida degenerada ou ausente deixa o
 *     card exatamente como a versão que renderiza bem;
 *   - TOQUES RÁPIDOS: o destino dos toques é ACUMULADO — enquanto a rolagem
 *     anterior ainda está animando, o toque seguinte conta a partir do destino
 *     já pedido (não da posição animada) e é aplicado NA HORA, sem animação. Sem
 *     isso, 5 toques seguidos andavam quase nada (cada um reiniciava a animação
 *     de onde ela estava) e o fim da lista parecia inalcançável. Toque isolado
 *     continua animando suave; pausa de 350ms volta ao modo suave;
 *   - painel do "Usar": campos vindos do `usage` real do comando, validação e
 *     o comando montado pronto para COPIAR (o card não envia mensagens);
 *   - busca/filtro instantâneo sobre os comandos já desenhados;
 *   - transições curtas (opacity/transform) respeitando
 *     `prefers-reduced-motion`.
 *
 * O que ele NÃO faz, de propósito:
 *   - não chama o processo do bot e não inventa API: o WebView do card é um
 *     sandbox de origem opaca (about:blank), sem secure context e sem rede —
 *     `fetch`, XHR e navegação por `href` http(s) não contam como caminho (ver
 *     menus/html/actions.js, com a origem de cada afirmação). A única ponte
 *     exposta é `AndroidBridge.updateSize` (altura); não existe canal
 *     HTML→bot por aqui;
 *   - não usa storage (localStorage/indexedDB lançam SecurityError): o estado
 *     vive em memória, dentro da própria página;
 *   - não deixa timer pendente: cada troca de tela cancela a transição anterior
 *     (toque rápido em outra categoria não empilha tela nem deixa resultado
 *     antigo sobrescrever a atual — a última troca vence);
 *   - não bloqueia gestos: nenhum listener de `touch`/`touchmove` e nenhum
 *     `preventDefault` global. Os botões só respondem a `click`, então
 *     selecionar texto, copiar e os gestos do WhatsApp continuam funcionando.
 *     Contra o arrastar-para-responder, o que ajuda é a PÁGINA não rolar
 *     (overflow:hidden em html/body/#__wrap) e as setas existirem.
 *   - não faz polling: os estados das setas são recalculados em rAF depois de
 *     um evento (rolagem, resize, troca de categoria/busca) e nunca em laço.
 *
 * Todo o JS vai EMBUTIDO no payload da mensagem (o WebView é offline) e cada
 * byte é multiplicado por centenas de comandos: por isso o código abaixo é
 * enxuto de propósito e os comentários ficam aqui fora.
 */

'use strict';

/**
 * Fração da ÁREA VISÍVEL que cada toque das setas desloca — PADRÃO DO PROJETO.
 * Este é o único lugar com o número: vale para ↑ ↓ (altura visível de
 * #lua-list/#lua-panel-body) e para ← → (largura visível de #lua-tabs).
 * Sem editar código dá para trocar por card com `MENU_HTML_STEP` (ver
 * menus/html/index.js, passoDoCard()).
 */
const PASSO_PADRAO = 0.7;

function buildJs(initialCategory, opts = {}) {
  const { DIM } = require('./dimensoes');
  const initial = JSON.stringify(String(initialCategory || ''));
  const informado = Number(opts && opts.passo);
  const passo = Number.isFinite(informado) && informado > 0 && informado <= 1 ? informado : PASSO_PADRAO;
  const alturaCss = Math.max(
    DIM.alturaMin,
    Math.min(DIM.alturaMax, Math.round(Number(opts && opts.altura) || DIM.altura))
  );
  // Guarda do encaixe e corte do body.curto: MESMOS números do dimensoes.js.
  const alturaMin = DIM.alturaMin;
  const alturaCurta = DIM.alturaCurta;
  return `
(function(){
"use strict";
var raiz=document.getElementById("lua-menu");if(!raiz)return;
var lista=document.getElementById("lua-list"),painel=document.getElementById("lua-panel-body"),
corpo=document.getElementById("lua-panel-conteudo"),faixa=document.getElementById("lua-tabs"),
telaL=document.getElementById("lua-view-list"),telaP=document.getElementById("lua-view-panel"),
BT={up:document.getElementById("lua-up"),down:document.getElementById("lua-down"),
esq:document.getElementById("lua-cat-prev"),dir:document.getElementById("lua-cat-next")};
var tabs=[].slice.call(raiz.querySelectorAll(".tab")),secs=[].slice.call(raiz.querySelectorAll(".sec"));
var input=document.getElementById("lua-q"),vazio=document.getElementById("lua-empty"),
rotulo=document.getElementById("lua-cat-label");
var inicial=${initial};
var REQ={g:"Só funciona no grupo — envie a mensagem no grupo.",d:"Só o dono do bot pode usar.",
a:"Só admin do grupo pode usar.",ba:"O bot precisa ser admin do grupo.",pv:"Este comando é só no privado.",
r:"Responda uma mensagem com este comando (o card não responde por você).",
m:"Para mencionar alguém use @ no chat depois de colar: digitar @nome não marca ninguém.",
md:"Usa mídia enviada ou respondida no chat."};
var st={tela:"list",cat:inicial,busca:"",rol:{},faixa:0,campos:{},cmd:"",pilha:[]};
var timer=null,copiouEm=0,alvo=null,alvoEm=0;
var ALTURA_CSS=${alturaCss},ALTURA_MIN=${alturaMin},CURTO=${alturaCurta},alturaAtual=0,medido=0,pedido=0;
/* PASSO = fração da área visível por toque (único ponto de ajuste). */
var PASSO=${passo};

function reduz(){try{return !!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)}catch(e){return false}}

/* Encaixe de altura em RUNTIME (CSS fica em px fixo — ver templates.js):
   só encolhe, só com medida PLAUSÍVEL (>=240px) e volta ao CSS se a janela
   folgar. Medida de 0/1px é ignorada de propósito: foi com uma medida dessas
   que a altura presa à viewport virou uma faixa de 1px (ver MENUS-HTML.md). */
function encaixar(){
  var h=0;
  try{h=document.documentElement.clientHeight||0}catch(e){h=0}
  var alvo=(h>=ALTURA_MIN&&h<ALTURA_CSS)?h:ALTURA_CSS;
  medido=h||0;
  if(alvo===alturaAtual)return;
  alturaAtual=alvo;
  var px=alvo+"px",raiz=document.documentElement;
  [raiz,document.body,document.getElementById("__wrap")].forEach(function(el){
    if(!el)return;
    el.style.height=px;el.style.maxHeight=px;
  });
  if(document.body)document.body.classList.toggle("curto",alvo<CURTO);
  notaMedida();
  pedirAltura();
  setas();
}
/* Pede ao HOST a altura declarada, pela ponte nativa do WebView
   (AndroidBridge.updateSize — a mesma que o helper de referência do formato usa
   para auto-altura). Enviamos SEMPRE o px que o HTML já declara, então não há
   laço de medição: um pedido por valor, dentro de try/catch. Se o host não
   tiver a ponte ou ignorar o pedido, nada muda. */
function pedirAltura(){
  if(pedido===ALTURA_CSS)return;
  pedido=ALTURA_CSS;
  try{
    if(window.AndroidBridge&&typeof window.AndroidBridge.updateSize==="function"){
      window.AndroidBridge.updateSize(ALTURA_CSS);
    }
  }catch(e){}
}
function notaMedida(){
  var el=document.getElementById("lua-medida");if(!el)return;
  if(medido>=ALTURA_MIN&&medido<ALTURA_CSS){
    el.textContent="▸ área do card aqui: "+medido+"px (pedido "+ALTURA_CSS+"px) — é o que o aplicativo desenha";
    el.hidden=false;
  }else{
    el.hidden=true;
  }
}
function chave(){return st.tela==="panel"?"panel":"cat:"+st.cat}
function elV(){return st.tela==="panel"?painel:lista}
function maxV(el){return el?Math.max(0,(el.scrollHeight||0)-(el.clientHeight||0)):0}
function maxH(el){return el?Math.max(0,(el.scrollWidth||0)-(el.clientWidth||0)):0}
/* Rolagem programática no contêiner, com o limite calculado aqui. Movimento
   suave quando o motor aceita opções e o usuário não pediu menos movimento;
   em motor antigo isso lança e cai no deslocamento direto (mesmo destino). */
function rolar(el,top,left){
  if(!el)return;
  var t=Math.max(0,Math.min(maxV(el),Math.round(top))),l=Math.max(0,Math.min(maxH(el),Math.round(left)));
  if(el.scrollTo&&!reduz()){try{el.scrollTo({top:t,left:l,behavior:"smooth"});return}catch(e){}}
  try{el.scrollTop=t;el.scrollLeft=l}catch(e){}
}
function guardar(){var el=elV();if(el)st.rol[chave()]=el.scrollTop||0;if(faixa)st.faixa=faixa.scrollLeft||0;alvo=null}
function repor(){var el=elV();if(el){try{el.scrollTop=st.rol[chave()]||0}catch(e){}}if(faixa){try{faixa.scrollLeft=st.faixa||0}catch(e){}}}
/* posição "efetiva": durante a animação vale o destino já pedido */
function posicao(el){
  if(!el)return 0;
  if(alvo!=null&&Date.now()-alvoEm<350)return alvo;
  return el.scrollTop||0;
}
function pintar(){
  var el=elV(),mv=maxV(el),p=posicao(el),mh=maxH(faixa),f=faixa?(faixa.scrollLeft||0):0;
  if(BT.up)BT.up.disabled=!(mv>1&&p>1);
  if(BT.down)BT.down.disabled=!(mv>1&&p<mv-1);
  if(BT.esq)BT.esq.disabled=!(mh>1&&f>1);
  if(BT.dir)BT.dir.disabled=!(mh>1&&f<mh-1);
}
var raf=false;
function setas(){
  if(raf)return;raf=true;
  (window.requestAnimationFrame||function(f){return setTimeout(f,16)})(function(){raf=false;pintar()});
}
function rotular(){
  var c=st.tela==="panel"?"o painel":"comandos";
  if(BT.up)BT.up.setAttribute("aria-label","Rolar "+c+" para cima");
  if(BT.down)BT.down.setAttribute("aria-label","Rolar "+c+" para baixo");
}
function tela(n){
  if(telaL)telaL.hidden=n!=="list";
  if(telaP)telaP.hidden=n!=="panel";
  st.tela=n;repor();rotular();setas();
}
function rolarV(dir){
  var el=elV();if(!el)return;
  var agora=Date.now(),emCurso=(alvo!=null&&agora-alvoEm<350);
  var passo=Math.max(90,Math.round((el.clientHeight||0)*PASSO));
  var base=emCurso?alvo:(el.scrollTop||0);
  var t=Math.max(0,Math.min(maxV(el),base+dir*passo));
  alvo=t;alvoEm=agora;
  if(emCurso){
    /* rajada: a animação anterior ainda está rodando — aplica o novo destino
       na hora, senão os toques entram numa fila de animações e a lista fica
       "arrastando" atrás do dedo (e o fim parece inalcançável). */
    try{el.scrollTop=t}catch(e){}
  }else{
    rolar(el,t,el.scrollLeft||0);
  }
  setas();
}
function rolarF(dir){
  if(!faixa)return;
  rolar(faixa,faixa.scrollTop||0,(faixa.scrollLeft||0)+dir*Math.max(60,Math.round((faixa.clientWidth||0)*PASSO)));
  setas();
}
/* Ao selecionar uma categoria, mexe na faixa só o necessário para mostrá-la. */
function mostrar(tab){
  if(!faixa||!tab)return;
  var ini=0,fim=0,larg=faixa.clientWidth||0,atual=faixa.scrollLeft||0;
  try{
    var r=tab.getBoundingClientRect(),fr=faixa.getBoundingClientRect();
    ini=(r.left-fr.left)+atual;fim=ini+(r.width||tab.offsetWidth||0);
  }catch(e){ini=tab.offsetLeft||0;fim=ini+(tab.offsetWidth||0)}
  var alvo=atual;
  if(ini-8<alvo)alvo=ini-8;
  else if(fim+8>alvo+larg)alvo=fim+8-larg;
  if(alvo!==atual)rolar(faixa,faixa.scrollTop||0,alvo);
}

function trocar(n,semPilha){
  if(n===st.tela)return;
  if(!semPilha)st.pilha.push({tela:st.tela,cat:st.cat,busca:st.busca});
  guardar();
  if(timer){clearTimeout(timer);timer=null}
  var alvo=n==="panel"?telaP:telaL, de=n==="panel"?telaL:telaP;
  if(reduz()||!alvo||!de){tela(n);return}
  de.classList.add("sai");
  timer=setTimeout(function(){
    timer=null;de.classList.remove("sai");tela(n);alvo.classList.add("entra");
    timer=setTimeout(function(){timer=null;alvo.classList.remove("entra")},170);
  },110);
}
function voltar(){
  var ant=st.pilha.pop();
  if(!ant){fechar();return}
  if(ant.tela==="list"&&ant.cat)st.cat=ant.cat;
  if(st.tela==="panel"&&ant.busca!==undefined&&input){input.value=ant.busca;st.busca=ant.busca;filtrar(ant.busca)}
  trocar(ant.tela||"list",true);
}
function fechar(){st.pilha=[];trocar("list",true)}

function aba(id){
  var achou=false,ativa=null;
  secs.forEach(function(s){var on=s.getAttribute("data-cat")===id;s.hidden=!on;if(on)achou=true});
  tabs.forEach(function(t){
    var a=t.getAttribute("data-cat")===id;
    t.classList.toggle("active",a);t.setAttribute("aria-selected",a?"true":"false");
    if(a)ativa=t;
  });
  if(rotulo)rotulo.textContent=ativa?(ativa.getAttribute("data-label")||""):"";
  st.cat=id;
  alvo=null; /* troca de categoria: destino acumulado não vale mais */
  /* cada categoria guarda a própria rolagem */
  if(lista){try{lista.scrollTop=st.rol["cat:"+id]||0}catch(e){}}
  mostrar(ativa);
  setas();
  return achou;
}

secs.forEach(function(s){
  var cat=s.getAttribute("data-cat")||"";
  [].slice.call(s.querySelectorAll(".cmd")).forEach(function(c){
    c.__find=((c.textContent||"")+" "+cat).toLowerCase().replace(/\\s+/g," ");
  });
});

function filtrar(termo){
  var q=String(termo||"").toLowerCase().trim(),total=0;
  secs.forEach(function(s){
    var vis=0;
    [].slice.call(s.querySelectorAll(".cmd")).forEach(function(c){
      var on=!q||(c.__find||"").indexOf(q)!==-1;c.hidden=!on;if(on)vis++;
    });
    s.hidden=!vis;total+=vis;
  });
  st.busca=q;
  if(vazio)vazio.hidden=!!total;
  if(q){
    tabs.forEach(function(t){t.classList.remove("active");t.setAttribute("aria-selected","false")});
    if(rotulo)rotulo.textContent="🔎 "+q+" ("+total+")";
    /* resultado novo começa do topo; a posição da categoria volta ao limpar */
    alvo=null;
    if(lista){try{lista.scrollTop=0}catch(e){}}
  }else{
    var a=tabs.filter(function(t){return t.classList.contains("active")})[0];
    aba(a?a.getAttribute("data-cat"):(st.cat||inicial));
  }
  setas();
}
function porCategoria(id){
  if(!id)return;
  guardar();
  if(st.busca&&input){input.value="";st.busca="";filtrar("")}
  aba(id);
}

function camposDoUso(texto){
  texto=String(texto||"");
  if(!texto)return [];
  var out=[],tks=texto.match(/<[^<>]*>|\\[[^\\[\\]]*\\]|@\\S+|\\S+/g)||[],i,tk;
  for(i=0;i<tks.length&&out.length<4;i++){
    tk=tks[i];
    if(tk.charAt(0)==="<"&&tk.charAt(tk.length-1)===">")out.push(campo(tk.slice(1,-1),true));
    else if(tk.charAt(0)==="["&&tk.charAt(tk.length-1)==="]")out.push(campo(tk.slice(1,-1),false));
    else if(tk.charAt(0)==="@")out.push(campo(tk.replace(/[.,;)]+$/,""),true));
    else if(tk.indexOf("|")!==-1&&tk.split("|").length<=6){var c=campo(tk,false);if(c.opcoes.length)out.push(c)}
  }
  return out.filter(function(c,ix,arr){
    return c.nome&&arr.findIndex(function(x){return x.nome.toLowerCase()===c.nome.toLowerCase()})===ix;
  });
  function campo(bruto,obrig){
    var nome=String(bruto||"").trim();
    var op=nome.indexOf("|")!==-1?nome.split("|").map(function(v){return v.trim()}).filter(Boolean):[];
    return {nome:nome,rotulo:op.length?op.join(", "):nome,obrigatorio:!!obrig,opcoes:op,
      tipo:/^@/.test(nome)?"mencao":(/link|url|site/i.test(nome)?"link":"texto")};
  }
}

function validar(campos,valores){
  var erros={};
  campos.forEach(function(c,i){
    var v=String(valores[i]==null?"":valores[i]).trim();
    if(!v){if(c.obrigatorio)erros[c.nome]="Preencha "+(c.rotulo||c.nome)+".";return}
    if(c.opcoes.length&&c.opcoes.indexOf(v)===-1){erros[c.nome]="Use: "+c.opcoes.join(", ")+".";return}
    if(c.tipo==="mencao"&&v.charAt(0)!=="@"){erros[c.nome]="Use @ no chat para marcar alguém.";return}
    if(c.tipo==="link"&&/\\s/.test(v)&&v.indexOf(".")!==-1&&!/^https?:\\/\\//i.test(v))erros[c.nome]="Confira: link com espaço.";
  });
  return erros;
}

function montar(trigger,campos,valores){
  var nome=(document.body.getAttribute("data-prefix")||"!")+trigger,partes=[],i,v;
  for(i=0;i<campos.length;i++){
    v=String(valores[i]==null?"":valores[i]).trim();
    if(!v)break;
    partes.push(v);
  }
  return partes.length?nome+" "+partes.join(" "):nome;
}

function esc(s){
  return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function abrir(btn){
  var card=btn.closest?btn.closest(".cmd"):null;
  var trigger=btn.getAttribute("data-usar")||"";
  var campos=camposDoUso(btn.getAttribute("data-uso")||"");
  var req=(btn.getAttribute("data-req")||"").split(",").filter(Boolean);
  var pref=document.body.getAttribute("data-prefix")||"!";
  var vals=(st.campos[trigger]||[]).slice();
  var h='<div class="pn-cmd"><code>'+esc(pref+trigger)+"</code></div>";
  var desc=card&&card.querySelector(".desc")?card.querySelector(".desc").textContent.trim():"";
  if(desc)h+='<p class="pn-desc">'+esc(desc)+"</p>";
  if(req.length){
    h+='<ul class="pn-req">';
    req.forEach(function(c){if(REQ[c])h+="<li>"+esc(REQ[c])+"</li>"});
    h+="</ul>";
  }
  if(campos.length){
    h+='<div class="pn-fields">';
    campos.forEach(function(c,i){
      var id="lua-f"+i;
      h+='<label class="pn-field" for="'+id+'"><span>'+esc(c.nome+(c.obrigatorio?" *":""))+"</span>";
      if(c.opcoes.length){
        h+='<select id="'+id+'" data-i="'+i+'"><option value="">— escolha —</option>';
        c.opcoes.forEach(function(o){
          h+='<option value="'+esc(o)+'"'+(vals[i]===o?" selected":"")+">"+esc(o)+"</option>";
        });
        h+="</select>";
      }else{
        h+='<input id="'+id+'" data-i="'+i+'" type="text" autocomplete="off" '+
           (c.tipo==="link"?'inputmode="url" ':"")+'placeholder="'+esc(c.rotulo)+'" value="'+esc(vals[i]||"")+'">';
      }
      h+='<span class="pn-err" data-err="'+esc(c.nome)+'"></span></label>';
    });
    h+="</div>";
  }
  h+='<p class="pn-prev">Comando pronto:</p><pre class="pn-out" id="lua-cmd" tabindex="0">'+esc(montar(trigger,campos,vals))+"</pre>";
  h+='<div class="pn-actions"><button type="button" class="pn-copy" id="lua-copy">Copiar comando</button>'+
     '<button type="button" class="pn-back" data-voltar="1">Voltar</button></div>';
  h+='<p class="pn-status" id="lua-status" role="status" aria-live="polite"></p>';
  h+='<p class="pn-tip">Este card não envia mensagens: copie e cole no chat. O bot confere permissão, '+
     'limites e pede confirmação quando for o caso.</p>';
  if(corpo)corpo.innerHTML=h;
  st.cmd=trigger;
  painel.__campos=campos;
  painel.__vals=vals;
  st.rol.panel=0; /* comando novo abre no topo */
  alvo=null;
  if(painel){try{painel.scrollTop=0}catch(e){}}
  trocar("panel");
  setas(); /* conteúdo novo = altura nova: reavalia as setas do painel */
  /* Sem focar campo sozinho: abrir teclado sem pedir tira o card da vista.
     Enquanto ele digita o foco não se perde (a prévia só troca texto). */
}

function previa(){
  var pre=document.getElementById("lua-cmd");
  if(pre&&painel.__campos)pre.textContent=montar(st.cmd,painel.__campos,painel.__vals);
  setas(); /* a prévia pode quebrar linha e mudar a altura do painel */
}
function limpar(){
  [].slice.call(painel.querySelectorAll(".pn-err")).forEach(function(e){e.textContent=""});
  [].slice.call(painel.querySelectorAll(".pn-field")).forEach(function(e){e.classList.remove("bad")});
}
function ler(){
  var campos=painel.__campos||[],vals=[];
  campos.forEach(function(c,i){var el=painel.querySelector('[data-i="'+i+'"]');vals[i]=el?el.value:""});
  painel.__vals=vals;
  if(st.cmd)st.campos[st.cmd]=vals.slice();
  return vals;
}
function selecionar(){
  try{
    var pre=document.getElementById("lua-cmd");
    if(!pre||!window.getSelection||!document.createRange)return;
    var r=document.createRange();r.selectNodeContents(pre);
    var s=window.getSelection();s.removeAllRanges();s.addRange(r);
  }catch(e){}
}
function legado(texto){
  try{
    var ta=document.createElement("textarea");
    ta.value=texto;ta.setAttribute("readonly","");
    ta.style.position="absolute";ta.style.left="-9999px";
    document.body.appendChild(ta);ta.select();
    if(ta.setSelectionRange)ta.setSelectionRange(0,texto.length);
    var ok=!!(document.execCommand&&document.execCommand("copy"));
    document.body.removeChild(ta);
    if(!ok)selecionar();
    return ok;
  }catch(e){selecionar();return false}
}
function copiar(texto,cb){
  var fim=false;
  function pronto(ok){if(!fim){fim=true;cb(ok)}}
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(texto).then(function(){pronto(true)},function(){pronto(legado(texto))});
      return;
    }
  }catch(e){}
  pronto(legado(texto));
}
function acaoCopiar(){
  var agora=Date.now();
  if(agora-copiouEm<900)return;
  var btn=document.getElementById("lua-copy"),sta=document.getElementById("lua-status");
  var campos=painel.__campos||[],vals=ler(),erros=validar(campos,vals),primeiro=null;
  limpar();
  campos.forEach(function(c,i){
    if(erros[c.nome]){
      var alvo=painel.querySelector('[data-err="'+c.nome+'"]');
      if(alvo)alvo.textContent=erros[c.nome];
      var dono=painel.querySelector('[data-i="'+i+'"]');
      if(dono&&dono.parentNode)dono.parentNode.classList.add("bad");
      if(!primeiro)primeiro=dono;
    }
  });
  if(primeiro){
    if(sta)sta.textContent="Falta preencher o comando.";
    try{primeiro.focus({preventScroll:true})}catch(e){}
    return;
  }
  var texto=montar(st.cmd,campos,vals);
  copiouEm=Date.now();
  if(btn){btn.disabled=true;btn.textContent="Copiando…"}
  copiar(texto,function(ok){
    if(btn){btn.disabled=false;btn.textContent="Copiar comando"}
    if(!sta)return;
    sta.textContent=ok?"✔ Copiado. Cole no chat e envie."
      :"Não deu para copiar sozinho. O comando está selecionado: segure e toque em Copiar.";
  });
}

raiz.addEventListener("click",function(ev){
  var a=ev.target;
  if(!a||!a.closest)return;
  var v=a.closest("[data-voltar]");
  if(v){ev.preventDefault();if(v.getAttribute("data-voltar")==="raiz")fechar();else voltar();return}
  var sobe=a.closest("#lua-up");if(sobe){ev.preventDefault();rolarV(-1);return}
  var desce=a.closest("#lua-down");if(desce){ev.preventDefault();rolarV(1);return}
  var esq=a.closest("#lua-cat-prev");if(esq){ev.preventDefault();rolarF(-1);return}
  var dir=a.closest("#lua-cat-next");if(dir){ev.preventDefault();rolarF(1);return}
  var u=a.closest("[data-usar]");if(u){ev.preventDefault();abrir(u);return}
  var c=a.closest("#lua-copy");if(c){ev.preventDefault();acaoCopiar();return}
  var t=a.closest("#lua-top"); /* atalho "topo" (na barra, fora da rolagem) */
  if(t){
    /* salto longo: aqui o deslocamento imediato é o certo — animar 17 mil px
       demora e parece travado (e o atalho existe justamente para encurtar). */
    ev.preventDefault();alvo=0;alvoEm=Date.now();
    if(lista){try{lista.scrollTop=0}catch(e){}}
    setas();return
  }
  var ab=a.closest(".tab");
  if(ab){ev.preventDefault();porCategoria(ab.getAttribute("data-cat"))}
});
if(input){
  input.addEventListener("input",function(){filtrar(input.value)});
  input.addEventListener("keydown",function(ev){if(ev.key==="Escape"){input.value="";filtrar("")}});
}
raiz.addEventListener("input",function(ev){
  if(ev.target&&ev.target.getAttribute&&ev.target.getAttribute("data-i")!==null){ler();previa();limpar()}
});
raiz.addEventListener("change",function(ev){
  if(ev.target&&ev.target.getAttribute&&ev.target.getAttribute("data-i")!==null){ler();previa();limpar()}
});
/* Setas: recalcula em rolagem (passivo), resize e trocas de tela. */
[lista,painel,faixa].forEach(function(el){if(el)el.addEventListener("scroll",setas,{passive:true})});
window.addEventListener("resize",function(){encaixar();setas();setTimeout(function(){encaixar();setas()},120)},{passive:true});
window.addEventListener("orientationchange",function(){setTimeout(function(){encaixar();setas()},200)});
window.addEventListener("pagehide",function(){if(timer){clearTimeout(timer);timer=null}});

if(!st.cat||!aba(st.cat))aba(inicial);
tela("list");
encaixar();
setas();

/* DIAGNÓSTICO de tamanho: sem editar nada, o card diz o tamanho que recebeu.
   Primeiro toque no título da seção mostra a medida aqui no rodapé. É o número
   que decide se o card pode ser ainda maior no SEU aparelho (ver MENUS-HTML.md
   §2.2) — o card nunca pede mais do que a área que o WhatsApp desenha. */
function amostra(){
  var el=document.getElementById("lua-medida");if(!el)return;
  var h=medido||ALTURA_CSS;
  el.textContent="📐 área do card aqui: "+h+"px (pedido "+ALTURA_CSS+"px; desenhado "+alturaAtual+"px)";
  el.hidden=false;
}
/* O toque que revela a medida fica em dois pontos que SEMPRE existem: o título
   da seção (que some em card baixo) e o nome da categoria no cabeçalho. */
var titulo=document.querySelector(".sec-title");
if(titulo)titulo.addEventListener("click",amostra);
var rotuloTopo=document.getElementById("lua-cat-label");
if(rotuloTopo)rotuloTopo.addEventListener("click",amostra);
window.__luaMenu={campos:camposDoUso,validar:validar,montar:montar,esc:esc,estado:st,abrir:abrir,
  amostra:amostra,medida:function(){return medido},
  copiar:acaoCopiar,voltar:voltar,fechar:fechar,categoria:porCategoria,filtrar:filtrar,requisitos:REQ,
  rolarVertical:rolarV,rolarHorizontal:rolarF,atualizarSetas:pintar,encaixar:encaixar,
  altura:function(){return alturaAtual||ALTURA_CSS},passo:PASSO,
  rolavel:function(){return {vertical:maxV(elV()),horizontal:maxH(faixa)}}};
})();
`.trim();
}

module.exports = { buildJs, PASSO_PADRAO };
