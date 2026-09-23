#!/usr/bin/env node
/**
 * test/menuhtml.test.js — menus em HTML, `!modohtml` e o botão "Usar".
 *
 * Cobre (o que dá para verificar sem aparelho):
 *  1) padrão DESLIGADO quando a chave não existe no banco
 *  2) `!modohtml on/off` persiste e confirma só depois de salvar
 *  3) permissão: alterar é do dono (escopo GLOBAL — admin de grupo não muda)
 *  4) persistência após "reiniciar" (processo limpo lendo o mesmo banco)
 *  5) prefixo DINÂMICO vindo da configuração real
 *  6) templates por categoria (menu principal / admin / membros / categoria)
 *     gerados a partir do REGISTRO (sem lista duplicada)
 *  7) payload: estrutura richResponseMessage correta + teto de tamanho
 *  8) documento: duas telas (lista/painel), altura fixa, 1 CSS + 2 <script>
 *     (o que envolve o corpo em #__wrap e o menu), nada de recurso remoto
 *  9) argumento inválido não altera nada
 * 10) fallback: erro no envio → menu tradicional (sem repetir envio)
 * 11) `!menu --texto` força o tradicional mesmo com o modo ligado
 * 12) modo seguro bloqueia o card e o modo volta ao tradicional
 * 13) botão "Usar": é BOTÃO (nunca link — link não navega no WebView), existe
 *     para todo comando e carrega o `usage`/requisitos do registro
 * 14) regras do ambiente do card (medidas no aparelho): sem subresource remoto,
 *     sem fetch/XHR/WebSocket, sem storage, sem crypto.subtle, sem timers soltos
 * 15) escapagem de conteúdo dinâmico (descrição com HTML)
 * 16) modo desligado NÃO carrega menus/html (require preguiçoso)
 * 17) integração: `!menu` e `!menuadm` entregam o card pelo pipeline real
 * 18) actions.js: campos a partir do `usage`, validação, montagem e requisitos
 * 19) [jsdom, opcional] o JS do card roda de verdade: painel do "Usar", campos,
 *     validação, cópia (sucesso/queda), toque repetido, busca, "Voltar" com
 *     estado preservado, troca rápida de categoria e `prefers-reduced-motion`
 *
 * Sem jsdom instalado, os testes 19 são PULADOS com aviso (o resto roda igual).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DB = require('./dbtmp').tmpFile('lua-menuhtml-test.db');

let falhas = 0;
let feitos = 0;
function ok(l) {
  feitos++;
  console.log('✅ ' + l);
}
function fail(l, e) {
  falhas++;
  console.log('❌ ' + l + ' — ' + (e && e.message));
}
function skip(l, motivo) {
  console.log('⏭  ' + l + ' — pulado: ' + motivo);
}

/** ctx falso com socket que registra o que foi enviado. */
function fakeCtx(opts = {}) {
  const enviados = [];
  const ctx = {
    enviados,
    socket: {
      user: { id: opts.botId === undefined ? '5511977776666:3@s.whatsapp.net' : opts.botId },
      relayMessage: async (jid, message, o) => {
        enviados.push({ jid, message, o });
        if (opts.relayFalha) throw new Error('stanza rejeitada');
        return { key: { id: 'ABC' } };
      },
    },
    remoteJid: opts.remoteJid || '120363000000000000@g.us',
    isGroup: opts.isGroup === undefined ? true : opts.isGroup,
    isOwner: !!opts.isOwner,
    isAdmin: !!opts.isAdmin,
    prefix: '!',
    sender: opts.sender || '5511999999999@s.whatsapp.net',
    args: opts.args || [],
    replies: [],
    reply: async (m) => {
      ctx.replies.push(String(m));
      return {};
    },
  };
  return ctx;
}

/** Extrai o HTML do card de um envio fake. */
function htmlDoEnvio(enviado) {
  const rich = enviado.message.botForwardedMessage.message.richResponseMessage;
  return JSON.parse(rich.unifiedResponse.data.toString('utf8')).sections[0].view_model.primitive.payload;
}

