#!/usr/bin/env node
/**
 * test/temahtml.test.js — aparência dos menus HTML (!temahtml / utils/htmlTheme)
 * e painel de identificação (utils/menuIdentity + components.painelIdentidade).
 *
 * Tudo com banco temporário; o card é gerado pelo MESMO montarDocumento usado
 * no envio real (nenhum WhatsApp envolvido).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-temahtml-test.db');
fs.rmSync(DB, { force: true });
process.env.DATABASE_FILE = DB;
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || '5519911112222';
require('../database/database').open();
require('../commands/loader').loadCommands(true);

const CONFIG = require('../config');
const htmlTheme = require('../utils/htmlTheme');
const identity = require('../utils/menuIdentity');
const comp = require('../menus/html/components');
const htmlMenu = require('../menus/html');
const { buildCss } = require('../menus/html/styles');
const settings = require('../database/settings');

let falhas = 0;
let feitos = 0;
async function caso(nome, fn) {
  try {
    await fn();
    feitos++;
    console.log('✅ ' + nome);
  } catch (e) {
    falhas++;
    console.log('❌ ' + nome + ' — ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}

const cmd = [].concat(require('../commands/general/temahtml')).find((c) => c.name === 'temahtml');
async function rodar(args, { dono = true } = {}) {
  let resposta = '';
  await cmd.execute({ args, prefix: settings.effectivePrefix(), isOwner: dono, isGroup: true, reply: async (t) => (resposta = t) });
  return resposta;
}
function ctxMenu(extra = {}) {
  return {
    socket: { user: { id: '5519988887777:3@s.whatsapp.net', lid: '999888777666555:3@lid', name: 'Lua Oficial' } },
    remoteJid: '120363000000000001@g.us',
    sender: '5511999999999@s.whatsapp.net',
    message: { pushName: 'Maria' },
    isGroup: true,
    isOwner: false,
    prefix: '!',
    args: [],
    ...extra,
  };
}

(async () => {
  await caso('1: cores aceitas só #RGB/#RRGGBB, normalizadas', () => {
    assert.strictEqual(htmlTheme.normalizarCor('#abc'), '#AABBCC');
    assert.strictEqual(htmlTheme.normalizarCor('#11aa33'), '#11AA33');
    for (const r of ['red', '#12', '#1234', 'rgb(1,2,3)', '#GGGGGG', '', null, '#11aa33;}']) {
      assert.strictEqual(htmlTheme.normalizarCor(r), null, String(r));
    }
  });

  await caso('2: paleta derivada tem contraste legível (texto ≥ 4.5, botão ≥ 4.5)', () => {
    for (const p of htmlTheme.listarPresets()) {
      const pal = htmlTheme.derivarPaleta(p.bg, p.primary, p.secondary);
      assert.ok(htmlTheme.contraste(pal['--lua-text'], p.bg) >= 4.5, p.id + ' texto');
      assert.ok(htmlTheme.contraste(pal['--lua-on-primary'], pal['--lua-primary']) >= 4.5, p.id + ' botão');
    }
    // combinação ruim do usuário (destaque quase igual ao fundo) ainda fica legível
    const pal = htmlTheme.derivarPaleta('#111111', '#161616', null);
    assert.ok(htmlTheme.contraste(pal['--lua-text'], '#111111') >= 4.5);
  });

  await caso('3: status/temas liberados para qualquer um', async () => {
    const st = await rodar([], { dono: false });
    assert.ok(/GLOBAL/.test(st) && /Emojis decorativos: ligados/.test(st), st);
    const lista = await rodar(['temas'], { dono: false });
    assert.ok(lista.includes('roxo-verde') && lista.includes('claro') && lista.includes('mono'));
  });

  await caso('4: alterar é só do dono (nada é gravado)', async () => {
    const antes = settings.get('menu_html_visual', null);
    const r = await rodar(['cores', '#111', '#EF4444'], { dono: false });
    assert.strictEqual(r, CONFIG.messages.deniedOwner);
    assert.strictEqual(settings.get('menu_html_visual', null), antes);
  });

  await caso('5: entrada inválida não altera nada (mesmo para o dono)', async () => {
    await rodar(['aplicar', 'roxo-verde']);
    const antes = JSON.stringify(htmlTheme.get());
    for (const args of [['cores', 'vermelho', '#fff'], ['cores', '#111'], ['cores', '#111', '#111'], ['aplicar', 'nada'], ['emojis', 'talvez'], ['fonte', 'comic'], ['xyz']]) {
      const r = await rodar(args);
      assert.ok(/Nada foi alterado/.test(r), args.join(' ') + ' → ' + r);
    }
    assert.strictEqual(JSON.stringify(htmlTheme.get()), antes);
  });

  await caso('6: mudar UMA propriedade preserva as outras', async () => {
    await rodar(['restaurar']);
    await rodar(['cores', '#111111', '#EF4444', '#A855F7']);
    await rodar(['fonte', 'mono']);
    await rodar(['emojis', 'off']);
    const v = htmlTheme.get();
    assert.deepStrictEqual(
      { bg: v.bg, primary: v.primary, secondary: v.secondary, font: v.font, emojis: v.emojis },
      { bg: '#111111', primary: '#EF4444', secondary: '#A855F7', font: 'mono', emojis: false }
    );
    await rodar(['cores', '#000', '#22D3EE']);
    const w = htmlTheme.get();
    assert.strictEqual(w.font, 'mono');
    assert.strictEqual(w.emojis, false);
    assert.strictEqual(w.secondary, null);
  });

  await caso('7: restaurar mexe SÓ no visual do card', async () => {
    settings.setMenuHtmlEnabled(true);
    const prefixo = settings.effectivePrefix();
    const r = await rodar(['restaurar']);
    assert.ok(/restaurada/.test(r));
    assert.deepStrictEqual(htmlTheme.get(), { preset: null, bg: null, primary: null, secondary: null, emojis: true, font: 'padrao' });
    assert.strictEqual(settings.menuHtmlEnabled(), true);
    assert.strictEqual(settings.effectivePrefix(), prefixo);
  });

  await caso('8: CSS padrão idêntico ao de antes; override só com configuração', async () => {
    const semArg = buildCss();
    assert.strictEqual(buildCss({ visual: htmlTheme.get() }), semArg);
    assert.ok(!/color-scheme/.test(semArg));
    htmlTheme.aplicarPreset('claro');
    htmlTheme.set({ font: 'serif' });
    const css = buildCss({ visual: htmlTheme.get() });
    assert.ok(/color-scheme:light/.test(css));
    assert.ok(/--lua-font:/.test(css));
    assert.ok(!/<|>/.test(htmlTheme.cssOverrides()), 'sem tags no CSS');
    // regras que protegem o tamanho do card continuam
    assert.ok(!/transform:\s*scale|zoom:/.test(css));
    htmlTheme.restaurar();
  });

  await caso('9: emojis off removem os decorativos NA ORIGEM (botões mantêm texto)', async () => {
    htmlTheme.set({ emojis: false });
    const { html } = htmlMenu.montarDocumento(ctxMenu(), {});
    assert.ok(html.includes('data-emojis="0"'));
    assert.ok(!html.includes('class="logo"'));
    assert.ok(!html.includes('class="ico"'));
    // o 🔎 do rótulo de busca existe no <script>, mas é condicional a data-emojis
    const semScript = html.replace(/<script[\s\S]*?<\/script>/g, '');
    assert.ok(!semScript.includes('🔎'));
    assert.ok(html.includes('getAttribute("data-emojis")==="0"'));
    assert.ok(/>Usar</.test(html), 'botão Usar');
    assert.ok(html.includes('id="lua-up"') && html.includes('id="lua-cat-next"'), 'setas');
    htmlTheme.set({ emojis: true });
    const com = htmlMenu.montarDocumento(ctxMenu(), {}).html;
    assert.ok(com.includes('class="logo"') && com.includes('class="ico"') && !com.includes('data-emojis="0"'));
  });

  await caso('10: identidade — nome, dono, conta conectada, prefixo', () => {
    const id = identity.coletar(ctxMenu());
    assert.strictEqual(id.solicitante.texto, 'Maria');
    assert.strictEqual(id.prefixo, settings.effectivePrefix());
    assert.strictEqual(id.dono.texto, identity.formatarTelefone(CONFIG.owner.numbers[0]));
    assert.ok(/^\+55 19 98888.?7777$/.test(id.bot.numero), id.bot.numero);
    assert.strictEqual(id.bot.nome, 'Lua Oficial');
  });

  await caso('11: LID nunca vira telefone; sem dados → texto honesto', () => {
    assert.strictEqual(identity.digitosDePn('123456789012345@lid'), null);
    assert.strictEqual(identity.digitosDePn('120363000000000001@g.us'), null);
    const id = identity.coletar(ctxMenu({ message: {}, sender: '123456789012345@lid', identidades: ['123456789012345@lid'], socket: { user: { lid: '1@lid' } } }));
    assert.strictEqual(id.solicitante.texto, null);
    assert.strictEqual(id.bot.numero, null);
    const html = comp.painelIdentidade(id, { total: 3 });
    assert.ok(html.includes('não identificado') && html.includes('indisponível'));
    assert.ok(!html.includes('123456789012345'));
  });

  await caso('12: nomes escapados e limitados (sem HTML injetado)', () => {
    const id = identity.coletar(ctxMenu({ message: { pushName: '<img src=x onerror=alert(1)>' + 'A'.repeat(80) } }));
    assert.ok(id.solicitante.texto.length <= identity.MAX_NOME + 1);
    const html = comp.painelIdentidade(id, {});
    assert.ok(!html.includes('<img'), html);
    assert.ok(html.includes('&lt;img'));
  });

  await caso('13: painel presente no card (principal e submenu), prefixo efetivo', () => {
    settings.set('prefix', '#');
    for (const opts of [{}, { foco: 'general' }]) {
      const { html } = htmlMenu.montarDocumento(ctxMenu(), opts);
      assert.ok(html.includes('class="idp"'), 'painel');
      assert.ok(html.includes('Prefixo <b>#</b>'));
      assert.ok(html.includes('Pedido por <b>Maria</b>'));
      assert.ok(html.includes(`Dono <b>${identity.formatarTelefone(CONFIG.owner.numbers[0])}</b>`));
      assert.ok(html.includes('Bot <b>+55 19 98888'));
      assert.ok(!html.includes('999888777666555'), 'LID do bot não aparece');
    }
  });

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  try {
    require('../database/database').close();
  } catch (_) {}
  fs.rmSync(DB, { force: true });
  process.exit(falhas ? 1 : 0);
})();
