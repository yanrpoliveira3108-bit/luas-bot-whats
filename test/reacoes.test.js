#!/usr/bin/env node
/**
 * test/reacoes.test.js — reações contextuais + resposta de prefixo.
 *
 * utils/reactionTopics.js, utils/contextReact.js, utils/prefixReply.js e o
 * comando !prefix sem argumentos. Socket FALSO que só registra sendMessage
 * (mesmo formato real: sendMessage(jid, { react: { text, key } })).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-reacoes-test.db');
fs.rmSync(DB, { force: true });
process.env.DATABASE_FILE = DB;
require('../database/database').open();

const topics = require('../utils/reactionTopics');
const react = require('../utils/contextReact');
const prefixReply = require('../utils/prefixReply');
const settings = require('../database/settings');

let falhas = 0;
let feitos = 0;
async function caso(nome, fn) {
  try {
    await fn();
    feitos++;
    console.log('✅ ' + nome);
  } catch (e) {
    falhas++;
    console.log('❌ ' + nome + ' — ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}

const BOT = { id: '5519988887777:3@s.whatsapp.net', lid: '111222333444555:3@lid', name: 'Lua' };
function sockFalso(opts = {}) {
  const enviados = [];
  return {
    user: BOT,
    enviados,
    sendMessage: async (jid, conteudo) => {
      enviados.push({ jid, conteudo });
      if (opts.falhar) throw new Error('rede caiu');
      return { key: { id: 'R' + enviados.length } };
    },
  };
}
let seq = 0;
function msg(texto, extra = {}) {
  seq++;
  const m = {
    key: { remoteJid: extra.jid || '120363000000000001@g.us', id: 'MSG' + seq, fromMe: false, participant: '5511900000000@s.whatsapp.net' },
    message: extra.message || { conversation: texto },
  };
  return m;
}
function citando(texto, participant) {
  return msg(texto, {
    message: {
      extendedTextMessage: {
        text: texto,
        contextInfo: { stanzaId: 'BOTMSG1', participant, quotedMessage: { conversation: 'oi' } },
      },
    },
  });
}
const esperar = () => new Promise((r) => setImmediate(r));

(async () => {
  await caso('1: mapa de tópicos tem os emojis pedidos', () => {
    const e = (t) => topics.emojiDe(t);
    assert.strictEqual(e('tecnico'), '💻');
    assert.strictEqual(e('menu'), '🧭');
    assert.strictEqual(e('conversa'), '💬');
    assert.strictEqual(e('topico-que-nao-existe'), '💬');
  });

  await caso('2: comando → tópico por nome/categoria real', () => {
    assert.strictEqual(topics.topicoDoComando({ name: 'menu', category: 'general' }), 'menu');
    assert.strictEqual(topics.topicoDoComando({ name: 'horariogrupo', category: 'admin' }) !== 'conversa', true);
    assert.strictEqual(topics.topicoDoComando(null), 'conversa');
    // categoria desconhecida → técnico (nunca quebra)
    assert.strictEqual(topics.topicoDoComando({ name: 'x', category: 'inexistente' }), 'tecnico');
  });

  await caso('3: texto casa só PALAVRA INTEIRA (sem substring)', () => {
    assert.strictEqual(topics.topicoDoTexto('qual o prefixo?'), 'tecnico');
    assert.strictEqual(topics.topicoDoTexto('prefixoso demais'), null);
    assert.strictEqual(topics.topicoDoTexto(''), null);
  });

  await caso('4: resposta ao bot — por id E por lid, com device', () => {
    const s = sockFalso();
    assert.strictEqual(react.respondeAoBot(s, citando('oi', '5519988887777@s.whatsapp.net')), true);
    assert.strictEqual(react.respondeAoBot(s, citando('oi', '111222333444555@lid')), true);
    assert.strictEqual(react.respondeAoBot(s, citando('oi', '5511900000000@s.whatsapp.net')), false);
    assert.strictEqual(react.respondeAoBot(s, msg('sem citação')), false);
    assert.strictEqual(react.respondeAoBot({}, citando('oi', '5519988887777@s.whatsapp.net')), false);
  });

  await caso('5: uma reação por mensagem (dedupe chat+id)', async () => {
    react._reset();
    const s = sockFalso();
    const m = msg('!menu');
    assert.strictEqual(react.reagirTema(s, m, '🧭'), true);
    assert.strictEqual(react.reagirTema(s, m, '💻'), false);
    await esperar();
    await esperar();
    assert.strictEqual(s.enviados.length, 1);
    assert.deepStrictEqual(s.enviados[0].conteudo, { react: { text: '🧭', key: m.key } });
    assert.strictEqual(s.enviados[0].jid, m.key.remoteJid);
  });

  await caso('6: mesmo id em OUTRO chat é outra mensagem', async () => {
    react._reset();
    const s = sockFalso();
    const a = msg('x');
    const b = { ...a, key: { ...a.key, remoteJid: '5511900000000@s.whatsapp.net' } };
    assert.strictEqual(react.reagirTema(s, a, '💬'), true);
    assert.strictEqual(react.reagirTema(s, b, '💬'), true);
  });

  await caso('7: reação, protocolo e status nunca recebem reação', () => {
    react._reset();
    const s = sockFalso();
    assert.strictEqual(react.reagivel(msg('', { message: { reactionMessage: { text: '👍' } } })), false);
    assert.strictEqual(react.reagivel(msg('', { message: { protocolMessage: {} } })), false);
    assert.strictEqual(react.reagivel(msg('oi', { jid: 'status@broadcast' })), false);
    assert.strictEqual(react.reagirTema(s, msg('', { message: { reactionMessage: {} } }), '💬'), false);
  });

  await caso('8: falha ao reagir NÃO rejeita nem lança', async () => {
    react._reset();
    const s = sockFalso({ falhar: true });
    const m = msg('!menu');
    assert.strictEqual(react.reagirTema(s, m, '🧭'), true);
    const ok = await react.enviar(s, msg('y'), '💻');
    assert.strictEqual(ok, false);
    // socket sem sendMessage / msg sem key
    assert.strictEqual(await react.enviar({}, m, '💻'), false);
    assert.strictEqual(react.reagirTema(s, { message: {} }, '💻'), false);
  });

  await caso('9: reagirComando/reagirResposta usam o ctx real', async () => {
    react._reset();
    const s = sockFalso();
    const m1 = msg('!menu');
    react.reagirComando({ socket: s, message: m1 }, { name: 'menu', category: 'general' });
    const m2 = citando('valeu', '5519988887777@s.whatsapp.net');
    react.reagirResposta({ socket: s, message: m2, text: 'bom dia pessoal' });
    await esperar();
    await esperar();
    assert.strictEqual(s.enviados[0].conteudo.react.text, '🧭');
    assert.strictEqual(s.enviados[1].conteudo.react.text, '💬');
  });

  await caso('10: pedido de prefixo — claro sim, menção solta não', () => {
    for (const t of ['prefixo', 'qual o prefixo?', 'Qual é o seu prefixo', 'prefix', 'me passa o prefixo por favor']) {
      assert.strictEqual(prefixReply.ehPedidoDePrefixo(t), true, t);
    }
    for (const t of ['não gostei desse prefixo', 'prefixos', 'bom dia', '', 'qual o prefixo do outro grupo de amigos meus']) {
      assert.strictEqual(prefixReply.ehPedidoDePrefixo(t), false, t);
    }
  });

  await caso('11: resposta de prefixo usa o prefixo EFETIVO (nunca "!" fixo)', () => {
    settings.setPrefix ? settings.setPrefix('#') : settings.set('prefix', '#');
    const eff = settings.effectivePrefix();
    const txt = prefixReply.textoPrefixo({ isGroup: true, prefix: '!' });
    assert.strictEqual(txt, `💻 Meu prefixo neste grupo é: ${eff}\n🧭 Para abrir o menu, envie: ${eff}menu`);
    assert.ok(!txt.includes('!'), txt);
    assert.ok(prefixReply.textoPrefixo({ isGroup: false }).includes('nesta conversa'));
  });

  await caso('12: !prefix sem argumento responde o texto padronizado', async () => {
    const cmds = [].concat(require('../commands/general/prefix'));
    const cmd = cmds.find((c) => c.name === 'prefix' || (c.commands || []).includes('prefix'));
    let resposta = null;
    await cmd.execute({ args: [], prefix: settings.effectivePrefix(), isGroup: true, isOwner: false, reply: async (t) => (resposta = t) });
    assert.strictEqual(resposta, prefixReply.textoPrefixo({ isGroup: true }));
  });

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  try {
    require('../database/database').close();
  } catch (_) {}
  fs.rmSync(DB, { force: true });
  process.exit(falhas ? 1 : 0);
})();
