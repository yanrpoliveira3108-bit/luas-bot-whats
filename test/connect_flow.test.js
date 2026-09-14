/**
 * test/connect_flow.test.js — valida o fluxo de pareamento e reconexão:
 *
 * 1) requestPairingCode só é chamado DEPOIS de waitForConnectionUpdate
 *    (o Baileys lança "Connection Closed"/428 se o websocket não abriu).
 * 2) a reconexão durante o pareamento NÃO re-gera o código (o código já
 *    emitido continua válido — o servidor conclui com restartRequired).
 * 3) fechamento da conexão durante o pareamento com erro SEM statusCode
 *    (ex.: queda de rede, ECONNRESET) emite 'failed' (terminal) — a UI não
 *    pode ficar pendurada em "Aguardando autenticação" sem causa.
 * 4) badSession (500) é terminal e explica a causa (sessão inválida).
 * 5) restartRequired (515) agenda RECONEXÃO e NUNCA é tratado como falha.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const order = [];
const fakeSock = {
  ev: { on: () => {}, removeAllListeners: () => {}, emit: () => {} },
  ws: { readyState: 1, close: () => {} },
  user: null,
  waitForConnectionUpdate: async () => {
    order.push('waitForConnectionUpdate');
  },
  requestPairingCode: async () => {
    order.push('requestPairingCode');
    return 'ABCDEFGH';
  },
  logout: async () => {},
};

const fakeBaileys = {
  default: () => fakeSock,
  useMultiFileAuthState: async () => ({
    state: { creds: { registered: false }, keys: {} },
    saveCreds: async () => {},
  }),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0], isLatest: true }),
  makeCacheableSignalKeyStore: (k) => k,
  DisconnectReason: {
    loggedOut: 401,
    forbidden: 403,
    connectionClosed: 428,
    badSession: 500,
    restartRequired: 515,
  },
  Browsers: { ubuntu: () => ['Ubuntu', 'Chrome', '1'] },
};

// injeta o mock do baileys no cache de require
const baileysPath = require.resolve('@lucasmod/boruto-vk7-baileys');
require.cache[baileysPath] = {
  id: baileysPath,
  filename: baileysPath,
  loaded: true,
  exports: fakeBaileys,
};

const connect = require('../connection/connect');

function collect(fn) {
  const events = [];
  const unsub = connect.setStatusListener((e) => events.push(e));
  try {
    fn();
  } finally {
    unsub();
  }
  return events;
}

async function main() {
  // 1) ordem correta no primeiro pareamento
  await connect.connect({ phone: '5511999999999' });
  assert.deepStrictEqual(
    order,
    ['waitForConnectionUpdate', 'requestPairingCode'],
    'requestPairingCode deve ser chamado DEPOIS de waitForConnectionUpdate'
  );
  console.log('✅ 1/5: waitForConnectionUpdate antes de requestPairingCode');

  // 2) reconexão durante o pareamento NÃO re-pede código
  order.length = 0;
  await connect.connect({});
  assert.deepStrictEqual(
    order,
    [],
    'reconexão durante o pareamento não deve re-gerar o código'
  );
  console.log('✅ 2/5: reconexão durante pareamento não re-pede o código');

  // 3) queda de rede durante o pareamento (sem statusCode) → failed terminal
  const ev3 = collect(() =>
    connect.handleConnectionUpdate(
      { connection: 'close', lastDisconnect: { error: new Error('ECONNRESET'), date: new Date() } },
      fakeSock
    )
  );
  assert(
    ev3.some((e) => e.type === 'failed'),
    'fechamento sem statusCode durante pareamento deve emitir failed (senão a UI trava)'
  );
  assert(
    !ev3.some((e) => e.type === 'reconnecting'),
    'pareamento sem sessão NÃO deve reconectar sozinho em loop'
  );
  console.log('✅ 3/5: queda de rede no pareamento → failed com causa (sem travar)');

  // 4) badSession (500) → terminal, com causa clara
  const ev4 = collect(() =>
    connect.handleConnectionUpdate(
      { connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } }, date: new Date() } },
      fakeSock
    )
  );
  assert(
    ev4.some((e) => e.type === 'failed' && /badSession|sessão/i.test(e.reason || '')),
    'badSession deve emitir failed explicando a sessão inválida'
  );
  console.log('✅ 4/5: badSession (500) → failed com causa');

  // 5) restartRequired (515) → reconexão, NUNCA failed
  const ev5 = collect(() =>
    connect.handleConnectionUpdate(
      { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } }, date: new Date() } },
      fakeSock
    )
  );
  assert(
    ev5.some((e) => e.type === 'reconnecting'),
    'restartRequired deve agendar reconexão'
  );
  assert(
    !ev5.some((e) => e.type === 'failed'),
    'restartRequired NÃO pode ser tratado como falha'
  );
  console.log('✅ 5/5: restartRequired (515) → reconexão (não é falha)');

  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
