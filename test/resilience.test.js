/**
 * test/resilience.test.js — timeout, retry, máquina de estados, progresso e
 * limpeza de temporários (itens 18, 46, 47, 50, 86 e 87).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const { withTimeout, retry, isPermanent } = require('../utils/resilience');
const sm = require('../utils/stateMachine');
const progressMod = require('../utils/progress');
const tmp = require('../utils/tmpCleaner');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`✅ ${n}: ${label}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  /* ------------------------------ withTimeout ------------------------------ */
  {
    const t0 = Date.now();
    await assert.rejects(() => withTimeout(sleep(500), 80, 'teste-lento'), /tempo limite de 80ms/);
    assert.ok(Date.now() - t0 < 400, 'deve abortar perto do limite, não esperar os 500ms');
    ok('withTimeout: promise lenta é cancelada no limite');

    const value = await withTimeout(Promise.resolve(42), 1000, 'rápida');
    assert.strictEqual(value, 42);
    ok('withTimeout: promise rápida resolve normal');

    // função com signal: o abort chega de verdade
    let aborted = false;
    await assert.rejects(
      () =>
        withTimeout(({ signal }) => {
          return new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              const e = new Error('abortado');
              e.name = 'AbortError';
              reject(e);
            });
          });
        }, 60, 'fn-signal'),
      /tempo limite de 60ms/
    );
    assert.strictEqual(aborted, true, 'o signal deve ter sido abortado');
    ok('withTimeout: AbortSignal é propagado para a função');
  }

  /* -------------------------------- retry -------------------------------- */
  {
    let calls = 0;
    const out = await retry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
        return 'ok';
      },
      { retries: 3, baseDelayMs: 5, maxDelayMs: 20, label: 'transitorio' }
    );
    assert.strictEqual(out, 'ok');
    assert.strictEqual(calls, 3, 'deve tentar até dar certo');
    ok('retry: erro transitório é repetido até o sucesso');

    // permanente não repete
    let calls2 = 0;
    await assert.rejects(
      () =>
        retry(
          async () => {
            calls2++;
            throw Object.assign(new Error('token inválido'), { code: 'AUTH_FAILED' });
          },
          { retries: 3, baseDelayMs: 1, label: 'permanente' }
        ),
      /token inválido/
    );
    assert.strictEqual(calls2, 1, 'erro permanente NÃO pode ser repetido');
    assert.strictEqual(isPermanent(Object.assign(new Error('x'), { status: 404 })), true);
    assert.strictEqual(isPermanent(Object.assign(new Error('x'), { code: 'ECONNRESET' })), false);
    ok('retry: erro permanente (auth/404/input) não é repetido');

    // esgota as tentativas
    let calls3 = 0;
    await assert.rejects(
      () =>
        retry(
          async () => {
            calls3++;
            throw Object.assign(new Error('instável'), { code: 'ECONNRESET' });
          },
          { retries: 2, baseDelayMs: 1, maxDelayMs: 5 }
        ),
      /instável/
    );
    assert.strictEqual(calls3, 3, '2 retries = 3 tentativas');
    ok('retry: respeita o número de tentativas e devolve o último erro');
  }

  /* ---------------------------- máquina de estados ---------------------------- */
  {
    const m = sm.create('SEARCHING');
    assert.strictEqual(m.label(), 'BUSCANDO');
    m.to('FOUND', { videoId: 'abc' });
    assert.strictEqual(m.meta.videoId, 'abc');
    assert.strictEqual(m.can('DONE'), false, 'não pode pular etapa');
    assert.throws(() => m.to('DONE'), (e) => e.code === 'INVALID_TRANSITION');
    m.to('DOWNLOADING').to('CONVERTING').to('UPLOADING').to('DONE');
    assert.strictEqual(m.settled(), true);
    assert.strictEqual(m.path(), 'SEARCHING → FOUND → DOWNLOADING → CONVERTING → UPLOADING → DONE');
    ok('stateMachine: transições válidas, meta e histórico');

    const e = sm.create('SEARCHING');
    e.fail(new Error('rede caiu'));
    assert.strictEqual(e.state, 'ERROR');
    assert.strictEqual(e.error, 'rede caiu');
    assert.strictEqual(e.settled(), true);
    const e2 = sm.create('DOWNLOADING');
    e2.to('ERROR');
    assert.throws(() => e2.to('UPLOADING'), (err) => err.code === 'INVALID_TRANSITION');
    ok('stateMachine: qualquer estado → ERROR, e ERROR é terminal');
  }

  /* ------------------------------ progresso ------------------------------ */
  {
    const replies = [];
    const sent = [];
    const ctx = {
      remoteJid: 'j1@s.whatsapp.net',
      socket: {
        sendMessage: async (jid, payload) => {
          sent.push(payload);
          return { key: { id: `K${sent.length}` } };
        },
      },
      reply: async (t) => replies.push(t),
    };

    const p1 = await progressMod.progressMessage(ctx, { key: 'play:abc', title: 'PLAY', category: 'music', state: 'BUSCANDO' });
    assert.ok(sent.length === 1, 'primeira pintura envia 1 mensagem');
    assert.ok(sent[0].text.includes('BUSCANDO'), 'mostra o estado real');
    assert.ok(!/\d+%/.test(sent[0].text), 'sem porcentagem inventada');

    const p2 = await progressMod.progressMessage(ctx, { key: 'play:abc', title: 'PLAY' });
    assert.strictEqual(p1, p2, 'mesma chave reusa a mensagem (sem concorrência)');
    assert.strictEqual(progressMod.activeCount(), 1);
    ok('progress: 1 operação = 1 mensagem (reuso por chave)');

    await p1.state('BAIXANDO');
    await p1.update({ percent: 40, label: 'Baixando áudio' });
    await p1.update({ percent: 100 });
    assert.ok(sent[sent.length - 1].text.includes('100%'), 'percentual real aparece');
    assert.ok(p1.edits >= 2, 'usou edição em vez de spam');
    ok('progress: update com progresso real e edição da mesma mensagem');

    await p1.complete('🎵 Concluído');
    assert.ok(replies.some((r) => r.includes('Concluído')), 'mensagem final enviada');
    assert.strictEqual(progressMod.activeCount(), 0, 'tracker liberado ao concluir');
    ok('progress: complete/fail encerram e liberam o estado');

    const p3 = await progressMod.progressMessage(ctx, { key: 'play:fail', title: 'PLAY', maxLifeMs: 5 });
    await sleep(20);
    assert.strictEqual(progressMod.sweep(), 1, 'expirado é coletado pelo GC');
    assert.strictEqual(p3.done, false);
    ok('progress: estado expira (TTL) e é coletado — nada eterno');
  }

  /* ---------------------------- temporários ---------------------------- */
  {
    const dir = tmp.TMP_DIR;
    const created = await tmp.withTempFile({ prefix: 'teste', ext: 'webp' }, async (file) => {
      fs.writeFileSync(file, 'x'.repeat(10));
      assert.ok(fs.existsSync(file), 'arquivo criado dentro de tmp/');
      assert.ok(file.startsWith(dir), 'nunca sai do diretório permitido');
      return file;
    });
    assert.strictEqual(fs.existsSync(created), false, 'cleanup no finally removeu o arquivo');
    ok('tmpCleaner.withTempFile: create → use → cleanup garantido');

    // erro no meio também limpa
    const failed = await tmp
      .withTempFile({ prefix: 'teste-erro' }, async (file) => {
        fs.writeFileSync(file, 'x');
        throw new Error('conversão falhou');
        return file;
      })
      .catch((e) => e.message);
    assert.strictEqual(failed, 'conversão falhou');
    const leftovers = fs.readdirSync(dir).filter((f) => f.startsWith('teste-erro'));
    assert.deepStrictEqual(leftovers, [], 'erro não pode deixar resíduo');
    ok('tmpCleaner: falha na conversão não deixa arquivo abandonado');

    // varredura de órfãos antigos (tmp + lixo na raiz)
    const old = path.join(dir, `lua-orfao-${Date.now()}.tmp`);
    fs.writeFileSync(old, 'lixo');
    const oldTime = new Date(Date.now() - 9 * 60 * 60 * 1000);
    fs.utimesSync(old, oldTime, oldTime);
    const card = path.join(process.cwd(), 'card-orfao-teste.jpg');
    fs.writeFileSync(card, 'lixo');
    fs.utimesSync(card, oldTime, oldTime);
    const importante = path.join(process.cwd(), 'arquivo-importante.txt');
    fs.writeFileSync(importante, 'nao apagar');
    fs.utimesSync(importante, oldTime, oldTime);

    const res = await tmp.sweepOrphans({ maxAgeMs: 60 * 60 * 1000 });
    assert.ok(res.removed >= 2, `esperava remover os órfãos, removeu ${res.removed}`);
    assert.strictEqual(fs.existsSync(old), false, 'tmp/ antigo removido');
    assert.strictEqual(fs.existsSync(card), false, 'card-*.jpg órfão removido');
    assert.strictEqual(fs.existsSync(importante), true, 'arquivo fora da allowlist preservado');
    fs.rmSync(importante, { force: true });
    ok('tmpCleaner.sweepOrphans: remove órfãos e preserva o resto');
  }

  console.log(`\n✅ resilience/state/progress/tmp: ${n} verificações, 0 falhas`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err && err.stack ? err.stack : err);
  process.exit(1);
});
