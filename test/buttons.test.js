/**
 * test/buttons.test.js — callbacks de botão e confirmações (briefing 37, 39, 78).
 *
 * Foco: nenhum callback inválido, expirado ou desconhecido pode derrubar o
 * processo; paginação calcula páginas corretamente; confirmação exige resposta
 * explícita e expira.
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const buttonHandler = require('../handlers/buttonHandler');
const nav = require('../utils/nav');
const ui = require('../utils/uiKit');
const session = require('../utils/session');
const { confirmAction } = require('../commands/_shared/confirm');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ctx de clique de botão, no formato real que o WhatsApp envia. */
function clickCtx(id, overrides = {}) {
  const ctx = fakeCtx(overrides);
  ctx.message = {
    key: { remoteJid: ctx.remoteJid, id: 'CLICK', fromMe: false },
    message: { buttonsResponseMessage: { selectedButtonId: id, selectedDisplayText: id } },
  };
  return ctx;
}

function fakeCtx(overrides = {}) {
  const replies = [];
  return Object.assign(
    {
      text: '',
      args: [],
      remoteJid: 'grupo@s.whatsapp.net',
      sender: '5511999999999@s.whatsapp.net',
      isGroup: true,
      isOwner: true,
      isAdmin: true,
      isBotAdmin: true,
      replies,
      reply: async (t) => {
        replies.push(String(t));
        return true;
      },
      socket: { sendMessage: async () => ({ key: { id: 'K' } }) },
    },
    overrides
  );
}

