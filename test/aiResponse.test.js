'use strict';

const assert = require('assert');
const { splitLongMessage } = require('../utils/aiResponse');

const input = `Parágrafo inicial.\n\n${'á🙂 conteúdo '.repeat(1200)}\n\nfinal.`;
const chunks = splitLongMessage(input, 4000);
assert.ok(chunks.length > 1);
assert.strictEqual(chunks.join('').replace(/```\n/g, '').replace(/\n```/g, ''), input);
assert.ok(chunks.every((c) => c.length <= 4005));

const code = 'antes\n```js\n' + 'const valor = 1;\n'.repeat(500) + '```\ndepois';
const codeChunks = splitLongMessage(code, 1000);
assert.ok(codeChunks.length > 1);
assert.ok(codeChunks.every((c) => (c.match(/```/g) || []).length % 2 === 0));
assert.ok(codeChunks.join('\n').includes('const valor = 1;'));

const url = `https://example.com/${'x'.repeat(9000)}`;
assert.strictEqual(splitLongMessage(url, 1000).join(''), url);
console.log('aiResponse.test.js: OK');
