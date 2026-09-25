'use strict';

const assert = require('assert');
const { formatPlayDetailCard } = require('../utils/mediaPresentation');
const playPresentation = require('../utils/playPresentation');

const card = formatPlayDetailCard({
  title: 'Oriente - Vida Longa Mundo Pequeno',
  artist: 'Oriente',
  channel: 'Oriente Oficial',
  duration: '05:16',
  views: 0,
  likes: null,
  publishDate: '2024-05-02',
  description: 'Descrição curta da fonte. #hashtag https://example.invalid não deve virar uma lista enorme.',
  url: 'https://www.youtube.com/watch?v=selected123',
  prefix: ',',
});

assert.ok(card.includes('🎙️ Artista: Oriente'));
assert.ok(card.includes('📺 Canal: Oriente Oficial'));
assert.ok(card.includes('👁️ Visualizações: 0'));
assert.ok(card.includes('👍 Curtidas: Não informado'));
assert.ok(card.includes('📅 Publicado em: 2024-05-02'));
assert.ok(card.includes('https://www.youtube.com/watch?v=selected123'));
assert.ok(card.includes(',letra https://www.youtube.com/watch?v=selected123'));
assert.ok(!card.includes('"https://'));
assert.ok(!card.includes('`,'));
assert.ok(!card.includes('Biografia'));

const initial = playPresentation.formatInitialPlayMessage([{ title: 'Faixa', duration: 60 }]);
assert.strictEqual((initial.match(/LUA • PLAY/g) || []).length, 1);

console.log('✅ Card complementar do Play: metadados, campos ausentes, prefixo e URL sem aspas');
