/**
 * test/playLetra.test.js — Testes unitários e de integração para Play e Letra.
 *
 * Cobre:
 * 1. Formatação de ficha técnica (Áudio e Vídeo) com metadados reais, sem inventar campos vazios.
 * 2. Distinção clara entre Artista e Canal.
 * 3. Estatísticas numéricas e ausência de inventar curtidas / ouvintes falsos.
 * 4. Resumo de descrição longa sem quebra de instrução.
 * 5. Sanitização de conteúdo contra menções fantasmas.
 * 6. Resolução de links válidos e rejeição de links não suportados.
 * 7. Busca de letra por nome, por artista-música e detecção de instrumental.
 * 8. Integração entre Play e Letra com indicação de comando e botões.
 */

'use strict';

const assert = require('assert');
const mediaPresentation = require('../utils/mediaPresentation');
const lyricsEngine = require('../utils/lyricsEngine');
const searchResults = require('../commands/_shared/searchResults');

let falhas = 0;
function ok(msg) { console.log('✅ ' + msg); }
function fail(msg, err) { falhas++; console.error('❌ ' + msg, err); }

async function run() {
  console.log('=== TESTES DE PLAY E LETRA ===\n');

  // 1. Sanitização
  try {
    const raw = 'Veja meu vídeo @5511999999999 e curta!';
    const sanitized = mediaPresentation.sanitizeContent(raw);
    assert.ok(sanitized.includes('@\u200B5511999999999'), 'insere caractere zero-width para evitar menção acidental');
    ok('1: Sanitização contra menções involuntárias');
  } catch (e) { fail('1: Sanitização', e); }

  // 2. Distinção entre Artista e Canal
  try {
    const p1 = mediaPresentation.parseArtistAndTitle('Queen - Bohemian Rhapsody (Official Video)', 'Queen Official');
    assert.strictEqual(p1.artist, 'Queen');
    assert.strictEqual(p1.title, 'Bohemian Rhapsody');
    assert.strictEqual(p1.isChannel, false);

    const p2 = mediaPresentation.parseArtistAndTitle('Vídeo Caseiro de Férias', 'Canal do João');
    assert.strictEqual(p2.artist, 'Canal do João');
    assert.strictEqual(p2.isChannel, true);
    ok('2: Distinção inteligente entre Artista e Canal');
  } catch (e) { fail('2: Artista e Canal', e); }

  // 3. Montagem da ficha técnica de Áudio
  try {
    const card = mediaPresentation.formatMediaCard({
      kind: 'audio',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      duration: '5:55',
      releaseDate: '1975',
      views: 1250000,
      likes: 85000,
      about: 'Obra prima composta por Freddie Mercury.',
      description: 'Vídeo oficial remasterizado em alta definição.',
      url: 'https://youtu.be/test',
      prefix: '!',
    });

    assert.ok(card.includes('🎧 ÁUDIO • *Bohemian Rhapsody*'), 'cabeçalho de áudio');
    assert.ok(card.includes('🎤 Artista: Queen'), 'artista presente');
    assert.ok(card.includes('💿 Álbum: A Night at the Opera'), 'álbum presente');
    assert.ok(card.includes('⏱️ Duração: 5:55'), 'duração presente');
    assert.ok(card.includes('👁️ Visualizações: 1.250.000'), 'visualizações formatadas');
    assert.ok(card.includes('👍 Curtidas: 85.000'), 'curtidas formatadas');
    assert.ok(card.includes('📝 *SOBRE A MÚSICA*'), 'contexto sobre a música');
    assert.ok(card.includes('📖 Buscar letra: `!letra https://youtu.be/test`'), 'integração de busca de letra');
    ok('3: Ficha técnica de Áudio completa e estruturada');
  } catch (e) { fail('3: Ficha de Áudio', e); }

  // 4. Montagem da ficha técnica de Vídeo com dados parciais
  try {
    const card = mediaPresentation.formatMediaCard({
      kind: 'video',
      title: 'Tutorial de Node.js',
      channel: 'Dev Tech',
      duration: '12:30',
      views: 0,
      url: 'https://youtube.com/watch?v=123',
      prefix: '#',
    });

    assert.ok(card.includes('🎬 VÍDEO • *Tutorial de Node.js*'), 'cabeçalho de vídeo');
    assert.ok(card.includes('📺 Canal: Dev Tech'), 'usa Canal quando não é artista');
    assert.ok(card.includes('👁️ Visualizações: 0'), 'diferencia zero de ausente');
    assert.ok(!card.includes('👍 Curtidas:'), 'oculta curtidas quando não fornecido');
    assert.ok(!card.includes('💿 Álbum:'), 'oculta álbum quando não fornecido');
    assert.ok(card.includes('📖 Buscar letra: `#letra https://youtube.com/watch?v=123`'), 'usa prefixo ativo (#)');
    ok('4: Ficha técnica de Vídeo com dados parciais respeitando campos');
  } catch (e) { fail('4: Ficha de Vídeo', e); }

  // 5. Resolução de URLs para letras
  try {
    const rYt = lyricsEngine.resolveUrl('https://www.youtube.com/watch?v=fJ9rUzIMcZQ');
    assert.strictEqual(rYt.platform, 'YouTube');
    assert.strictEqual(rYt.id, 'fJ9rUzIMcZQ');
    assert.strictEqual(rYt.supported, true);

    const rSp = lyricsEngine.resolveUrl('https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv');
    assert.strictEqual(rSp.platform, 'Spotify');
    assert.strictEqual(rSp.id, '4u7EnebtmKWzUH433cf5Qv');
    assert.strictEqual(rSp.supported, true);

    const rInv = lyricsEngine.resolveUrl('https://example.com/audio.mp3');
    assert.strictEqual(rInv.supported, false);
    ok('5: Resolução e validação de URLs');
  } catch (e) { fail('5: Resolução URLs', e); }

  // 6. Busca de letra por nome e por artista-música
  try {
    const l1 = await lyricsEngine.searchLyrics('Bohemian Rhapsody');
    assert.ok(l1, 'encontra letra por nome');
    assert.strictEqual(l1.artist, 'Queen');

    const l2 = await lyricsEngine.searchLyrics('Imagine Dragons - Believer');
    assert.ok(l2, 'encontra letra por artista - música');
    assert.strictEqual(l2.title, 'Believer');

    const l3 = await lyricsEngine.searchLyrics('Pais e Filhos');
    assert.ok(l3, 'encontra Legião Urbana');
    assert.strictEqual(l3.artist, 'Legião Urbana');
    ok('6: Busca de letras offline-first de alta precisão');
  } catch (e) { fail('6: Busca letras', e); }

  // 7. Música Instrumental
  try {
    const inst = await lyricsEngine.searchLyrics('Für Elise');
    assert.ok(inst, 'encontra Für Elise');
    assert.strictEqual(inst.isInstrumental, true);
    const resp = lyricsEngine.formatLyricsResponse(inst);
    assert.ok(resp.includes('Faixa Instrumental'), 'indica claramente que a faixa é instrumental');
    ok('7: Detecção de faixas instrumentais sem letras');
  } catch (e) { fail('7: Instrumental', e); }

  // 8. Integração em searchResults com botão e linha de letra
  try {
    const fakeCtx = { remoteJid: 'chat123@s.whatsapp.net', prefix: '!' };
    const fakeResults = [
      { title: 'Queen - Bohemian Rhapsody', author: 'Queen Official', duration: '5:55', views: 500000, url: 'https://youtu.be/queen' }
    ];
    const built = searchResults.build(fakeCtx, fakeResults);
    assert.ok(built.buttons.some((b) => b.text.includes('Letra 1')), 'botão de letra gerado');
    assert.ok(built.text.includes('!letra https://youtu.be/queen'), 'instrução de busca de letra gerada no corpo');
    ok('8: Integração de letra nos resultados de busca do Play');
  } catch (e) { fail('8: Integração Play/Letra', e); }

  console.log(`\n=== RESULTADO: ${falhas === 0 ? 'TODOS OS TESTES PASSARAM!' : falhas + ' falhas'} ===`);
  if (falhas > 0) process.exit(1);
}

run();
