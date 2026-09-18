/**
 * test/creator.test.js — identidade do criador editável por comando + selos.
 *
 * Cobre: !setcriador (gravar/validar/resetar), persistência no banco, reflexo no
 * cartão !criador e no !owner, e !selo (fixo/aleatório/desconhecido).
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-creator.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
database.open();
const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

const creatorProfile = require('../utils/creatorProfile');
const consts = require('../utils/consts');
const settings = require('../database/settings');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

const BOT = '5511888887777@s.whatsapp.net';
const USER = '5511911110001@s.whatsapp.net';
const CHAT = '120363000000000000@g.us';

function fakeSocket() {
  const relayed = [];
  const sent = [];
  return {
    relayed,
    sent,
    user: { id: BOT },
    relayMessage: async (jid, message) => {
      relayed.push({ jid, message });
      return 'OK';
    },
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: 'K' } };
    },
    profilePictureUrl: async () => '',
  };
}

function fakeCtx(overrides = {}) {
  const socket = overrides.socket || fakeSocket();
  const replies = [];
  return Object.assign(
    {
      args: [],
      text: '',
      prefix: '!',
      remoteJid: CHAT,
      sender: USER,
      isGroup: true,
      isOwner: true,
      isAdmin: true,
      isBotAdmin: true,
      mentionedJid: [],
      replies,
      socket,
      reply: async (t) => {
        replies.push(String(t));
        return true;
      },
      message: { key: { remoteJid: CHAT, fromMe: false, id: 'M1', participant: USER }, pushName: 'Tester', message: {} },
    },
    overrides,
    { socket, replies }
  );
}

const setCmd = registry.resolveTrigger('setcriador');
const sealCmd = registry.resolveTrigger('selo');
const criadorCmd = registry.resolveTrigger('criador');
const ownerCmd = registry.resolveTrigger('owner');

const sectionsOf = (message) =>
  JSON.parse(
    Buffer.from(message.botForwardedMessage.message.richResponseMessage.unifiedResponse.data, 'base64').toString('utf8')
  );

(async () => {
  // ---- 1) comandos registrados e restritos ao dono
  assert.ok(setCmd && sealCmd && criadorCmd && ownerCmd, 'comandos registrados');
  assert.strictEqual(setCmd.ownerOnly, true, '!setcriador é só do dono');
  assert.strictEqual(sealCmd.ownerOnly, true, '!selo é só do dono');
  ok('!setcriador e !selo registrados como ownerOnly');

  // ---- 2) listagem
  creatorProfile.reset();
  const c2 = fakeCtx({ args: [] });
  await setCmd.execute(c2);
  const list = c2.replies.join('\n');
  for (const field of Object.keys(creatorProfile.FIELDS)) {
    assert.ok(list.includes(field), `lista o campo ${field}`);
  }
  assert.match(list, /setcriador <campo> <valor>/, 'mostra a sintaxe');
  ok('!setcriador sem args lista todos os campos com o valor atual');

  // ---- 3) gravar nome e desenvolvedor
  let r = fakeCtx({ args: ['name', 'Ana', 'Lua'] });
  await setCmd.execute(r);
  assert.strictEqual(creatorProfile.get('name'), 'Ana Lua', 'nome gravado');
  assert.strictEqual(creatorProfile.isCustom('name'), true, 'marcado como personalizado');
  assert.strictEqual(settings.get('creator.name'), 'Ana Lua', 'persistido no banco');
  r = fakeCtx({ args: ['developer', 'Ana Dev'] });
  await setCmd.execute(r);
  assert.strictEqual(creatorProfile.get('developer'), 'Ana Dev');
  ok('!setcriador name/developer gravam no banco (sobrevivem a restart)');

  // ---- 4) validações
  const bad = [
    [['supportUrl', 'abc'], /link http/],
    [['photoUrl', 'não é url'], /link http/],
    [['instagram', 'inválido com espaço!'], /parece inválido/],
    [['name', 'x'.repeat(80)], /máximo 60/],
    [['about', 'a|b|c|d|e|f|g'], /Máximo de 6 itens/],
    [['campoque naoexiste', 'valor'], /Campo desconhecido/],
  ];
  for (const [args, pattern] of bad) {
    const c = fakeCtx({ args });
    await setCmd.execute(c);
    assert.match(c.replies.join('\n'), pattern, `rejeita ${args[0]}=${String(args[1]).slice(0, 12)}`);
  }
  assert.strictEqual(creatorProfile.get('supportUrl'), creatorProfile.DEFAULTS.supportUrl, 'nada foi gravado nos inválidos');
  ok('validação: URL, handle, tamanho, nº de itens e campo desconhecido');

  // ---- 5) about vira lista
  const c5 = fakeCtx({ args: ['about', 'dev do Lua | Node.js | chama no suporte'] });
  await setCmd.execute(c5);
  assert.deepStrictEqual(creatorProfile.get('about'), ['dev do Lua', 'Node.js', 'chama no suporte']);
  // sem "|" vira um item só (comportamento documentado, não erro)
  const c5b = fakeCtx({ args: ['about', 'frase única sem separador'] });
  await setCmd.execute(c5b);
  assert.deepStrictEqual(creatorProfile.get('about'), ['frase única sem separador']);
  ok('!setcriador about aceita itens separados por "|" (sem "|" vira um item só)');

  // ---- 6) o cartão usa os valores gravados
  await setCmd.execute(fakeCtx({ args: ['about', 'dev do Lua | Node.js | chama no suporte'] }));
  const c6 = fakeCtx({ args: [] });
  await criadorCmd.execute(c6);
  assert.strictEqual(c6.socket.relayed.length, 1, 'cartão enviado');
  const flat6 = JSON.stringify(sectionsOf(c6.socket.relayed[0].message));
  assert.ok(flat6.includes('Ana Lua'), 'nome configurado aparece no cartão');
  assert.ok(flat6.includes('Ana Dev'), 'desenvolvedor configurado aparece no cartão');
  assert.ok(flat6.includes('dev do Lua'), 'sobre configurado aparece no cartão');
  ok('!criador lê a identidade gravada (sem restart, sem editar arquivo)');

  // ---- 7) !owner usa a mesma fonte
  const c7 = fakeCtx({ args: [] });
  await ownerCmd.execute(c7);
  assert.match(c7.replies.join('\n'), /Ana Lua/, 'nome do dono veio do perfil');
  assert.match(c7.replies.join('\n'), /Ana Dev/, 'desenvolvedor veio do perfil');
  const vcard = c7.socket.sent.find((s) => s.content.contacts);
  assert.ok(vcard && vcard.content.contacts.contacts[0].vcard.includes('FN:Ana Lua'), 'vCard com o nome configurado');
  ok('!owner e o vCard refletem a mesma identidade');

  // ---- 8) suporte wa.me alimenta o vCard
  const c8 = fakeCtx({ args: ['supportUrl', 'https://wa.me/5511987654321'] });
  await setCmd.execute(c8);
  const c8b = fakeCtx({ args: [] });
  await ownerCmd.execute(c8b);
  const vc = c8b.socket.sent.find((s) => s.content.contacts).content.contacts.contacts[0].vcard;
  assert.ok(vc.includes('waid=5511987654321'), `número do contato veio do supportUrl (${vc.match(/waid=\d+/)})`);
  ok('!setcriador supportUrl (wa.me) define o número do contato do !owner');

  // ---- 9) reset
  const c9 = fakeCtx({ args: ['reset', 'name'] });
  await setCmd.execute(c9);
  assert.strictEqual(creatorProfile.isCustom('name'), false, 'voltou ao padrão');
  assert.strictEqual(creatorProfile.get('name'), creatorProfile.DEFAULTS.name);
  const c9b = fakeCtx({ args: ['reset'] });
  await setCmd.execute(c9b);
  for (const f of Object.keys(creatorProfile.FIELDS)) {
    assert.strictEqual(creatorProfile.isCustom(f), false, `${f} resetado`);
  }
  const c9c = fakeCtx({ args: ['reset', 'naoexiste'] });
  await setCmd.execute(c9c);
  assert.match(c9c.replies.join('\n'), /Campo desconhecido/, 'reset de campo inválido avisa');
  ok('!setcriador reset devolve o padrão (campo único ou todos)');

  // ---- 10) selos: listagem
  const c10 = fakeCtx({ args: [] });
  await sealCmd.execute(c10);
  const sealList = c10.replies.join('\n');
  for (const name of consts.sealNames()) assert.ok(sealList.includes(name), `lista o selo ${name}`);
  assert.ok(consts.sealNames().length >= 6, `selos disponíveis: ${consts.sealNames().length}`);
  assert.match(sealList, /random/, 'mostra a opção aleatória');
  ok(`!selo lista os ${consts.sealNames().length} selos com prévia (${consts.sealNames().join(', ')})`);

  // ---- 11) selo fixo vale no cartão
  const c11 = fakeCtx({ args: ['seguranca'] });
  await sealCmd.execute(c11);
  assert.strictEqual(creatorProfile.sealChoice(), 'seguranca');
  const c11b = fakeCtx({ args: [] });
  await criadorCmd.execute(c11b);
  const quoted = c11b.socket.relayed[0].message.botForwardedMessage.message.richResponseMessage.contextInfo.quotedMessage;
  assert.strictEqual(quoted.extendedTextMessage.text, consts.sealText('seguranca'), 'cartão cita o selo escolhido');
  assert.match(quoted.extendedTextMessage.text, /Central de Segurança/);
  ok('!selo <nome> fixa o selo e o cartão passa a citá-lo');

  // ---- 12) selo aleatório
  const c12 = fakeCtx({ args: ['random'] });
  await sealCmd.execute(c12);
  assert.strictEqual(creatorProfile.sealChoice(), 'random');
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) seen.add(consts.pickSealName());
  assert.ok(seen.size >= 3, `o sorteio variou (${seen.size} selos diferentes em 40 sorteios)`);
  for (const s of seen) assert.ok(consts.SEALS[s], `sorteou apenas selos existentes (${s})`);
  ok('!selo random sorteia entre os selos existentes (nunca inventa nome)');

  // ---- 13) selo desconhecido
  const c13 = fakeCtx({ args: ['nubank'] });
  await sealCmd.execute(c13);
  assert.match(c13.replies.join('\n'), /Selo desconhecido/, 'rejeita selo inexistente');
  assert.strictEqual(creatorProfile.sealChoice(), 'random', 'não alterou a escolha');
  ok('!selo com nome inexistente avisa e mantém a configuração');

  // ---- 14) acento no nome do selo é aceito
  creatorProfile.setSealChoice('lua');
  const c14 = fakeCtx({ args: ['aleatório'] });
  await sealCmd.execute(c14);
  assert.strictEqual(creatorProfile.sealChoice(), 'random', 'aceita "aleatório" com acento');
  ok('!selo aceita "aleatório" (normaliza acento)');

  // ---- 15) selo nunca fica sem texto/id
  const selo = await consts.seloNubank(fakeSocket(), { key: { id: 'ABC', participant: USER } }, USER, 'T', CHAT);
  assert.ok(selo.seal && consts.SEALS[selo.seal], `selo resolvido: ${selo.seal}`);
  assert.ok(selo.message.extendedTextMessage.text.length > 5, 'texto do selo não vazio');
  assert.strictEqual(selo.key.id, 'ABC');
  ok('seloNubank devolve nome do selo, texto e chave válida');

  creatorProfile.reset();
  database.close();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
  }
  console.log(`\n✅ criador editável + selos: ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ creator: ${err.stack || err.message}`);
  process.exit(1);
});
