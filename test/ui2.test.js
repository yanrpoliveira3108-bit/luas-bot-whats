/**
 * test/ui2.test.js — fonts, dividers, icons e uiKit (Lua 2.0).
 * Cobre: Unicode, fallback, string vazia, especiais/emojis, comandos protegidos,
 * truncamento por code point, paginação e componentes visuais.
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const fonts = require('../utils/fonts');
const divider = require('../utils/dividers');
const icons = require('../utils/icons');
const ui = require('../utils/uiKit');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`✅ ${n}: ${label}`);
};

/* ------------------------------ fonts ------------------------------ */
{
  assert.strictEqual(fonts.apply('LUA BOT', 'boldScript'), '𝓛𝓤𝓐 𝓑𝓞𝓣');
  assert.strictEqual(fonts.apply('fonte', 'mono'), '𝚏𝚘𝚗𝚝𝚎');
  assert.strictEqual(fonts.apply('fonte', 'bold'), '𝐟𝐨𝐧𝐭𝐞');
  assert.strictEqual(fonts.apply('fonte', 'boldFraktur'), '𝖋𝖔𝖓𝖙𝖊');
  assert.strictEqual(fonts.apply('fonte', 'double'), '𝕗𝕠𝕟𝕥𝕖');
  ok('fonts: estilos Unicode mapeados (bold/script/mono/fraktur/double)');

  // fallback: emoji, acento e símbolo sem equivalente permanecem
  const mixed = fonts.apply('ação 🌙 ✓', 'boldScript');
  assert.ok(mixed.includes('🌙'), 'emoji deve sobreviver');
  assert.ok(mixed.includes('✓'), 'símbolo sem equivalente deve sobreviver');
  assert.ok(!mixed.includes('?'), 'não pode virar "?"');
  ok('fonts: fallback preserva emoji/acentos/símbolos');

  // string vazia / null / estilo inexistente
  assert.strictEqual(fonts.apply('', 'bold'), '');
  assert.strictEqual(fonts.apply(null, 'bold'), '');
  assert.strictEqual(fonts.apply(undefined, 'bold'), '');
  assert.strictEqual(fonts.apply('abc', 'naoExiste'), 'abc');
  ok('fonts: string vazia e estilo desconhecido não quebram');

  // proteção: comando e URL não são estilizados
  const safe = fonts.safe('Use !play música e veja https://lua.bot/x', 'boldScript');
  assert.strictEqual(safe, '𝓤𝓼𝓮 !play música 𝓮 𝓿𝓮𝓳𝓪 https://lua.bot/x', `saída inesperada: ${safe}`);
  assert.ok(safe.includes('!play música'), 'comando E argumento ficam copiáveis');
  assert.ok(safe.includes('https://lua.bot/x'), 'URL deve ficar intacta');
  assert.ok(safe.includes('𝓤'), 'texto decorativo foi estilizado');
  const jid = fonts.safe('jid 5511999990000@s.whatsapp.net', 'bold');
  assert.ok(jid.includes('5511999990000@s.whatsapp.net'), 'jid não pode ser estilizado');
  ok('fonts.safe: comandos, URLs e jids ficam copiáveis');

  // length por code point
  assert.strictEqual(fonts.length('🌙'), 1);
  assert.strictEqual(fonts.length('𝓛𝓤𝓐'), 3);
  ok('fonts.length conta por code point (não corta emoji)');
}

/* ----------------------------- dividers ----------------------------- */
{
  const cats = divider.categories();
  for (const need of ['floral', 'dark', 'minimal', 'music', 'cute', 'royal', 'warning', 'box', 'wave', 'heavy', 'anime', 'cyber', 'classic']) {
    assert.ok(cats.includes(need), `categoria ${need} ausente`);
  }
  assert.ok(divider.count() >= 40, `esperava dezenas de estilos, veio ${divider.count()}`);
  for (const c of cats) {
    for (const s of divider.of(c)) {
      assert.ok(typeof s === 'string' && s.length > 0, 'estilo vazio');
      assert.ok(Buffer.byteLength(s, 'utf8') > 0, 'UTF-8 inválido');
    }
  }
  ok(`dividers: ${cats.length} categorias / ${divider.count()} estilos, todos UTF-8 válidos`);

  // alternância (não repete sempre o mesmo) e random
  const a = divider('music');
  const b = divider('music');
  assert.notStrictEqual(a, b, 'divider() deve variar entre estilos');
  assert.ok(divider.of('music').includes(divider.random('music')), 'random deve sair do catálogo');
  ok('dividers: divider() alterna e divider.random() usa o catálogo');

  // caixa com título
  const box = divider.box('PLAY');
  assert.ok(box.top.startsWith('╔') && box.bottom.startsWith('╚'));
  assert.ok(box.body.includes('PLAY'));
  assert.strictEqual(box.top.length, box.bottom.length, 'caixa deve ser simétrica');
  ok('dividers.box: caixa simétrica com título');

  // string literal passa direto + largura
  assert.strictEqual(divider('─────', 10).length, 10);
  ok('dividers: aceita separador literal e padding de largura');
}

