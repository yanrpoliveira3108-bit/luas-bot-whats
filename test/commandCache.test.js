/**
 * test/commandCache.test.js — cache O(1) de comandos + busca + fuzzy (itens 8,
 * 14, 15, 16, 62).
 *
 * Fuzzy coberto com distâncias 0/1/2/3/>3, aliases, comando inexistente,
 * empate entre sugestões e comando oculto/desabilitado.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const TEST_DB = path.resolve(__dirname, '..', 'database', 'lua-cmdcache-test.db');
process.env.DATABASE_FILE = TEST_DB;
for (const suf of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(TEST_DB + suf, { force: true });
  } catch (_) {}
}

const CONFIG = require('../config');
CONFIG.helpers.ensureDirs();

const database = require('../database/database');
database.open();

const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

const cache = require('../utils/commandCache');
const fuzzy = require('../utils/fuzzySearch');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`✅ ${n}: ${label}`);
};

/* --------------------------- cache de comandos --------------------------- */
{
  const stats = cache.stats();
  assert.ok(stats.commands > 300, `registry deveria ter os comandos todos (veio ${stats.commands})`);
  assert.strictEqual(stats.commands, registry.count(), 'cache espelha o registry');
  assert.ok(stats.triggers >= stats.commands, 'todo comando tem ao menos 1 trigger');

  const t0 = Date.now();
  for (let i = 0; i < 20000; i++) cache.resolve('play');
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1000, `20k lookups deveriam ser O(1), levou ${elapsed}ms`);
  ok(`commandCache: ${stats.commands} comandos / ${stats.triggers} triggers / ${stats.tokens} tokens (20k lookups em ${elapsed}ms)`);

  // resolve por nome e por alias
  assert.strictEqual(cache.resolve('play').name, 'play');
  assert.strictEqual(cache.resolve('PLAY').name, 'play', 'case-insensitive');
  const help = cache.get('help');
  assert.ok(help, 'help existe');
  for (const alias of help.commands || []) {
    assert.strictEqual(cache.resolve(alias).name, help.name, `alias ${alias} resolve para help`);
  }
  assert.strictEqual(cache.resolve('comandoquenaoexiste'), null, 'trigger inexistente → null');
  ok('commandCache: nome e aliases resolvem em O(1), inexistente → null');

  // categorias
  const cats = cache.categories();
  assert.ok(cats.length >= 10, `esperava várias categorias, veio ${cats.length}`);
  const stickers = cache.byCategory('stickers');
  assert.ok(stickers.length > 0 && stickers.every((c) => c.category === 'stickers'));
  ok(`commandCache.byCategory: ${cats.length} categorias indexadas`);

  // busca por nome/alias/categoria/descrição (item 8)
  const bySticker = cache.search('sticker');
  assert.ok(bySticker.length > 0, 'busca "sticker" precisa achar algo');
  assert.ok(
    bySticker.slice(0, 6).every((c) => /sticker|stick|figu|emoji|take/i.test(`${c.name} ${(c.commands || []).join(' ')} ${c.description}`)),
    `"sticker" deve retornar só coisas de sticker: ${bySticker.slice(0, 6).map((c) => c.name)}`
  );
  const byCat = cache.search('admin');
  assert.ok(byCat.some((c) => c.category === 'admin'), 'busca por categoria funciona');
  const byDesc = cache.search('advertência');
  assert.ok(byDesc.length > 0, 'busca por descrição (com acento) funciona');
  const byMusic = cache.search('musica');
  assert.ok(byMusic.some((c) => /play|ytmp3|audio|song|yt/i.test(c.name)), 'busca "musica" acha música');
  assert.deepStrictEqual(cache.search(''), [], 'busca vazia não devolve nada');
  ok('commandCache.search: nome, alias, categoria e descrição (sem acento/case)');
}

