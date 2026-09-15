/**
 * test/poll.test.js — !poll e !pollresult: parser, caixa de 40 colunas e
 * confirmação obrigatória (pendingPollConfirmations).
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-poll.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
database.open();
const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

const poll = require('../utils/poll');
const pendingPoll = require('../utils/pendingPoll');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

const BOT = '5511888887777@s.whatsapp.net';
const USER_A = '5511911110001@s.whatsapp.net';
const USER_B = '5511911110002@s.whatsapp.net';
const CHAT = '120363000000000000@g.us';

function fakeSocket(opts = {}) {
  const sent = [];
  return {
    sent,
    user: { id: BOT },
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      if (opts.fail && (content.poll || content.pollResult)) throw new Error('500: falha');
      return { key: { id: 'K' + sent.length } };
    },
    profilePictureUrl: async () => '',
    groupMetadata: async () => ({ id: CHAT, subject: 'Grupo', participants: [] }),
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
      sender: USER_A,
      isGroup: true,
      isOwner: false,
      isAdmin: true,
      isBotAdmin: true,
      mentionedJid: [],
      replies,
      socket,
      reply: async (t) => {
        replies.push(String(t));
        return true;
      },
      message: { key: { remoteJid: CHAT, id: 'M', participant: USER_A }, message: {} },
    },
    overrides,
    { socket, replies }
  );
}

const cmdPoll = registry.resolveTrigger('poll');
const cmdResult = registry.resolveTrigger('pollresult');
const pollMsgs = (ctx) => ctx.socket.sent.filter((m) => m.content && (m.content.poll || m.content.pollResult));

function reset() {
  for (const k of [...pendingPoll.pendingPollConfirmations.keys()]) pendingPoll.clear(k);
}

/** largura visual de cada linha da caixa */
const widths = (box) => [...new Set(box.split('\n').map((l) => poll.visualWidth(l)))];

