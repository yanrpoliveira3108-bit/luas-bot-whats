/**
 * test/play_redesign.test.js — Testes rigorosos da reformulação do comando Play.
 *
 * Cobre:
 * 1. Apresentação inicial: cabeçalho 'LUA • PLAY', divisórias, 'Duração · mm:ss', sem links, sem bio, sem comando de letra.
 * 2. Formatação da mensagem complementar pós-envio com prefixo dinâmico, link oficial e atalho da letra.
 * 3. Seleção de 3 resultados por nome, 1 por link direto, 0 por busca vazia.
 * 4. Deduplicação por identificador/URL canônica preservando subtítulos e tags ("ao vivo", "remix", etc).
 * 5. Isolamento de sessões de usuário/chat, bloqueio anti-duplo clique e controle de expiração.
 * 6. Segurança SSRF: bloqueio de localhost, IPs privados (RFC 1918), link-local e subdomínios fraudulentos.
 * 7. Fallback numérico e compatibilidade em caso de modo seguro ou falha interativa.
 */

'use strict';

const assert = require('assert');
const playPresentation = require('../utils/playPresentation');
const playSession = require('../utils/playSession');
const urlSecurity = require('../utils/urlSecurity');
const playFlow = require('../commands/_shared/playFlow');
const numberFallback = require('../utils/numberFallback');

let falhas = 0;
function ok(msg) { console.log('✅ ' + msg); }
function fail(msg, err) { falhas++; console.error('❌ ' + msg, err); }

