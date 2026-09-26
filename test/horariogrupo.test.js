#!/usr/bin/env node
/**
 * test/horariogrupo.test.js — `!horariogrupo` + utils/groupSchedule + utils/tzTime.
 *
 * Tudo com RELÓGIO CONTROLADO (now/setTimeout falsos) e socket falso que
 * imita os métodos reais da biblioteca (groupMetadata → { announce,
 * participants }, groupSettingUpdate(jid, 'announcement'|'not_announcement')).
 * Nenhuma chamada real ao WhatsApp acontece aqui.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-horariogrupo-test.db');

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

/* ------------------------------ relógio falso ------------------------------ */

const clock = {
  t: 0,
  seq: 0,
  fila: [],
  setTimeout(fn, ms) {
    const h = { id: ++this.seq, at: this.t + Math.max(0, ms), fn, vivo: true };
    this.fila.push(h);
    return h;
  },
  clearTimeout(h) {
    if (h) h.vivo = false;
  },
  pendentes() {
    return this.fila.filter((h) => h.vivo).length;
  },
  async avancar(ms) {
    const fim = this.t + ms;
    for (;;) {
      const prox = this.fila.filter((h) => h.vivo && h.at <= fim).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!prox) break;
      prox.vivo = false;
      this.t = Math.max(this.t, prox.at);
      prox.fn();
      await drenar();
    }
    this.t = fim;
    await drenar();
  },
  set(iso) {
    this.t = Date.parse(iso);
  },
};

async function drenar() {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}

/* ------------------------------ socket falso ------------------------------ */

const BOT = '5511000000001:5@s.whatsapp.net';
const ADMIN = '5511000000002@s.whatsapp.net';
const MEMBRO = '5511000000003@s.whatsapp.net';

function novoSock() {
  const sock = {
    user: { id: BOT, name: 'Lua Teste' },
    conectado: true,
    grupos: new Map(),
    updates: [],
    consultas: 0,
    enviados: [],
    falhaConsulta: null, // () => Error | null
    falhaUpdate: null, // (jid, s) => { erro, aplicar }
    async groupMetadata(jid) {
      sock.consultas++;
      if (sock.falhaConsulta) {
        const e = sock.falhaConsulta();
        if (e) throw e;
      }
      const g = sock.grupos.get(jid);
      if (!g) {
        const e = new Error('item-not-found');
        e.output = { statusCode: 404 };
        throw e;
      }
      return { id: jid, announce: g.announce, participants: g.participants.map((p) => ({ ...p })) };
    },
    async groupSettingUpdate(jid, s) {
      sock.updates.push({ jid, s });
      const g = sock.grupos.get(jid);
      if (sock.falhaUpdate) {
        const r = sock.falhaUpdate(jid, s);
        if (r) {
          if (r.aplicar) g.announce = s === 'announcement';
          if (r.pendurar) return new Promise(() => {});
          throw r.erro;
        }
      }
      g.announce = s === 'announcement';
    },
    async sendMessage(jid, content) {
      sock.enviados.push({ jid, content });
      return { key: { id: 'X' } };
    },
  };
  return sock;
}

function grupo(sock, jid, { announce = false, botAdmin = true, botDentro = true } = {}) {
  const participants = [
    { id: ADMIN, admin: 'admin' },
    { id: MEMBRO, admin: null },
  ];
  if (botDentro) participants.push({ id: '5511000000001@s.whatsapp.net', admin: botAdmin ? 'admin' : null });
  sock.grupos.set(jid, { announce, participants });
}

function ctxDe(sock, jid, args, { sender = ADMIN, isOwner = false, isAdmin, isX9 = false } = {}) {
  const ctx = {
    socket: sock,
    remoteJid: jid,
    isGroup: true,
    isOwner,
    isAdmin: isAdmin === undefined ? sender === ADMIN : isAdmin,
    isX9,
    sender,
    identidades: [sender],
    prefix: '#',
    args,
    replies: [],
    reply: async (t) => {
      ctx.replies.push(String(t));
      return {};
    },
  };
  return ctx;
}

