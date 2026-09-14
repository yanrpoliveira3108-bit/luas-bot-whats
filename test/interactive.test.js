/**
 * test/interactive.test.js — regressões de botões/listas e sugestão de comandos.
 *
 * Bugs reais cobertos aqui:
 *  1. utils/interactive.sendButtons lia `b.label`, mas todos os callers do
 *     projeto mandam `b.text` → todo botão saía com o texto "undefined"
 *     (as sugestões "quis dizer?" ficavam sem rótulo).
 *  2. Texto com "\n" ESCAPADO (backslash + n, vindo de .env/banco/string
 *     montada) chegava cru ao WhatsApp → mensagem de botões rejeitada e
 *     sendButtons caindo no fallback em silêncio.
 *  3. handlers/buttonHandler só despachava IDs registrados em memória: um
 *     clique em lua:suggest_<comando> depois de restart não fazia nada.
 *  4. utils/fuzzySearch sugeria qualquer coisa com até 60% de distância;
 *     o critério é Levenshtein <= 3 (ou substring).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

// banco isolado (não toca no banco de produção)
const TEST_DB = path.resolve(__dirname, '..', 'database', 'lua-interactive-test.db');
process.env.DATABASE_FILE = TEST_DB;
for (const suf of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(TEST_DB + suf, { force: true });
  } catch (_) {}
}

const CONFIG = require('../config');
CONFIG.helpers.ensureDirs();

const interactive = require('../utils/interactive');
const buttonHandler = require('../handlers/buttonHandler');
const fuzzy = require('../utils/fuzzySearch');

let n = 0;
function ok(label) {
  n += 1;
  console.log(`✅ ${n}: ${label}`);
}

/** socket falso que captura os payloads em vez de enviar ao WhatsApp */
function fakeSocket() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, payload) => {
      sent.push({ jid, payload });
      return { key: { id: 'FAKE' } };
    },
  };
}

