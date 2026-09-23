#!/usr/bin/env node
/**
 * scripts/menu-scroll-check.js — confere a ROLAGEM do card HTML num navegador
 * de verdade (layout real), não só em simulação.
 *
 * Por que existe: a suíte normal (`npm test`) roda em jsdom, que NÃO calcula
 * layout — clientHeight/scrollHeight são sempre 0. Foi assim que passou batido
 * o defeito em que o card se declarava com uma altura fixa maior que o WebView
 * e o fim da lista ficava cortado, sem forma de alcançar (ver MENUS-HTML.md §7).
 * Este script abre o card no Chromium em alturas diferentes e verifica o que o
 * jsdom não vê: se a lista rola DE VERDADE, se o último comando aparece
 * inteiro no fim, se as setas desativam nos limites e se a rajada de toques
 * anda um passo por toque.
 *
 * É OPCIONAL de propósito: sem `puppeteer` instalado ele avisa e sai com 0, sem
 * quebrar nada. No Termux/aparelho o teste que vale é o card no WhatsApp.
 *
 * Uso:
 *   npm i --no-save puppeteer        # ou: CHROME_PATH=/caminho/para/chrome
 *   node scripts/menu-scroll-check.js
 *   CHROME_PATH=... node scripts/menu-scroll-check.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
process.chdir(RAIZ);

function carregarPuppeteer() {
  try {
    return require('puppeteer');
  } catch (_) {
    return null;
  }
}
const SEM_PUPPETEER =
  '⏭  sem puppeteer: as checagens de layout real foram puladas (a guarda estática rodou acima).\n' +
  '   Para rodar tudo: npm i --no-save puppeteer   (ou defina CHROME_PATH)';

/**
 * Guarda estática — roda SEMPRE, mesmo sem navegador. Protege a classe exata
 * do defeito do "quadradinho de 1px" (42d8c35): altura do card declarada com
 * unidade de viewport. No WebView do card a viewport acompanha o conteúdo, então
 * `100vh` resolve para ~0 e `min(520px,100vh)` (2ª declaração) sobrescreve o px.
 * Aqui a regra fica cravada na própria verificação, não só num comentário.
 */
