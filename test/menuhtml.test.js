#!/usr/bin/env node
/**
 * test/menuhtml.test.js — menus em HTML + `!modohtml`.
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
 *  8) navegação (abas) e busca presentes no card
 *  9) argumento inválido não altera nada
 * 10) fallback: erro no envio → menu tradicional (sem repetir envio)
 * 11) `!menu --texto` força o tradicional mesmo com o modo ligado
 * 12) modo seguro bloqueia o card e o modo volta ao tradicional
 * 13) nenhum botão decorativo: comando só-de-grupo não vira link
 * 14) escapagem de conteúdo dinâmico (descrição com HTML)
 * 15) modo desligado NÃO carrega menus/html (require preguiçoso)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-menuhtml-test.db');

let failures = 0;
function ok(l) {
  console.log('✅ ' + l);
}
function fail(l, e) {
  failures++;
  console.log('❌ ' + l + ' — ' + (e && e.message));
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
    assert.ok(
      ctx.replies.some((r) => /dono/i.test(r)),
      'recebeu a negativa de dono'
    );

    // sem argumento, qualquer pessoa consulta o estado
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
      { cwd: require('path').resolve(__dirname, '..'), timeout: 30000 }
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
    assert.ok(html.includes('>#menucompleto<'), 'rodapé usa o prefixo real');
    assert.ok(html.includes('<code>#'), 'cartões usam o prefixo real');
    assert.ok(!html.includes('>!menu<'), 'não sobrou prefixo fixo');
    assert.ok(html.includes('Prefixo <b>#</b>'), 'cabeçalho mostra o prefixo real');
    settings.set('prefix', '!');
    ok('5: prefixo vem da configuração real (testado com "#")');
  } catch (e) {
    fail('5: prefixo dinâmico', e);
  }

  /* 6) templates por menu, gerados do registro */
  try {
    const { registry } = require('../engine/plugins');
    const data = require('../menus/html/data');
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

    // contagem bate com o registro (fonte única)
    const noRegistro = (registry.byCategory().get('downloads') || []).filter((c) => !c.hidden).length;
    assert.strictEqual(download.grupo.categorias[0].count, noRegistro, 'contagem vem do registro');

    // nomes/aliases atuais preservados: o primeiro trigger do comando aparece
    const alvo = (registry.byCategory().get('downloads') || [])[0];
    const trigger = (alvo.commands && alvo.commands[0]) || alvo.name;
    assert.ok(download.html.includes(`!${trigger}`), `comando ${trigger} listado pelo trigger atual`);

    // comando novo no registro aparece sozinho no HTML (nada de lista paralela)
    registry.registerCommand(
      { name: 'testehtmlxyz', commands: ['testehtmlxyz'], category: 'downloads', description: 'Comando de teste.', usage: '!testehtmlxyz', execute: async () => {} },
      'downloads'
    );
    const depois = htmlMenu.montarDocumento(ctx, { kind: 'categoria', categoria: 'downloads' });
    assert.ok(depois.html.includes('!testehtmlxyz'), 'comando novo aparece sem editar template');
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
    assert.ok(bytes < 100000, `payload dentro do teto (${(bytes / 1024).toFixed(1)} KB)`);
    assert.ok(html.includes('Mostrando '), 'card avisa quando cortou comandos');

    // estrutura do card (mesmo caminho do !ping2/!tigrinho)
    const msg = require('../utils/richHtml').buildHtmlMessage(html, { title: 'teste' });
    const rich = msg.botForwardedMessage.message.richResponseMessage;
    assert.ok(rich, 'botForwardedMessage → richResponseMessage');
    assert.strictEqual(rich.messageType, 1, 'tipo padrão (1)');
    assert.strictEqual(rich.submessages[0].messageType, 2, 'submessage de texto (2)');
    assert.ok(rich.unifiedResponse.data instanceof Buffer, 'unifiedResponse.data é Buffer');
    const json = JSON.parse(rich.unifiedResponse.data.toString('utf8'));
    const prim = json.sections[0].view_model.primitive;
    assert.strictEqual(prim.__typename, 'GenAIaeacdsnwHtmlPrimitive', 'primitiva de HTML');
    assert.ok(prim.payload.includes('<!doctype html>'), 'payload leva o documento');
    ok(`7: payload correto e limitado (${(bytes / 1024).toFixed(1)} KB)`);
  } catch (e) {
    fail('7: payload', e);
  }

  /* 8) navegação e busca no card */
  try {
    const ctx = fakeCtx();
    const { html, grupo } = htmlMenu.montarDocumento(ctx, { kind: 'main' });
    const abas = (html.match(/class="tab"/g) || []).length;
    const secoes = (html.match(/class="sec"/g) || []).length;
    assert.strictEqual(abas, grupo.categorias.length, 'uma aba por categoria');
    assert.strictEqual(secoes, grupo.categorias.length, 'uma seção por categoria');
    assert.ok(html.includes('id="lua-q"'), 'campo de busca presente');
    assert.ok(html.includes('showTab'), 'JS de navegação presente');
    assert.ok(html.includes('__find'), 'JS de busca presente');
    assert.ok(html.includes('id="lua-top"'), 'botão de voltar ao topo');
    ok('8: abas, busca e retorno ao topo no mesmo card');
  } catch (e) {
    fail('8: navegação', e);
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
    const ctx = fakeCtx({ isOwner: true, args: ['--texto'], socket: null });
    ctx.socket = fakeCtx().socket;
    await menuCmd.execute(ctx);
    assert.ok(
      ctx.replies.some((r) => /MENU PRINCIPAL|menu/i.test(r)),
      'respondeu o menu tradicional em texto'
    );
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

  /* 13) sem botão decorativo: comando só-de-grupo não vira link */
  try {
    const { registry } = require('../engine/plugins');
    const ctx = fakeCtx({ botId: '5511977776666:3@s.whatsapp.net' });
    const admin = htmlMenu.montarDocumento(ctx, { kind: 'categoria', categoria: 'admin' });
    const semGrupo = (registry.byCategory().get('admin') || []).filter((c) => !c.groupOnly && !c.adminOnly && !c.botAdmin);
    const soGrupo = (registry.byCategory().get('admin') || []).filter((c) => c.groupOnly || c.adminOnly || c.botAdmin);
    assert.ok(soGrupo.length > 0, 'a categoria admin tem comandos só-de-grupo');

    // um comando só-de-grupo NÃO pode ter link
    const alvo = soGrupo[0];
    const trigger = (alvo.commands && alvo.commands[0]) || alvo.name;
    const idx = admin.html.indexOf(`!${trigger}<`);
    assert.ok(idx > 0, 'comando listado');
    const artigo = admin.html.slice(admin.html.lastIndexOf('<article', idx), admin.html.indexOf('</article>', idx));
    assert.ok(!/wa\.me/.test(artigo), `${trigger} (só no grupo) não tem link`);
    assert.ok(/contexto do grupo/.test(artigo), `${trigger} explica que roda no grupo`);

    // e um comando do privado TEM link com o número do BOT
    if (semGrupo.length) {
      const t2 = (semGrupo[0].commands && semGrupo[0].commands[0]) || semGrupo[0].name;
      assert.ok(admin.html.includes(`https://wa.me/5511977776666?text=`), 'link wa.me usa o número do bot');
    }
    ok('13: nada de botão decorativo — só link quando o comando funciona no privado');
  } catch (e) {
    fail('13: links', e);
  }

  /* 14) escapagem de conteúdo dinâmico */
  try {
    const { registry } = require('../engine/plugins');
    registry.registerCommand(
      {
        name: 'testexss',
        commands: ['testexss'],
        category: 'downloads',
        description: '"><script>alert(1)</script>',
        usage: '!testexss',
        execute: async () => {},
      },
      'downloads'
    );
    const ctx = fakeCtx();
    const { html } = htmlMenu.montarDocumento(ctx, { kind: 'categoria', categoria: 'downloads' });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'script injetado não aparece cru');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'descrição escapada');
    // o único <script> real é o do menu
    assert.strictEqual((html.match(/<script>/g) || []).length, 1, 'apenas o script do menu');
    assert.ok(!/"><script/.test(html), 'atributo não é quebrado pelo conteúdo');
    registry.unregisterCommand('testexss');
    ok('14: conteúdo dinâmico escapado por contexto');
  } catch (e) {
    fail('14: escapagem', e);
  }

  /* 15) modo desligado não carrega menus/html */
  try {
    settings.setMenuHtmlEnabled(false);
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${require('path').sep}menus${require('path').sep}html`)) delete require.cache[k];
    }
    const ctx = fakeCtx();
    const enviado = await menuFormat.abrir(ctx, { kind: 'main' });
    assert.strictEqual(enviado, false, 'desligado: não envia');
    const carregou = Object.keys(require.cache).some((k) => k.includes(`${require('path').sep}menus${require('path').sep}html`));
    assert.strictEqual(carregou, false, 'menus/html NÃO foi carregado com o modo desligado');
    ok('15: com o modo desligado os templates HTML nem são carregados');
  } catch (e) {
    fail('15: carregamento preguiçoso', e);
  }

  /* 16) integração: `!menu` e `!menuadm` entregam o card (nada de texto junto) */
  try {
    settings.setMenuHtmlEnabled(true);
    const menuCmd = require('../commands/general/menu').find((c) => c.name === 'menu');
    const ctxMenu = fakeCtx({ isOwner: true });
    await menuCmd.execute(ctxMenu);
    assert.strictEqual(ctxMenu.enviados.length, 1, '!menu enviou UM card');
    const msg = ctxMenu.enviados[0].message;
    assert.ok(msg.botForwardedMessage, 'usa o caminho de card HTML');
    const html = JSON.parse(
      msg.botForwardedMessage.message.richResponseMessage.unifiedResponse.data.toString('utf8')
    ).sections[0].view_model.primitive.payload;
    assert.ok(html.includes('🌙'), 'card tem a identidade do bot');
    assert.ok(/Geral|MENU/i.test(html), 'card tem a categoria');
    assert.ok(!ctxMenu.replies.some((r) => /MENU PRINCIPAL/.test(r)), 'não mandou o menu de texto junto');

    // atalho !menuadm abre direto a categoria admin
    const adm = require('../commands/general/menus').find((c) => c.name === 'menuadm');
    const ctxAdm = fakeCtx({ isOwner: true });
    await adm.execute(ctxAdm);
    assert.strictEqual(ctxAdm.enviados.length, 1, '!menuadm enviou UM card');
    const htmlAdm = JSON.parse(
      ctxAdm.enviados[0].message.botForwardedMessage.message.richResponseMessage.unifiedResponse.data.toString('utf8')
    ).sections[0].view_model.primitive.payload;
    assert.ok(htmlAdm.includes('data-cat="admin"'), 'menuadm abre a categoria admin');
    assert.ok(!htmlAdm.includes('data-cat="downloads"'), 'menuadm não traz outras categorias');
    ok('16: !menu e !menuadm entregam o card pelo pipeline real do comando');
  } catch (e) {
    fail('16: integração', e);
  }

  /* limpeza */
  try {
    settings.setMenuHtmlEnabled(false);
    settings.set('prefix', '!');
  } catch (_) {}
  database.close();

  console.log(`\n=== MENU HTML TEST: ${16 - failures}/16 ✅ ===`);
  if (failures) {
    console.error(`❌ ${failures} falha(s)`);
    process.exit(1);
  }
  console.log('=== MENU HTML TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e && e.stack ? e.stack : e);
  process.exit(1);
});
