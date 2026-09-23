/**
 * menus/html/client.js — JavaScript compartilhado dos menus HTML.
 *
 * O que ele faz (SÓ o que o ambiente suporta):
 *   - navegação entre categorias (abas): mostrar/esconder seções;
 *   - busca/filtro instantâneo sobre os comandos da tela;
 *   - "voltar ao topo".
 *
 * O que ele NÃO faz, de propósito:
 *   - não chama o processo do bot. Não existe (e não inventamos) canal do HTML
 *     de volta para o socket: o vendor não trata `botInvokeMessage` recebido,
 *     e o `richResponseMessage` é somente renderizado pelo cliente. As ações
 *     reais são LINKS `wa.me` (ver menus/html/components.js), que abrem a
 *     conversa com o comando preenchido — o envio e a autorização acontecem no
 *     pipeline normal de comandos do bot.
 *
 * Autocontido: sem fetch, sem storage, sem timers permanentes (mesmo princípio
 * do HTML do !ping2, que encerra sozinho).
 */

'use strict';

function buildJs(initialCategory) {
  const initial = JSON.stringify(String(initialCategory || ''));
  return `
(function(){
  "use strict";
  var root = document.getElementById("lua-menu");
  if(!root) return;
  var tabs = [].slice.call(root.querySelectorAll(".tab"));
  var secs = [].slice.call(root.querySelectorAll(".sec"));
  var input = document.getElementById("lua-q");
  var empty = document.getElementById("lua-empty");
  var label = document.getElementById("lua-cat-label");
  var initial = ${initial};

  function showTab(id){
    var found = false;
    secs.forEach(function(s){
      var on = s.getAttribute("data-cat") === id;
      s.style.display = on ? "" : "none";
      if(on) found = true;
    });
    tabs.forEach(function(t){ t.classList.toggle("active", t.getAttribute("data-cat") === id); });
    var tab = tabs.filter(function(t){ return t.getAttribute("data-cat") === id; })[0];
    if(label) label.textContent = tab ? (tab.getAttribute("data-label") || "") : "";
    if(input && input.value){ filter(input.value); }
    return found;
  }

  // Índice de busca: montado do TEXTO visível do cartão (nome, descrição,
  // exemplo, etiquetas). Assim o HTML enviado não carrega o texto duas vezes —
  // o payload do card fica ~40% menor.
  secs.forEach(function(s){
    var cat = s.getAttribute("data-cat") || "";
    [].slice.call(s.querySelectorAll(".cmd")).forEach(function(c){
      c.__find = ((c.textContent || "") + " " + cat).toLowerCase().replace(/\s+/g, " ");
    });
  });

  // filtro: casa nome, descrição, exemplo e categoria (todas as categorias)
  function filter(term){
    var q = String(term || "").toLowerCase().trim();
    var total = 0;
    secs.forEach(function(s){
      var cards = [].slice.call(s.querySelectorAll(".cmd"));
      var visible = 0;
      cards.forEach(function(c){
        var hay = c.__find || "";
        var on = !q || hay.indexOf(q) !== -1;
        c.style.display = on ? "" : "none";
        if(on) visible++;
      });
      // durante a busca mostramos todas as categorias que têm resultado
      s.style.display = visible ? "" : "none";
      total += visible;
    });
    if(q){
      tabs.forEach(function(t){ t.classList.remove("active"); });
      if(label) label.textContent = "🔎 " + q + " (" + total + ")";
    } else {
      var active = tabs.filter(function(t){ return t.classList.contains("active"); })[0];
      showTab(active ? active.getAttribute("data-cat") : initial);
    }
    if(empty) empty.style.display = total ? "none" : "";
  }

  tabs.forEach(function(t){
    t.addEventListener("click", function(){
      if(input) input.value = "";
      showTab(t.getAttribute("data-cat"));
      try { root.scrollIntoView({block:"start"}); } catch(e){}
    });
  });

  if(input){
    input.addEventListener("input", function(){ filter(input.value); });
    input.addEventListener("keyup", function(){ filter(input.value); });
  }

  var top = document.getElementById("lua-top");
  if(top){
    top.addEventListener("click", function(){ try { root.scrollIntoView({block:"start"}); } catch(e){} });
  }

  showTab(initial);
})();
`.trim();
}

module.exports = { buildJs };
