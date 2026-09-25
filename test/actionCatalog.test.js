'use strict';

const assert = require('assert');
const actionImage = require('../utils/actionImage');

function fakeCtx() {
  const calls = [];
  return {
    calls,
    reply: async (text, opts) => {
      calls.push({ method: 'reply', text, opts });
      return true;
    },
    sendImage: async (filePath, caption, opts) => {
      calls.push({ method: 'sendImage', filePath, caption, opts });
      return true;
    },
    sendVideo: async (filePath, caption, opts) => {
      calls.push({ method: 'sendVideo', filePath, caption, opts });
      return true;
    },
  };
}

(async () => {
  console.log('=== TESTES DO ACTION CATALOG & ACTION IMAGE ===');

  // 1. Compatibilidade com resolvePath
  assert.strictEqual(typeof actionImage.resolvePath('beijo'), 'string', 'resolve beijo');
  assert.strictEqual(actionImage.resolvePath('nao_existe_xyz'), null, 'não existe retorna null');
  console.log('✅ 1: resolvePath legado preservado');

  // 2. Catalog has items for keys
  const catalog = actionImage.catalog;
  assert.ok(catalog, 'actionImage.catalog exportado');
  const expectedKeys = ['beijo', 'bater', 'sirrica', 'siririca', 'gado', 'abraco', 'tapinha', 'cafune', 'zoar'];
  for (const k of expectedKeys) {
    const items = actionImage.getItems(k);
    assert.ok(Array.isArray(items) && items.length >= 5, `key ${k} tem ao menos 5 itens (tem ${items ? items.length : 0})`);
    const gifs = items.filter(it => it.type === 'gif');
    const imgs = items.filter(it => it.type === 'image');
    assert.ok(gifs.length >= 3, `key ${k} tem ao menos 3 gifs (tem ${gifs.length})`);
    assert.ok(imgs.length >= 2, `key ${k} tem ao menos 2 imagens (tem ${imgs.length})`);
  }
  console.log('✅ 2: catálogo com 3 GIFs e 2 imagens para comandos principais');

  // 3. Anti-immediate repetition
  const first = actionImage.pickMedia('beijo');
  const second = actionImage.pickMedia('beijo');
  assert.notStrictEqual(first.path, second.path, 'duas chamadas seguidas não repetem a mesma mídia');
  console.log('✅ 3: anti-repetição imediata funciona');

  // 4. Envio com GIF chama sendVideo({ gifPlayback: true }) e fallback para sendImage / reply
  const ctxNormal = fakeCtx();
  await actionImage.send(ctxNormal, 'beijo', 'Legenda de teste', ['123@s.whatsapp.net']);
  assert.strictEqual(ctxNormal.calls.length, 1);
  const sent = ctxNormal.calls[0];
  assert.ok(['sendVideo', 'sendImage'].includes(sent.method), 'enviou vídeo ou imagem');
  assert.strictEqual(sent.caption, 'Legenda de teste');
  assert.deepStrictEqual(sent.opts.mentions, ['123@s.whatsapp.net']);
  if (sent.method === 'sendVideo') {
    assert.strictEqual(sent.opts.gifPlayback, true, 'gifPlayback habilitado');
  }
  console.log('✅ 4: envio com mídia e opções de menções');

  // 5. Fallback gracioso se ctx.sendVideo e ctx.sendImage falharem
  const ctxFail = fakeCtx();
  ctxFail.sendVideo = async () => { throw new Error('Falha de vídeo'); };
  ctxFail.sendImage = async () => { throw new Error('Falha de imagem'); };
  await actionImage.send(ctxFail, 'beijo', 'Legenda fallback');
  assert.strictEqual(ctxFail.calls[0].method, 'reply', 'caiu no reply');
  assert.strictEqual(ctxFail.calls[0].text, 'Legenda fallback');
  console.log('✅ 5: fallback de erro envia apenas texto sem crash');

  // 6. Ação sem mídia registrada cai direto no reply
  const ctxNoMedia = fakeCtx();
  await actionImage.send(ctxNoMedia, 'chave_inexistente_123', 'Só texto');
  assert.strictEqual(ctxNoMedia.calls.length, 1);
  assert.strictEqual(ctxNoMedia.calls[0].method, 'reply');
  assert.strictEqual(ctxNoMedia.calls[0].text, 'Só texto');
  console.log('✅ 6: chave sem mídia envia reply direto');

  console.log('TODOS OS TESTES PASSARAM COM SUCESSO! 🎉');
})();
