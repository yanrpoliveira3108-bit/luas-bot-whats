/**
 * test/cards.test.js — sistema reutilizável de templates de imagem.
 *
 * Cobre o contrato do módulo utils/cards:
 *  - devolve Buffer JPEG não vazio;
 *  - avatar válido/inválido/ausente nunca derruba o render;
 *  - dados ausentes, texto longo e Unicode não quebram;
 *  - o envio (sendCard) cai no fallback quando não há imagem ou socket;
 *  - caches têm teto (fontes) e o semáforo devolve os slots.
 *
 * Não usa rede nem banco: as cards recebem os dados prontos.
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-cards.db');

const Jimp = require('jimp');
const cards = require('../utils/cards');
const kit = require('../utils/imageKit');

const results = [];
async function check(label, fn) {
  try {
    await fn();
    results.push([label, true]);
    console.log('  ✔ ' + label);
  } catch (err) {
    results.push([label, false, err.message]);
    console.log('  ✘ ' + label + ' → ' + err.message);
  }
}

async function fotoValida() {
  const p = new Jimp(200, 200, 0x2f6fedff);
  return p.getBufferAsync(Jimp.MIME_PNG);
}

function isJpeg(buf) {
  return Buffer.isBuffer(buf) && buf.length > 500 && buf[0] === 0xff && buf[1] === 0xd8;
}

(async () => {
  console.log('══════════ CARDS TEST ══════════');

  await check('profile: retorna Buffer JPEG não vazio', async () => {
    const buf = await cards.renderProfileCard({ name: 'Teste', level: 5, xp: 10, xpNext: 100 });
    assert.ok(isJpeg(buf), 'não é JPEG ou está vazio');
  });

  await check('rank: retorna Buffer JPEG não vazio', async () => {
    const buf = await cards.renderRankCard({ name: 'Teste', position: 3, total: 99, xp: 10, level: 2 });
    assert.ok(isJpeg(buf));
  });

  await check('level: retorna Buffer JPEG não vazio', async () => {
    const buf = await cards.renderLevelCard({ name: 'Teste', level: 7, xp: 30, xpNext: 60 });
    assert.ok(isJpeg(buf));
  });

  await check('avatar válido: render usa a foto sem quebrar', async () => {
    const buf = await cards.renderProfileCard({ avatar: await fotoValida(), name: 'ComFoto' });
    assert.ok(isJpeg(buf));
  });

  await check('avatar inválido (lixo): cai no padrão sem lançar', async () => {
    const buf = await cards.renderProfileCard({ avatar: Buffer.from('nao-é-imagem'), name: 'SemFoto' });
    assert.ok(isJpeg(buf));
  });

  await check('avatar ausente: usa o padrão (placeholder)', async () => {
    const buf = await cards.renderProfileCard({ name: 'SemAvatar' });
    assert.ok(isJpeg(buf));
  });

  await check('dados ausentes: só o nome ainda renderiza', async () => {
    assert.ok(isJpeg(await cards.renderProfileCard({})));
    assert.ok(isJpeg(await cards.renderRankCard({})));
    assert.ok(isJpeg(await cards.renderLevelCard({})));
  });

  await check('texto longo é truncado e não estoura a card', async () => {
    const nomeLongo = 'A'.repeat(300) + ' fim';
    const buf = await cards.renderProfileCard({ name: nomeLongo, level: 1 });
    assert.ok(isJpeg(buf));
  });

  await check('nome com Unicode/emoji não quebra a fonte bitmap', async () => {
    const buf = await cards.renderLevelCard({ name: 'Usuário 😀 Áéíõç 🚀', level: 3, xp: 1, xpNext: 10 });
    assert.ok(isJpeg(buf));
  });

  await check('cache de fontes respeita o teto (sem cache infinito)', async () => {
    // carrega todos os nomes conhecidos do kit
    for (const k of Object.keys(kit.FONTS)) await kit.loadFont(k);
    const usados = cards.stats().fonts;
    assert.ok(usados >= 1, 'nenhuma fonte ficou em cache');
    assert.ok(usados <= kit.MAX_FONTS, `cache com ${usados} fontes (teto ${kit.MAX_FONTS})`);
  });

  await check('semáforo devolve os slots após os renders', async () => {
    const st = cards.stats();
    assert.strictEqual(st.active, 0, 'slot vazou ativo');
    assert.strictEqual(st.waiting, 0, 'fila não esvaziou');
    assert.strictEqual(st.max, 2, 'limite de concorrência mudou');
  });

  await check('concorrência limitada: nunca mais de 2 renders ativos', async () => {
    let pico = 0;
    const medir = async () => {
      pico = Math.max(pico, cards.stats().active);
      await cards.renderLevelCard({ name: 'C', level: 1, xp: 1, xpNext: 2 });
      pico = Math.max(pico, cards.stats().active);
    };
    await Promise.all([medir(), medir(), medir(), medir(), medir(), medir()]);
    assert.ok(pico <= 2, `pico de concorrência ${pico} > 2`);
  });

  await check('sendCard sem imagem devolve false (fallback em texto)', async () => {
    const enviados = [];
    const ctx = { remoteJid: 'x@g.us', socket: { sendMessage: async (j, p) => { enviados.push(p); } } };
    assert.strictEqual(await cards.sendCard(ctx, null, 'cap'), false, 'deveria pedir fallback');
    assert.strictEqual(enviados.length, 0, 'não deveria ter enviado');
  });

  await check('sendCard com imagem envia o payload certo', async () => {
    const enviados = [];
    const ctx = { remoteJid: 'x@g.us', socket: { sendMessage: async (j, p) => { enviados.push({ j, p }); } } };
    const buf = await cards.renderLevelCard({ name: 'X', level: 1, xp: 1, xpNext: 2 });
    assert.strictEqual(await cards.sendCard(ctx, buf, 'cap'), true);
    assert.strictEqual(enviados[0].j, 'x@g.us');
    assert.strictEqual(enviados[0].p.image, buf, 'o buffer não foi enviado');
  });

  await check('sendCard com socket quebrado vira false (não lança)', async () => {
    const ctx = { remoteJid: 'x@g.us', socket: { sendMessage: async () => { throw new Error('kaboom'); } } };
    const buf = await cards.renderLevelCard({ name: 'X', level: 1, xp: 1, xpNext: 2 });
    assert.strictEqual(await cards.sendCard(ctx, buf, 'cap'), false);
  });

  const falhas = results.filter(([, ok]) => !ok);
  console.log(`\n=== CARDS TEST: ${results.length - falhas.length} passou, ${falhas.length} falhou ===`);
  if (falhas.length) {
    for (const [l, , e] of falhas) console.log('  FALHA: ' + l + ' — ' + e);
    process.exitCode = 1;
  } else {
    console.log('=== CARDS TEST: TUDO OK ===');
  }
})().catch((err) => {
  console.error('CARDS TEST quebrou:', err);
  process.exitCode = 1;
});
