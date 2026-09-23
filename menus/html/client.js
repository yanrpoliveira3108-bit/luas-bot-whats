/**
 * menus/html/client.js — JavaScript compartilhado dos menus HTML.
 *
 * O que ele faz (SÓ o que o ambiente suporta):
 *   - troca de tela LOCAL (lista ↔ painel do "Usar"): nada é reenviado, nada é
 *     reconstruído — só se mostra/esconde o que já está no documento;
 *   - histórico: "Voltar" retorna para a tela anterior com categoria, busca,
 *     campos preenchidos e rolagem restaurados;
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
 *   - não promete execução: o botão só copia o comando. Quem executa é o
 *     pipeline normal do bot, com a identidade real de quem enviou.
 *
 * Todo o JS vai EMBUTIDO no payload da mensagem (o WebView é offline), então o
 * código abaixo é enxuto de propósito: comentários ficam aqui fora.
 */

'use strict';

function buildJs(initialCategory) {
  const initial = JSON.stringify(String(initialCategory || ''));
  return `
(function(){
"use strict";
var root=document.getElementById("lua-menu");if(!root)return;
var wrap=document.getElementById("__wrap")||root;
var lista=document.getElementById("lua-view-list");
var painel=document.getElementById("lua-view-panel");
var corpo=document.getElementById("lua-panel-body");
var tabs=[].slice.call(root.querySelectorAll(".tab"));
var secs=[].slice.call(root.querySelectorAll(".sec"));
var input=document.getElementById("lua-q");
var vazio=document.getElementById("lua-empty");
var rotulo=document.getElementById("lua-cat-label");
var inicial=${initial};
var REQ={g:"Só funciona no grupo — envie a mensagem no grupo.",d:"Só o dono do bot pode usar.",
a:"Só admin do grupo pode usar.",ba:"O bot precisa ser admin do grupo.",pv:"Este comando é só no privado.",
r:"Responda uma mensagem com este comando (o card não responde por você).",
m:"Para mencionar alguém use @ no chat depois de colar: digitar @nome não marca ninguém.",
md:"Usa mídia enviada ou respondida no chat."};
var st={tela:"list",cat:inicial,busca:"",rol:{},campos:{},cmd:"",pilha:[]};
var timer=null,copiouEm=0;

function reduz(){try{return !!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)}catch(e){return false}}
function chave(){return st.tela==="panel"?"panel":"cat:"+st.cat}
function guardarRol(){st.rol[chave()]=wrap.scrollTop||0}
function porRol(){try{wrap.scrollTop=st.rol[chave()]||0}catch(e){}}
function tela(n){if(lista)lista.hidden=n!=="list";if(painel)painel.hidden=n!=="panel";st.tela=n;porRol()}

function trocar(n,semPilha){
  if(n===st.tela)return;
  if(!semPilha)st.pilha.push({tela:st.tela,cat:st.cat,busca:st.busca});
  guardarRol();
  if(timer){clearTimeout(timer);timer=null}
  var alvo=n==="panel"?painel:lista, de=n==="panel"?lista:painel;
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
  var achou=false;
  secs.forEach(function(s){var on=s.getAttribute("data-cat")===id;s.hidden=!on;if(on)achou=true});
  tabs.forEach(function(t){var a=t.getAttribute("data-cat")===id;t.classList.toggle("active",a);t.setAttribute("aria-selected",a?"true":"false")});
  var t=tabs.filter(function(x){return x.getAttribute("data-cat")===id})[0];
  if(rotulo)rotulo.textContent=t?(t.getAttribute("data-label")||""):"";
  st.cat=id;
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
  }else{
    var a=tabs.filter(function(t){return t.classList.contains("active")})[0];
    aba(a?a.getAttribute("data-cat"):(st.cat||inicial));
  }
}
function porCategoria(id){
  if(!id)return;
  guardarRol();
  if(st.busca&&input){input.value="";st.busca="";filtrar("")}
  aba(id);
  try{wrap.scrollTop=0}catch(e){}
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
  st.rol.panel=0; // comando novo abre no topo (o scroll do painel não é herdado)
  trocar("panel");
  // Nada de focar campo sozinho: abrir o teclado sem o usuário pedir tira o
  // card da vista. O foco só não é perdido enquanto ele digita (a prévia
  // atualiza por texto, sem recriar o campo).
}

function previa(){
  var pre=document.getElementById("lua-cmd");
  if(pre&&painel.__campos)pre.textContent=montar(st.cmd,painel.__campos,painel.__vals);
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

root.addEventListener("click",function(ev){
  var a=ev.target;
  if(!a||!a.closest)return;
  var u=a.closest("[data-usar]");if(u){ev.preventDefault();abrir(u);return}
  var c=a.closest("#lua-copy");if(c){ev.preventDefault();acaoCopiar();return}
  var v=a.closest("[data-voltar]");
  if(v){ev.preventDefault();if(v.getAttribute("data-voltar")==="raiz")fechar();else voltar();return}
  var t=a.closest("#lua-top");
  if(t){ev.preventDefault();try{wrap.scrollTo({top:0,behavior:reduz()?"auto":"smooth"})}catch(e){wrap.scrollTop=0}return}
  var ab=a.closest(".tab");
  if(ab){ev.preventDefault();porCategoria(ab.getAttribute("data-cat"))}
});
if(input){
  input.addEventListener("input",function(){filtrar(input.value)});
  input.addEventListener("keydown",function(ev){if(ev.key==="Escape"){input.value="";filtrar("")}});
}
root.addEventListener("input",function(ev){
  if(ev.target&&ev.target.getAttribute&&ev.target.getAttribute("data-i")!==null){ler();previa();limpar()}
});
root.addEventListener("change",function(ev){
  if(ev.target&&ev.target.getAttribute&&ev.target.getAttribute("data-i")!==null){ler();previa();limpar()}
});
window.addEventListener("pagehide",function(){if(timer){clearTimeout(timer);timer=null}});

if(!st.cat||!aba(st.cat))aba(inicial);
tela("list");

window.__luaMenu={campos:camposDoUso,validar:validar,montar:montar,esc:esc,estado:st,abrir:abrir,
  copiar:acaoCopiar,voltar:voltar,fechar:fechar,categoria:porCategoria,filtrar:filtrar,requisitos:REQ};
})();
`.trim();
}

module.exports = { buildJs };