/* ------------------------------- icons ------------------------------- */
{
  for (const k of ['success', 'error', 'warning', 'loading', 'music', 'video', 'sticker', 'group', 'admin', 'download', 'search', 'owner', 'system', 'info']) {
    assert.ok(icons.get(k) && icons.get(k) !== icons.FALLBACK, `ícone ${k} ausente`);
  }
  assert.strictEqual(icons.forCategory('stickers'), '🎨');
  assert.strictEqual(icons.forCategory('naoExiste'), icons.FALLBACK);
  assert.strictEqual(icons.theme('music').divider, 'music');
  ok('icons: semânticos, por categoria e temas por contexto');
}

/* ------------------------------- uiKit ------------------------------- */
{
  const h = ui.header('PLAY', 'music');
  assert.ok(h.includes('𝓟𝓛𝓐𝓨'), `título estilizado: ${h}`);
  assert.ok(h.split('\n').length === 3, 'header tem 3 linhas');
  ok('ui.header: caixa + fonte, sem montar template na mão');

  const c = ui.card('INFO', [['Versão', '2.0'], ['Comandos', 318]], 'system');
  assert.ok(c.includes('Versão') && c.includes('318'));
  assert.ok(c.startsWith('╭') && c.includes('╰'), 'card tem bordas');
  ok('ui.card: linhas chave/valor com bordas');

  assert.strictEqual(ui.progress(0), '▱▱▱▱▱▱▱▱▱▱ 0%');
  assert.strictEqual(ui.progress(100), '▰▰▰▰▰▰▰▰▰▰ 100%');
  assert.strictEqual(ui.progress(50).split(' ')[1], '50%');
  assert.strictEqual(ui.progress(-20), '▱▱▱▱▱▱▱▱▱▱ 0%');
  assert.strictEqual(ui.progress(999), '▰▰▰▰▰▰▰▰▰▰ 100%');
  assert.ok(ui.progressBar(30).includes('█'));
  ok('ui.progress: barra real com clamp 0..100');

  // truncate por code point
  assert.strictEqual(ui.truncate('🌙🌙🌙', 2), '🌙…');
  assert.strictEqual(ui.truncate('abc', 10), 'abc');
  ok('ui.truncate não corta emoji no meio');

  // safeText: "\n" escapado, controles, excesso de quebras
  const st = ui.safeText('a\\nb\u0000c\n\n\n\nd');
  assert.ok(!st.includes('\\n') && !st.includes('\u0000'), 'limpa escape e controle');
  assert.ok(!/\n{3,}/.test(st), 'colapsa quebras');
  ok('ui.safeText: normaliza \\n escapado, controles e quebras');

  // paginação
  const p = ui.paginate(Array.from({ length: 25 }, (_, i) => i), 1, 10);
  assert.strictEqual(p.pages, 3);
  assert.strictEqual(p.items.length, 10);
  assert.strictEqual(p.items[0], 10);
  assert.strictEqual(p.hasNext, true);
  assert.strictEqual(p.hasPrev, true);
  const last = ui.paginate([1, 2], 99, 10);
  assert.strictEqual(last.page, 0, 'página fora do rango é corrigida');
  ok('ui.paginate: páginas, slice e limites');

  // mensagens uniformes
  const err = ui.error('Falhou', { reason: 'TIMEOUT', hint: 'tente novamente' });
  assert.ok(err.includes('ERRO') && err.includes('TIMEOUT') && err.startsWith('╭'));
  assert.ok(!err.includes('/home/') && !err.includes('node_modules'), 'não vaza caminho');
  assert.ok(ui.success('feito').includes('✅'));
  assert.ok(ui.loading('Buscando').includes('Buscando'));
  assert.ok(ui.permission().includes('permissão'), 'texto padrão de permissão');
  assert.ok(ui.permission('Só administradores', { need: 'admin do grupo' }).includes('Só administradores'));
  assert.ok(ui.notFound('stiker', ['sticker']).includes('sticker'));
  ok('ui.messages: error/success/loading/permission/notFound uniformes');

  // botão sanitizado
  const btn = ui.button('lua:suggest_play', '!play\nmúsica muito grande');
  assert.ok(!btn.text.includes('\n'), 'rótulo sem quebra');
  assert.ok(fonts.length(btn.text) <= 24, 'rótulo <= 24');
  ok('ui.button: id + rótulo dentro do limite do WhatsApp');
}

console.log(`\n✅ ui2 (fonts/dividers/icons/uiKit): ${n} verificações, 0 falhas`);
process.exit(0);
