'use strict';

const assert = require('assert');
const { normalizeMediaInfo, buildHtmlPlay } = require('../utils/htmlPlay');

const url = 'https://www.youtube.com/watch?v=x&list=1';
const title = 'Teste "Ao Vivo" & It\'s <Live> 🚀';
const info = normalizeMediaInfo({
  title,
  author: 'Artista & Canal',
  url,
  duration: '03:42',
  views: 0,
  mimetype: 'audio/mp4',
}, { kind: 'audio' });
const html = buildHtmlPlay({ ...info, thumbnail: '' }, '.', {
  audio: 'ytmp3',
  video: 'ytmp4',
  lyrics: 'letra',
  search: 'play',
});

function decode(value) {
  return value
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const copies = [...html.matchAll(/<button data-copy="([^"]*)">/g)].map((m) => decode(m[1]));
const copyInfo = [
  `Título: ${title}`,
  'Autor: Artista & Canal',
  'Duração: 03:42',
  'Visualizações: 0',
  `Link: ${url}`,
].join('\n');

assert.strictEqual(copies.length, 7, 'HTML PLAY deve gerar os sete botões de cópia');
assert.deepStrictEqual(copies, [
  url,
  title,
  copyInfo,
  `.ytmp3 ${url}`,
  `.ytmp4 ${url}`,
  `.letra ${title}`,
  `.play ${title}`,
]);
assert.ok(html.includes('&lt;Live&gt;'), 'conteúdo externo deve ser escapado no HTML');
assert.ok(html.includes('&quot;Ao Vivo&quot;'), 'aspas devem ser escapadas');
assert.ok(html.includes('&#10;'), 'quebras de linha devem ser preservadas no atributo');
assert.ok(html.includes('navigator.clipboard'));
assert.ok(html.includes('Promise.resolve'));
assert.ok(html.includes('document.execCommand'));
assert.ok(html.includes('event.preventDefault'));
assert.ok(html.includes('event.stopPropagation'));
console.log('✅ HTML PLAY: sete ações de cópia, escaping e fallback validados');