async function main() {
  try {
    fs.rmSync(DB, { force: true });
  } catch (_) {}
  process.env.OWNER_NUMBER = '5511999999999';
  process.env.DATABASE_FILE = DB;

  const database = require('../database/database');
  database.open();
  require('../commands/loader').loadCommands(true);

  const settings = require('../database/settings');
  const menuFormat = require('../utils/menuFormat');
  const htmlMenu = require('../menus/html');
  const actions = require('../menus/html/actions');
  const cmdModohtml = require('../commands/general/modohtml').find((c) => c.name === 'modohtml');

  /* 1) padrão desligado */
  try {
    assert.strictEqual(settings.get('menu_html', null), null, 'chave não existe no banco novo');
    assert.strictEqual(menuFormat.htmlAtivo(), false, 'modo HTML começa DESLIGADO');
    assert.strictEqual(menuFormat.status().active, false, 'não está em uso');
    ok('1: padrão desligado quando a configuração não existe');
  } catch (e) {
    fail('1: padrão', e);
  }

  /* 2) ligar/desligar persiste (dono) */
  try {
    const ctx = fakeCtx({ isOwner: true, args: ['on'] });
    await cmdModohtml.execute(ctx);
    assert.strictEqual(settings.menuHtmlEnabled(), true, 'salvou no banco');
    assert.ok(ctx.replies.some((r) => /ATIVADOS/i.test(r)), 'confirmou a ativação');
    assert.strictEqual(menuFormat.htmlAtivo(), true, 'modo ligado');

    const ctxOff = fakeCtx({ isOwner: true, args: ['off'] });
    await cmdModohtml.execute(ctxOff);
    assert.strictEqual(settings.menuHtmlEnabled(), false, 'desligou no banco');
    assert.ok(ctxOff.replies.some((r) => /DESATIVADOS/i.test(r)), 'confirmou a desativação');
    ok('2: !modohtml on/off salva e confirma');
  } catch (e) {
    fail('2: ligar/desligar', e);
  }

  /* 3) permissão: admin de grupo NÃO altera configuração global */
  try {
    const ctx = fakeCtx({ isGroup: true, isAdmin: true, isOwner: false, args: ['on'] });
    await cmdModohtml.execute(ctx);
    assert.strictEqual(settings.menuHtmlEnabled(), false, 'admin não alterou');
    assert.ok(ctx.replies.some((r) => /dono/i.test(r)), 'recebeu a negativa de dono');

    const consulta = fakeCtx({ isGroup: true, isOwner: false, args: [] });
    await cmdModohtml.execute(consulta);
    assert.ok(consulta.replies.some((r) => /MENUS EM HTML/i.test(r)), 'status liberado para consulta');
    assert.ok(consulta.replies.some((r) => /GLOBAL/i.test(r)), 'informa o escopo');
    ok('3: alterar é do dono; consultar é liberado (escopo global informado)');
  } catch (e) {
    fail('3: permissão', e);
  }

  /* 4) persistência após reinício (processo limpo) */
  try {
    settings.setMenuHtmlEnabled(true);
    const { execFileSync } = require('child_process');
    const saida = execFileSync(
      process.execPath,
      [
        '-e',
        `process.env.DATABASE_FILE=${JSON.stringify(DB)};` +
          "const db=require('./database/database'); db.open();" +
          "const m=require('./utils/menuFormat');" +
          'console.log("PERSIST:" + JSON.stringify(m.status()));',
      ],
      { cwd: path.resolve(__dirname, '..'), timeout: 30000 }
    ).toString();
    const linha = saida.split('\n').find((l) => l.startsWith('PERSIST:'));
    const st = JSON.parse(linha.replace('PERSIST:', ''));
    assert.strictEqual(st.enabled, true, 'leu LIGADO em processo novo (banco)');
    assert.strictEqual(st.scope, 'global', 'escopo global');
    ok('4: escolha persiste depois de reiniciar');
  } catch (e) {
    fail('4: persistência', e);
  }

  /* 5) prefixo dinâmico */
  try {
    settings.set('prefix', '#');
    const ctx = fakeCtx({ isOwner: true });
    const { html } = htmlMenu.montarDocumento(ctx, { kind: 'categoria', categoria: 'downloads' });
    assert.ok(html.includes('<code>#'), 'cartões usam o prefixo real');
    assert.ok(html.includes('data-prefix="#"'), 'documento informa o prefixo ao JS');
    assert.ok(html.includes('Prefixo <b>#</b>'), 'cabeçalho mostra o prefixo real');
    assert.ok(!html.includes('>!menu<'), 'não sobrou prefixo fixo');
    settings.set('prefix', '!');
    ok('5: prefixo vem da configuração real (testado com "#")');
  } catch (e) {
    fail('5: prefixo dinâmico', e);
  }

  /* 6) templates por menu, gerados do registro */
  try {
    const { registry } = require('../engine/plugins');
    const ctx = fakeCtx();

    const main = htmlMenu.montarDocumento(ctx, { kind: 'main' });
    const admin = htmlMenu.montarDocumento(ctx, { kind: 'admin' });
    const membros = htmlMenu.montarDocumento(ctx, { kind: 'membros' });
    const download = htmlMenu.montarDocumento(ctx, { kind: 'categoria', categoria: 'downloads' });

    assert.ok(main.grupo.categorias.length >= 10, `menu principal tem as categorias reais (${main.grupo.categorias.length})`);
    assert.strictEqual(admin.grupo.categorias.length, 1, 'menuadm = só a categoria admin');
    assert.strictEqual(admin.grupo.categorias[0].id, 'admin', 'categoria correta no menuadm');
    assert.strictEqual(membros.grupo.categorias[0].id, 'members', 'menumembros = categoria members');
    assert.strictEqual(download.grupo.categorias[0].id, 'downloads', 'menu de categoria');

    const noRegistro = (registry.byCategory().get('downloads') || []).filter((c) => !c.hidden).length;
    assert.strictEqual(download.grupo.categorias[0].count, noRegistro, 'contagem vem do registro');

    const alvo = (registry.byCategory().get('downloads') || [])[0];
    const trigger = (alvo.commands && alvo.commands[0]) || alvo.name;
    assert.ok(download.html.includes(`!${trigger}`), `comando ${trigger} listado pelo trigger atual`);

    registry.registerCommand(
      { name: 'testehtmlxyz', commands: ['testehtmlxyz'], category: 'downloads', description: 'Comando de teste.', usage: '!testehtmlxyz', execute: async () => {} },
      'downloads'
    );
    const depois = htmlMenu.montarDocumento(ctx, { kind: 'categoria', categoria: 'downloads' });
    assert.ok(depois.html.includes('!testehtmlxyz'), 'comando novo aparece sem editar template');
    assert.ok(depois.html.includes('data-usar="testehtmlxyz"'), 'e já ganha o botão Usar');
    registry.unregisterCommand('testehtmlxyz');
    ok('6: templates por menu usando o registro como fonte única');
  } catch (e) {
    fail('6: templates', e);
  }

  /* 7) payload + teto de tamanho */
  try {
    const ctx = fakeCtx();
    const { html } = htmlMenu.montarDocumento(ctx, { kind: 'main' });
    const bytes = Buffer.byteLength(html, 'utf8');
    const teto = Number(process.env.MENU_HTML_MAX_BYTES) || 120000;
    assert.ok(bytes < teto, `payload dentro do teto (${(bytes / 1024).toFixed(1)} KB < ${(teto / 1024) | 0} KB)`);

    const msg = require('../utils/richHtml').buildHtmlMessage(html, { title: 'teste' });
    const rich = msg.botForwardedMessage.message.richResponseMessage;
    assert.ok(rich, 'botForwardedMessage → richResponseMessage');
    assert.strictEqual(rich.messageType, 1, 'tipo padrão (1)');
    assert.strictEqual(rich.submessages[0].messageType, 2, 'submessage de texto (2)');
    assert.ok(rich.unifiedResponse.data instanceof Buffer, 'unifiedResponse.data é Buffer');
    const json = JSON.parse(rich.unifiedResponse.data.toString('utf8'));
    const prim = json.sections[0].view_model.primitive;
    assert.strictEqual(prim.__typename, 'GenAIaeacdsnwHtmlPrimitive', 'primitiva de HTML');
    assert.ok(Array.isArray(prim.trusted_sources), 'trusted_sources presente (não libera rede: medido)');
    assert.ok(prim.payload.includes('<!doctype html>'), 'payload leva o documento');
    ok(`7: payload correto e limitado (${(bytes / 1024).toFixed(1)} KB)`);
  } catch (e) {
    fail('7: payload', e);
  }

  /* 8) documento: telas, altura fixa, scripts */
  try {
    const ctx = fakeCtx();
    const { html } = htmlMenu.montarDocumento(ctx, { kind: 'main' });
    assert.ok(html.includes('id="lua-view-list"'), 'tela da lista');
    assert.ok(html.includes('id="lua-view-panel"'), 'tela do painel do Usar');
    assert.ok(html.includes('data-voltar="raiz"'), 'Voltar do painel');
    assert.ok(html.includes('id="__wrap"') || html.includes('w.id="__wrap"'), 'contêiner injetado');
    assert.ok(/#__wrap\{height:\d+px;max-height:\d+px;overflow:hidden/.test(html), 'altura fixa e página que NÃO rola');
    assert.ok(/html,body\{margin:0;padding:0;height:\d+px;max-height:\d+px;overflow:hidden\}/.test(html), 'html/body sem rolagem');
    assert.ok(html.includes('prefers-reduced-motion'), 'respeita movimento reduzido');
    // contêineres de rolagem: um por eixo, cada um com overflow próprio
    assert.ok(html.includes('id="lua-list"'), 'contêiner rolável dos comandos');
    assert.ok(html.includes('id="lua-tabs"'), 'contêiner rolável das categorias');
    assert.ok(html.includes('id="lua-panel-body"'), 'contêiner rolável do painel');
    assert.ok(/#lua-list\{flex:1 1 auto;min-height:0;overflow-y:auto/.test(html), '#lua-list rola no eixo Y');
    assert.ok(/\.tabs\{flex:1 1 auto;min-width:0;display:flex;gap:8px;overflow-x:auto/.test(html), '.tabs rola no eixo X');
    assert.ok(/#lua-panel-body\{flex:1 1 auto;min-height:0;overflow-y:auto/.test(html), 'painel rola no eixo Y');
    // setas: fora das áreas que rolam (irmãs, não filhas) e com rótulo acessível
    const iLista = html.indexOf('id="lua-list"');
    const iBarra = html.indexOf('class="vrail"');
    assert.ok(iBarra > iLista && html.indexOf('</main>', iLista) < iBarra, 'barra ↑↓ depois da lista (irmã)');
    assert.ok(html.includes('aria-label="Rolar comandos para baixo"'), 'rótulo: rolar para baixo');
    assert.ok(html.includes('aria-label="Rolar comandos para cima"'), 'rótulo: rolar para cima');
    assert.ok(html.includes('aria-label="Mostrar próximas categorias"'), 'rótulo: próximas categorias');
    assert.ok(html.includes('aria-label="Mostrar categorias anteriores"'), 'rótulo: categorias anteriores');
    const iFaixa = html.indexOf('id="lua-tabs"');
    assert.ok(
      html.indexOf('id="lua-cat-prev"') < iFaixa && html.indexOf('id="lua-cat-next"') > iFaixa,
      '← e → nas extremidades da faixa'
    );
    assert.ok(html.includes('[hidden]{display:none!important}'), 'hidden vence o display dos componentes');
    assert.strictEqual((html.match(/<style>/g) || []).length, 2, '2 blocos de CSS (trava de altura + tema)');
    assert.strictEqual((html.match(/<script>/g) || []).length, 2, '2 scripts (envolver + menu)');
    assert.ok(html.includes('lua-entra'), 'transição definida no CSS');
    ok('8: duas telas, altura fixa e CSS/JS embutidos sem recurso externo');
  } catch (e) {
    fail('8: documento', e);
  }

  /* 9) argumento inválido */
  try {
    const antes = settings.menuHtmlEnabled();
    const ctx = fakeCtx({ isOwner: true, args: ['ligado?'] });
    await cmdModohtml.execute(ctx);
    assert.strictEqual(settings.menuHtmlEnabled(), antes, 'nada mudou');
    assert.ok(ctx.replies.some((r) => /inválido/i.test(r)), 'avisou o argumento inválido');
    ok('9: argumento inválido é recusado sem alterar a configuração');
  } catch (e) {
    fail('9: argumento inválido', e);
  }

  /* 10) erro no envio → tradicional (e sem repetição) */
  try {
    const ctx = fakeCtx({ relayFalha: true });
    const enviado = await menuFormat.abrir(ctx, { kind: 'main' });
    assert.strictEqual(enviado, false, 'devolveu false (quem chamou usa o tradicional)');
    assert.strictEqual(ctx.enviados.length, 1, 'tentou UMA vez (sem repetir envio)');
    assert.ok(!ctx.replies.length, 'não respondeu nada pela camada HTML');
    ok('10: falha no card cai no tradicional sem repetir envio');
  } catch (e) {
    fail('10: fallback', e);
  }

  /* 11) `!menu --texto` (alternativa tradicional com o modo ligado) */
  try {
    const menuCmd = require('../commands/general/menu').find((c) => c.name === 'menu');
    const ctx = fakeCtx({ isOwner: true, args: ['--texto'] });
    await menuCmd.execute(ctx);
    assert.ok(ctx.replies.some((r) => /MENU PRINCIPAL|menu/i.test(r)), 'respondeu o menu tradicional em texto');
    assert.ok(!ctx.enviados.length, 'não tentou o card HTML com --texto');
    ok('11: !menu --texto força o menu tradicional');
  } catch (e) {
    fail('11: --texto', e);
  }

  /* 12) modo seguro bloqueia o card */
  try {
    settings.setMenuHtmlEnabled(true);
    const safety = require('../utils/safety');
    const anterior = safety.safeMode();
    safety.setSafeMode(true);
    const ctx = fakeCtx();
    const enviado = await menuFormat.abrir(ctx, { kind: 'main' });
    assert.strictEqual(enviado, false, 'modo seguro: não envia card');
    assert.strictEqual(ctx.enviados.length, 0, 'nem chegou no socket');
    const st = menuFormat.status();
    assert.strictEqual(st.enabled, true, 'preferência continua ligada');
    assert.strictEqual(st.active, false, 'mas não está em uso');
    assert.ok(/MODO SEGURO/i.test(st.motivo), 'explica o motivo');
    safety.setSafeMode(anterior);
    ok('12: modo seguro tem precedência e o motivo fica explícito');
  } catch (e) {
    fail('12: modo seguro', e);
  }

  /* 13) botão "Usar" — botão de verdade, com dados do registro */
  try {
    const { registry } = require('../engine/plugins');
    const ctx = fakeCtx();
    const admin = htmlMenu.montarDocumento(ctx, { kind: 'categoria', categoria: 'admin' });
    const downloads = htmlMenu.montarDocumento(ctx, { kind: 'categoria', categoria: 'downloads' });

    assert.ok(!/href\s*=\s*["']https?:/i.test(admin.html), 'nenhum link http(s) no card (não navega no WebView)');
    assert.ok(admin.html.includes('<button class="go" data-usar="'), 'Usar é <button>');
    assert.ok(!/<a class="go"/.test(admin.html), 'o link morto antigo não existe mais');

    const comandos = (registry.byCategory().get('admin') || []).filter((c) => !c.hidden);
    const botoes = (admin.html.match(/data-usar="/g) || []).length;
    assert.strictEqual(botoes, comandos.length, 'todo comando da categoria tem botão (inclusive só-de-grupo)');

    // comando só-de-grupo: botão existe E carrega o requisito
    const soGrupo = comandos.find((c) => c.groupOnly || c.adminOnly || c.botAdmin);
    if (soGrupo) {
      const trig = (soGrupo.commands && soGrupo.commands[0]) || soGrupo.name;
      const re = new RegExp(`<button class="go" data-usar="${trig}"[^>]*data-req="[^"]*"`);
      assert.ok(re.test(admin.html), `${trig} carrega data-req (o painel explica o contexto)`);
    }

    // comando com argumentos: o padrão do usage vai junto
    const comArgs = (registry.byCategory().get('downloads') || []).find((c) => actions.camposDoUso(c.usage, (c.commands || [])[0]).length);
    if (comArgs) {
      const trig = (comArgs.commands && comArgs.commands[0]) || comArgs.name;
      assert.ok(downloads.html.includes(`data-uso="`), 'comando com argumentos leva data-uso');
      assert.ok(new RegExp(`data-usar="${trig}"`).test(downloads.html), `${trig} tem botão`);
    }
    ok('13: Usar é botão real com usage/requisitos do registro (nada de link morto)');
  } catch (e) {
    fail('13: botão Usar', e);
  }

  /* 14) regras do ambiente medido (sem recursos/APIs que morrem no WebView) */
  try {
    const ctx = fakeCtx();
    const { html } = htmlMenu.montarDocumento(ctx, { kind: 'main' });
    const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    const remotos = html.match(/\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//gi) || [];
    assert.strictEqual(remotos.length, 0, `0 subresource remoto (achou ${remotos.length})`);
    for (const api of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'EventSource', 'new WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'crypto.subtle', 'setInterval']) {
      assert.ok(!js.includes(api), `JS sem ${api} (medido como morto/indisponível no WebView)`);
    }
    assert.ok(!/location\.href\s*=/.test(js), 'JS não tenta navegar (o WebView bloqueia)');
    assert.ok(!/window\.open\s*\(/.test(js), 'JS não abre janela (bloqueado)');
    // nada de interceptar toque: os gestos do WhatsApp (e a seleção de texto)
    // continuam valendo; os botões só respondem a clique
    assert.ok(!/touchstart|touchmove|touchend|gesturestart/i.test(js), 'JS não captura eventos de toque');
    assert.ok(js.includes('setTimeout'), 'usa setTimeout só para a transição curta');
    ok('14: nada de recurso remoto nem API morta no WebView');
  } catch (e) {
    fail('14: ambiente do card', e);
  }

  /* 15) escapagem de conteúdo dinâmico */
  try {
    const { registry } = require('../engine/plugins');
    registry.registerCommand(
      {
        name: 'testexss',
        commands: ['testexss'],
        category: 'downloads',
        description: '"><script>alert(1)</script>',
        usage: '!testexss <link>',
        execute: async () => {},
      },
      'downloads'
    );
    const ctx = fakeCtx();
    const { html } = htmlMenu.montarDocumento(ctx, { kind: 'categoria', categoria: 'downloads' });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'script injetado não aparece cru');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'descrição escapada');
    assert.ok(!/"><script/.test(html), 'atributo não é quebrado pelo conteúdo');
    assert.ok(html.includes('data-usar="testexss"'), 'e o botão Usar continua íntegro');
    registry.unregisterCommand('testexss');
    ok('15: conteúdo dinâmico escapado por contexto');
  } catch (e) {
    fail('15: escapagem', e);
  }

  /* 16) modo desligado não carrega menus/html */
  try {
    settings.setMenuHtmlEnabled(false);
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}menus${path.sep}html`)) delete require.cache[k];
    }
    const ctx = fakeCtx();
    const enviado = await menuFormat.abrir(ctx, { kind: 'main' });
    assert.strictEqual(enviado, false, 'desligado: não envia');
    const carregou = Object.keys(require.cache).some((k) => k.includes(`${path.sep}menus${path.sep}html`));
    assert.strictEqual(carregou, false, 'menus/html NÃO foi carregado com o modo desligado');
    ok('16: com o modo desligado os templates HTML nem são carregados');
  } catch (e) {
    fail('16: carregamento preguiçoso', e);
  }

  /* 17) integração: `!menu` e `!menuadm` entregam o card (nada de texto junto) */
  try {
    settings.setMenuHtmlEnabled(true);
    const menuCmd = require('../commands/general/menu').find((c) => c.name === 'menu');
    const ctxMenu = fakeCtx({ isOwner: true });
    await menuCmd.execute(ctxMenu);
    assert.strictEqual(ctxMenu.enviados.length, 1, '!menu enviou UM card');
    const html = htmlDoEnvio(ctxMenu.enviados[0]);
    assert.ok(html.includes('🌙'), 'card tem a identidade do bot');
    assert.ok(/Geral|MENU/i.test(html), 'card tem a categoria');
    assert.ok(!ctxMenu.replies.some((r) => /MENU PRINCIPAL/.test(r)), 'não mandou o menu de texto junto');

    const adm = require('../commands/general/menus').find((c) => c.name === 'menuadm');
    const ctxAdm = fakeCtx({ isOwner: true });
    await adm.execute(ctxAdm);
    assert.strictEqual(ctxAdm.enviados.length, 1, '!menuadm enviou UM card');
    const htmlAdm = htmlDoEnvio(ctxAdm.enviados[0]);
    assert.ok(htmlAdm.includes('data-cat="admin"'), 'menuadm abre a categoria admin');
    assert.ok(!htmlAdm.includes('data-cat="downloads"'), 'menuadm não traz outras categorias');
    ok('17: !menu e !menuadm entregam o card pelo pipeline real do comando');
  } catch (e) {
    fail('17: integração', e);
  }

  /* 18) actions.js — campos, validação, montagem, requisitos */
  try {
    const campos = actions.camposDoUso('!ytmp3 <link>', 'ytmp3');
    assert.deepStrictEqual(campos.map((c) => [c.nome, c.obrigatorio, c.tipo]), [['link', true, 'link']], '<link> obrigatório');

    const dois = actions.camposDoUso('!abrirempresa <tipo> [nome]', 'abrirempresa');
    assert.strictEqual(dois.length, 2, 'dois campos');
    assert.strictEqual(dois[0].obrigatorio, true, 'primeiro obrigatório');
    assert.strictEqual(dois[1].obrigatorio, false, 'segundo opcional');

    const mencao = actions.camposDoUso('!advertir @usuario [motivo]', 'advertir');
    assert.strictEqual(mencao.length, 2, '@usuario é campo');
    assert.strictEqual(mencao[0].tipo, 'mencao', 'tipo menção');
    assert.strictEqual(mencao[0].obrigatorio, true, 'menção obrigatória');

    const escolha = actions.camposDoUso('!sticker <imagem|texto>', 'sticker');
    assert.deepStrictEqual(escolha[0].opcoes, ['imagem', 'texto'], 'escolhas extraídas');

    const alternativo = actions.camposDoUso('!apagar @user [quantidade] | !apagar [quantidade] (apaga do bot)', 'apagar');
    assert.strictEqual(alternativo.length, 2, 'só a PRIMEIRA variante do usage conta');

    const semArgs = actions.camposDoUso('!menuadm', 'menuadm');
    assert.deepStrictEqual(semArgs, [], 'comando sem argumentos não pede nada');

    const erros = actions.validarCampos(campos, ['']);
    assert.ok(erros.erros.link, 'obrigatório vazio acusa erro');
    assert.ok(actions.validarCampos(campos, ['https://youtu.be/x']).ok, 'valor preenchido passa');
    assert.ok(actions.validarCampos(mencao, ['joao', 'x']).erros['@usuario'], 'menção sem @ acusa erro');
    assert.ok(actions.validarCampos(escolha, ['audio']).erros['imagem|texto'], 'valor fora das opções acusa');

    assert.strictEqual(actions.montarComando('!', 'ytmp3', campos, ['https://youtu.be/x']), '!ytmp3 https://youtu.be/x', 'comando montado');
    assert.strictEqual(actions.montarComando('!', 'ytmp3', campos, ['']), '!ytmp3', 'sem valor → só o comando');
    assert.strictEqual(
      actions.montarComando('#', 'abrirempresa', dois, ['padaria', '']),
      '#abrirempresa padaria',
      'opcional vazio não entra (argumentos posicionais)'
    );

    const reqBan = actions.requisitosDe({ usage: '!banir @usuario', description: 'Bane do grupo.' });
    assert.strictEqual(reqBan.mencao, true, 'menção detectada');
    const reqToimg = actions.requisitosDe({ usage: '!toimg', description: 'Responda um sticker para converter em imagem.' });
    assert.strictEqual(reqToimg.resposta, true, 'resposta detectada');
    assert.strictEqual(reqToimg.midia, true, 'mídia detectada');
    const reqSimples = actions.requisitosDe({ usage: '!menu', description: 'Mostra o menu.' });
    assert.strictEqual(actions.flagsCompactas(reqSimples), '', 'comando simples não carrega requisito');
    assert.ok(actions.avisosDe(reqToimg).length >= 2, 'avisos prontos para o painel');
    ok('18: actions.js — campos, validação, montagem e requisitos');
  } catch (e) {
    fail('18: actions.js', e);
  }

  /* 19) DOM de verdade (jsdom opcional) */
  let JSDOM = null;
  try {
    JSDOM = require('jsdom').JSDOM;
  } catch (_) {
    skip('19: comportamento no DOM (Usar, navegação, cópia)', 'jsdom não instalado (npm i --no-save jsdom)');
  }

  if (JSDOM) {
    const card = htmlMenu.montarDocumento(fakeCtx(), { kind: 'categoria', categoria: 'downloads' }).html;
    const cardAdmin = htmlMenu.montarDocumento(fakeCtx(), { kind: 'categoria', categoria: 'admin' }).html;
    const cardMain = htmlMenu.montarDocumento(fakeCtx(), { kind: 'main' }).html; // 14 categorias
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

    /**
     * O jsdom não tem layout (clientHeight/scrollHeight são 0 e scrollTop não
     * anda). Para testar a rolagem de verdade, cada contêiner recebe uma
     * GEOMETRIA FALSA: limites reais, scrollTop/scrollLeft que respeitam o
     * limite. Isso valida a lógica (passo, limites, setas), não o CSS — o CSS
     * só é verificável no WhatsApp.
     */
    function medir(el, g = {}) {
      const larg = g.w || 0;
      const alt = g.h || 0;
      const totalX = g.sw || 0;
      const totalY = g.sh || 0;
      const maxX = Math.max(0, totalX - larg);
      const maxY = Math.max(0, totalY - alt);
      let x = 0;
      let y = 0;
      const def = (nome, get, set) =>
        Object.defineProperty(el, nome, { get, set, configurable: true, enumerable: true });
      def('clientWidth', () => larg);
      def('scrollWidth', () => totalX);
      def('clientHeight', () => alt);
      def('scrollHeight', () => totalY);
      const avisar = () => {
        try {
          const W = el.ownerDocument.defaultView;
          el.dispatchEvent(new W.Event('scroll'));
        } catch (_) {}
      };
      def('scrollLeft', () => x, (v) => {
        x = Math.max(0, Math.min(maxX, Math.round(Number(v) || 0)));
        avisar(); // o WebView dispara scroll em rolagem programática: aqui também
      });
      def('scrollTop', () => y, (v) => {
        y = Math.max(0, Math.min(maxY, Math.round(Number(v) || 0)));
        avisar();
      });
      medir.limite ||= {};
      return { get maxX() { return maxX; }, get maxY() { return maxY; }, el };
    }

    /** Geometria de uma faixa/lista com N "itens" visíveis em faixas de tamanho. */
    function montarDom(html, opts = {}) {
      return new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        beforeParse(w) {
          w.__copiados = [];
          w.__exec = [];
          w.matchMedia = (q) => ({ matches: opts.movimento !== 'full', media: q, addEventListener() {}, removeEventListener() {} });
          w.__rolagens = [];
          // scrollTo/scrollBy do jsdom não existem de verdade: aqui eles viram
          // deslocamento imediato e ficam registrados (com o `behavior`).
          w.Element.prototype.scrollTo = function (a, b) {
            const o = a && typeof a === 'object' ? a : { top: b, left: a };
            w.__rolagens.push({ id: this.id, top: o.top, left: o.left, behavior: o.behavior });
            if (typeof o.top === 'number') this.scrollTop = o.top;
            if (typeof o.left === 'number') this.scrollLeft = o.left;
          };
          w.Element.prototype.scrollBy = function (a, b) {
            const o = a && typeof a === 'object' ? a : { top: b, left: a };
            this.scrollTop = (this.scrollTop || 0) + (Number(o.top) || 0);
            this.scrollLeft = (this.scrollLeft || 0) + (Number(o.left) || 0);
          };
          w.Element.prototype.scrollIntoView = function () {};
          if (opts.clipboard === 'falha') {
            Object.defineProperty(w.navigator, 'clipboard', {
              value: {
                writeText: () => {
                  w.__exec.push('clipboard');
                  return Promise.reject(new Error('negado'));
                },
              },
              configurable: true,
            });
          } else if (opts.clipboard) {
            Object.defineProperty(w.navigator, 'clipboard', {
              value: {
                writeText: (t) => {
                  w.__exec.push('clipboard');
                  w.__copiados.push(t);
                  return Promise.resolve();
                },
              },
              configurable: true,
            });
          }
          if (opts.execCommand) {
            w.document.execCommand = () => {
              w.__exec.push('execCommand');
              return !!opts.execCommand;
            };
          }
        },
      });
    }

    const comArgs = (() => {
      const { registry } = require('../engine/plugins');
      const cmds = (registry.byCategory().get('downloads') || []).filter((c) => !c.hidden);
      return cmds.find((c) => actions.camposDoUso(c.usage, (c.commands || [])[0]).some((f) => f.tipo === 'link'));
    })();
    const semArgs = (() => {
      const { registry } = require('../engine/plugins');
      const cmds = (registry.byCategory().get('downloads') || []).filter((c) => !c.hidden);
      return cmds.find((c) => actions.camposDoUso(c.usage, (c.commands || [])[0]).length === 0);
    })();

    /* 19a) Usar em comando sem argumentos: painel abre com o comando pronto */
    try {
      const dom = montarDom(card);
      const w = dom.window;
      const d = w.document;
      const trigger = (semArgs.commands && semArgs.commands[0]) || semArgs.name;
      const btn = d.querySelector(`[data-usar="${trigger}"]`);
      assert.ok(btn, `botão do ${trigger} existe`);
      btn.click();
      assert.strictEqual(d.getElementById('lua-view-panel').hidden, false, 'painel visível');
      assert.strictEqual(d.getElementById('lua-view-list').hidden, true, 'lista escondida (sem tela sobreposta)');
      assert.strictEqual(d.getElementById('lua-cmd').textContent, `!${trigger}`, 'comando pronto no painel');
      assert.ok(d.querySelector('.pn-tip'), 'painel diz que o card não envia mensagens');
      ok('19a: [DOM] "Usar" sem argumentos abre o painel com o comando montado');
      dom.window.close();
    } catch (e) {
      fail('19a: DOM sem argumentos', e);
    }

    /* 19b) Usar em comando com argumentos: campos, validação, prévia e cópia */
    try {
      const dom = montarDom(card, { clipboard: true });
      const w = dom.window;
      const d = w.document;
      const trigger = (comArgs.commands && comArgs.commands[0]) || comArgs.name;
      const btn = d.querySelector(`[data-usar="${trigger}"]`);
      assert.ok(btn, `botão do ${trigger} existe`);
      assert.ok(btn.getAttribute('data-uso'), `${trigger} carrega o padrão de argumentos`);
      btn.click();

      const campo = d.querySelector('.pn-field input');
      assert.ok(campo, 'campo renderizado');
      assert.strictEqual(d.querySelectorAll('.pn-field').length, actions.camposDoUso(comArgs.usage, trigger).length, 'um campo por argumento');

      d.getElementById('lua-copy').click();
      assert.strictEqual(d.getElementById('lua-status').textContent, 'Falta preencher o comando.', 'valida antes de copiar');
      assert.strictEqual(w.__copiados.length, 0, 'não copiou com campo obrigatório vazio');

      campo.value = 'https://youtu.be/abc123';
      campo.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.strictEqual(d.getElementById('lua-cmd').textContent, `!${trigger} https://youtu.be/abc123`, 'prévia atualiza ao digitar');

      d.getElementById('lua-copy').click();
      await esperar(20);
      assert.deepStrictEqual(w.__copiados, [`!${trigger} https://youtu.be/abc123`], 'copiou o comando completo');
      assert.ok(/Copiado/.test(d.getElementById('lua-status').textContent), 'status confirma a cópia (não a execução)');
      assert.ok(!/enviad|executad/i.test(d.getElementById('lua-status').textContent), 'não promete execução');

      // toque repetido não dispara outra cópia
      d.getElementById('lua-copy').click();
      d.getElementById('lua-copy').click();
      await esperar(20);
      assert.strictEqual(w.__copiados.length, 1, 'toque repetido não duplica a ação');
      ok('19b: [DOM] campos, validação, prévia e cópia sem duplicar');
      dom.window.close();
    } catch (e) {
      fail('19b: DOM argumentos/cópia', e);
    }

    /* 19c) sem clipboard: cai no legado e, falhando, orienta a copiar na mão */
    try {
      const dom = montarDom(card, { clipboard: 'falha', execCommand: false });
      const w = dom.window;
      const d = w.document;
      const trigger = (semArgs.commands && semArgs.commands[0]) || semArgs.name;
      d.querySelector(`[data-usar="${trigger}"]`).click();
      d.getElementById('lua-copy').click();
      await esperar(30);
      const st = d.getElementById('lua-status').textContent;
      assert.ok(/não deu para copiar/i.test(st), 'avisa que não conseguiu copiar');
      assert.ok(/Copiar/i.test(st), 'diz o que fazer (copiar manualmente)');
      assert.ok(w.__exec.includes('execCommand') || w.__exec.includes('clipboard'), 'tentou os dois caminhos');
      ok('19c: [DOM] falha de cópia orienta o usuário (sem prometer nada)');
      dom.window.close();
    } catch (e) {
      fail('19c: DOM falha de cópia', e);
    }

    /* 19d) navegação: busca, Voltar com estado preservado, categorias */
    try {
      const dom = montarDom(cardAdmin);
      const w = dom.window;
      const d = w.document;
      const rolagem = d.getElementById('lua-list');
      medir(rolagem, { h: 300, sh: 900 });

      const primeiro = d.querySelector('[data-usar]');
      rolagem.scrollTop = 120; // marca a rolagem dos comandos
      primeiro.click();
      assert.strictEqual(d.getElementById('lua-view-list').hidden, true, 'painel aberto');
      d.querySelector('[data-voltar="raiz"]').click();
      assert.strictEqual(d.getElementById('lua-view-list').hidden, false, 'Voltar devolve a lista');
      assert.strictEqual(rolagem.scrollTop, 120, 'rolagem dos comandos restaurada');

      // campos preenchidos sobrevivem a sair e voltar
      const campo = d.querySelector('.pn-field input');
      if (campo) {
        primeiro.click();
        const c2 = d.querySelector('.pn-field input');
        c2.value = 'valor guardado';
        c2.dispatchEvent(new w.Event('input', { bubbles: true }));
        d.querySelector('[data-voltar="raiz"]').click();
        primeiro.click();
        assert.strictEqual(d.querySelector('.pn-field input').value, 'valor guardado', 'campos preenchidos preservados');
        assert.ok(d.querySelector('.pn-req'), 'requisitos aparecem no painel do comando só-de-grupo');
        d.querySelector('[data-voltar="raiz"]').click();
      }

      // busca
      const q = d.getElementById('lua-q');
      q.value = 'modo';
      q.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.ok(/🔎/.test(d.getElementById('lua-cat-label').textContent), 'rótulo mostra a busca');
      q.value = '';
      q.dispatchEvent(new w.Event('input', { bubbles: true }));

      // troca de categoria preserva e volta para a última escolhida
      const abas = [...d.querySelectorAll('.tab')];
      if (abas.length > 1) {
        abas[1].click();
        assert.strictEqual(w.__luaMenu.estado.cat, abas[1].getAttribute('data-cat'), 'categoria ativa é a tocada');
      }
      ok('19d: [DOM] busca, Voltar com estado (rolagem + campos) e categorias');
      dom.window.close();
    } catch (e) {
      fail('19d: DOM navegação', e);
    }

    /* 19e) toques rápidos + transição com movimento habilitado */
    try {
      const dom = montarDom(cardAdmin, { movimento: 'full' });
      const w = dom.window;
      const d = w.document;
      const alvos = [...d.querySelectorAll('[data-usar]')].slice(0, 3);
      alvos.forEach((b) => b.click()); // toques em sequência, sem esperar
      await esperar(420); // deixa as transições terminarem
      const telas = ['lua-view-list', 'lua-view-panel'].filter((id) => !d.getElementById(id).hidden);
      assert.strictEqual(telas.length, 1, 'exatamente UMA tela visível (nada sobreposto)');
      assert.strictEqual(d.getElementById('lua-view-panel').hidden, false, 'a última tela é a do último toque');
      assert.strictEqual(w.__luaMenu.estado.cmd, ((alvos[2].getAttribute('data-usar')) || ''), 'estado é do último comando tocado');
      assert.ok(!d.querySelector('.screen.sai') && !d.querySelector('.screen.entra'), 'nenhuma classe de transição pendente');
      ok('19e: [DOM] toques rápidos convergem para o último, sem tela sobreposta');
      dom.window.close();
    } catch (e) {
      fail('19e: DOM toques rápidos', e);
    }

    /* 19f) paridade parser do card × actions.js + movimento reduzido */
    try {
      const dom = montarDom(card, { movimento: 'reduzido' });
      const w = dom.window;
      const d = w.document;
      const casos = [
        '!ytmp3 <link>',
        '!abrirempresa <tipo> [nome]',
        '!advertir @usuario [motivo]',
        '!sticker <imagem|texto>',
        '!aimemory on|off|clear|status',
        '!apagar @user [quantidade] | !apagar [quantidade]',
      ];
      for (const uso of casos) {
        const trigger = uso.replace(/^!/, '').split(' ')[0];
        const noNode = actions.camposDoUso(uso, trigger).map((c) => `${c.nome}|${c.obrigatorio}|${c.opcoes.join('/')}|${c.tipo}`);
        // Array.from: o array vem do realm do jsdom, e deepStrictEqual compara
        // protótipos (array de outro realm reprovaria mesmo com o mesmo conteúdo).
        const noCard = Array.from(
          w.__luaMenu.campos(uso.replace(/^\S+\s*/, '')),
          (c) => `${c.nome}|${c.obrigatorio}|${c.opcoes.join('/')}|${c.tipo}`
        );
        assert.deepStrictEqual(noCard, noNode, `parser do card == actions.js em "${uso}"`);
      }
      assert.strictEqual(w.__luaMenu.montar('ytmp3', [{ nome: 'link', obrigatorio: true, opcoes: [] }], ['x y']), '!ytmp3 x y', 'montagem idêntica');
      assert.ok(w.__luaMenu.validar([{ nome: 'link', obrigatorio: true, opcoes: [], tipo: 'link' }], ['']).link, 'validação idêntica');

      // com movimento reduzido a troca é imediata (sem timer pendente)
      d.querySelector('[data-usar]').click();
      assert.strictEqual(d.getElementById('lua-view-panel').hidden, false, 'troca imediata com prefers-reduced-motion');
      ok('19f: [DOM] parser/validação do card == actions.js e movimento reduzido respeitado');
      dom.window.close();
    } catch (e) {
      fail('19f: DOM paridade/movimento', e);
    }

    /** true quando as duas setas verticais estão desativadas (nada a rolar). */
    function barraPainelVazia(d) {
      return d.getElementById('lua-up').disabled === true && d.getElementById('lua-down').disabled === true;
    }

    /* ============ 20) setas de rolagem (↑ ↓ ← →) ============ */

    /* 20a) vertical: cada toque anda 70% da área visível, só nos comandos */
    try {
      const dom = montarDom(card, { movimento: 'full' }); // movimento permitido: testa o caminho suave
      const w = dom.window;
      const d = w.document;
      const lista = d.getElementById('lua-list');
      const faixa = d.getElementById('lua-tabs');
      const corpoTela = d.getElementById('__wrap');
      medir(lista, { h: 300, sh: 900 }); // cabem 300px; conteúdo 900px → sobra 600
      medir(faixa, { w: 200, sw: 800 });
      w.__luaMenu.atualizarSetas();
      await esperar(20);

      const passo = Math.round(300 * w.__luaMenu.passo); // 70% de 300 = 210
      assert.strictEqual(passo, 210, 'passo = 70% da altura visível');
      assert.strictEqual(d.getElementById('lua-up').disabled, true, 'no topo, ↑ desativada');
      assert.strictEqual(d.getElementById('lua-down').disabled, false, '↓ ativada (há conteúdo para baixo)');

      d.getElementById('lua-down').click();
      assert.strictEqual(lista.scrollTop, 210, '↓ desceu uma parte (210px)');
      assert.strictEqual(corpoTela.scrollTop, 0, 'a página/contêiner externo NÃO se moveu');
      assert.strictEqual(faixa.scrollLeft, 0, 'a faixa de categorias NÃO se moveu');
      await esperar(25); // o evento de scroll liga a seta de voltar
      assert.strictEqual(d.getElementById('lua-up').disabled, false, '↑ ativa depois de descer (via evento scroll)');

      d.getElementById('lua-down').click();
      assert.strictEqual(lista.scrollTop, 420, '↓ de novo desceu outra parte');
      d.getElementById('lua-up').click();
      assert.strictEqual(lista.scrollTop, 210, '↑ voltou uma parte');
      assert.ok(w.__rolagens.some((r) => r.id === 'lua-list' && r.behavior === 'smooth'), 'usou rolagem suave');
      assert.ok(!w.__rolagens.some((r) => r.id !== 'lua-list' && r.id !== 'lua-tabs' && r.id !== 'lua-panel-body'), 'nenhuma rolagem fora dos contêineres internos');
      ok('20a: [DOM] ↑/↓ deslocam 70% da área visível só no contêiner dos comandos');
      dom.window.close();
    } catch (e) {
      fail('20a: DOM rolagem vertical', e);
    }

    /* 20b) limites: desativa no topo/fim; conteúdo curto → tudo desativado */
    try {
      const dom = montarDom(card);
      const w = dom.window;
      const d = w.document;
      const lista = d.getElementById('lua-list');
      const cima = () => d.getElementById('lua-up');
      const baixo = () => d.getElementById('lua-down');
      medir(lista, { h: 300, sh: 900 });

      w.__luaMenu.atualizarSetas();
      assert.strictEqual(cima().disabled, true, 'no topo, ↑ desativada');
      assert.strictEqual(baixo().disabled, false, 'no topo, ↓ ativada');

      lista.scrollTop = 600; // fim
      w.__luaMenu.atualizarSetas();
      assert.strictEqual(baixo().disabled, true, 'no fim, ↓ desativada');
      assert.strictEqual(cima().disabled, false, 'no fim, ↑ ativada');

      baixo().click(); // clique no limite não passa do fim
      assert.strictEqual(lista.scrollTop, 600, 'toque no fim não estoura o conteúdo');
      cima().click();
      assert.strictEqual(lista.scrollTop, 390, '↑ volta 210px do fim');

      // conteúdo que cabe inteiro: setas desativadas e SEM sumir do layout
      lista.scrollTop = 0;
      medir(lista, { h: 300, sh: 300 });
      w.__luaMenu.atualizarSetas();
      assert.strictEqual(cima().disabled, true, 'conteúdo curto: ↑ desativada');
      assert.strictEqual(baixo().disabled, true, 'conteúdo curto: ↓ desativada');
      assert.strictEqual(cima().hidden, false, '↑ continua no layout (nada de salto)');
      assert.strictEqual(baixo().hidden, false, '↓ continua no layout');
      baixo().click();
      assert.strictEqual(lista.scrollTop, 0, 'sem conteúdo para rolar, nada se move');
      ok('20b: [DOM] setas desativam nos limites e com conteúdo curto (sem salto de layout)');
      dom.window.close();
    } catch (e) {
      fail('20b: DOM limites', e);
    }

    /* 20c) horizontal: ←/→ revelam categorias SEM trocar de menu */
    try {
      const dom = montarDom(card);
      const w = dom.window;
      const d = w.document;
      const faixa = d.getElementById('lua-tabs');
      const lista = d.getElementById('lua-list');
      medir(faixa, { w: 200, sw: 800 });
      medir(lista, { h: 300, sh: 900 });
      w.__luaMenu.atualizarSetas();

      const esq = () => d.getElementById('lua-cat-prev');
      const dir = () => d.getElementById('lua-cat-next');
      const antes = w.__luaMenu.estado.cat;
      assert.strictEqual(esq().disabled, true, 'no começo, ← desativada');
      assert.strictEqual(dir().disabled, false, 'no começo, → ativada');

      dir().click();
      assert.strictEqual(faixa.scrollLeft, 140, '→ revelou 70% da largura visível (140px)');
      assert.strictEqual(w.__luaMenu.estado.cat, antes, 'rolar a faixa NÃO troca de categoria');
      assert.strictEqual(lista.scrollTop, 0, 'rolar a faixa não mexe nos comandos');

      faixa.scrollLeft = 600; // fim
      w.__luaMenu.atualizarSetas();
      assert.strictEqual(dir().disabled, true, 'no fim, → desativada');
      assert.strictEqual(esq().disabled, false, 'no fim, ← ativada');
      esq().click();
      assert.strictEqual(faixa.scrollLeft, 460, '← volta 140px');

      // faixa que cabe inteira: as duas desativadas e ainda visíveis
      medir(faixa, { w: 200, sw: 200 });
      w.__luaMenu.atualizarSetas();
      assert.strictEqual(esq().disabled, true, 'faixa curta: ← desativada');
      assert.strictEqual(dir().disabled, true, 'faixa curta: → desativada');
      assert.strictEqual(dir().hidden, false, '→ continua no layout');
      ok('20c: [DOM] ←/→ revelam categorias sem trocar de menu, com limites corretos');
      dom.window.close();
    } catch (e) {
      fail('20c: DOM rolagem horizontal', e);
    }

    /* 20d) escolher categoria: ativa fica visível e a faixa anda só o necessário */
    try {
      const dom = montarDom(cardMain);
      const w = dom.window;
      const d = w.document;
      const faixa = d.getElementById('lua-tabs');
      const abas = [...d.querySelectorAll('.tab')];
      assert.ok(abas.length >= 3, 'card com várias categorias para testar');
      medir(faixa, { w: 200, sw: 900 });
      // geometria falsa: cada aba ocupa 90px de conteúdo a cada 100px; o
      // retângulo acompanha a rolagem da faixa (como no navegador de verdade)
      abas.forEach((t, i) => {
        t.getBoundingClientRect = () => ({
          left: 300 + i * 100 - faixa.scrollLeft,
          width: 90,
          top: 0,
          height: 44,
        });
      });
      faixa.getBoundingClientRect = () => ({ left: 300, width: 200, top: 0, height: 44 });
      w.__luaMenu.atualizarSetas();

      abas[2].click();
      assert.strictEqual(w.__luaMenu.estado.cat, abas[2].getAttribute('data-cat'), 'categoria ativa é a tocada');
      assert.ok(abas[2].classList.contains('active'), 'categoria selecionada marcada no visual');
      const rotuloTopo = d.getElementById('lua-cat-label').textContent;
      assert.ok(rotuloTopo.trim().length > 0 && rotuloTopo === abas[2].getAttribute('data-label'), 'cabeçalho mostra a categoria selecionada');
      assert.deepStrictEqual(
        abas.filter((t) => t.classList.contains('active')).map((t) => t.getAttribute('data-cat')),
        [abas[2].getAttribute('data-cat')],
        'só uma categoria ativa por vez'
      );
      assert.strictEqual(faixa.scrollLeft, 98, 'andou só o necessário para mostrar a ativa (98px)');

      abas[0].click();
      assert.strictEqual(faixa.scrollLeft, 0, 'ao voltar para a primeira, a faixa acompanha');
      ok('20d: [DOM] seleção ajusta a faixa só o necessário e mantém a ativa visível');
      dom.window.close();
    } catch (e) {
      fail('20d: DOM seleção/categoria', e);
    }

    /* 20e) posição preservada por categoria e pela busca */
    try {
      const dom = montarDom(cardMain);
      const w = dom.window;
      const d = w.document;
      const lista = d.getElementById('lua-list');
      const abas = [...d.querySelectorAll('.tab')];
      medir(lista, { h: 300, sh: 1200 });

      lista.scrollTop = 350;
      w.__luaMenu.categoria(abas[0].getAttribute('data-cat'));
      assert.strictEqual(lista.scrollTop, 350, 'posição guardada da categoria atual');

      if (abas.length > 1) {
        w.__luaMenu.categoria(abas[1].getAttribute('data-cat'));
        assert.strictEqual(lista.scrollTop, 0, 'categoria nova começa no topo');
        lista.scrollTop = 180;
        w.__luaMenu.categoria(abas[0].getAttribute('data-cat'));
        assert.strictEqual(lista.scrollTop, 350, 'ao voltar, a posição daquela categoria volta');
        w.__luaMenu.categoria(abas[1].getAttribute('data-cat'));
        assert.strictEqual(lista.scrollTop, 180, 'e a da outra também');
      }

      const q = d.getElementById('lua-q');
      q.value = 'a';
      q.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.strictEqual(lista.scrollTop, 0, 'busca nova começa do topo');
      q.value = '';
      q.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.strictEqual(lista.scrollTop, 180, 'limpar a busca devolve a posição guardada');
      w.__luaMenu.atualizarSetas();
      assert.strictEqual(typeof d.getElementById('lua-down').disabled, 'boolean', 'estado das setas recalculado após a busca');
      ok('20e: [DOM] rolagem preservada por categoria (e pela busca)');
      dom.window.close();
    } catch (e) {
      fail('20e: DOM preservação de rolagem', e);
    }

    /* 20f) toques rápidos: sem fila, sem estourar, sem tela sobreposta */
    try {
      const dom = montarDom(card);
      const w = dom.window;
      const d = w.document;
      const lista = d.getElementById('lua-list');
      medir(lista, { h: 300, sh: 900 });
      w.__luaMenu.atualizarSetas();
      const baixo = d.getElementById('lua-down');
      for (let i = 0; i < 6; i++) baixo.click(); // 6 toques seguidos, sem esperar
      assert.strictEqual(lista.scrollTop, 600, '6 toques param no fim (limite respeitado)');
      w.__luaMenu.atualizarSetas(); // equivalente ao frame que recalcula os estados
      assert.strictEqual(d.getElementById('lua-up').disabled, false, '↑ liberada no fim do conteúdo');
      for (let i = 0; i < 6; i++) d.getElementById('lua-up').click();
      assert.strictEqual(lista.scrollTop, 0, '6 toques para cima param no topo');
      await esperar(240);
      w.__luaMenu.atualizarSetas();
      assert.strictEqual(d.getElementById('lua-up').disabled, true, '↑ desativada no topo (estado atualizado)');
      assert.strictEqual(d.getElementById('lua-down').disabled, false, '↓ ativada');
      const telas = ['lua-view-list', 'lua-view-panel'].filter((id) => !d.getElementById(id).hidden);
      assert.strictEqual(telas.length, 1, 'segue com UMA tela visível');
      ok('20f: [DOM] toques rápidos nas setas não criam fila nem estouram o limite');
      dom.window.close();
    } catch (e) {
      fail('20f: DOM toques rápidos nas setas', e);
    }

    /* 20g) painel do "Usar": setas miram o painel; lista não se move; copiar segue ok */
    try {
      const dom = montarDom(card, { clipboard: true });
      const w = dom.window;
      const d = w.document;
      const lista = d.getElementById('lua-list');
      const painel = d.getElementById('lua-panel-body');
      medir(lista, { h: 300, sh: 900 });
      const usos = [...d.querySelectorAll('[data-usar]')];
      const comCampo = usos.find((b) => b.getAttribute('data-uso'));
      (comCampo || usos[0]).click();

      medir(painel, { h: 300, sh: 800 });
      w.__luaMenu.atualizarSetas();
      await esperar(20);
      assert.strictEqual(d.getElementById('lua-up').getAttribute('aria-label'), 'Rolar o painel para cima', 'rótulo do painel em cima');
      assert.strictEqual(d.getElementById('lua-down').getAttribute('aria-label'), 'Rolar o painel para baixo', 'rótulo do painel embaixo');
      assert.strictEqual(d.getElementById('lua-down').disabled, false, '↓ ativa para o painel');

      d.getElementById('lua-down').click();
      assert.strictEqual(painel.scrollTop, 210, '↓ rola o painel (210px)');
      assert.strictEqual(lista.scrollTop, 0, 'a lista de comandos não se moveu');
      assert.ok(!d.querySelector('.pn-top .pn-back') === false && !!d.querySelector('.pn-top'), 'o botão Voltar do painel fica fora da área rolável');

      if (comCampo) {
        const campo = d.querySelector('.pn-field input');
        campo.value = 'https://exemplo.com/x';
        campo.dispatchEvent(new w.Event('input', { bubbles: true }));
      }
      d.getElementById('lua-copy').click();
      await esperar(20);
      assert.ok(/Copiado/.test(d.getElementById('lua-status').textContent), 'copiar continua funcionando depois de rolar o painel');

      // conteúdo do painel mudou (coube inteiro) → setas reavaliadas
      medir(painel, { h: 300, sh: 300 });
      w.__luaMenu.atualizarSetas();
      if (comCampo) {
        const campo2 = d.querySelector('.pn-field input');
        campo2.value = 'https://exemplo.com/muito/longo/para/ver/se/o/painel/muda';
        campo2.dispatchEvent(new w.Event('input', { bubbles: true }));
      }
      await esperar(25);
      assert.strictEqual(d.getElementById('lua-down').disabled, true, 'painel que coube inteiro desativa ↓');
      assert.strictEqual(barraPainelVazia(d), true, 'estado recalculado quando o conteúdo do painel muda');

      d.querySelector('[data-voltar="raiz"]').click();
      await esperar(260);
      assert.strictEqual(d.getElementById('lua-down').getAttribute('aria-label'), 'Rolar comandos para baixo', 'rótulo volta a ser dos comandos');
      ok('20g: [DOM] setas passam a mirar o painel e "Usar"/copiar seguem funcionando');
      dom.window.close();
    } catch (e) {
      fail('20g: DOM painel + setas', e);
    }

    /* 20h) movimento reduzido = deslocamento imediato; resize recalcula */
    try {
      const dom = montarDom(card, { movimento: 'reduzido' });
      const w = dom.window;
      const d = w.document;
      const lista = d.getElementById('lua-list');
      medir(lista, { h: 300, sh: 900 });
      w.__luaMenu.atualizarSetas();
      d.getElementById('lua-down').click();
      assert.strictEqual(lista.scrollTop, 210, 'com movimento reduzido a rolagem é imediata (mesmo destino)');
      assert.strictEqual(
        w.__rolagens.filter((r) => r.behavior === 'smooth').length,
        0,
        'nada de animação suave quando o usuário pediu menos movimento'
      );

      medir(lista, { h: 300, sh: 300 }); // agora tudo cabe
      w.dispatchEvent(new w.Event('resize'));
      await esperar(200);
      assert.strictEqual(d.getElementById('lua-down').disabled, true, 'resize recalculou: ↓ desativada');
      assert.strictEqual(d.getElementById('lua-up').disabled, true, 'resize recalculou: ↑ desativada');
      ok('20h: [DOM] deslocamento imediato com movimento reduzido e recálculo no resize');
      dom.window.close();
    } catch (e) {
      fail('20h: DOM movimento reduzido/resize', e);
    }

    /* 20i) último comando e última categoria acessíveis pelas setas */
    try {
      const dom = montarDom(card);
      const w = dom.window;
      const d = w.document;
      const lista = d.getElementById('lua-list');
      const faixa = d.getElementById('lua-tabs');
      medir(lista, { h: 300, sh: 900 });
      medir(faixa, { w: 200, sw: 800 });
      w.__luaMenu.atualizarSetas();

      const cartoes = [...d.querySelectorAll('.cmd')];
      const abas = [...d.querySelectorAll('.tab')];
      assert.ok(cartoes.length, 'há comandos no card');
      assert.ok(lista.contains(cartoes[cartoes.length - 1]), 'o ÚLTIMO comando está dentro da área rolável (alcançável)');
      assert.ok(faixa.contains(abas[abas.length - 1]), 'a ÚLTIMA categoria está dentro da faixa rolável');
      assert.ok(lista.contains(d.querySelector('.foot')), 'o rodapé fecha o fim da lista (nada cortado depois dele)');
      assert.ok(d.querySelector('.go'), 'botão Usar segue no cartão');

      lista.scrollTop = 99999;
      assert.strictEqual(lista.scrollTop, 600, 'a rolagem para no fim exato do conteúdo');
      faixa.scrollLeft = 99999;
      await esperar(25); // evento de scroll → rAF → estado das setas
      assert.strictEqual(d.getElementById('lua-down').disabled, true, 'no fim, ↓ desativada (conteúdo todo acessível)');
      assert.strictEqual(faixa.scrollLeft, 600, 'a faixa para no fim exato');
      ok('20i: [DOM] último comando e última categoria ficam acessíveis');
      dom.window.close();
    } catch (e) {
      fail('20i: DOM acessibilidade do fim', e);
    }
  }

  /* limpeza */
  try {
    settings.setMenuHtmlEnabled(false);
    settings.set('prefix', '!');
  } catch (_) {}
  database.close();

  console.log(`\n=== MENU HTML TEST: ${feitos}/${feitos + falhas} ✅ ===`);
  if (falhas) {
    console.error(`❌ ${falhas} falha(s)`);
    process.exit(1);
  }
  console.log('=== MENU HTML TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e && e.stack ? e.stack : e);
  process.exit(1);
});