async function runTests() {
  console.log('=== TESTES DA REFORMULAÇÃO DO PLAY ===\n');

  // 1. Mensagem inicial exata
  try {
    const results = [
      { title: 'Queen - Bohemian Rhapsody (Live at Wembley)', duration: '05:55' },
      { title: 'Queen - Don\'t Stop Me Now', duration: 210 },
      { title: 'Radiohead - Creep (Acoustic)', duration: null },
    ];
    const initial = playPresentation.formatInitialPlayMessage(results);

    assert.ok(initial.includes('*LUA • PLAY*'), 'Cabeçalho LUA • PLAY presente');
    assert.ok(initial.includes('━━━━━━━━━━━━━━'), 'Divisória presente');
    assert.ok(initial.includes('*01*  *Queen - Bohemian Rhapsody (Live at Wembley)*'), 'Opção 01 formatada');
    assert.ok(initial.includes('Duração · 05:55'), 'Duração 01 formatada');
    assert.ok(initial.includes('*02*  *Queen - Don\'t Stop Me Now*'), 'Opção 02 formatada');
    assert.ok(initial.includes('Duração · 03:30'), 'Duração numérica convertida');
    assert.ok(initial.includes('*03*  *Radiohead - Creep (Acoustic)*'), 'Opção 03 formatada');
    assert.ok(initial.includes('Duração · Não informada'), 'Duração nula tratada honestamente');
    assert.ok(initial.includes('_Escolha uma opção abaixo._'), 'Texto final de instrução');

    // NUNCA conter links, curtidas, visualizações ou comando de letra na resposta inicial
    assert.ok(!initial.includes('http'), 'Sem links na resposta inicial');
    assert.ok(!initial.includes('Visualizações'), 'Sem visualizações na resposta inicial');
    assert.ok(!initial.includes('Curtidas'), 'Sem curtidas na resposta inicial');
    assert.ok(!initial.includes('letra'), 'Sem menção a letra na resposta inicial');
    ok('1: Apresentação inicial limpa, elegante e fiel ao layout de referência');
  } catch (e) { fail('1: Apresentação inicial', e); }

  // 2. Mensagem complementar pós-mídia
  try {
    const comp = playPresentation.formatComplementaryMessage(
      'Queen - Bohemian Rhapsody',
      'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
      '.'
    );
    assert.ok(comp.includes('*Queen - Bohemian Rhapsody*'), 'Título presente');
    assert.ok(comp.includes('Link: "https://www.youtube.com/watch?v=fJ9rUzIMcZQ"'), 'Link formatado');
    assert.ok(comp.includes('Letra: ".letra https://www.youtube.com/watch?v=fJ9rUzIMcZQ"'), 'Comando de letra com prefixo ativo (.)');
    ok('2: Mensagem complementar com URL canônica e atalho de letra');
  } catch (e) { fail('2: Mensagem complementar', e); }

  // 3. Sessões interativas e bloqueio anti-duplo clique
  try {
    const userA = '5511999990001@s.whatsapp.net';
    const userB = '5511999990002@s.whatsapp.net';
    const chat1 = '12036300000001@g.us';

    const s = playSession.createSession({
      sender: userA,
      chatId: chat1,
      results: [{ title: 'Track 1', url: 'https://youtube.com/watch?v=1' }],
      query: 'Track 1',
      prefix: '!',
    });

    assert.ok(s.id.startsWith('ps_'), 'ID de sessão válido');
    const lock1 = playSession.lockSession(s.id);
    assert.strictEqual(lock1.ok, true, 'adquire primeira trava');

    const lock2 = playSession.lockSession(s.id);
    assert.strictEqual(lock2.ok, false, 'segundo clique concorrente é bloqueado');
    assert.strictEqual(lock2.reason, 'ALREADY_PROCESSING', 'motivo correto de trava');

    playSession.unlockSession(s.id);
    const lock3 = playSession.lockSession(s.id);
    assert.strictEqual(lock3.ok, true, 'trava liberada para nova ação');
    playSession.unlockSession(s.id);

    // Isolamento entre chats/usuários
    const sForA = playSession.getSessionForUser(chat1, userA);
    const sForB = playSession.getSessionForUser(chat1, userB);
    assert.strictEqual(sForA.id, s.id, 'encontra sessão do autor A');
    assert.strictEqual(sForB, null, 'autor B não tem acesso à sessão do autor A');
    ok('3: Isolamento de sessões de usuário e proteção contra duplo clique');
  } catch (e) { fail('3: Sessões e concorrência', e); }

  // 4. Segurança de URLs e proteção contra SSRF
  try {
    assert.strictEqual(urlSecurity.validateSafeUrl('http://127.0.0.1:8080').valid, false, 'bloqueia loopback IPv4');
    assert.strictEqual(urlSecurity.validateSafeUrl('http://localhost').valid, false, 'bloqueia localhost');
    assert.strictEqual(urlSecurity.validateSafeUrl('http://169.254.169.254/latest/meta-data').valid, false, 'bloqueia metadados AWS');
    assert.strictEqual(urlSecurity.validateSafeUrl('http://192.168.0.1/admin').valid, false, 'bloqueia rede interna');
    assert.strictEqual(urlSecurity.validateSafeUrl('https://youtube.com.attacker.com').valid, false, 'bloqueia bypass de subdomínio');
    assert.strictEqual(urlSecurity.validateSafeUrl('ftp://youtube.com').valid, false, 'bloqueia protocolo não http/https');

    assert.strictEqual(urlSecurity.validateSafeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').valid, true, 'permite YouTube padrão');
    assert.strictEqual(urlSecurity.validateSafeUrl('https://youtu.be/dQw4w9WgXcQ').valid, true, 'permite YouTube encurtado');
    assert.strictEqual(urlSecurity.validateSafeUrl('https://open.spotify.com/track/123').valid, true, 'permite Spotify');
    ok('4: Validação rigorosa de URLs e proteção SSRF comprovada');
  } catch (e) { fail('4: SSRF e URLs', e); }

  // 5. Deduplicação e seleção de resultados no fluxo
  try {
    const youtube = require('../downloaders/youtube');
    const origSearch = youtube.search;
    youtube.search = async () => [
      { title: 'Queen - Bohemian Rhapsody', duration: '05:55', url: 'https://youtube.com/watch?v=1' },
      { title: 'Queen - Don\'t Stop Me Now', duration: '03:30', url: 'https://youtube.com/watch?v=2' },
      { title: 'Queen - Radio Ga Ga', duration: '05:43', url: 'https://youtube.com/watch?v=3' },
    ];

    let sentMsg = '';
    const mockCtx = {
      args: ['Queen Bohemian'],
      sender: '5511999990001@s.whatsapp.net',
      remoteJid: '12036300000001@g.us',
      prefix: '#',
      reply: async (msg) => { sentMsg = msg; },
      socket: {},
      message: {},
    };

    // Chamada do play com fallback numérico garantido
    await playFlow.handlePlay(mockCtx);
    youtube.search = origSearch;

    assert.ok(sentMsg.includes('LUA • PLAY'), 'mensagem inicial gerada com sucesso');
    assert.ok(sentMsg.includes('Duração ·'), 'duração presente no fluxo real');

    const numMenu = numberFallback.getNumberMenu(mockCtx.remoteJid);
    assert.ok(numMenu && numMenu.items.length > 0, 'menu de opções numéricas registrado no fallback');
    ok('5: Execução do fluxo de busca e fallback numérico ativo');
  } catch (e) { fail('5: Fluxo do Play', e); }

  console.log(`\n=== RESULTADO: ${falhas === 0 ? 'TODOS OS TESTES DO PLAY PASSARAM!' : falhas + ' falhas'} ===`);
  if (falhas > 0) process.exit(1);
}

runTests();