function guardaEstatica(html) {
  const bloco = html.match(/html,body\{margin:0;padding:0;height[^}]*\}/);
  const declarado = bloco && bloco[0].match(/height:\s*(\d+)px/);
  if (bloco && declarado && !/(?:^|[^a-z])vh\b/.test(bloco[0]) && !/min\(|max\(|calc\(/.test(bloco[0])) {
    ok(`altura do card em px fixo (${declarado[1]}px) — sem vh/min()/calc()`);
  } else {
    erro(`altura do card com vh/min()/calc() ou ausente: ${bloco ? bloco[0] : 'bloco html,body não encontrado'}`);
  }

  // Só regras de verdade contam: comentários que EXPLICAM a regra (por que não
  // usar @media de altura) não podem ser confundidos com uso dela.
  const semComentarios = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (!/@media[^{;]*\(\s*(?:max|min)-height\s*:[^{)]*\)\s*\{/.test(semComentarios)) ok('CSS sem @media de altura de viewport (usa body.curto em runtime)');
  else erro('CSS tem @media (max-height/min-height) — altura de viewport não é confiável neste WebView');

  const altura = declarado ? Number(declarado[1]) : 0;
  if (altura >= 240) ok(`altura declarada utilizável (${altura}px ≥ 240px)`);
  else erro(`altura declarada pequena demais (${altura}px)`);
  return altura;
}

const TMP = path.join(RAIZ, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
process.env.DATABASE_FILE = process.env.DATABASE_FILE || path.join(TMP, 'menu-scroll-check.db');

require('../database/database').open();
require('../commands/loader').loadCommands(true);
const htmlMenu = require('../menus/html');

const ctxFalso = {
  socket: { user: { id: '5511977776666:3@s.whatsapp.net' } },
  remoteJid: '120363000000000000@g.us',
  isGroup: true,
  prefix: '!',
  sender: '5511999999999@s.whatsapp.net',
};

let falhas = 0;
const ok = (m) => console.log('✅ ' + m);
const erro = (m) => {
  falhas++;
  console.log('❌ ' + m);
};

/** Mesma verificação do card, dentro da página, devolvida como objeto. */
const ROTEIRO = async () => {
  const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
  const lista = document.getElementById('lua-list');
  const cx = (el) => el.getBoundingClientRect();
  const visiveis = () => [...lista.querySelectorAll('.cmd')].filter((c) => c.offsetParent !== null && cx(c).height > 0);
  const max = () => lista.scrollHeight - lista.clientHeight;
  const passo = () => Math.max(90, Math.round(lista.clientHeight * (window.__luaMenu.passo || 0.7)));
  const r = {};

  r.semTransbordoLateral = document.documentElement.scrollWidth <= window.innerWidth + 1;
  r.barraVisivel = (() => {
    const b = cx(document.getElementById('lua-down'));
    return b.right <= window.innerWidth + 1 && b.left >= -1;
  })();
  r.cabeNoVisivel = cx(lista).bottom <= window.innerHeight + 1;
  r.alturaLista = Math.round(cx(lista).height);
  r.rolavel = lista.scrollHeight > lista.clientHeight + 1;

  // ---- tamanho e legibilidade (o pedido: "menu maior e legível") ----------
  // Mede o que o usuário vê: quanto do card é área de comando, os tamanhos de
  // fonte efetivos e as áreas de toque. Serve de trava: se alguém reduzir de
  // novo (o que já aconteceu neste card), a verificação falha.
  const fonte = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 : 0;
  };
  const alturaDe = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(cx(el).height) : 0;
  };
  const faixaCats = document.getElementById('lua-tabs');
  const fr = cx(faixaCats);
  const abas = [...document.querySelectorAll('.tab')];
  const cardAltura = Math.round(cx(document.getElementById('__wrap')).height);
  r.tamanho = {
    card: cardAltura,
    lista: Math.round(cx(lista).height),
    fatiaLista: Math.round((cx(lista).height / cardAltura) * 100),
    fontes: { corpo: fonte('body'), comando: fonte('.cmd code'), descricao: fonte('.cmd .desc'), aba: fonte('.tab') },
    toques: {
      usar: alturaDe('.go'),
      vnav: alturaDe('.vnav'),
      aba: alturaDe('.tab'),
      snav: alturaDe('.snav'),
    },
    categoriasInteiras: abas.filter((t) => {
      const b = cx(t);
      return b.left >= fr.left - 1 && b.right <= fr.right + 1;
    }).length,
    totalCategorias: abas.length,
    // nenhum botão "Usar" pode passar da área da lista (a largura do card é a
    // que o WebView dá; o conteúdo tem de caber nela)
    botoesDentro: (() => {
      const l = cx(lista);
      return [...lista.querySelectorAll('.cmd .go')].every((b) => cx(b).right <= l.right + 1);
    })(),
  };

  // a faixa vai até a ÚLTIMA categoria (e volta): dá para acessar todas?
  const maxFaixa = () => Math.max(0, faixaCats.scrollWidth - faixaCats.clientWidth);
  let h = 0;
  while (!document.getElementById('lua-cat-next').disabled && h < 80) {
    document.getElementById('lua-cat-next').click();
    await dorme(40);
    h++;
    if (Math.abs(faixaCats.scrollLeft - maxFaixa()) < 2) break;
  }
  await dorme(700);
  const ultimaAba = abas[abas.length - 1];
  const recFr = cx(faixaCats);
  r.faixa = {
    toques: h,
    noFim: Math.abs(faixaCats.scrollLeft - maxFaixa()) < 2,
    setaDireitaDesativada: document.getElementById('lua-cat-next').disabled,
    ultimaInteira: cx(ultimaAba).left >= recFr.left - 1 && cx(ultimaAba).right <= recFr.right + 1,
  };
  let v = 0;
  while (!document.getElementById('lua-cat-prev').disabled && v < 80) {
    document.getElementById('lua-cat-prev').click();
    await dorme(40);
    v++;
    if (faixaCats.scrollLeft <= 1) break;
  }
  await dorme(700);
  const recFr2 = cx(faixaCats);
  const primeiraAba = abas[0];
  r.faixa.voltou = faixaCats.scrollLeft <= 1 && document.getElementById('lua-cat-prev').disabled;
  r.faixa.primeiraInteira = cx(primeiraAba).left >= recFr2.left - 1 && cx(primeiraAba).right <= recFr2.right + 1;

  // descer até o fim
  let n = 0;
  while (!document.getElementById('lua-down').disabled && n < 400) {
    document.getElementById('lua-down').click();
    await dorme(30);
    n++;
    if (Math.abs(lista.scrollTop - max()) < 2) break;
  }
  await dorme(900);
  const lr = cx(lista);
  const ultimo = visiveis().at(-1);
  // Área ÚTIL = caixa da lista menos o padding: é o espaço em que um cartão
  // cabe inteiro. Usar só clientHeight dava falso positivo quando o padding
  // (aqui, o rodapé no fim do conteúdo) comia alguns px do último cartão.
  const css = getComputedStyle(lista);
  const areaUtil = lista.clientHeight - parseFloat(css.paddingTop || 0) - parseFloat(css.paddingBottom || 0);
  r.cartaoMaiorQueJanela = Math.max(...visiveis().map((c) => cx(c).height)) > areaUtil + 1;
  r.fim = {
    areaUtil: Math.round(areaUtil),
    alturaUltimo: Math.round(cx(ultimo).height),
    // Cabe inteiro em alguma posição de rolagem? (basta a área útil comportar o cartão)
    alcancavelInteiro: cx(ultimo).height <= areaUtil + 1,
    toques: n,
    noFim: Math.abs(lista.scrollTop - max()) < 2,
    setaBaixoDesativada: document.getElementById('lua-down').disabled,
    ultimoInteiro: cx(ultimo).top >= lr.top - 1 && cx(ultimo).bottom <= lr.bottom + 1,
    usarInteiro: (() => {
      const b = cx(ultimo.querySelector('.go'));
      return b.top >= lr.top - 1 && b.bottom <= lr.bottom + 1;
    })(),
  };

  // "Usar" + copiar no fim da lista
  ultimo.querySelector('.go').click();
  await dorme(350);
  document.getElementById('lua-copy').click();
  await dorme(150);
  r.copiaNoFim = {
    valor: window.__copiado,
    status: document.getElementById('lua-status').textContent,
    painel: !document.getElementById('lua-view-panel').hidden,
  };
  document.querySelector('[data-voltar="raiz"]').click();
  await dorme(600);
  r.voltouComRolagem = Math.round(lista.scrollTop);

  // atalho de topo (na barra, fora da rolagem)
  document.getElementById('lua-top').click();
  await dorme(900);
  r.topo = {
    scrollTop: Math.round(lista.scrollTop),
    setaCimaDesativada: document.getElementById('lua-up').disabled,
    primeiroAparece: (() => {
      const c = visiveis()[0];
      const l = cx(lista);
      return cx(c).bottom > l.top + 1 && cx(c).top < l.bottom - 1;
    })(),
    primeiroInteiro: (() => {
      const c = visiveis()[0];
      const l = cx(lista);
      return cx(c).top >= l.top - 1 && cx(c).bottom <= l.bottom + 1;
    })(),
    // no topo da lista vem o título da categoria antes do primeiro comando;
    // se título + cartão não cabem juntos, o cartão inteiro no topo é
    // fisicamente impossível (caso de card muito baixo)
    cabecalhoMaisCartao: (() => {
      const c = visiveis()[0];
      const sec = c.closest('.sec');
      const titulo = sec ? cx(sec).top : cx(c).top;
      return Math.round(cx(c).bottom - titulo);
    })(),
  };

  // rajada: 5 toques sem esperar devem andar 5 passos
  const antes = lista.scrollTop;
  for (let i = 0; i < 5; i++) document.getElementById('lua-down').click();
  await dorme(1200);
  r.rajada = { passos: (lista.scrollTop - antes) / passo(), andou: Math.round(lista.scrollTop - antes) };

  // horizontais seguem funcionando
  const faixa = document.getElementById('lua-tabs');
  const antesH = faixa.scrollLeft;
  if (!document.getElementById('lua-cat-next').disabled) {
    document.getElementById('lua-cat-next').click();
    await dorme(500);
  }
  r.horizontal = { andou: Math.round(faixa.scrollLeft - antesH) };
  return r;
};

(async () => {
  const arquivo = path.join(TMP, 'menu-scroll-check.html');
  const { html, grupo } = htmlMenu.montarDocumento(ctxFalso, { kind: 'main' });
  fs.writeFileSync(arquivo, html);
  console.log(`card: ${grupo.titulo} (${grupo.total} comandos) — ${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB\n`);

  const alturaDeclarada = guardaEstatica(html);

  const puppeteer = carregarPuppeteer();
  if (!puppeteer) {
    console.log('\n' + (falhas ? `❌ ${falhas} problema(s)` : '✅ guarda estática OK'));
    console.log(SEM_PUPPETEER);
    process.exit(falhas ? 1 : 0);
  }

  const navegador = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    // a primeira é a altura PADRÃO do card (dimensoes.js); as outras, janelas
    // menores — inclusive as que o cliente encaixa em runtime.
    for (const altura of [...new Set([alturaDeclarada, 520, 430, 300])]) {
      const pg = await navegador.newPage();
      await pg.setViewport({ width: 360, height: altura, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await pg.evaluateOnNewDocument(() => {
        window.__copiado = null;
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: (t) => { window.__copiado = t; return Promise.resolve(); } },
          configurable: true,
        });
      });
      await pg.goto('file://' + arquivo, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 300));
      const r = await pg.evaluate(ROTEIRO);
      const tag = `[${altura}px]`;

      // --- tamanho, legibilidade e faixa de categorias ---
      // A moldura (cabeçalho + faixa + busca + respiro) tem orçamento de px: o
      // que sobrar do card é área de comando. É isso que mantém o menu grande
      // em janela alta e ainda utilizável em janela baixa.
      const moldura = r.tamanho.card - r.tamanho.lista;
      if (moldura <= 260)
        ok(`${tag} moldura (cabeçalho+faixa+busca) = ${moldura}px; comandos ficam com ${r.tamanho.lista}px`);
      else erro(`${tag} moldura grande demais: ${moldura}px de ${r.tamanho.card}px de card`);

      // No card na altura declarada (a que o aparelho recebe), a área de
      // comando tem de ser a maior parte da interface.
      if (r.tamanho.card === alturaDeclarada) {
        if (r.tamanho.fatiaLista >= 55)
          ok(`${tag} área de comandos = ${r.tamanho.lista}px, ${r.tamanho.fatiaLista}% do card de ${r.tamanho.card}px`);
        else erro(`${tag} área de comandos pequena: ${r.tamanho.lista}px (${r.tamanho.fatiaLista}% do card)`);
      }

      if (r.tamanho.fontes.corpo >= 16 && r.tamanho.fontes.comando >= 15 && r.tamanho.fontes.descricao >= 14 && r.tamanho.fontes.aba >= 14)
        ok(`${tag} fontes legíveis (corpo ${r.tamanho.fontes.corpo}px, comando ${r.tamanho.fontes.comando}px, descrição ${r.tamanho.fontes.descricao}px, categoria ${r.tamanho.fontes.aba}px)`);
      else erro(`${tag} fonte pequena: ${JSON.stringify(r.tamanho.fontes)}`);

      if (Math.min(...Object.values(r.tamanho.toques)) >= 44)
        ok(`${tag} áreas de toque confortáveis (Usar ${r.tamanho.toques.usar}px, setas ${r.tamanho.toques.vnav}/${r.tamanho.toques.snav}px, categoria ${r.tamanho.toques.aba}px)`);
      else erro(`${tag} alvo de toque pequeno: ${JSON.stringify(r.tamanho.toques)}`);

      if (r.tamanho.botoesDentro) ok(`${tag} todos os botões "Usar" cabem dentro da área da lista`);
      else erro(`${tag} botão "Usar" passando da borda da lista`);

      if (r.tamanho.categoriasInteiras >= 2)
        ok(`${tag} ${r.tamanho.categoriasInteiras} categorias inteiras visíveis na faixa (de ${r.tamanho.totalCategorias})`);
      else erro(`${tag} só ${r.tamanho.categoriasInteiras} categoria inteira visível na faixa`);

      if (r.faixa.noFim && r.faixa.setaDireitaDesativada && r.faixa.ultimaInteira)
        ok(`${tag} última categoria alcançada e inteira (${r.faixa.toques} toques; → desativou)`);
      else erro(`${tag} não chega à última categoria inteira (${JSON.stringify(r.faixa)})`);

      if (r.faixa.voltou && r.faixa.primeiraInteira) ok(`${tag} volta à primeira categoria (← desativou; aba inteira)`);
      else erro(`${tag} não volta à primeira categoria (${JSON.stringify(r.faixa)})`);

      if (r.cabeNoVisivel) ok(`${tag} a lista cabe no WebView (altura ${r.alturaLista}px, rola: ${r.rolavel})`);
      else erro(`${tag} a lista extrapola o WebView (é isto que corta os comandos)`);

      if (r.semTransbordoLateral) ok(`${tag} nada passa da largura da tela (sem transbordo lateral)`);
      else erro(`${tag} conteúdo mais largo que a tela — botões fora da área visível`);

      if (r.barraVisivel) ok(`${tag} barra das setas visível na tela`);
      else erro(`${tag} barra das setas fora da área visível`);

      if (r.rolavel) ok(`${tag} a lista realmente rola (conteúdo > área visível)`);
      else erro(`${tag} a lista NÃO rola — as setas não têm para onde ir`);

      if (r.fim.noFim && r.fim.setaBaixoDesativada) ok(`${tag} desceu até o fim em ${r.fim.toques} toques e ↓ desativou`);
      else erro(`${tag} não chegou ao fim (scrollTop ≠ máximo) ou ↓ seguiu ativa`);

      if (r.fim.ultimoInteiro && r.fim.usarInteiro) ok(`${tag} último comando e botão "Usar" inteiros no fim`);
      else if (r.fim.alcancavelInteiro)
        ok(`${tag} último comando inteiro é alcançável (${r.fim.alturaUltimo}px em ${r.fim.areaUtil}px de área útil; no fim da rolagem aparece o rodapé)`);
      else if (r.cartaoMaiorQueJanela) ok(`${tag} cartão mais alto que a janela (${r.alturaLista}px): não há como caber inteiro — visível e alcançável`);
      else erro(`${tag} último comando/botão "Usar" cortados no fim`);

      if (r.copiaNoFim.valor && /Copiado/.test(r.copiaNoFim.status)) ok(`${tag} "Usar" + copiar funcionam no fim da lista (${r.copiaNoFim.valor})`);
      else erro(`${tag} "Usar"/copiar falharam no fim da lista`);

      if (r.topo.scrollTop === 0 && r.topo.setaCimaDesativada) ok(`${tag} atalho de topo voltou ao início e ↑ desativou`);
      else erro(`${tag} atalho de topo não voltou ao início`);

      if (r.topo.primeiroInteiro) ok(`${tag} primeiro comando inteiro no topo`);
      else if (r.topo.cabecalhoMaisCartao > r.alturaLista)
        ok(`${tag} primeiro comando visível no topo (título + cartão = ${r.topo.cabecalhoMaisCartao}px numa janela de ${r.alturaLista}px)`);
      else erro(`${tag} primeiro comando cortado no topo`);

      if (Math.abs(r.rajada.passos - 5) < 0.35) ok(`${tag} rajada de 5 toques andou ${r.rajada.passos.toFixed(2)} passos (sem fila de animações)`);
      else erro(`${tag} rajada andou ${r.rajada.passos.toFixed(2)} passos (esperado ~5)`);

      if (r.horizontal.andou > 0) ok(`${tag} setas horizontais seguem movendo a faixa (${r.horizontal.andou}px)`);
      else erro(`${tag} setas horizontais não moveram a faixa`);

      await pg.close();
    }
  } finally {
    // Viewport DEGENERADA (1px e 60px): é o cenário que reproduziu o
    // "quadradinho". A versão com min(520px,100vh) media 60px de card aqui;
    // a correta mantém a altura declarada porque nada depende de viewport.
    for (const altura of [60, 1]) {
      const pg = await navegador.newPage();
      await pg.setViewport({ width: 360, height: altura, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await pg.goto('file://' + arquivo, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 300));
      const d = await pg.evaluate(() => {
        const wrap = document.getElementById('__wrap') || document.querySelector('.wrap');
        const lista = document.getElementById('lua-list');
        return {
          card: Math.round(wrap.getBoundingClientRect().height),
          lista: Math.round(lista.getBoundingClientRect().height),
          curto: document.body.classList.contains('curto'),
        };
      });
      const tag = `[viewport ${altura}px]`;
      if (d.card >= alturaDeclarada - 1 && d.card >= 240) ok(`${tag} card NÃO colapsou: ${d.card}px (declarado ${alturaDeclarada}px)`);
      else erro(`${tag} card colapsou: ${d.card}px com ${alturaDeclarada}px declarados — altura presa à viewport?`);
      if (d.lista >= 90) ok(`${tag} área dos comandos utilizável (${d.lista}px, curto: ${d.curto})`);
      else erro(`${tag} área dos comandos inutilizável (${d.lista}px)`);
      await pg.close();
    }

    await navegador.close();
  }

  console.log(falhas ? `\n❌ ${falhas} problema(s) de layout` : '\n✅ layout e rolagem OK nas alturas testadas');
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('❌ menu-scroll-check:', e && e.message);
  process.exit(1);
});
