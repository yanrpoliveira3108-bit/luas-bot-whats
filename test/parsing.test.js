/**
 * test/parsing.test.js — helpers puros de parsing de argumentos.
 *
 * Cobre a classe de bug que impedia !pagar/!presente de funcionar: o parser
 * mantém a menção dentro de `args`, então ler o valor pela posição 0 quando há
 * menção significa ler o texto "@fulano".
 *
 * Sem banco, sem socket: são funções puras de utils/messages.js.
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
const { dropMentionArgs, toPositiveInt, splitCommand } = require('../utils/messages');

const results = [];
function check(label, fn) {
  try {
    fn();
    results.push([label, true]);
    console.log('  ✔ ' + label);
  } catch (err) {
    results.push([label, false, err.message]);
    console.log('  ✘ ' + label + ' → ' + err.message);
  }
}

const ALVO = '5511988887777@s.whatsapp.net';
const OUTRO = '5511911112222@s.whatsapp.net';

console.log('══════════ PARSING TEST ══════════');

/* --------------------------------------------------- premissa do bug */
check('splitCommand mantém a menção dentro de args (premissa do bug)', () => {
  const parsed = splitCommand('!pagar @5511988887777 150', '!');
  assert.deepStrictEqual(parsed.args, ['@5511988887777', '150']);
  assert.strictEqual(parsed.command, 'pagar');
});

/* ------------------------------------------------------ dropMentionArgs */
check('dropMentionArgs: remove a menção e deixa o valor na posição 0', () => {
  assert.deepStrictEqual(dropMentionArgs(['@5511988887777', '150'], [ALVO]), ['150']);
});

check('dropMentionArgs: funciona com o valor antes da menção', () => {
  assert.deepStrictEqual(dropMentionArgs(['150', '@5511988887777'], [ALVO]), ['150']);
});

check('dropMentionArgs: remove também apelidos digitados (@nome)', () => {
  assert.deepStrictEqual(dropMentionArgs(['@fulano', '150'], [ALVO]), ['150']);
});

check('dropMentionArgs: remove as duas menções quando há duas', () => {
  const args = ['@5511988887777', '@5511911112222', '30'];
  assert.deepStrictEqual(dropMentionArgs(args, [ALVO, OUTRO]), ['30']);
});

check('dropMentionArgs: sem menção não muda nada', () => {
  assert.deepStrictEqual(dropMentionArgs(['peixe', '2'], []), ['peixe', '2']);
  assert.deepStrictEqual(dropMentionArgs(['peixe', '2'], undefined), ['peixe', '2']);
});

check('dropMentionArgs: menção sozinha devolve array vazio', () => {
  assert.deepStrictEqual(dropMentionArgs(['@5511988887777'], [ALVO]), []);
});

check('dropMentionArgs: não muta o array original', () => {
  const original = ['@5511988887777', '150'];
  dropMentionArgs(original, [ALVO]);
  assert.deepStrictEqual(original, ['@5511988887777', '150'], 'o array do ctx foi mutado');
});

check('dropMentionArgs: tolera entrada inválida sem lançar', () => {
  assert.deepStrictEqual(dropMentionArgs(null, [ALVO]), []);
  assert.deepStrictEqual(dropMentionArgs(undefined, null), []);
  assert.deepStrictEqual(dropMentionArgs(['10'], 'nao-e-array'), ['10']);
});

/* -------------------------------------------------------- toPositiveInt */
check('toPositiveInt: aceita inteiro positivo', () => {
  assert.strictEqual(toPositiveInt('150'), 150);
  assert.strictEqual(toPositiveInt('  77  '), 77, 'espaços ao redor devem ser tolerados');
  assert.strictEqual(toPositiveInt(250), 250, 'número também deve passar');
});

check('toPositiveInt: rejeita o que parseInt aceitaria e truncaria', () => {
  assert.strictEqual(toPositiveInt('1.5'), null, 'parseInt devolveria 1');
  assert.strictEqual(toPositiveInt('1e3'), null);
  assert.strictEqual(toPositiveInt('-5'), null);
  assert.strictEqual(toPositiveInt('0'), null);
  assert.strictEqual(toPositiveInt('abc'), null);
  assert.strictEqual(toPositiveInt(''), null);
});

check('toPositiveInt: rejeita vazio/nulo e inteiro fora do range seguro', () => {
  assert.strictEqual(toPositiveInt(null), null);
  assert.strictEqual(toPositiveInt(undefined), null);
  assert.strictEqual(toPositiveInt('9007199254740993'), null);
});

check('toPositiveInt: não aceita menção disfarçada de valor', () => {
  assert.strictEqual(toPositiveInt('@5511988887777'), null);
});

/* ---------------------------------------- o cenário do bug, ponta a ponta */
check('cenário do bug: com o helper o valor é lido corretamente', () => {
  const parsed = splitCommand('!pagar @5511988887777 150', '!');
  const args = dropMentionArgs(parsed.args, [ALVO]);
  assert.strictEqual(toPositiveInt(args[0]), 150, 'o valor lido não é 150');
});

check('cenário do bug: sem o helper o valor lido seria NaN', () => {
  const parsed = splitCommand('!pagar @5511988887777 150', '!');
  assert.ok(Number.isNaN(parseInt(parsed.args[0], 10)), 'a premissa do bug mudou');
});

const falhas = results.filter(([, ok]) => !ok);
console.log(`\n=== PARSING TEST: ${results.length - falhas.length} passou, ${falhas.length} falhou ===`);
if (falhas.length) {
  for (const [l, , e] of falhas) console.log('  FALHA: ' + l + ' — ' + e);
  process.exitCode = 1;
} else {
  console.log('=== PARSING TEST: TUDO OK ===');
}