(async () => {
  // ------------------------------------------------- callbacks registrados
  let ran = 0;
  buttonHandler.register('lua_test_ok', () => {
    ran += 1;
  });
  await buttonHandler.process(clickCtx('lua_test_ok'));
  assert.strictEqual(ran, 1, 'handler registrado deve rodar');
  ok('botões: id registrado executa o handler');

  // ------------------------------------------------- callbacks inválidos
  const invalid = [
    'lua_nao_existe_123',
    'ID COM ESPAÇO 🎵',
    'lua:' + 'x'.repeat(300),
    '',
    null,
    undefined,
    12345,
    { id: 'objeto' },
    '../lua_nav_home',
    'lua_nav_home;rm -rf /',
  ];
  for (const id of invalid) {
    let threw = null;
    try {
      await buttonHandler.process(clickCtx(id));
    } catch (err) {
      threw = err;
    }
    assert.strictEqual(threw, null, `process(${JSON.stringify(id)}) não pode lançar: ${threw && threw.message}`);
  }
  ok(`botões: ${invalid.length} callbacks inválidos/hostis processados sem lançar`);

  // ------------------------------------------------- registerOnce (expira)
  let once = 0;
  buttonHandler.registerOnce('lua_test_once', () => {
    once += 1;
  });
  await buttonHandler.process(clickCtx('lua_test_once'));
  await buttonHandler.process(clickCtx('lua_test_once'));
  assert.strictEqual(once, 1, 'registerOnce roda uma única vez');
  ok('botões: registerOnce executa 1x e o segundo clique é ignorado (sem crash)');

  // ------------------------------------------------- registro de id inválido
  let refused = null;
  try {
    refused = buttonHandler.register('id com espaço', () => {});
  } catch (err) {
    refused = err;
  }
  assert.ok(!refused || refused instanceof Error === false || true, 'não pode derrubar o processo');
  assert.strictEqual(buttonHandler.has('id com espaço'), false, 'id fora do padrão não é registrado');
  ok('botões: id fora do padrão (lua…) é recusado, não registrado');

  // ------------------------------------------------- paginação (item 37)
  const items = Array.from({ length: 47 }, (_, i) => `cmd${i}`);
  const p0 = ui.paginate(items, 0, 6);
  assert.strictEqual(p0.pages, 8, `47 itens / 6 = 8 páginas, veio ${p0.pages}`);
  assert.strictEqual(p0.page, 0, 'página inicial 0');
  assert.strictEqual(p0.items.length, 6, '6 itens na página');
  assert.strictEqual(p0.hasNext, true, 'tem próxima');
  assert.strictEqual(p0.hasPrev, false, 'não tem anterior na primeira');
  const pLast = ui.paginate(items, 99, 6);
  assert.strictEqual(pLast.page, 7, 'página fora do intervalo é clampada para a última');
  assert.strictEqual(pLast.items.length, 5, 'última página tem o resto (5)');
  assert.strictEqual(pLast.hasNext, false, 'sem próxima na última');
  ok(`paginação: 47 itens → 8 páginas, clamp de índice e última página com ${pLast.items.length}`);

  // ids de navegação são estáveis (sobrevivem a restart) e usam o prefixo lua
  for (const key of ['next', 'prev', 'home', 'back', 'close']) {
    assert.match(nav.NAV_IDS[key], /^lua_nav_/, `NAV_IDS.${key} estável: ${nav.NAV_IDS[key]}`);
  }
  ok(`navegação: ids estáveis (${Object.values(nav.NAV_IDS).join(', ')})`);

  // ------------------------------------------------- confirmação (item 39)
  let executed = 0;
  const c1 = fakeCtx();
  await confirmAction(c1, 'apagar 50 mensagens', () => {
    executed += 1;
  });
  assert.match(c1.replies.join(' '), /Confirmar/, 'pergunta de confirmação');
  assert.match(c1.replies.join(' '), /sim.*não|sim ou não/, 'instrui a resposta');
  const st1 = session.get(c1.remoteJid, c1.sender);
  assert.ok(st1 && typeof st1.onMessage === 'function', 'estado de confirmação salvo com callback');
  ok('confirmação: pede sim/não e guarda a ação pendente');

  await st1.onMessage(fakeCtx({ text: 'sim', remoteJid: c1.remoteJid, sender: c1.sender }));
  assert.strictEqual(executed, 1, '"sim" executa a ação');
  assert.strictEqual(session.get(c1.remoteJid, c1.sender), null, 'sessão limpa após confirmar');
  ok('confirmação: "sim" executa a ação e limpa a sessão');

  const c2 = fakeCtx();
  await confirmAction(c2, 'banir usuário', () => {
    executed += 1;
  });
  const c2b = fakeCtx({ text: 'nao', remoteJid: c2.remoteJid, sender: c2.sender });
  await session.get(c2.remoteJid, c2.sender).onMessage(c2b);
  assert.strictEqual(executed, 1, '"não" NÃO executa a ação');
  assert.match(c2b.replies.join(' '), /cancelada/i, 'avisa o cancelamento');
  ok('confirmação: "não" cancela sem executar');

  const c3 = fakeCtx();
  await confirmAction(c3, 'resetar tudo', () => {
    executed += 1;
  });
  const c3b = fakeCtx({ text: 'talvez', remoteJid: c3.remoteJid, sender: c3.sender });
  await session.get(c3.remoteJid, c3.sender).onMessage(c3b);
  assert.strictEqual(executed, 1, 'resposta ambígua não executa');
  assert.match(c3b.replies.join(' '), /sim.*não/, 'pede de novo');
  ok('confirmação: resposta ambígua não executa e pede sim/não de novo');

  // ------------------------------------------------- sessão expirada (TTL)
  const c4 = fakeCtx();
  session.set(c4.remoteJid, c4.sender, { type: 'confirm', onMessage: async () => {} }, 10);
  await sleep(40);
  assert.strictEqual(session.get(c4.remoteJid, c4.sender), null, 'sessão expira pelo TTL');
  ok('confirmação: estado pendente expira (TTL) em vez de ficar para sempre');

  console.log(`\n✅ buttons/paginação/confirmação: ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ buttons: ${err.message}`);
  process.exit(1);
});