/* -------------------------------- fuzzy -------------------------------- */
{
  const all = registry.all();

  // distância 0 (o comando existe)
  assert.strictEqual(fuzzy.levenshtein('ping', 'ping'), 0);
  // distância 1
  assert.strictEqual(fuzzy.levenshtein('stiker', 'sticker'), 1);
  const d1 = fuzzy.findSimilarCommands('stiker', all, 3);
  assert.ok(d1.length > 0 && d1[0].cmd.name === 'sticker', `d=1 deve sugerir sticker: ${JSON.stringify(d1.map((d) => d.cmd.name))}`);
  assert.strictEqual(d1[0].distance, 1);
  // distância 2 (transposição)
  assert.strictEqual(fuzzy.levenshtein('stikcer', 'sticker'), 2);
  const d2 = fuzzy.findSimilarCommands('stikcer', all, 3);
  assert.strictEqual(d2[0].cmd.name, 'sticker', 'd=2 ainda sugere sticker');
  // distância 3 (limite aceito)
  assert.strictEqual(fuzzy.levenshtein('stik', 'sticker'), 3);
  const d3 = fuzzy.findSimilarCommands('stik', all, 3);
  assert.ok(d3.length > 0, 'd=3 é o limite e ainda sugere');
  assert.ok(d3.every((d) => d.distance <= 3 || d.trigger.includes('stik') || 'stik'.includes(d.trigger)), 'nada acima do limite');
  // distância > 3 → nenhuma sugestão absurda
  const far = fuzzy.findSimilarCommands('xyzabc123', all, 3);
  assert.deepStrictEqual(far, [], 'string distante não pode gerar sugestão');
  ok('fuzzy: distâncias 0/1/2/3 aceitas e >3 descartadas');

  // aliases entram na comparação
  const byAlias = fuzzy.findSimilarCommands('ajudda', all, 3);
  assert.ok(byAlias.length > 0, 'alias deve ser considerado');
  assert.strictEqual(byAlias[0].cmd.name, 'help', `esperava help via alias, veio ${byAlias[0].cmd.name}`);
  assert.strictEqual(byAlias[0].trigger, 'ajuda', 'o trigger sugerido é o alias digitado errado');
  ok('fuzzy: aliases são candidatos (ajudda → ajuda)');

  // empate resolvido de forma determinística (não pela ordem de carregamento)
  const tie = fuzzy.findSimilarCommands('pingg', all, 3);
  assert.strictEqual(tie[0].cmd.name, 'ping', `empate deve preferir "ping", veio ${tie[0].cmd.name}`);
  const again = fuzzy.findSimilarCommands('pingg', all, 3);
  assert.deepStrictEqual(
    tie.map((t) => t.cmd.name),
    again.map((a) => a.cmd.name),
    'resultado deve ser estável entre chamadas'
  );
  ok('fuzzy: empate determinístico (pingg → ping, estável)');

  // comando oculto/desabilitado não vaza para a busca (marca um de verdade)
  const target = registry.resolveTrigger('ping');
  const wasHidden = target.hidden;
  target.hidden = true;
  cache.invalidate();
  assert.ok(!cache.search('ping').some((c) => c.name === 'ping'), 'comando oculto não pode aparecer na busca');
  target.hidden = wasHidden;
  cache.invalidate();
  assert.ok(cache.search('ping').some((c) => c.name === 'ping'), 'voltou a aparecer após invalidate');
  ok('busca: comando oculto é excluído e invalidate() atualiza o cache');

  // limite configurável
  const limited = fuzzy.findSimilarCommands('stik', all, 1);
  assert.strictEqual(limited.length, 1, 'limit é respeitado');
  ok('fuzzy: limit respeitado');
}

/* --------------------------- ajuda pesquisável --------------------------- */
{
  // !help <comando> precisa existir para qualquer comando do registry
  const help = registry.resolveTrigger('help');
  assert.ok(help && typeof help.execute === 'function', 'help registrado');
  // todo comando tem os metadados mínimos (item 36)
  let missing = 0;
  const required = ['name', 'category', 'description'];
  for (const cmd of registry.all()) {
    for (const k of required) if (!cmd[k]) missing++;
    if (!Array.isArray(cmd.commands) || !cmd.commands.length) missing++;
  }
  assert.strictEqual(missing, 0, `${missing} comandos sem metadados mínimos`);
  ok(`help/registry: ${registry.count()} comandos com metadados mínimos (name/category/description/commands)`);
}

for (const suf of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(TEST_DB + suf, { force: true });
  } catch (_) {}
}
database.close();

console.log(`\n✅ commandCache/fuzzy: ${n} verificações, 0 falhas`);
process.exit(0);