async function main() {
  fs.rmSync(DB, { force: true });
  process.env.DATABASE_FILE = DB;
  process.env.OWNER_NUMBER = '5511999999999';
  delete process.env.BOT_TIMEZONE;

  const database = require('../database/database');
  database.open();
  const groups = require('../database/groups');
  const tzTime = require('../utils/tzTime');
  const schedule = require('../utils/groupSchedule');
  const cmd = require('../commands/admin/horariogrupo').find((c) => c.name === 'horariogrupo');
  const TZ = 'America/Sao_Paulo';

  let sock = novoSock();
  schedule._setDeps({
    now: () => clock.t,
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (h) => clock.clearTimeout(h),
    getSocket: () => sock,
    isConnected: () => !!(sock && sock.conectado),
    prazoMs: 50,
  });
  const run = (ctx) => cmd.execute(ctx);
  const G1 = '120363000000000001@g.us';
  const G2 = '120363000000000002@g.us';

  /* ------------------------------ calendário ------------------------------ */

  await caso('tz: padrão centralizado é America/Sao_Paulo', () => {
    assert.strictEqual(tzTime.botTimezone(), TZ);
    assert.strictEqual(require('../config').bot.timezone, TZ);
  });

  await caso('tz: 06:00/00:00 → fechado 00:00–06:00 e aberto 06:00–24:00', () => {
    const at = (h) => Date.parse(`2026-09-25T${h}:00-03:00`);
    assert.strictEqual(tzTime.expectedState('06:00', '00:00', TZ, at('00:00')), 'closed');
    assert.strictEqual(tzTime.expectedState('06:00', '00:00', TZ, at('02:00')), 'closed');
    assert.strictEqual(tzTime.expectedState('06:00', '00:00', TZ, at('05:59')), 'closed');
    assert.strictEqual(tzTime.expectedState('06:00', '00:00', TZ, at('06:00')), 'open');
    assert.strictEqual(tzTime.expectedState('06:00', '00:00', TZ, at('23:59')), 'open');
  });

  await caso('tz: 20:00/06:00 (atravessa a meia-noite) → aberto à noite, fechado de dia', () => {
    const at = (iso) => Date.parse(iso);
    assert.strictEqual(tzTime.expectedState('20:00', '06:00', TZ, at('2026-09-25T21:00:00-03:00')), 'open');
    assert.strictEqual(tzTime.expectedState('20:00', '06:00', TZ, at('2026-09-26T03:00:00-03:00')), 'open');
    assert.strictEqual(tzTime.expectedState('20:00', '06:00', TZ, at('2026-09-26T06:00:00-03:00')), 'closed');
    assert.strictEqual(tzTime.expectedState('20:00', '06:00', TZ, at('2026-09-26T12:00:00-03:00')), 'closed');
  });

  await caso('tz: próxima ocorrência pelo calendário local (virada do dia, não "+24h")', () => {
    const t = Date.parse('2026-09-25T23:59:30-03:00');
    const n = tzTime.nextOccurrence('00:00', TZ, t);
    assert.strictEqual(new Date(n).toISOString(), '2026-09-26T03:00:00.000Z');
    assert.strictEqual(tzTime.formatLocal(n, TZ).endsWith('26/09/2026 00:00'), true);
  });

  await caso('tz: mudança de offset (New York, horário de verão) respeitada', () => {
    const NY = 'America/New_York';
    let x = Date.parse('2026-03-07T12:00:00Z');
    const vistos = [];
    for (let i = 0; i < 3; i++) {
      x = tzTime.nextOccurrence('06:00', NY, x);
      vistos.push(new Date(x).toISOString());
    }
    // 06:00 local = 11:00Z antes do dia 8 (EST) e 10:00Z depois (EDT): +24h fixo erraria
    assert.deepStrictEqual(vistos, ['2026-03-08T10:00:00.000Z', '2026-03-09T10:00:00.000Z', '2026-03-10T10:00:00.000Z']);
    // hora inexistente (02:30 do dia 8) vai para o primeiro instante válido
    assert.strictEqual(new Date(tzTime.zonedToUtc(2026, 3, 8, 2, 30, NY)).toISOString(), '2026-03-08T07:30:00.000Z');
    // sobreposição (01:30 do dia 1/11 acontece 2x) usa a primeira
    assert.strictEqual(new Date(tzTime.zonedToUtc(2026, 11, 1, 1, 30, NY)).toISOString(), '2026-11-01T05:30:00.000Z');
  });

  /* ------------------------------ comando ------------------------------ */

  await caso('configurar 06:00 00:00 às 02:00: salva, ativa, fecha o grupo e programa 06:00', async () => {
    clock.set('2026-09-25T02:00:00-03:00');
    grupo(sock, G1, { announce: false });
    const ctx = ctxDe(sock, G1, ['06:00', '00:00']);
    await run(ctx);
    const r = ctx.replies.join('\n');
    assert.match(r, /Programação diária ativada/);
    assert.match(r, /Abertura: 06:00/);
    assert.match(r, /Fechamento: 00:00/);
    assert.match(r, /Fuso: America\/Sao_Paulo/);
    assert.match(r, /Configuração salva/);
    assert.match(r, /alterado agora para 🔒 fechado/);
    assert.match(r, /Próxima abertura: sex\. 25\/09\/2026 06:00/);
    assert.deepStrictEqual(sock.updates, [{ jid: G1, s: 'announcement' }]);
    const cfg = schedule.getConfig(G1);
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.open, '06:00');
    assert.strictEqual(cfg.close, '00:00');
    assert.strictEqual(cfg.tz, TZ);
    const ag = schedule.agendado(G1);
    assert.strictEqual(ag.timer.kind, 'open');
    assert.strictEqual(new Date(ag.timer.due).toISOString(), '2026-09-25T09:00:00.000Z');
  });

  await caso('06:00 abre, 00:00 fecha (um único temporizador por grupo)', async () => {
    sock.updates = [];
    await clock.avancar(4 * 3600 * 1000 + 1000); // → 06:00:01
    assert.deepStrictEqual(sock.updates, [{ jid: G1, s: 'not_announcement' }]);
    assert.strictEqual(sock.grupos.get(G1).announce, false);
    assert.strictEqual(schedule.agendado(G1).timer.kind, 'close');
    await clock.avancar(18 * 3600 * 1000); // → 00:00:01 do dia 26
    assert.deepStrictEqual(sock.updates.map((u) => u.s), ['not_announcement', 'announcement']);
    assert.strictEqual(sock.grupos.get(G1).announce, true);
    assert.strictEqual(schedule.agendado(G1).timer.kind, 'open');
  });

  await caso('grupo já no estado desejado: consulta, mas não altera', async () => {
    sock.updates = [];
    const res = await schedule.reconcile(G1, { reason: 'teste' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.changed, false);
    assert.deepStrictEqual(sock.updates, []);
  });

  await caso('status mostra estado, horários, fuso e próximas execuções com data', async () => {
    const ctx = ctxDe(sock, G1, [], { sender: MEMBRO });
    await run(ctx);
    const r = ctx.replies[0];
    assert.match(r, /ATIVA/);
    assert.match(r, /Fuso: America\/Sao_Paulo \(UTC−03:00\)/);
    assert.match(r, /Próxima abertura: sáb\. 26\/09\/2026 06:00 \(America\/Sao_Paulo, UTC−03:00\)/);
    assert.match(r, /Próximo fechamento: dom\. 27\/09\/2026 00:00/);
  });

  await caso('alterar só a abertura preserva o fechamento; tarefa antiga não executa', async () => {
    sock.updates = [];
    const antes = schedule.agendado(G1).timer;
    assert.strictEqual(new Date(antes.due).toISOString(), '2026-09-26T09:00:00.000Z');
    const ctx = ctxDe(sock, G1, ['abrir', '07:30']);
    await run(ctx);
    const cfg = schedule.getConfig(G1);
    assert.strictEqual(cfg.open, '07:30');
    assert.strictEqual(cfg.close, '00:00');
    assert.strictEqual(cfg.enabled, true);
    assert.match(ctx.replies[0], /Horário atualizado/);
    // passa das 06:00 (antigo) — nada acontece; às 07:30 abre
    await clock.avancar(6 * 3600 * 1000 - 1000 + 2000); // → 06:00:01
    assert.deepStrictEqual(sock.updates, []);
    await clock.avancar(90 * 60 * 1000); // → 07:30:01
    assert.deepStrictEqual(sock.updates, [{ jid: G1, s: 'not_announcement' }]);
  });

  await caso('desativar: horários preservados, estado do grupo mantido, nada mais executa', async () => {
    sock.updates = [];
    const ctx = ctxDe(sock, G1, ['off']);
    await run(ctx);
    assert.match(ctx.replies[0], /Programação diária desativada/);
    assert.match(ctx.replies[0], /continuam salvos/);
    assert.match(ctx.replies[0], /estado atual do grupo foi mantido/);
    const cfg = schedule.getConfig(G1);
    assert.strictEqual(cfg.enabled, false);
    assert.strictEqual(cfg.open, '07:30');
    assert.strictEqual(cfg.close, '00:00');
    assert.strictEqual(schedule.agendado(G1).timer, null);
    await clock.avancar(48 * 3600 * 1000);
    assert.deepStrictEqual(sock.updates, []);
  });

  await caso('alterar um horário com a programação desativada NÃO ativa', async () => {
    const ctx = ctxDe(sock, G1, ['fechar', '23:00']);
    await run(ctx);
    const cfg = schedule.getConfig(G1);
    assert.strictEqual(cfg.enabled, false);
    assert.strictEqual(cfg.close, '23:00');
    assert.match(ctx.replies[0], /Configuração salva/);
    assert.match(ctx.replies[0], /continua \*desativada\*/);
    assert.deepStrictEqual(sock.updates, []);
  });

  await caso('reativar com on: reconcilia e informa o resultado real', async () => {
    clock.set('2026-09-28T12:00:00-03:00');
    sock.grupos.get(G1).announce = true; // alguém fechou manualmente
    sock.updates = [];
    const ctx = ctxDe(sock, G1, ['on']);
    await run(ctx);
    assert.match(ctx.replies[0], /Programação diária ativada/);
    assert.match(ctx.replies[0], /alterado agora para 🔓 aberto/);
    assert.deepStrictEqual(sock.updates, [{ jid: G1, s: 'not_announcement' }]);
  });

  await caso('configuração incompleta: salva um horário, não ativa, diz qual falta', async () => {
    grupo(sock, G2, { announce: false });
    const ctx = ctxDe(sock, G2, ['abrir', '08:00']);
    await run(ctx);
    assert.match(ctx.replies[0], /Configuração salva/);
    assert.match(ctx.replies[0], /Falta o horário de \*fechamento\*/);
    const cfg = schedule.getConfig(G2);
    assert.strictEqual(cfg.open, '08:00');
    assert.strictEqual(cfg.close, null);
    assert.strictEqual(cfg.enabled, false);
    const on = ctxDe(sock, G2, ['on']);
    await run(on);
    assert.match(on.replies[0], /Não dá para ativar: falta o horário de \*fechamento\*/);
    assert.strictEqual(schedule.getConfig(G2).enabled, false);
  });

  await caso('entradas inválidas não alteram nada (24:00, 25:00, 6:00, extras, iguais)', async () => {
    const antes = JSON.stringify(schedule.getConfig(G1));
    const casos = [
      [['24:00', '06:00'], /meia-noite deve ser informada como \*00:00\*/],
      [['06:00', '25:00'], /não é um horário válido/],
      [['6:00', '00:00'], /dois dígitos/],
      [['abrir', '07:00', 'extra'], /único horário/],
      [['06:00', '00:00', '12:00'], /não reconhecido/],
      [['talvez'], /não reconhecido/],
      [['on', 'agora'], /não reconhecido/],
      [['10:00', '10:00'], /mesmo horário.*ambíguos/],
      [['abrir', '23:00'], /mesmo horário/], // fechamento salvo é 23:00
    ];
    for (const [args, re] of casos) {
      const ctx = ctxDe(sock, G1, args);
      await run(ctx);
      assert.match(ctx.replies[0], re, args.join(' '));
      assert.match(ctx.replies[0], /Nada foi alterado/);
      assert.match(ctx.replies[0], /Exemplos corretos/);
    }
    assert.strictEqual(JSON.stringify(schedule.getConfig(G1)), antes);
  });

  await caso('grupos diferentes têm programações independentes', async () => {
    const ctx = ctxDe(sock, G2, ['fechar', '22:00']);
    await run(ctx);
    const on = ctxDe(sock, G2, ['on']);
    await run(on);
    const c1 = schedule.getConfig(G1);
    const c2 = schedule.getConfig(G2);
    assert.deepStrictEqual([c1.open, c1.close, c1.enabled], ['07:30', '23:00', true]);
    assert.deepStrictEqual([c2.open, c2.close, c2.enabled], ['08:00', '22:00', true]);
    assert.ok(schedule.agendado(G1).timer && schedule.agendado(G2).timer);
  });

  await caso('usuário sem autorização: negado, nada muda (inclusive com cache antigo dizendo admin)', async () => {
    const antes = JSON.stringify(schedule.getConfig(G1));
    const ctx = ctxDe(sock, G1, ['off'], { sender: MEMBRO, isAdmin: false });
    await run(ctx);
    assert.match(ctx.replies[0], /administradores|admin/i);
    // cache velho: ctx.isAdmin = true, mas os participantes consultados agora dizem "membro"
    const velho = ctxDe(sock, G1, ['off'], { sender: MEMBRO, isAdmin: true });
    await run(velho);
    assert.match(velho.replies[0], /administradores|admin/i);
    assert.strictEqual(JSON.stringify(schedule.getConfig(G1)), antes);
  });

  await caso('não consegue confirmar permissões (consulta falha) → recusa sem alterar', async () => {
    const antes = JSON.stringify(schedule.getConfig(G1));
    sock.falhaConsulta = () => new Error('rate-overlimit');
    const ctx = ctxDe(sock, G1, ['off']);
    await run(ctx);
    sock.falhaConsulta = null;
    assert.match(ctx.replies[0], /Não consegui confirmar suas permissões/);
    assert.strictEqual(JSON.stringify(schedule.getConfig(G1)), antes);
  });

  await caso('bot sem admin: não ativa; horários salvos ficam desativados', async () => {
    const G3 = '120363000000000003@g.us';
    grupo(sock, G3, { botAdmin: false });
    const ctx = ctxDe(sock, G3, ['06:00', '00:00']);
    await run(ctx);
    assert.match(ctx.replies[0], /Configuração salva/);
    assert.match(ctx.replies[0], /NÃO ativada.*não é administrador/);
    assert.strictEqual(schedule.getConfig(G3).enabled, false);
    assert.deepStrictEqual(sock.updates.filter((u) => u.jid === G3), []);
    const on = ctxDe(sock, G3, ['on']);
    await run(on);
    assert.match(on.replies[0], /Não ativei: o bot não é administrador/);
  });

  await caso('bot perde admin antes do evento: não altera, avisa UMA vez só', async () => {
    sock.updates = [];
    sock.enviados = [];
    const g = sock.grupos.get(G1);
    g.participants.find((p) => p.id.startsWith('5511000000001')).admin = null;
    // G1: 07:30/23:00, ativo. Agora 28/09 12:00 → próximo evento: fechar 23:00
    await clock.avancar(11 * 3600 * 1000 + 1000);
    await clock.avancar(24 * 3600 * 1000); // mais um fechamento e uma abertura
    assert.deepStrictEqual(sock.updates.filter((u) => u.jid === G1), []);
    const avisos = sock.enviados.filter((e) => e.jid === G1);
    assert.strictEqual(avisos.length, 1, 'um aviso só');
    assert.match(avisos[0].content.text, /não é administrador/);
    assert.strictEqual(schedule.getConfig(G1).last.code, 'bot-not-admin');
    g.participants.find((p) => p.id.startsWith('5511000000001')).admin = 'admin';
  });

  await caso('volta a ser admin: próxima reconciliação corrige e libera novo aviso futuro', async () => {
    const res = await schedule.reconcile(G1, { reason: 'teste' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(schedule.getConfig(G1).notified, null);
  });

  await caso('reinício ANTES do evento (02:00, grupo aberto indevidamente): corrige uma vez', async () => {
    const G4 = '120363000000000004@g.us';
    clock.set('2026-10-01T22:00:00-03:00');
    grupo(sock, G4, { announce: false });
    await run(ctxDe(sock, G4, ['06:00', '00:00']));
    assert.strictEqual(sock.grupos.get(G4).announce, false); // 22:00 = aberto
    // bot cai às 23:00; volta às 02:00 (perdeu o fechamento de 00:00)
    schedule._reset();
    clock.fila.forEach((h) => (h.vivo = false));
    clock.set('2026-10-02T02:00:00-03:00');
    sock = novoSock();
    grupo(sock, G4, { announce: false });
    grupo(sock, G1, { announce: false });
    grupo(sock, G2, { announce: true });
    const r = schedule.onConnected();
    assert.ok(r.grupos >= 1);
    await clock.avancar(30 * 1000);
    const doG4 = sock.updates.filter((u) => u.jid === G4);
    assert.deepStrictEqual(doG4, [{ jid: G4, s: 'announcement' }], 'um fechamento só, nada de repetir eventos perdidos');
    assert.strictEqual(schedule.agendado(G4).timer.kind, 'open');
  });

  await caso('reinício DEPOIS do evento (grupo já certo): nada é alterado', async () => {
    schedule._reset();
    clock.fila.forEach((h) => (h.vivo = false));
    sock.updates = [];
    schedule.onConnected();
    await clock.avancar(30 * 1000);
    assert.deepStrictEqual(sock.updates.filter((u) => u.jid === 'G4'), []);
    assert.deepStrictEqual(sock.updates.filter((u) => u.jid === '120363000000000004@g.us'), []);
  });

  await caso('reconexões repetidas não duplicam temporizadores nem alterações', async () => {
    sock.updates = [];
    schedule.onConnected();
    schedule.onConnected();
    schedule.onConnected();
    const ativos = schedule.gruposAtivos();
    assert.strictEqual(schedule._STATE.timers.size, ativos.length, 'um temporizador por grupo ativo');
    await clock.avancar(60 * 1000);
    // passa pelas 06:00 de 02/10: G4 abre UMA vez
    await clock.avancar(4 * 3600 * 1000);
    const g4 = sock.updates.filter((u) => u.jid === '120363000000000004@g.us');
    assert.deepStrictEqual(g4, [{ jid: '120363000000000004@g.us', s: 'not_announcement' }]);
    // recarregar o módulo reaproveita o mesmo estado (sem temporizadores órfãos)
    const antes = schedule._STATE.timers.size;
    delete require.cache[require.resolve('../utils/groupSchedule')];
    const recarregado = require('../utils/groupSchedule');
    assert.strictEqual(recarregado._STATE, schedule._STATE);
    assert.strictEqual(recarregado._STATE.timers.size, antes);
  });

  await caso('reconnect: scheduler troca socket A pelo socket B sem perder configuração ativa', async () => {
    const jid = G1;
    const socketA = sock;
    const socketB = novoSock();
    grupo(socketB, jid, { announce: true });
    let atual = socketA;
    schedule._setDeps({ getSocket: () => atual, isConnected: () => !!(atual && atual.conectado) });
    const antes = schedule.getConfig(jid);
    assert.strictEqual(antes.enabled, true);
    atual = socketB;
    const result = await schedule.reconcile(jid, { reason: 'reconexão-teste' });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(socketA.updates.filter((x) => x.jid === jid), []);
    const expectedSetting = schedule.estadoEsperado(antes, clock.t) === 'closed' ? 'announcement' : 'not_announcement';
    assert.deepStrictEqual(socketB.updates.filter((x) => x.jid === jid), [{ jid, s: expectedSetting }]);
    assert.strictEqual(schedule.getConfig(jid).enabled, true);
    sock = socketB;
  });

  await caso('evento duplicado (mesma versão e horário) executa uma vez só', async () => {
    const jid = '120363000000000004@g.us';
    const cfg = schedule.getConfig(jid);
    const due = Date.parse('2026-10-02T06:00:00-03:00');
    const r = await schedule.dispararEvento(jid, { version: cfg.version, due, kind: 'open' });
    assert.strictEqual(r.code, 'already-done');
  });

  await caso('timeout ao alterar, mas foi aplicado: confere antes de repetir e não repete', async () => {
    const jid = '120363000000000004@g.us';
    sock.grupos.get(jid).announce = true; // deveria estar aberto (após 06:00)
    sock.updates = [];
    sock.falhaUpdate = () => ({ pendurar: true, aplicar: true });
    const res = await schedule.reconcile(jid, { reason: 'teste' });
    sock.falhaUpdate = null;
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.confirmedAfter, 'timeout-update');
    assert.strictEqual(sock.updates.length, 1);
    assert.strictEqual(schedule.agendado(jid).retry, null);
  });

  await caso('erro ao alterar: novas tentativas limitadas (3) e espaçadas; para quando der certo', async () => {
    const jid = '120363000000000004@g.us';
    sock.grupos.get(jid).announce = true;
    sock.updates = [];
    let falhar = 2;
    sock.falhaUpdate = () => (falhar-- > 0 ? { erro: new Error('internal-server-error') } : null);
    const res = await schedule.reconcile(jid, { reason: 'teste' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'update-failed');
    assert.strictEqual(res.retryInMs, 20000);
    await clock.avancar(20000);
    assert.strictEqual(schedule.agendado(jid).retry.attempt, 2);
    await clock.avancar(60000);
    assert.strictEqual(sock.updates.length, 3);
    assert.strictEqual(sock.grupos.get(jid).announce, false);
    assert.strictEqual(schedule.agendado(jid).retry, null);
    sock.falhaUpdate = null;

    // sempre falhando: para depois de 3 novas tentativas (4 chamadas) e avisa uma vez
    sock.grupos.get(jid).announce = true;
    sock.updates = [];
    sock.enviados = [];
    sock.falhaUpdate = () => ({ erro: new Error('internal-server-error') });
    await schedule.reconcile(jid, { reason: 'teste' });
    await clock.avancar(20000 + 60000 + 180000 + 1000);
    assert.strictEqual(sock.updates.length, 4);
    assert.strictEqual(schedule.agendado(jid).retry, null);
    assert.strictEqual(sock.enviados.filter((e) => e.jid === jid).length, 1);
    sock.falhaUpdate = null;
  });

  await caso('nova tentativa pendente é descartada se a programação mudar', async () => {
    const jid = '120363000000000004@g.us';
    sock.grupos.get(jid).announce = true;
    sock.updates = [];
    sock.falhaUpdate = () => ({ erro: new Error('internal-server-error') });
    await schedule.reconcile(jid, { reason: 'teste' });
    assert.ok(schedule.agendado(jid).retry);
    sock.falhaUpdate = null;
    await run(ctxDe(sock, jid, ['off']));
    await clock.avancar(300000);
    assert.strictEqual(sock.updates.length, 1, 'nenhuma nova tentativa depois do off');
    assert.strictEqual(sock.grupos.get(jid).announce, true, 'off mantém o estado atual');
  });

  await caso('desconectado no horário: não altera; reconcilia ao reconectar', async () => {
    const jid = '120363000000000004@g.us';
    await run(ctxDe(sock, jid, ['on'])); // corrige para aberto
    sock.updates = [];
    sock.conectado = false;
    // próximo evento: fechar 00:00 de 03/10
    await clock.avancar(18 * 3600 * 1000 + 5000);
    assert.deepStrictEqual(sock.updates, []);
    assert.strictEqual(schedule.getConfig(jid).last.code, 'disconnected');
    sock.conectado = true;
    schedule.onConnected();
    await clock.avancar(60 * 1000);
    assert.deepStrictEqual(sock.updates.filter((u) => u.jid === jid), [{ jid, s: 'announcement' }]);
  });

  await caso('bot removido do grupo: registra motivo, sem novas tentativas', async () => {
    const jid = '120363000000000004@g.us';
    sock.grupos.delete(jid);
    const res = await schedule.reconcile(jid, { reason: 'teste' });
    assert.strictEqual(res.code, 'bot-removed');
    assert.strictEqual(schedule.agendado(jid).retry, null);
    grupo(sock, jid, { announce: true });
  });

  await caso('timeout na consulta: classificado e com nova tentativa', async () => {
    const jid = '120363000000000004@g.us';
    sock.falhaConsulta = () => null;
    const orig = sock.groupMetadata;
    sock.groupMetadata = () => new Promise(() => {});
    const res = await schedule.reconcile(jid, { reason: 'teste' });
    sock.groupMetadata = orig;
    sock.falhaConsulta = null;
    assert.strictEqual(res.code, 'timeout-query');
    assert.ok(res.retryInMs > 0);
    schedule.cancel(jid);
    schedule.arm(jid);
  });

  await caso('falha ao salvar: responde "NÃO foi salva" e mantém a configuração anterior', async () => {
    const antes = JSON.stringify(schedule.getConfig(G2));
    const orig = groups.patchSettings;
    groups.patchSettings = () => {
      throw new Error('SQLITE_BUSY');
    };
    const ctx = ctxDe(sock, G2, ['05:00', '23:00']);
    try {
      await run(ctx);
    } finally {
      groups.patchSettings = orig;
    }
    assert.match(ctx.replies[0], /NÃO foi salva/);
    assert.doesNotMatch(ctx.replies[0], /Configuração salva/);
    groups.invalidateSettings(G2);
    assert.strictEqual(JSON.stringify(schedule.getConfig(G2)), antes);
  });

  await caso('persistência: processo novo lê a mesma programação do banco', async () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `process.env.DATABASE_FILE=${JSON.stringify(DB)};require('./database/database').open();` +
          `const s=require('./utils/groupSchedule');const c=s.getConfig('${G2}');` +
          `console.log(JSON.stringify({open:c.open,close:c.close,enabled:c.enabled,tz:c.tz,ativos:s.gruposAtivos().includes('${G2}')}))`,
      ],
      { cwd: require('path').resolve(__dirname, '..'), env: { ...process.env, LOG_LEVEL: 'silent' } }
    )
      .toString()
      .trim()
      .split('\n')
      .pop();
    assert.deepStrictEqual(JSON.parse(out), { open: '08:00', close: '22:00', enabled: true, tz: TZ, ativos: true });
  });

  await caso('abrirgrupo/fechargrupo manuais continuam e avisam da programação ativa', async () => {
    const cmds = require('../commands/admin/groupcfg');
    const fechar = cmds.find((c) => c.name === 'fechargrupo');
    const ctx = ctxDe(sock, G2, []);
    ctx.socket = sock;
    grupo(sock, G2, { announce: false });
    await fechar.execute(ctx);
    assert.match(ctx.replies[0], /Grupo fechado/);
    assert.match(ctx.replies[0], /programação diária continua ativa/);
    assert.strictEqual(sock.grupos.get(G2).announce, true);
    const G9 = '120363000000000009@g.us';
    grupo(sock, G9);
    const ctx2 = ctxDe(sock, G9, []);
    await cmds.find((c) => c.name === 'abrirgrupo').execute(ctx2);
    assert.strictEqual(ctx2.replies[0], '🔓 Grupo aberto: todos podem enviar mensagens.', 'sem programação: resposta original');
  });

  await caso('comando registrado no menu administrativo (categoria admin) com emoji ⏰', () => {
    require('../commands/loader').loadCommands(true);
    const { registry } = require('../engine/plugins');
    const c = registry.resolveTrigger('horariogrupo');
    assert.ok(c && c.category === 'admin' && c.groupOnly);
    assert.strictEqual(require('../utils/commandEmoji').commandEmoji(c), '⏰');
    assert.ok((registry.byCategory().get('admin') || []).some((x) => x.name === 'horariogrupo'));
  });

  schedule._reset();
  database.close();
  fs.rmSync(DB, { force: true });
  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