(async () => {
  assert.ok(cmdPoll && cmdResult, 'comandos registrados');

  /* ------------------------------------------------------------ parser */

  // 1) básico + padrões
  const p1 = poll.parsePoll('Qual linguagem você prefere? | Lua | JavaScript | Python');
  assert.ok(p1.ok, p1.error || 'parse ok');
  assert.strictEqual(p1.poll.name, 'Qual linguagem você prefere?');
  assert.deepStrictEqual(p1.poll.values, ['Lua', 'JavaScript', 'Python']);
  assert.strictEqual(p1.poll.selectableCount, 1, 'selectableCount padrão 1');
  assert.strictEqual(p1.poll.toAnnouncementGroup, false, 'announcement padrão false');
  ok('parser: pergunta + 3 opções, padrões selectableCount=1 e announcement=false');

  // 2) parâmetros em qualquer posição e fora das opções
  for (const raw of [
    '--selectableCount=2 Qual linguagem? | Lua | JavaScript',
    'Qual linguagem? --selectableCount=2 | Lua | JavaScript',
    'Qual linguagem? | Lua --selectableCount=2 | JavaScript',
    'Qual linguagem? | Lua | JavaScript --selectableCount=2',
  ]) {
    const r = poll.parsePoll(raw);
    assert.ok(r.ok, `posição aceita: ${raw} (${r.error || ''})`);
    assert.strictEqual(r.poll.name, 'Qual linguagem?', `nome limpo em: ${raw}`);
    assert.deepStrictEqual(r.poll.values, ['Lua', 'JavaScript'], `opções limpas em: ${raw}`);
    assert.strictEqual(r.poll.selectableCount, 2, `selectableCount=2 em: ${raw}`);
  }
  ok('parser: --chave=valor em qualquer posição nunca vira parte do nome/opção');

  // 3) selectableCount inválido
  for (const bad of ['0', '-1', '1.5', 'abc', '', '+2', '01']) {
    const r = poll.parsePoll(`Pergunta? | Lua | JavaScript --selectableCount=${bad}`);
    assert.strictEqual(r.ok, false, `--selectableCount=${bad} deve ser rejeitado`);
    assert.match(r.error, /--selectableCount/, `erro cita o parâmetro (${bad})`);
    assert.match(r.error, /inteiro/, `erro explica o formato (${bad})`);
  }
  ok('parser: --selectableCount rejeita 0, -1, 1.5, abc, vazio, +2 e 01');

  // 4) selectableCount acima do nº de opções
  const p4 = poll.parsePoll('Pergunta? | Lua | JavaScript | Python --selectableCount=4');
  assert.strictEqual(p4.ok, false);
  assert.match(p4.error, /entre 1 e a quantidade de opções disponíveis \(3\)/);
  ok('parser: --selectableCount=4 com 3 opções é rejeitado (limite = nº de opções)');

  // 5) announcement
  assert.strictEqual(poll.parsePoll('P? | A | B --announcement=true').poll.toAnnouncementGroup, true);
  assert.strictEqual(poll.parsePoll('P? | A | B --announcement=false').poll.toAnnouncementGroup, false);
  const p5 = poll.parsePoll('P? | A | B --announcement=hello');
  assert.strictEqual(p5.ok, false);
  assert.match(p5.error, /aceita somente:\n▸ true\n▸ false/);
  ok('parser: --announcement aceita só true/false e diz isso no erro');

  // 6) parâmetro desconhecido e sem valor
  const p6 = poll.parsePoll('P? | A | B --desconhecido=1');
  assert.strictEqual(p6.ok, false);
  assert.match(p6.error, /Parâmetro desconhecido/);
  const p6b = poll.parsePoll('P? | A | B --selectableCount');
  assert.strictEqual(p6b.ok, false);
  assert.match(p6b.error, /Faltou o valor/);
  ok('parser: parâmetro desconhecido e parâmetro sem valor são rejeitados');

  // 7) validações de estrutura
  assert.strictEqual(poll.parsePoll('').ok, false, 'sem pergunta');
  assert.match(poll.parsePoll('Só a pergunta').error, /pelo menos \*2 opções\*/, 'menos de 2 opções');
  assert.match(poll.parsePoll('P? | Lua |  | Python').error, /opção vazia/, 'opção vazia');
  assert.match(poll.parsePoll('P? | Lua | Lua').error, /Opção repetida/, 'opção duplicada');
  assert.match(poll.parsePoll(' | Lua | JavaScript').error, /pergunta da enquete é obrigatória/, 'pergunta vazia');
  ok('parser: pergunta obrigatória, mínimo 2 opções, sem opção vazia nem repetida');

  // 8) pollresult
  const r1 = poll.parsePollResult('Minha enquete | Lua:1000 | JavaScript:2000 | Python:500 --announcement=true');
  assert.ok(r1.ok, r1.error || 'parse ok');
  assert.strictEqual(r1.pollResult.name, 'Minha enquete');
  assert.deepStrictEqual(r1.pollResult.values, [
    ['Lua', 1000],
    ['JavaScript', 2000],
    ['Python', 500],
  ]);
  assert.strictEqual(r1.announcement, true);
  assert.ok(poll.parsePollResult('E | Lua:0 | JS:1').ok, 'votos 0 são válidos');
  ok('parser: !pollresult monta [[opção, votos]] e aceita votos 0');

  // 9) votos inválidos
  for (const bad of ['-1', '1.5', 'abc', '', '+10', '01']) {
    const r = poll.parsePollResult(`E | Lua:${bad} | JS:2`);
    assert.strictEqual(r.ok, false, `Lua:${bad} deve ser rejeitado`);
    assert.match(r.error, /votos devem ser um número inteiro maior ou igual a 0/, `erro claro (${bad})`);
  }
  const rBig = poll.parsePollResult(`E | Lua:${poll.MAX_VOTES + 1} | JS:2`);
  assert.strictEqual(rBig.ok, false, 'limite de segurança');
  assert.match(rBig.error, /alta demais/);
  ok('parser: votos rejeitam -1, 1.5, abc, vazio, +10, 01 e valores acima do limite');

  // 10) resultado sem ":votos"
  const r10 = poll.parsePollResult('E | Lua:100 | JavaScript');
  assert.strictEqual(r10.ok, false);
  assert.match(r10.error, /sem quantidade de votos/);
  ok('parser: resultado sem ":votos" é rejeitado com exemplo');

  /* -------------------------------------------------------------- caixa */

  // 11) largura exata
  const box = poll.renderBox({
    title: 'Qual linguagem você prefere usar atualmente no desenvolvimento?',
    items: ['Lua', 'JavaScript', 'Uma opção com um texto muito longo que precisa continuar aqui'],
  });
  assert.deepStrictEqual(widths(box), [poll.BOX_WIDTH], `todas as linhas com ${poll.BOX_WIDTH} colunas`);
  ok(`caixa: todas as linhas têm exatamente ${poll.BOX_WIDTH} colunas visuais (borda + padding 2 + texto)`);

  // 12) título com o mesmo padding das opções, alinhado à esquerda
  const lines = box.split('\n');
  assert.ok(lines[0].startsWith('┌'), 'borda superior');
  assert.ok(lines[1].startsWith(`│${' '.repeat(poll.PAD)}Qual linguagem`), 'título à esquerda com padding 2');
  const optLine = lines.find((l) => l.includes('1. Lua'));
  assert.ok(optLine.startsWith(`│${' '.repeat(poll.PAD)}1. Lua`), 'opção com o mesmo padding do título');
  assert.ok(lines[2].startsWith(`│${' '.repeat(poll.PAD)}atualmente`), 'continuação do título usa só o padding');
  ok('caixa: título e opções compartilham padding e alinhamento; continuação do título no mesmo recuo');

  // 13) continuação de opção alinha abaixo do texto (não do número)
  const cont = lines.find((l) => l.includes('longo que precisa continuar'));
  assert.ok(cont.startsWith(`│${' '.repeat(poll.PAD + 3)}longo`), 'recuo = padding + "1. " (5 espaços)');
  ok('caixa: continuação da opção alinha abaixo do texto (padding + prefixo "N. ")');

  // 14) recuo dinâmico para opção de 2 dígitos
  const many = poll.renderBox({
    title: 'T',
    items: Array.from({ length: 10 }, (_, i) =>
      i === 9 ? 'décima opção com texto bem longo para quebrar a linha' : `Opção ${i + 1}`
    ),
  });
  const cont10 = many.split('\n').find((l) => l.includes('quebrar a linha'));
  assert.ok(cont10, 'a 10ª opção quebrou linha');
  assert.ok(cont10.startsWith(`│${' '.repeat(poll.PAD + 4)}`), 'recuo = padding + "10. " (6 espaços)');
  assert.deepStrictEqual(widths(many), [poll.BOX_WIDTH]);
  ok('caixa: recuo calculado dinamicamente ("10. " → 6 espaços) e largura mantida');

  // 15) formatação não conta como caractere visível
  const fmt = poll.renderBox({ title: 'Título *negrito* aqui', items: ['Opção _italico_'] });
  assert.deepStrictEqual(widths(fmt), [poll.BOX_WIDTH], 'largura visual ignora * e _');
  assert.ok(fmt.includes('Título *negrito* aqui'), 'texto original preservado (sem alterar por alinhamento)');
  ok('caixa: largura visual ignora marcadores de formatação e preserva o texto original');

  // 16) palavra maior que a largura é cortada sem estourar a caixa
  const longWord = poll.renderBox({ title: 'X', items: ['a'.repeat(80)] });
  assert.deepStrictEqual(widths(longWord), [poll.BOX_WIDTH]);
  ok('caixa: palavra gigante é fatiada sem desalinhar a borda');

  /* -------------------------------------------------------- confirmação */

  // 17) !poll não envia nada
  reset();
  const c17 = fakeCtx({ args: ['Qual', 'linguagem', 'você', 'prefere?', '|', 'Lua', '|', 'JavaScript', '|', 'Python'] });
  await cmdPoll.execute(c17);
  assert.strictEqual(pollMsgs(c17).length, 0, 'nada enviado pelo comando');
  const card = c17.replies.join('\n');
  assert.match(card, /CONFIRMAÇÃO/);
  assert.match(card, /Você está prestes a enviar uma enquete\./);
  assert.match(card, /expira em 30 segundos/);
  assert.ok(card.includes('┌'), 'prévia mostra a caixa da enquete');
  const pend = pendingPoll.get(USER_A);
  assert.strictEqual(pend.type, 'poll');
  assert.strictEqual(pend.jid, CHAT, 'destino = chat atual');
  assert.deepStrictEqual(pend.data.values, ['Lua', 'JavaScript', 'Python']);
  assert.ok(pend.expiresAt > Date.now() + 25000);
  ok('!poll → nenhuma enquete enviada + prévia com a caixa + estado {type,jid,data,expiresAt}');

  // 18) confirmação envia
  const c18 = fakeCtx({ text: '1', socket: c17.socket, replies: c17.replies });
  assert.strictEqual(await pendingPoll.handleMessage(c18), true);
  assert.strictEqual(pollMsgs(c18).length, 1, 'enviou a enquete');
  assert.strictEqual(pollMsgs(c18)[0].jid, CHAT);
  assert.deepStrictEqual(pollMsgs(c18)[0].content.poll, {
    name: 'Qual linguagem você prefere?',
    values: ['Lua', 'JavaScript', 'Python'],
    selectableCount: 1,
    toAnnouncementGroup: false,
  });
  assert.strictEqual(pendingPoll.get(USER_A), null, 'estado limpo');
  ok('responder "1" → envia {poll:{...}} no chat e limpa o estado');

  // 19) cancelamento e resposta inválida
  reset();
  await cmdPoll.execute(fakeCtx({ args: ['P?', '|', 'A', '|', 'B'] }));
  const c19 = fakeCtx({ text: 'talvez' });
  await pendingPoll.handleMessage(c19);
  assert.strictEqual(pollMsgs(c19).length, 0);
  assert.match(c19.replies.join('\n'), /Resposta inválida/);
  assert.ok(pendingPoll.get(USER_A), 'pendência mantida');
  const c19b = fakeCtx({ text: 'cancel' });
  await pendingPoll.handleMessage(c19b);
  assert.strictEqual(pollMsgs(c19b).length, 0, 'cancel não envia');
  assert.strictEqual(pendingPoll.get(USER_A), null, 'estado limpo após cancelar');
  ok('resposta inválida re-pergunta; "cancel" aborta sem enviar');

  // 20) expiração
  reset();
  pendingPoll.set(USER_A, { type: 'poll', jid: CHAT, data: { name: 'P', values: ['A', 'B'], selectableCount: 1, toAnnouncementGroup: false }, remoteJid: CHAT, socket: fakeSocket() }, 20);
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(pendingPoll.get(USER_A), null);
  assert.strictEqual(pendingPoll.pendingPollConfirmations.has(USER_A), false);
  const c20 = fakeCtx({ text: '1' });
  assert.strictEqual(await pendingPoll.handleMessage(c20), false);
  assert.strictEqual(pollMsgs(c20).length, 0, 'confirmação fora do prazo não envia');
  ok('expiração: estado removido e confirmação tardia ignorada');

  // 21) isolamento + nova execução com pendência ativa
  reset();
  await cmdPoll.execute(fakeCtx({ sender: USER_A, args: ['P?', '|', 'A', '|', 'B'] }));
  const c21 = fakeCtx({ sender: USER_B, text: '1' });
  assert.strictEqual(await pendingPoll.handleMessage(c21), false, 'outro usuário não tem pendência');
  assert.strictEqual(pollMsgs(c21).length, 0);
  const c21b = fakeCtx({ sender: USER_A, args: ['Outra?', '|', 'X', '|', 'Y'] });
  await cmdPoll.execute(c21b);
  assert.match(c21b.replies.join('\n'), /já tem uma confirmação de enquete aguardando/);
  assert.strictEqual(pendingPoll.get(USER_A).data.name, 'P?', 'não sobrescreveu a pendência');
  ok('isolamento por senderJid e aviso quando já existe confirmação pendente');

  // 22) !pollresult
  reset();
  const c22 = fakeCtx({ args: ['Minha', 'enquete', '|', 'Lua:1000', '|', 'JavaScript:2000'] });
  await cmdResult.execute(c22);
  assert.strictEqual(pollMsgs(c22).length, 0, 'não envia sem confirmação');
  assert.match(c22.replies.join('\n'), /Você está prestes a enviar um resultado de enquete\./);
  assert.strictEqual(pendingPoll.get(USER_A).type, 'pollResult');
  await pendingPoll.handleMessage(fakeCtx({ text: 'sim', socket: c22.socket, replies: c22.replies }));
  assert.deepStrictEqual(pollMsgs(c22)[0].content.pollResult, {
    name: 'Minha enquete',
    values: [
      ['Lua', 1000],
      ['JavaScript', 2000],
    ],
  });
  ok('!pollresult → confirmação e envio de {pollResult:{name,values}}');

  // 23) falha no envio
  reset();
  const failSock = fakeSocket({ fail: true });
  await cmdPoll.execute(fakeCtx({ args: ['P?', '|', 'A', '|', 'B'], socket: failSock }));
  const c23 = fakeCtx({ text: '1', socket: failSock });
  await pendingPoll.handleMessage(c23);
  assert.strictEqual(pendingPoll.get(USER_A), null, 'estado limpo mesmo com falha');
  assert.match(c23.replies.join('\n'), /Não consegui criar a enquete/);
  assert.ok(!/at\s+\w+\.js:\d+/.test(c23.replies.join('\n')), 'sem stack');
  ok('falha no envio → mensagem amigável, estado limpo, sem stack');

  // 24) lib real: qual proto é gerado
  const { generateWAMessage } = require('@lucasmod/boruto-vk7-baileys/lib/Utils/messages');
  const opts = { userJid: BOT, upload: async () => ({}) };
  const v3 = await generateWAMessage(CHAT, { poll: { name: 'P', values: ['A', 'B'], selectableCount: 2 } }, opts);
  assert.ok(v3.message.pollCreationMessageV3, 'selectableCount>0 → pollCreationMessageV3');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(v3.message.pollCreationMessageV3.options)), [
    { optionName: 'A' },
    { optionName: 'B' },
  ]);
  assert.strictEqual(v3.message.pollCreationMessageV3.selectableOptionsCount, 2, 'selectableCount no proto');
  const v2 = await generateWAMessage(
    CHAT,
    { poll: { name: 'P', values: ['A', 'B'], selectableCount: 1, toAnnouncementGroup: true } },
    opts
  );
  assert.ok(v2.message.pollCreationMessageV2, 'toAnnouncementGroup → pollCreationMessageV2');
  const snap = await generateWAMessage(
    CHAT,
    { pollResult: { name: 'P', values: [['A', 10], ['B', 20]] } },
    opts
  );
  // int64 vira string na serialização protobuf — é o formato de linha real
  assert.deepStrictEqual(JSON.parse(JSON.stringify(snap.message.pollResultSnapshotMessage.pollVotes)), [
    { optionName: 'A', optionVoteCount: '10' },
    { optionName: 'B', optionVoteCount: '20' },
  ]);
  assert.strictEqual(String(snap.message.pollResultSnapshotMessage.pollVotes[0].optionVoteCount), '10');
  assert.strictEqual(snap.message.pollResultSnapshotMessage.name, 'P', 'nome da enquete no proto');
  ok('lib vendored: poll → V3/V2 e pollResult → pollResultSnapshotMessage.pollVotes');

  // 25) caminho real (handleMessage)
  reset();
  const handler = require('../handlers/commandHandler');
  const realSock = fakeSocket();
  const msg = (id, text) => ({
    key: { remoteJid: USER_A, fromMe: false, id },
    message: { extendedTextMessage: { text } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  });
  await handler.handleMessage(realSock, msg('P1', '!poll Qual linguagem você prefere? | Lua | JavaScript | Python'));
  assert.strictEqual(realSock.sent.filter((m) => m.content && m.content.poll).length, 0, 'não envia pelo pipeline');
  assert.ok(pendingPoll.get(USER_A), 'pendência criada pelo pipeline real');
  await handler.handleMessage(realSock, msg('P2', '1'));
  const realPolls = realSock.sent.filter((m) => m.content && m.content.poll);
  assert.strictEqual(realPolls.length, 1, 'o "1" pelo pipeline real cria a enquete');
  assert.strictEqual(pendingPoll.size(), 0);
  ok('caminho real (handleMessage): !poll não envia, "1" envia');

  reset();
  database.close();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
  }
  console.log(`\n✅ poll/pollresult (parser + caixa + confirmação): ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ poll: ${err.stack || err.message}`);
  process.exit(1);
});