async function main() {
  /* ---------------- 1) rótulo dos botões vem de `text` ---------------- */
  {
    const sock = fakeSocket();
    const sent = await interactive.sendButtons(sock, '5511999990000@s.whatsapp.net', {
      text: '❌ Comando não existe',
      footer: 'Lua • !menu',
      buttons: [
        { id: 'lua:suggest_ping', text: '!ping' },
        { id: 'lua:help_ping', text: '❓ Ajuda ping' },
      ],
    });
    assert.strictEqual(sent, true, 'sendButtons deveria ter enviado');
    const labels = sock.sent[0].payload.buttons.map((b) => b.buttonText.displayText);
    assert.deepStrictEqual(labels, ['!ping', '❓ Ajuda ping'], `rótulos errados: ${JSON.stringify(labels)}`);
    assert.ok(
      !labels.some((l) => /undefined/.test(l)),
      'nenhum botão pode sair como "undefined"'
    );
    assert.deepStrictEqual(
      sock.sent[0].payload.buttons.map((b) => b.buttonId),
      ['lua:suggest_ping', 'lua:help_ping'],
      'buttonId deve ser preservado para o clique resolver'
    );
    ok('sendButtons usa `text` do caller (regressão do rótulo "undefined")');
  }

  /* ---------------- 2) "\n" escapado vira quebra de linha real ---------------- */
  {
    const sock = fakeSocket();
    // string com "\n" LITERAL (backslash + n) — o caso que quebrava o envio
    const dirty = 'linha1\\nlinha2\\n\\n\\n\\nlinha3   ';
    await interactive.sendButtons(sock, 'j@s.whatsapp.net', {
      text: dirty,
      footer: 'rodapé\\nextra',
      buttons: [{ id: 'lua:suggest_ping', text: '!ping' }],
    });
    const text = sock.sent[0].payload.text;
    assert.ok(!text.includes('\\n'), 'não pode sobrar "\\n" literal na legenda');
    assert.ok(text.includes('\n'), 'as quebras de linha reais devem existir');
    assert.ok(!/\n{3,}/.test(text), 'no máximo uma linha em branco');
    assert.strictEqual(text, 'linha1\nlinha2\n\nlinha3', `texto normalizado errado: ${JSON.stringify(text)}`);
    assert.strictEqual(sock.sent[0].payload.footer, 'rodapé\nextra', 'rodapé também normalizado');
    ok('sendButtons converte "\\n" escapado em quebra de linha real');
  }

  /* ---------------- 3) rótulo sanitizado (sem quebra, máx. 24) ---------------- */
  {
    const sock = fakeSocket();
    await interactive.sendButtons(sock, 'j@s.whatsapp.net', {
      text: 'x',
      buttons: [{ id: 'lua:suggest_play', text: '!play\\nmúsica muito grande aqui' }],
    });
    const label = sock.sent[0].payload.buttons[0].buttonText.displayText;
    assert.ok(!label.includes('\n'), 'rótulo não pode ter quebra de linha');
    assert.ok(label.length <= 24, `rótulo deve ter <= 24 chars (veio ${label.length})`);
    ok('rótulo de botão sem quebra de linha e dentro de 24 chars');
  }

  /* ---------------- 4) sem botão válido → false (fallback de texto) ---------------- */
  {
    const sock = fakeSocket();
    const sent = await interactive.sendButtons(sock, 'j@s.whatsapp.net', {
      text: 'oi',
      buttons: [{ id: 'sem_rotulo' }, null],
    });
    assert.strictEqual(sent, false, 'sem rótulo válido deve devolver false');
    assert.strictEqual(sock.sent.length, 0, 'nada deve ser enviado ao WhatsApp');
    ok('sendButtons devolve false quando não há botão válido (caller cai no texto)');
  }

  /* ---------------- 5) sendList aceita linhas {id, text} ---------------- */
  {
    const sock = fakeSocket();
    const sent = await interactive.sendList(sock, 'j@s.whatsapp.net', {
      title: 'Resultados\\nde busca',
      text: 'escolha',
      sections: [{ title: 'seção', rows: [{ id: 'lua:suggest_ping', text: '!ping — testa resposta' }] }],
    });
    assert.strictEqual(sent, true, 'sendList deveria ter enviado');
    const row = sock.sent[0].payload.sections[0].rows[0];
    assert.strictEqual(row.rowId, 'lua:suggest_ping', 'rowId preservado');
    assert.ok(!/undefined/.test(row.title), 'título da linha não pode ser "undefined"');
    assert.ok(!sock.sent[0].payload.title.includes('\\n'), 'título da lista normalizado');
    ok('sendList aceita linhas {id, text} e normaliza títulos');
  }

  /* ---------------- 6) dispatch dinâmico dos botões de sugestão ---------------- */
  {
    assert.deepStrictEqual(
      buttonHandler.resolveDynamic('lua:suggest_ping'),
      { kind: 'command', name: 'ping' },
      'lua:suggest_ping deve resolver para o comando ping'
    );
    assert.deepStrictEqual(
      buttonHandler.resolveDynamic('lua:help_suggest_play'),
      { kind: 'help', name: 'play' },
      'lua:help_suggest_play deve resolver para ajuda do play'
    );
    assert.deepStrictEqual(
      buttonHandler.resolveDynamic('lua:use_sticker'),
      { kind: 'command', name: 'sticker' },
      'lua:use_sticker deve resolver para o comando sticker'
    );
    assert.strictEqual(buttonHandler.resolveDynamic('lua:open_menu'), null, 'IDs não dinâmicos → null');
    assert.strictEqual(buttonHandler.resolveDynamic('lua:help_'), null, 'ID sem nome → null');
    ok('buttonHandler.resolveDynamic interpreta suggest_/help_/use_');
  }

  /* ---------------- 7) clique real executa o comando sugerido ---------------- */
  {
    const database = require('../database/database');
    database.open();
    const { loadCommands } = require('../commands/loader');
    loadCommands(true);

    const replies = [];
    const ctx = {
      message: {
        key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'CLICK1', fromMe: false },
        message: { buttonsResponseMessage: { selectedButtonId: 'lua:suggest_ping' } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
      socket: fakeSocket(),
      remoteJid: '5511999990000@s.whatsapp.net',
      sender: '5511999990000@s.whatsapp.net',
      isGroup: false,
      isOwner: true,
      isAdmin: false,
      isBotAdmin: false,
      isRegistered: true,
      prefix: '!',
      args: [],
      text: '',
      reply: async (t) => {
        replies.push(t);
      },
    };

    const handled = await buttonHandler.process(ctx);
    assert.strictEqual(handled, true, 'o clique deveria ser tratado');
    assert.ok(replies.length > 0, 'o comando sugerido deveria ter respondido');
    assert.ok(/Pong/i.test(replies.join('\n')), `esperava resposta do !ping, veio: ${replies.join(' | ')}`);
    ok('clique em lua:suggest_ping executa !ping na hora (sem registro prévio)');

    database.close();
  }

  /* ---------------- 8) fuzzy: Levenshtein <= 3 ---------------- */
  {
    const { registry } = require('../engine/plugins');
    const all = registry.all();
    assert.ok(all.length > 300, `registry deveria ter os comandos todos (veio ${all.length})`);

    const near = fuzzy.findSimilarCommands('pingg', all, 3);
    assert.ok(near.length > 0, 'pingg deveria sugerir algo');
    assert.strictEqual(near[0].cmd.name, 'ping', 'melhor sugestão para "pingg" é ping');
    assert.ok(near[0].distance <= 3, `distância deve ser <= 3 (veio ${near[0].distance})`);

    const far = fuzzy.findSimilarCommands('qwzrtvbk', all, 3);
    assert.deepStrictEqual(far, [], 'comando totalmente distante não deve gerar sugestão');

    const sub = fuzzy.findSimilarCommands('stick', all, 3);
    assert.ok(
      sub.some((s) => s.cmd.name === 'sticker'),
      'substring "stick" deve sugerir sticker'
    );
    ok(`fuzzy sugere só Levenshtein <= 3 (registry com ${all.length} comandos)`);
  }

  /* limpeza */
  for (const suf of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(TEST_DB + suf, { force: true });
    } catch (_) {}
  }

  console.log(`\n✅ interactive/buttons: ${n} verificações, 0 falhas`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err && err.stack ? err.stack : err);
  process.exit(1);
});
