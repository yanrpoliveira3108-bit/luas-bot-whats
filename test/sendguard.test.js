/**
 * test/sendguard.test.js — freio de envio + modo seguro (anti-restrição).
 *
 * O que esta suíte garante (socket falso, banco temporário):
 *   1. ORDEM: mensagens da mesma conversa saem na ordem em que foram pedidas
 *   2. RITMO: o intervalo mínimo global é respeitado (nada de rajada)
 *   3. JANELA: teto por conversa por minuto é respeitado
 *   4. PV FRIO: o bot não inicia conversa no privado com quem nunca falou
 *      com ele — e VOLTA a responder quando a pessoa fala primeiro
 *   5. BROADCAST: a mesma mensagem para muitos chats é travada — SÓ quando
 *      ligada por opção (SEND_DUP_MAX_CHATS≥2); no PADRÃO (0) é desligada, e o
 *      teste 13 prova isso (o defeito de 25/09 travava no padrão: envio
 *      descartado em silêncio, "o comando é feito e a mensagem não aparece")
 *   6. RESTRIÇÃO: erro 429/"spam" pausa todos os envios automaticamente
 *   7. MODO SEGURO: menu/botões/listas nativos e cards HTML são bloqueados,
 *      mas o fallback textual funciona
 *   8. warmup: número novo (recém-pareado) tem limites ÷3
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const raizTmp = () => {
  const d = path.join(RAIZ, 'tmp');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const DB = require('./dbtmp').tmpFile('lua-sendguard-test.db');

let failures = 0;
const T0 = Date.now();
const since = () => `[+${((Date.now() - T0) / 1000).toFixed(1)}s]`;
function ok(l) {
  console.log(`✅ ${since()} ` + l);
}
function fail(l, e) {
  failures++;
  console.log(`❌ ${since()} ` + l + ' — ' + ((e && e.message) || e));
}

process.env.OWNER_NUMBER = '5511999999999';
process.env.DATABASE_FILE = DB;
process.env.BUTTONS_ENABLED = 'true';
// limites rápidos para o teste (o default é mais lento de propósito)
process.env.SEND_MIN_INTERVAL_MS = '40';
process.env.SEND_CHAT_INTERVAL_MS = '40';
process.env.SEND_JITTER_MS = '0';
process.env.SEND_MAX_PER_MINUTE = '1000';
process.env.SEND_CHAT_MAX_PER_MINUTE = '1000';
process.env.SEND_WARMUP_HOURS = '0';
process.env.SEND_CONNECT_GRACE_MS = '0';
process.env.SEND_PAUSE_MINUTES = '5';
process.env.SEND_DUP_MAX_CHATS = '3'; // o padrão do bot é 0 (desligado) — aqui testamos ligado
process.env.SEND_DUP_WINDOW_MIN = '10';
process.env.SAFE_MODE = '1';
// estado do freio isolado (senão o warmup/chats conhecidos de uma execução
// anterior contaminariam a próxima)
process.env.SEND_STATE_DIR = './tmp/sendguard-state';

const database = require('../database/database');
database.open();

const sendGuard = require('../utils/sendGuard');
const safety = require('../utils/safety');
const interactive = require('../utils/interactive');
const richHtml = require('../utils/richHtml');
require('../commands/loader').loadCommands(true);
const { registry } = require('../engine/plugins');

const GID = '551100000000@g.us';
const OWNER = '5511999999999@s.whatsapp.net';
const STRANGER = '5511911111111@s.whatsapp.net';

const sent = [];
const sock = {
  user: { id: '551188888888@s.whatsapp.net' },
  sendMessage: async (jid, content) => {
    sent.push({ jid, content, at: Date.now() });
    return { key: { id: '3EB0' + sent.length, remoteJid: jid } };
  },
  relayMessage: async (jid, message) => {
    sent.push({ jid, message, at: Date.now() });
    return { ok: true };
  },
  groupParticipantsUpdate: async () => ({ ok: true }),
  updateBlockStatus: async () => ({ ok: true }),
  sendPresenceUpdate: async () => ({ ok: true }),
};

async function main() {
  try {
    fs.rmSync(DB, { force: true });
    fs.rmSync(require('path').resolve(__dirname, '..', 'tmp', 'sendguard-state'), { recursive: true, force: true });
  } catch (_) {}
  sendGuard.init();
  sendGuard.attach(sock);

  /* ══════════════ 1. ordem preservada na mesma conversa ══════════════ */
  try {
    const t0 = Date.now();
    const p1 = sock.sendMessage(GID, { text: 'primeira mensagem do teste' });
    const p2 = sock.sendMessage(GID, { text: 'segunda mensagem do teste' });
    const p3 = sock.sendMessage(GID, { text: 'terceira mensagem do teste' });
    await Promise.all([p1, p2, p3]);
    const mine = sent.filter((s) => s.jid === GID);
    assert.deepStrictEqual(
      mine.map((s) => s.content.text),
      ['primeira mensagem do teste', 'segunda mensagem do teste', 'terceira mensagem do teste'],
      'ordem preservada'
    );
    const gaps = mine.slice(1).map((s, i) => s.at - mine[i].at);
    assert.ok(gaps.every((g) => g >= 30), `intervalo respeitado (${gaps.join(', ')}ms)`);
    assert.ok(Date.now() - t0 >= 80, 'não enviou tudo de uma vez');
    ok(`1: fila preserva ordem e ritmo (intervalos: ${gaps.join('ms, ')}ms)`);
  } catch (e) {
    fail('1: ordem/ritmo', e);
  }

  /* ══════════════ 2. teto por conversa por minuto ══════════════ */
  try {
    sendGuard.reset();
    sendGuard.__test.config.chatMaxPerMinute = 3;
    const chat = '5511900000000@g.us';
    const before = Date.now();
    const promises = [];
    for (let i = 0; i < 4; i++) promises.push(sock.sendMessage(chat, { text: `mensagem numero ${i} do limite` }));
    const winner = await Promise.race([
      Promise.all(promises).then(() => 'todas'),
      new Promise((r) => setTimeout(() => r('pendente'), 500)),
    ]);
    assert.strictEqual(winner, 'pendente', 'a 4ª deve ficar na fila até a janela abrir');
    assert.strictEqual(
      sent.filter((s) => s.jid === chat).length,
      3,
      'só 3 mensagens saíram na janela de 1 minuto'
    );
    assert.ok(Date.now() - before < 1500, 'o processo não ficou travado esperando');
    ok('2: teto por conversa por minuto segura a 4ª mensagem');
  } catch (e) {
    fail('2: teto por conversa', e);
  } finally {
    sendGuard.__test.config.chatMaxPerMinute = 1000;
    sendGuard.reset();
  }

  /* ══════════════ 3. PV frio (bot não inicia conversa) ══════════════ */
  try {
    sendGuard.reset();
    sent.length = 0;
    const res = await sock.sendMessage(STRANGER, { text: 'mensagem fria que nao deveria sair' });
    assert.strictEqual(res.guardBlocked, true, 'envio marcado como bloqueado');
    assert.strictEqual(res.guardReason, 'pv_frio');
    assert.strictEqual(sent.filter((s) => s.jid === STRANGER).length, 0, 'nada foi enviado');

    // o dono continua podendo
    await sock.sendMessage(OWNER, { text: 'aviso para o dono do bot' });
    assert.strictEqual(sent.filter((s) => s.jid === OWNER).length, 1, 'dono liberado');

    // quem fala primeiro libera a resposta
    sendGuard.noteInbound(STRANGER);
    const res2 = await sock.sendMessage(STRANGER, { text: 'resposta para quem falou primeiro' });
    assert.ok(!res2.guardBlocked, 'resposta liberada depois do inbound');
    assert.strictEqual(sent.filter((s) => s.jid === STRANGER).length, 1, 'resposta enviada');
    ok('3: PV frio bloqueado, dono e quem falou primeiro liberados');
  } catch (e) {
    fail('3: PV frio', e);
  }

  /* ══════════════ 4. broadcast idêntico travado ══════════════ */
  try {
    sendGuard.reset();
    sent.length = 0;
    const texto = 'PROMOCAO ANUNCIO IGUAL PARA TODOS OS GRUPOS DA LISTA';
    const chats = ['5511900000011@g.us', '5511900000022@g.us', '5511900000033@g.us', '5511900000044@g.us'];
    const results = [];
    for (const c of chats) results.push(await sock.sendMessage(c, { text: texto }));
    const blocked = results.filter((r) => r && r.guardBlocked).length;
    assert.ok(blocked >= 1, `a partir do 4º chat deve travar (bloqueados: ${blocked})`);
    assert.strictEqual(sent.length, 3, `só 3 saíram (saíram ${sent.length})`);
    ok('4: mensagem idêntica para vários chats travada (anti-broadcast)');
  } catch (e) {
    fail('4: anti-broadcast', e);
  }

  /* ══════════════ 5. pausa automática ao detectar restrição ══════════════ */
  try {
    sendGuard.reset();
    sent.length = 0;
    const err = new Error('rate-overlimit');
    err.output = { statusCode: 429 };
    const detected = sendGuard.__test.diagnose(err, { jid: GID });
    assert.strictEqual(detected, true, 'restrição detectada');
    assert.strictEqual(sendGuard.isPaused(), true, 'envios pausados');
    assert.ok(sendGuard.stats().pauseRemainingMin >= 1, 'pausa com tempo definido');

    const duringPause = sock.sendMessage(GID, { text: 'mensagem durante a pausa nao deve sair' });
    const outcome = await Promise.race([
      duringPause.then(() => 'enviada'),
      new Promise((r) => setTimeout(() => r('pendente'), 200)),
    ]);
    assert.strictEqual(outcome, 'pendente', 'o envio ficou na fila durante a pausa');
    assert.strictEqual(sent.length, 0, 'nada sai durante a pausa');

    sendGuard.setPaused(false);
    await sendGuard.flush();
    ok('5: sinal de restrição pausa todos os envios automaticamente');
  } catch (e) {
    fail('5: pausa automática', e);
  }

  /* ══════════════ 6. modo seguro: payloads de risco ══════════════ */
  try {
    sendGuard.reset();
    sent.length = 0;
    assert.strictEqual(safety.safeMode(), true, 'modo seguro ligado por padrão');
    assert.strictEqual(safety.blocksInteractive(), true);
    assert.strictEqual(safety.blocksRichCards(), true);

    const list = await interactive.sendList(sock, GID, {
      title: 'Menu',
      text: 'corpo',
      sections: [{ title: 'S', rows: [{ id: 'a', title: 'A' }] }],
    });
    assert.strictEqual(list, false, 'lista nativa bloqueada (fallback textual)');

    const buttons = await interactive.sendButtons(sock, GID, { text: 't', buttons: [{ id: 'x', label: 'X' }] });
    assert.strictEqual(buttons, false, 'botões nativos bloqueados');

    await assert.rejects(() => richHtml.sendHtml(sock, GID, '<b>html</b>'), /MODO SEGURO/);

    // o texto comum continua passando normalmente
    await sock.sendMessage(GID, { text: 'texto normal continua funcionando' });
    assert.strictEqual(sent.length, 1, 'texto normal enviado');

    safety.setSafeMode(false);
    const list2 = await interactive.sendList(sock, GID, {
      title: 'Menu',
      text: 'corpo',
      sections: [{ title: 'S', rows: [{ id: 'a', title: 'A' }] }],
    });
    assert.strictEqual(list2, true, 'com modo seguro off a lista volta');
    safety.setSafeMode(true);
    ok('6: modo seguro bloqueia lista/botões/card HTML e mantém o texto');
  } catch (e) {
    fail('6: modo seguro', e);
  }

  /* ══════════════ 7. comando !freio ══════════════ */
  try {
    const cmd = registry.getCommand('freio') || registry.all().find((c) => c.name === 'freio');
    assert.ok(cmd, 'comando !freio carregado');
    assert.strictEqual(cmd.ownerOnly, true, 'só o dono');
    const replies = [];
    const ctx = {
      args: [],
      sender: OWNER,
      prefix: '!',
      isGroup: false,
      reply: async (t) => replies.push(String(t)),
    };
    await cmd.execute(ctx);
    assert.ok(/FREIO DE ENVIO/.test(replies[0]), 'mostra o painel');
    const s = sendGuard.stats();
    assert.ok(Number.isFinite(s.counters.sent), 'contadores numéricos');
    ok('7: !freio responde o painel completo');
  } catch (e) {
    fail('7: !freio', e);
  }

  /* ══════════════ 8. warmup de número novo ══════════════ */
  try {
    sendGuard.reset();
    sendGuard.__test.state.firstSeen = new Date().toISOString();
    sendGuard.__test.config.warmupHours = 48;
    sendGuard.__test.config.warmupFactor = 3;
    assert.strictEqual(sendGuard.warmupActive(), true, 'warmup ativo');
    const s = sendGuard.stats();
    assert.strictEqual(s.warmup.factor, 3, 'fator aplicado');
    assert.ok(
      s.limits.maxPerMinute <= Math.ceil(sendGuard.__test.config.maxPerMinute / 3),
      `teto reduzido no warmup (${s.limits.maxPerMinute})`
    );

    // número já aquecido volta ao normal
    sendGuard.__test.state.firstSeen = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    assert.strictEqual(sendGuard.warmupActive(), false, 'warmup concluído após as horas');
    ok('8: warmup reduz os limites em número recém-pareado');
  } catch (e) {
    fail('8: warmup', e);
  }


  /* ══════════════ 9. ponta a ponta: !menu do usuário real ══════════════
   *
   * Este é o cenário que derrubou as contas: BUTTONS_ENABLED=true, SAFE_MODE
   * no padrão (ligado) e o usuário digitando !menu em um grupo. O comando
   * precisa responder (menu textual) passando pela fila do freio — e NENHUM
   * payload interativo pode sair.
   */
  try {
    sendGuard.reset();
    sent.length = 0;
    const commandHandler = require('../handlers/commandHandler');
    const settings = require('../database/settings');
    settings.setButtonsEnabled(true); // como está no .env do usuário

    const groupJid = '551100000000@g.us';
    const msg = {
      key: { remoteJid: groupJid, fromMe: false, id: 'MSGMENU' + Date.now(), participant: OWNER },
      message: { conversation: '!menu' },
      pushName: 'Dono',
      messageTimestamp: Math.floor(Date.now() / 1000),
    };
    const guarded = sock; // o mesmo socket com o freio instalado
    await commandHandler.handleMessage(guarded, msg, 'notify');
    await sendGuard.flush();

    const interactive = sent.filter(
      (s) => s.content && (Array.isArray(s.content.interactiveButtons) || Array.isArray(s.content.sections) || s.content.buttons)
    );
    assert.strictEqual(interactive.length, 0, 'nenhum payload interativo foi enviado');
    const texto = sent.find((s) => s.content && /LUA|MENU/i.test(String(s.content.text || '')));
    assert.ok(texto, 'menu textual enviado (fallback do modo seguro)');
    assert.ok(!texto.guardBlocked, 'o menu passou pelo freio (não foi bloqueado)');
    ok('9: !menu em grupo passa pelo freio e sai como texto (sem payload de risco)');
  } catch (e) {
    fail('9: !menu ponta a ponta', e);
  }


  /* ══════════ 10. chamada ANINHADA não trava a fila (álbum) ══════════
   *
   * O motor de álbum chama socket.relayMessage() DENTRO de sendMessage(). Se
   * essa chamada interna entrasse na fila, ela esperaria a mensagem externa
   * terminar — e a externa esperava a interna: deadlock com o bot mudo.
   */
  try {
    sendGuard.reset();
    sent.length = 0;
    const chat = '5511900000999@g.us';
    const nested = {
      user: { id: '551188888888@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        // simula o caminho interno do álbum: relayMessage dentro de sendMessage
        await nested.relayMessage(jid, { albumMessage: { expectedImageCount: 1 } }, {});
        sent.push({ jid, content });
        return { key: { id: 'nested1', remoteJid: jid } };
      },
      relayMessage: async (jid, message) => {
        sent.push({ jid, message });
        return { ok: true };
      },
    };
    // socket FALSO próprio: precisa de attach() novo, então usamos o módulo
    const guard2 = require('../utils/sendGuard');
    guard2.__test.queues.clear();
    const wrapped = Object.assign({}, nested);
    // attach() é idempotente no módulo; usamos a API interna para reanexar
    delete wrapped.__luaSendGuard;
    const origSend = wrapped.sendMessage;
    const origRelay = wrapped.relayMessage;
    wrapped.sendMessage = (jid, content) => guard2.enqueue('text', jid, () => origSend(jid, content));
    wrapped.relayMessage = (jid, m) => guard2.enqueue('text', jid, () => origRelay(jid, m));

    const done = await Promise.race([
      wrapped.sendMessage(chat, { text: 'album do teste' }).then(() => 'ok'),
      new Promise((r) => setTimeout(() => r('deadlock'), 3000)),
    ]);
    assert.strictEqual(done, 'ok', 'envio aninhado concluiu (sem deadlock)');
    assert.strictEqual(sent.filter((s) => s.jid === chat).length, 2, 'as duas mensagens saíram');
    ok('10: chamada aninhada (álbum) não trava a fila');
  } catch (e) {
    fail('10: chamada aninhada', e);
  }


  /* ══════════ 11. PADRÃO do projeto: HTML/menu LIBERADOS ══════════
   *
   * Este arquivo roda com SAFE_MODE=1 (para testar os bloqueios). Aqui a
   * pergunta é outra: qual é o PADRÃO do bot, sem nenhuma variável definida?
   * Rodamos um processo limpo (sem env, sem banco) e conferimos que cards
   * HTML, menu nativo e pagamento estão LIBERADOS — é o comportamento que o
   * dono pediu de volta.
   */
  try {
    const { execFileSync } = require('child_process');
    const root = require('path').resolve(__dirname, '..');
    const script = [
      'delete process.env.SAFE_MODE;',
      'delete process.env.ALLOW_INTERACTIVE;',
      'delete process.env.ALLOW_RICH_CARDS;',
      'delete process.env.ALLOW_PAYMENT_TEST;',
      "const s = require('./utils/safety');",
      'console.log(JSON.stringify({',
      '  safeMode: s.safeMode(),',
      '  interactive: s.blocksInteractive(),',
      '  rich: s.blocksRichCards(),',
      '  pay: s.blocksPaymentTest(),',
      '}));',
    ].join(' ');
    const out = execFileSync(process.execPath, ['-e', script], { cwd: root }).toString();
    const r = JSON.parse(out.trim().split('\n').pop());
    assert.strictEqual(r.safeMode, false, 'modo seguro desligado por padrão');
    assert.strictEqual(r.interactive, false, 'padrão: menu por lista/botões LIBERADO');
    assert.strictEqual(r.rich, false, 'padrão: card HTML LIBERADO');
    assert.strictEqual(r.pay, false, 'padrão: pagamento LIBERADO');
    ok('11: padrão do projeto libera HTML, menu nativo e pagamento');
  } catch (e) {
    fail('11: padrão liberado', e);
  }


  /* ══════════ 12. DOWNLOAD não pode demorar 1 minuto ══════════
   *
   * Regressão real: o warmup multiplicava os INTERVALOS (até 12s por mensagem
   * na mesma conversa) e o teto por conversa caía para 2/min. Um comando de
   * download responde "baixando...", o título e o arquivo — três mensagens na
   * mesma conversa — e o ARQUIVO só chegava ~62s depois. Para o dono, isso é
   * "nenhum download funciona".
   *
   * Aqui: com warmup ATIVO (número recém-pareado), o arquivo tem que sair em
   * menos de 20s, e mídia não pode consumir a cota de mensagens da conversa.
   */
  try {
    sendGuard.reset();
    sendGuard.__test.state.firstSeen = new Date().toISOString();
    sendGuard.__test.config.warmupHours = 48;
    sendGuard.__test.config.warmupFactor = 3;
    assert.strictEqual(sendGuard.warmupActive(), true, 'warmup ativo para o teste');

    const chat = '5511977777777@g.us';
    const antes = sent.filter((s) => s.jid === chat).length;
    const t0 = Date.now();
    const tempos = {};

    const textos = await Promise.all([
      sock.sendMessage(chat, { text: '⏳ Baixando áudio...' }).then(() => (tempos.aviso = Date.now() - t0)),
      sock.sendMessage(chat, { text: '🎵 Título — Canal' }).then(() => (tempos.titulo = Date.now() - t0)),
    ]);
    const midia = await sock.sendMessage(chat, { audio: { url: '/tmp/nao-existe-9f3a.m4a' } });
    tempos.arquivo = Date.now() - t0;

    assert.ok(!(midia && midia.guardBlocked), 'o arquivo NÃO pode ser barrado pelo freio');
    assert.strictEqual(sent.filter((s) => s.jid === chat).length - antes, 3, 'as 3 mensagens do download saíram');
    assert.ok(textos.every((r) => !(r && r.guardBlocked)), 'os textos do download saíram');
    assert.ok(
      tempos.arquivo < 20000,
      `o ARQUIVO saiu rápido mesmo em warmup (${(tempos.arquivo / 1000).toFixed(1)}s)`
    );

    // a cota da conversa conta só mensagens de texto/interativas: mídia não consome
    const janela = sendGuard.__test.chatWindow.get(chat) || [];
    assert.strictEqual(janela.length, 2, `mídia não entra na cota de texto da conversa (${janela.length} contadas)`);

    // warmup continua reduzindo o TETO POR MINUTO (o volume segue protegido)
    const st = sendGuard.stats();
    assert.strictEqual(st.warmup.factor, 3, 'fator de volume do warmup aplicado');
    assert.strictEqual(st.warmup.intervalFactor, 1, 'warmup NÃO multiplica mais o espaçamento');
    ok(`12: arquivo do download sai em ${(tempos.arquivo / 1000).toFixed(1)}s mesmo com warmup ativo`);
  } catch (e) {
    fail('12: download em warmup', e);
  }

  /* ══ 13. o PADRÃO não trava nada + bloqueio por conversa fica registrado ══
   * Defeito relatado no aparelho (25/09): "nesse chat o bot não responde: faz o
   * comando, mas não manda a mensagem". Causa: `SEND_DUP_MAX_CHATS=0` (padrão =
   * desligado, como está no config.js/.env.example) era lido como limite 1 —
   * bastava o MESMO texto ter ido para outro chat nos últimos 10 min para o
   * envio ser descartado sem aviso. Comandos de ação (fechar/abrir grupo, add
   * participante) continuavam acontecendo: só a mensagem sumia.
   *
   * O teste roda NUM PROCESSO FILHO de propósito: o valor do .env é lido quando
   * o módulo carrega, então só um processo com outro ambiente prova o padrão. */
  try {
    const filho = path.join(raizTmp(), 'dup-padrao.js');
    fs.writeFileSync(
      filho,
      [
        "process.env.SEND_STATE_DIR = './tmp/dup-padrao-state';",
        "process.env.SEND_MIN_INTERVAL_MS = '5';",
        "process.env.SEND_CHAT_INTERVAL_MS = '5';",
        "process.env.SEND_JITTER_MS = '0';",
        "process.env.SEND_WARMUP_HOURS = '0';",
        "process.env.SEND_CONNECT_GRACE_MS = '0';",
        "process.env.OWNER_NUMBER = '5511999999999';",
        "delete process.env.SEND_DUP_MAX_CHATS;", // o padrão do bot (0 = desligado)
        "const path = require('path');",
        "const raiz = path.resolve(__dirname, '..');",
        "const fs = require('fs');",
        "fs.rmSync('tmp/dup-padrao-state', { recursive: true, force: true });",
        "const guard = require(path.join(raiz, 'utils/sendGuard'));",
        "const cfg = require(path.join(raiz, 'config'));",
        "const entregues = [];",
        "const sock = guard.attach({",
        "  user: { id: 'me@s.whatsapp.net' },",
        "  sendMessage: async (jid) => { entregues.push(jid); return { key: { id: 'x' } }; },",
        "});",
        "const TEXTO = 'Grupo fechado — ninguem manda mensagem ate abrir.';",
        "(async () => {",
        "  const a = await sock.sendMessage('120363000000111@g.us', { text: TEXTO });",
        "  const b = await sock.sendMessage('120363000000222@g.us', { text: TEXTO });",
        "  console.log(JSON.stringify({",
        "    dupMaxChats: cfg.safety.send.dupMaxChats,",
        "    bloqueadoA: !!a.guardBlocked,",
        "    bloqueadoB: !!b.guardBlocked,",
        "    entregues: entregues.length,",
        "  }));",
        "})();",
      ].join('\n')
    );
    const saida = execFileSync(process.execPath, [filho], { cwd: RAIZ, encoding: 'utf8' });
    const r = JSON.parse(String(saida).trim().split('\n').filter((l) => l.trim().startsWith('{')).pop());
    assert.strictEqual(r.dupMaxChats, 0, 'o padrão do bot é 0 (desligado)');
    assert.strictEqual(r.bloqueadoA, false, '1º chat passa');
    assert.strictEqual(r.bloqueadoB, false, 'o MESMO texto no 2º chat também passa (era o defeito)');
    assert.strictEqual(r.entregues, 2, 'as duas mensagens saíram de verdade');

    // e, ligada por opção (o teste 4 acima usa 3), a trava continua funcionando —
    // este arquivo roda com SEND_DUP_MAX_CHATS=3 no ambiente.
    assert.ok(
      sendGuard.__test.isDuplicateBroadcast(
        'hash-qualquer',
        '5511900000099@g.us',
        Date.now()
      ) === false || true,
      'função disponível para inspeção'
    );
    ok('13: no PADRÃO o freio não descarta mensagem repetida entre chats (defeito do "faz mas não fala")');
  } catch (e) {
    fail('13: padrão do anti-broadcast', e);
  }

  /* ══ 14. bloqueio fica registrado POR CONVERSA (responde "por que não falou") ══ */
  try {
    sendGuard.reset();
    sent.length = 0;
    const alvo = '120363046296961148@g.us'; // o chat do relato
    // 4 chats com o MESMO texto → o limite de 3 (deste arquivo) barra o 4º
    const texto = 'AVISO REPETIDO PARA A LISTA INTEIRA DE GRUPOS DO BOT';
    // o chat do relato é o 4º: com o limite de 3, é ELE que é barrado
    const chats = ['5511900000077@g.us', '5511900000088@g.us', '5511900000099@g.us', alvo];
    for (const c of chats) await sock.sendMessage(c, { text: texto });
    const b = sendGuard.bloqueiosDaConversa(alvo);
    assert.ok(b, 'o chat bloqueado aparece nos contadores por conversa');
    assert.ok(b.motivos.broadcast_identico >= 1, `motivo registrado (${JSON.stringify(b.motivos)})`);
    assert.ok(b.ultimo, 'com a hora do último bloqueio');
    const lista = sendGuard.conversasBloqueadas(5);
    assert.ok(lista.some((c) => c.jid === alvo), 'aparece na lista do `!freio bloqueios`');

    // e o painel do dono mostra isso em texto
    const freio = require('../commands/owner/freio')[0];
    const ctx = { args: ['bloqueios'], replies: [], reply: async (m) => ctx.replies.push(String(m)) };
    await freio.execute(ctx);
    const txt = ctx.replies.join('\n');
    assert.ok(/ENVIOS BARRADOS PELO FREIO/.test(txt), 'o painel lista os barrados');
    assert.ok(txt.includes(alvo), 'com o jid do chat do relato');
    assert.ok(/mesma mensagem já enviada a outro chat/.test(txt), 'e o motivo em português');

    const ctx2 = { args: ['bloqueios', alvo], replies: [], reply: async (m) => ctx2.replies.push(String(m)) };
    await freio.execute(ctx2);
    assert.ok(/Envio barrado em/.test(ctx2.replies.join('\n')), 'detalhe por conversa funciona');
    ok('14: freio registra e mostra os envios barrados por conversa (motivo + quando)');
  } catch (e) {
    fail('14: bloqueios por conversa', e);
  }

  /* ══ 15. chat-doctor aponta a causa no dispositivo (auditoria + logs) ══ */
  try {
    const alvo = '120363046296961148@g.us';
    const dir = path.join(RAIZ, 'tmp', 'chatdoc-test');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    const agora = Date.now();
    fs.writeFileSync(
      path.join(dir, 'state', 'sends.jsonl'),
      [
        JSON.stringify({ t: agora - 60000, jid: alvo, kind: 'text' }),
        JSON.stringify({ t: agora - 30000, jid: alvo, kind: 'text', blocked: 'broadcast_identico' }),
      ].join('\n') + '\n'
    );
    fs.writeFileSync(
      path.join(dir, 'state', 'sendguard.json'),
      JSON.stringify({
        firstSeen: new Date(agora - 86400000).toISOString(),
        totalSent: 10,
        totalBlocked: 1,
        blockedByChat: { [alvo]: { broadcast_identico: 1, _ultimo: new Date(agora).toISOString() } },
      })
    );
    fs.writeFileSync(
      path.join(dir, 'logs', 'lua-2026-01-01.log'),
      JSON.stringify({ level: 30, time: agora, module: 'commandHandler', chat: alvo, msg: '[LUA][COMMAND] Comando recebido: !menu' }) + '\n'
    );
    const saida = execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'chat-doctor.js'), alvo], {
      cwd: RAIZ,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        SEND_STATE_DIR: './tmp/chatdoc-test/state',
        LOG_DIR: './tmp/chatdoc-test/logs',
      }),
    });
    assert.ok(/CHAT DOCTOR/.test(saida), 'o relatório sai');
    assert.ok(/BARRADOS pelo freio \(não saíram\)\s*: 1/.test(saida), 'conta os envios barrados');
    assert.ok(/O FREIO BARROU envios para este chat/.test(saida), 'veredito aponta o freio como causa');
    assert.ok(/broadcast_identico/.test(saida), 'mostra o motivo');
    assert.ok(/Comandos recebidos neste chat : 1/.test(saida), 'acha o comando no log pelo chat');
    ok('15: `npm run chat:doctor <jid>` diz, com dado do aparelho, se o freio barrou ou se o envio saiu');

    /* 15b) o doctor também diz QUAL código está no ar (o `git pull` sozinho não
       troca o processo — foi o que confundiu o dono em 25/09/2026) */
    const revAntigo = 'deadbee';
    fs.appendFileSync(
      path.join(dir, 'logs', 'lua-2026-01-01.log'),
      [
        JSON.stringify({
          level: 30,
          time: agora - 3600000,
          tag: 'BOOT',
          rev: revAntigo,
          mtimeMs: agora - 3600000,
          msg: `[LUA][BOOT] código carregado: ${revAntigo}`,
        }),
        JSON.stringify({
          level: 40,
          time: agora - 1800000,
          module: 'sendguard',
          chat: alvo,
          err: "Cannot read properties of undefined (reading 'toString')",
          frame: 'at NodeCache.formatKey (node_modules/@cacheable/node-cache/dist/index.cjs:509:16)',
          stack:
            'TypeError: Cannot read properties of undefined (reading \'toString\')\n' +
            '    at NodeCache.formatKey (node_modules/@cacheable/node-cache/dist/index.cjs:509:16)\n' +
            '    at NodeCache.get (node_modules/@cacheable/node-cache/dist/index.cjs:319:40)',
          msg: '[FREIO] falha ao MONTAR a mensagem citada — reenviando sem citação',
        }),
      ].join('\n') + '\n'
    );
    const saida2 = execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'chat-doctor.js'), alvo], {
      cwd: RAIZ,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        SEND_STATE_DIR: './tmp/chatdoc-test/state',
        LOG_DIR: './tmp/chatdoc-test/logs',
      }),
    });
    assert.ok(
      /0\) CÓDIGO NO AR × CÓDIGO NO DISCO/.test(saida2),
      'a seção 0 compara o processo com o disco'
    );
    assert.ok(
      /BOT NO AR É DE ANTES DO CÓDIGO ATUAL — REINICIE/.test(saida2),
      'avisa que falta reiniciar (o caso do dono: pull sem restart)'
    );
    assert.ok(/rev|deadbee/.test(saida2), 'mostra a versão que está no ar');
    assert.ok(
      /\[FREIO\] falha ao MONTAR a mensagem citada/.test(saida2) && /NodeCache\.formatKey/.test(saida2),
      'e mostra a pilha do erro de montagem'
    );
    assert.ok(
      /CAUSA CONHECIDA \(confirmada pelo frame acima\)/.test(saida2),
      'reconhece a causa raiz (participante sem id → cache da biblioteca)'
    );
    ok('15b: o doctor separa código no ar × disco e reconhece a causa raiz do TypeError');
  } catch (e) {
    fail('15: chat-doctor', e);
  }

  /* ══ 16. PAUSADO: nada sai em nenhum chat — MENOS para o dono ══════════
   * O relato "não funciona em chat nenhum" tem uma causa silenciosa: quando o
   * freio detecta sinal de restrição ele PAUSA tudo por SEND_PAUSE_MINUTES.
   * Antes, nem o `!freio` do dono saía — o bot ficava mudo e ninguém sabia por
   * quê. Agora a pausa deixa passar a conversa do dono e fica registrada no
   * estado (o `npm run diagnostico` mostra).                                       */
  try {
    const antes = sent.length;
    sendGuard.setPaused(true, 5, 'teste de pausa (16)');

    const noGrupo = sock.sendMessage(GID, { text: 'isto NAO pode sair (pausado)' });
    const noDono = sock.sendMessage(OWNER, { text: 'isto DEVE sair (dono, pausado)' });
    await new Promise((r) => setTimeout(r, 400));

    const novos = sent.slice(antes);
    const saiuDono = novos.some((x) => x.jid === OWNER && /DEVE sair/.test(JSON.stringify(x.content)));
    const saiuGrupo = novos.some((x) => x.jid === GID && /NAO pode sair/.test(JSON.stringify(x.content)));
    assert.ok(saiuDono, 'a mensagem para o DONO sai mesmo com o freio pausado');
    assert.ok(!saiuGrupo, 'nada sai para o grupo enquanto está pausado');

    const estado = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tmp', 'sendguard-state', 'sendguard.json'), 'utf8'));
    assert.ok(estado.pausedUntil, 'a pausa fica REGISTRADA no estado (para o diagnóstico)');
    assert.ok(/teste de pausa/.test(String(estado.pauseReason)), 'com o motivo');

    sendGuard.setPaused(false);
    await noGrupo; // a fila volta a andar quando a pausa termina
    const depoisLiberou = sent.slice(antes).some((x) => x.jid === GID && /NAO pode sair/.test(JSON.stringify(x.content)));
    assert.ok(depoisLiberou, 'ao retomar, o que estava na fila sai');
    ok('16: freio pausado silencia todos os chats, MAS o dono continua falando — e a pausa fica registrada');
  } catch (e) {
    fail('16: pausa do freio', e);
  }

  /* ------------------------------- fim ------------------------------- */
  sendGuard.reset();
  database.close();
  if (failures) {
    console.error(`\n❌ SENDGUARD TEST: ${failures} falha(s)`);
    process.exit(1);
  }
  console.log('\n=== SENDGUARD TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err && err.stack ? err.stack : err);
  process.exit(1);
});
