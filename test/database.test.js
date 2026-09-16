/**
 * test/database.test.js — Fase 4: schema, migrações, repositories e concorrência.
 *
 * Cobre:
 *   1) migrações: versões registradas, sem duplicatas, idempotência, upgrade
 *      incremental (banco na versão 34 → aplica só 35/36/37/38)
 *   2) moderation_cases: CRUD, consultas por grupo/usuário/grupo+usuário,
 *      ids únicos, timestamps, metadata, constraints
 *   3) command_usage: registro, agregação, integridade do upsert, retenção
 *   4) scheduled_jobs: criação, máquina de estados, guardas, retry/attempts
 *   5) concorrência: DOIS PROCESSOS disputando o mesmo job
 *   6) planos de consulta (EXPLAIN): os índices criados são realmente usados
 *   7) compatibilidade: tabelas antigas continuam íntegras e graváveis
 *
 * O acesso ao banco é sempre tardio (q(), casesRepo()...) porque alguns
 * cenários fecham e reabrem o banco com outro arquivo.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

process.chdir(path.resolve(__dirname, '..'));
const dbtmp = require('./dbtmp');

const DB_FILE = dbtmp.tmpFile('lua-fase4.db');
function limpaArquivo(file) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(file + suffix, { force: true }); } catch (_) {}
  }
}
limpaArquivo(DB_FILE);
process.env.DATABASE_FILE = DB_FILE;
process.env.LUA_TEST = '1';

/* --------------------- acesso tardio aos módulos --------------------- */

const D = () => require('../database/database');
const q = () => D().get();
const casesRepo = () => require('../database/moderationCases');
const usageRepo = () => require('../database/commandUsage');
const jobsRepo = () => require('../database/scheduledJobs');

/** Descarta as instâncias carregadas (usado ao trocar de arquivo de banco). */
function recarrega() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}database${path.sep}`) || k.endsWith(`${path.sep}config.js`)) delete require.cache[k];
  }
}

/** Abre `file` com uma instância limpa dos módulos de banco. */
function usaBanco(file) {
  D().close();
  process.env.DATABASE_FILE = file;
  recarrega();
  return D().open();
}

const GROUP = '120363000000000001@g.us';
const GROUP2 = '120363000000000002@g.us';
const USER = '5511911110001@s.whatsapp.net';
const USER2 = '5511911110002@s.whatsapp.net';
const ADMIN = '5511999999999@s.whatsapp.net';
const REF = '2026-09-15T13:00:00.000Z'; // instante de referência dos claims

/* ------------------------------ harness ------------------------------ */

const results = [];
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push([label, true, '']); console.log('  ✔ ' + label); })
    .catch((err) => {
      results.push([label, false, err.message]);
      console.log('  ✘ ' + label + ' → ' + err.message);
    });
}

const columns = (table) => q().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const indexes = (table) => q().prepare(`PRAGMA index_list(${table})`).all().map((i) => i.name);
const explain = (sql, params = []) =>
  q().prepare('EXPLAIN QUERY PLAN ' + sql).all(...params).map((r) => r.detail).join(' | ');

D().open();

(async () => {
  console.log('══════════ DATABASE TEST (Fase 4) ══════════');

  /* ---------------------------------------------------- 1. migrações */

  await check('migrações: 38 versões registradas, sem duplicatas', () => {
    const row = q().prepare('SELECT MAX(version) AS max, COUNT(*) AS c, COUNT(DISTINCT version) AS d FROM schema_migrations').get();
    assert.strictEqual(row.max, 38, 'versão máxima: ' + row.max);
    assert.strictEqual(row.c, 38, 'linhas em schema_migrations: ' + row.c);
    assert.strictEqual(row.d, 38, 'há versões duplicadas');
    const novas = q().prepare('SELECT version FROM schema_migrations WHERE version >= 35 ORDER BY version').all().map((r) => r.version);
    // 35/36/37 = Fase 4 (tabelas novas); 38 = índices das tabelas de alto volume
    assert.deepStrictEqual(novas, [35, 36, 37, 38], 'migrações após a v34: ' + novas.join(','));
    for (const r of q().prepare('SELECT version, applied_at FROM schema_migrations WHERE version >= 35').all()) {
      assert.match(r.applied_at, /^\d{4}-\d{2}-\d{2}T/, 'applied_at não é ISO: ' + r.applied_at);
    }
  });

  await check('migrações: tabelas, colunas, índices e ausência de FK', () => {
    const tabelas = q().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('moderation_cases','command_usage','scheduled_jobs') ORDER BY name"
    ).all().map((r) => r.name);
    assert.deepStrictEqual(tabelas, ['command_usage', 'moderation_cases', 'scheduled_jobs']);

    for (const col of ['id', 'group_id', 'user_id', 'moderator_id', 'action', 'reason', 'status', 'metadata', 'created_at', 'updated_at', 'closed_at']) {
      assert.ok(columns('moderation_cases').includes(col), 'moderation_cases sem coluna ' + col);
    }
    for (const col of ['command', 'user_id', 'group_id', 'day', 'ok', 'uses', 'total_ms', 'last_used_at']) {
      assert.ok(columns('command_usage').includes(col), 'command_usage sem coluna ' + col);
    }
    for (const col of ['id', 'type', 'payload', 'status', 'run_at', 'created_at', 'updated_at', 'started_at', 'finished_at', 'attempts', 'max_attempts', 'last_error', 'worker_id']) {
      assert.ok(columns('scheduled_jobs').includes(col), 'scheduled_jobs sem coluna ' + col);
    }

    const idxMod = indexes('moderation_cases');
    assert.ok(idxMod.includes('idx_mod_cases_group'), 'índice de grupo ausente: ' + idxMod.join(','));
    assert.ok(idxMod.includes('idx_mod_cases_user'), 'índice de usuário ausente: ' + idxMod.join(','));
    const idxUse = indexes('command_usage');
    for (const i of ['idx_cmd_usage_day', 'idx_cmd_usage_user', 'idx_cmd_usage_group']) {
      assert.ok(idxUse.includes(i), 'índice ' + i + ' ausente: ' + idxUse.join(','));
    }
    assert.ok(indexes('scheduled_jobs').includes('idx_sched_jobs_due'), 'índice do worker ausente');

    // o banco inteiro não usa FOREIGN KEY — consistência mantida
    for (const t of ['moderation_cases', 'command_usage', 'scheduled_jobs']) {
      assert.deepStrictEqual(q().prepare(`PRAGMA foreign_key_list(${t})`).all(), [], t + ' não deveria declarar FK');
    }
  });

  await check('migrações: constraints NOT NULL e CHECK ativas', () => {
    assert.throws(
      () => q().prepare(`INSERT INTO moderation_cases (group_id, user_id, action, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', '')`).run(GROUP, USER, 'warn', 'inexistente'),
      /CHECK/i, 'CHECK de status do caso não aplicado'
    );
    assert.throws(
      () => q().prepare(`INSERT INTO moderation_cases (group_id, user_id, created_at, updated_at) VALUES (?, ?, '', '')`).run(GROUP, USER),
      /NOT NULL/i, 'action deveria ser NOT NULL'
    );
    assert.throws(
      () => q().prepare(`INSERT INTO scheduled_jobs (type, status, run_at, created_at, updated_at) VALUES (?, ?, ?, '', '')`).run('x', 'voando', REF),
      /CHECK/i, 'CHECK de status de job não aplicado'
    );
    assert.throws(
      () => q().prepare(`INSERT INTO scheduled_jobs (type, run_at, created_at, updated_at) VALUES (?, NULL, '', '')`).run('x'),
      /NOT NULL/i, 'run_at deveria ser NOT NULL'
    );
    assert.throws(
      () => q().prepare(`INSERT INTO command_usage (command, day) VALUES (?, NULL)`).run('ping'),
      /NOT NULL/i, 'day deveria ser NOT NULL'
    );
  });

  await check('migrações: reabrir o banco não reaplica nada (idempotência)', () => {
    const antes = q().prepare('SELECT MAX(applied_at) AS a, COUNT(*) AS c FROM schema_migrations').get();
    D().close();
    D().open();
    const depois = q().prepare('SELECT MAX(applied_at) AS a, COUNT(*) AS c FROM schema_migrations').get();
    assert.strictEqual(depois.c, antes.c, 'contagem mudou ao reabrir');
    assert.strictEqual(depois.a, antes.a, 'applied_at mudou ao reabrir');
  });

  await check('migrações: banco antigo (v34) recebe só as migrações novas', () => {
    const copia = dbtmp.tmpFile('lua-fase4-upgrade.db');
    limpaArquivo(copia);
    D().close();
    fs.copyFileSync(DB_FILE, copia);

    // simula um banco que parou na versão 34 (sem as tabelas da Fase 4)
    const tmp = require('better-sqlite3')(copia);
    tmp.prepare('DELETE FROM schema_migrations WHERE version > 34').run();
    tmp.exec('DROP TABLE IF EXISTS moderation_cases; DROP TABLE IF EXISTS command_usage; DROP TABLE IF EXISTS scheduled_jobs;');
    const maxAntes = tmp.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    tmp.close();
    assert.strictEqual(maxAntes, 34, 'a simulação deveria deixar o banco na versão 34');

    usaBanco(copia);
    assert.strictEqual(q().prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 38, 'não subiu para 38');
    const recriadas = q().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('moderation_cases','command_usage','scheduled_jobs')"
    ).all().length;
    assert.strictEqual(recriadas, 3, 'tabelas não foram recriadas no upgrade');
    assert.strictEqual(q().prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c, 38, 'não deveria duplicar versões');
    assert.ok(q().prepare('SELECT COUNT(*) AS c FROM users').get().c >= 0, 'tabelas antigas devem continuar acessíveis');

    usaBanco(DB_FILE);
  });

  /* ------------------------------------------------ 2. moderation_cases */

  let caseId = 0;
  await check('moderation_cases: criação, leitura e case_id estável', () => {
    const c1 = casesRepo().createCase({ groupId: GROUP, userId: USER, moderatorId: ADMIN, action: 'warn', reason: 'spam' });
    const c2 = casesRepo().createCase({
      groupId: GROUP, userId: USER, moderatorId: ADMIN, action: 'mute', reason: 'flood',
      metadata: { duration: 3600, source: 'automod' },
    });
    caseId = c1.id;
    assert.ok(Number.isInteger(c1.id) && c1.id > 0, 'case_id inválido: ' + c1.id);
    assert.notStrictEqual(c1.id, c2.id, 'ids deveriam ser únicos');
    assert.strictEqual(c1.status, 'open');
    assert.strictEqual(c1.action, 'warn');
    assert.strictEqual(c1.moderator_id, ADMIN);
    assert.match(c1.created_at, /^\d{4}-\d{2}-\d{2}T/, 'created_at não é ISO');
    assert.match(c1.updated_at, /^\d{4}-\d{2}-\d{2}T/, 'updated_at não é ISO');
    assert.strictEqual(c1.closed_at, '');
    assert.strictEqual(casesRepo().getCase(c1.id).id, c1.id, 'case_id mudou entre gravação e leitura');
    assert.strictEqual(casesRepo().getCase(c1.id).reason, 'spam');
    assert.deepStrictEqual(c2.metadata, { duration: 3600, source: 'automod' }, 'metadata não voltou igual');
  });

  await check('moderation_cases: validação de entrada', () => {
    const c = casesRepo();
    assert.throws(() => c.createCase({ groupId: '', userId: USER, action: 'warn' }), /INVALID_GROUP_ID/);
    assert.throws(() => c.createCase({ groupId: GROUP, userId: '', action: 'warn' }), /INVALID_USER_ID/);
    assert.throws(() => c.createCase({ groupId: GROUP, userId: USER, action: '  ' }), /INVALID_ACTION/);
    assert.throws(() => c.createCase({ groupId: GROUP, userId: USER, action: 'warn', status: 'arquivado' }), /INVALID_STATUS/);
    assert.throws(() => c.createCase({ groupId: GROUP, userId: USER, action: 'warn', metadata: '{ quebrado' }), /SyntaxError|Unexpected/, 'metadata inválida deveria lançar');
    assert.strictEqual(q().prepare('SELECT COUNT(*) AS c FROM moderation_cases').get().c, 2, 'entrada inválida não deveria gravar nada');
  });

  await check('moderation_cases: consulta por grupo, usuário e grupo+usuário', () => {
    const c = casesRepo();
    c.createCase({ groupId: GROUP, userId: USER2, moderatorId: ADMIN, action: 'kick', reason: 'reincidência' });
    c.createCase({ groupId: GROUP2, userId: USER, moderatorId: ADMIN, action: 'ban', reason: 'ofensas' });
    c.createCase({ groupId: GROUP2, userId: USER2, moderatorId: ADMIN, action: 'warn' });

    const doGrupo = c.listCasesByGroup(GROUP);
    assert.strictEqual(doGrupo.length, 3, 'casos do grupo: ' + doGrupo.length);
    assert.ok(doGrupo.every((x) => x.group_id === GROUP), 'veio caso de outro grupo');
    assert.ok(doGrupo[0].id > doGrupo[1].id, 'deveria vir do mais recente para o mais antigo');

    const doUsuario = c.listCasesByUser(USER);
    assert.strictEqual(doUsuario.length, 3, 'casos do usuário: ' + doUsuario.length);
    assert.ok(doUsuario.every((x) => x.user_id === USER));

    const cruzado = c.listCasesByGroupAndUser(GROUP, USER);
    assert.strictEqual(cruzado.length, 2, 'casos do usuário neste grupo: ' + cruzado.length);
    assert.ok(cruzado.every((x) => x.group_id === GROUP && x.user_id === USER));

    assert.strictEqual(c.countByAction(GROUP, USER, 'warn'), 1, 'contagem por ação errada');
    assert.strictEqual(c.listRecent(2).length, 2, 'listRecent deveria respeitar o limite');
  });

  await check('moderation_cases: updateCase/closeCase e ciclo de vida', () => {
    const c = casesRepo();
    const antes = c.getCase(caseId);
    const editado = c.updateCase(caseId, { reason: 'spam reincidente', metadata: { escala: 2 } });
    assert.strictEqual(editado.reason, 'spam reincidente');
    assert.deepStrictEqual(editado.metadata, { escala: 2 });
    assert.ok(editado.updated_at >= antes.updated_at, 'updated_at deveria avançar');

    const fechado = c.closeCase(caseId, 'resolvido');
    assert.strictEqual(fechado.status, 'closed');
    assert.match(fechado.closed_at, /^\d{4}-\d{2}-\d{2}T/, 'closed_at deveria ser carimbado');
    assert.strictEqual(fechado.reason, 'resolvido');
    assert.strictEqual(c.countOpen(GROUP), 2, 'casos abertos do grupo: ' + c.countOpen(GROUP));

    const reaberto = c.updateCase(caseId, { status: 'open' });
    assert.strictEqual(reaberto.status, 'open');
    assert.strictEqual(reaberto.closed_at, '', 'reabrir deveria limpar closed_at');
    c.closeCase(caseId);

    // a identidade do caso é imutável (action/group/user/created_at fora do whitelist)
    assert.deepStrictEqual(c.EDITABLE.slice().sort(), ['metadata', 'moderator_id', 'reason', 'status']);
    assert.throws(() => c.updateCase(caseId, { status: 'pausado' }), /INVALID_STATUS/);
    assert.strictEqual(c.updateCase(999999, { reason: 'x' }), null, 'id inexistente deveria devolver null');
  });

  await check('moderation_cases: metadata corrompida é tolerada e logada', () => {
    q().prepare('INSERT INTO moderation_cases (group_id, user_id, action, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(GROUP, USER, 'warn', '{ json quebrado', new Date().toISOString(), new Date().toISOString());
    const id = q().prepare('SELECT MAX(id) AS id FROM moderation_cases').get().id;
    assert.deepStrictEqual(casesRepo().getCase(id).metadata, {}, 'metadata inválida deveria virar {} (com aviso no log)');
    q().prepare('DELETE FROM moderation_cases WHERE id = ?').run(id);
  });

  /* ------------------------------------------------- 3. command_usage */

  await check('command_usage: registro agrega em vez de duplicar linha', () => {
    const u = usageRepo();
    const dia = '2026-09-15';
    u.recordUsage({ command: 'ping', userId: USER, groupId: GROUP, ok: true, durationMs: 12, at: dia });
    const linhas1 = q().prepare('SELECT COUNT(*) AS c FROM command_usage').get().c;
    u.recordUsage({ command: 'ping', userId: USER, groupId: GROUP, ok: true, durationMs: 8, at: dia });
    u.recordUsage({ command: 'ping', userId: USER, groupId: GROUP, ok: true, durationMs: 10, at: dia });
    const linhas2 = q().prepare('SELECT COUNT(*) AS c FROM command_usage').get().c;
    assert.strictEqual(linhas2, linhas1, 'o mesmo balde criou linha nova');
    const row = q().prepare('SELECT uses, total_ms FROM command_usage WHERE command = ? AND day = ?').get('ping', dia);
    assert.strictEqual(row.uses, 3, 'contador: ' + row.uses);
    assert.strictEqual(row.total_ms, 30, 'total_ms: ' + row.total_ms);
    const totais = u.countUsage({ command: 'ping' });
    assert.deepStrictEqual(totais, { uses: 3, failures: 0, totalMs: 30 });
  });

  await check('command_usage: sucesso e falha ficam em baldes separados', () => {
    const u = usageRepo();
    u.recordUsage({ command: 'sticker', userId: USER, groupId: GROUP, ok: false, durationMs: 5, at: '2026-09-15' });
    u.recordUsage({ command: 'sticker', userId: USER, groupId: GROUP, ok: true, durationMs: 40, at: '2026-09-15' });
    const c = u.countUsage({ command: 'sticker' });
    assert.strictEqual(c.uses, 2);
    assert.strictEqual(c.failures, 1, 'falhas: ' + c.failures);
    const sticker = u.aggregateUsage({}).find((r) => r.command === 'sticker');
    assert.strictEqual(sticker.failures, 1);
    assert.strictEqual(sticker.avgMs, 23, 'média: ' + sticker.avgMs); // (5+40)/2
    assert.ok(u.topFailures({}).every((r) => r.failures > 0), 'topFailures trouxe comando sem falha');
  });

  await check('command_usage: agregações por usuário, grupo e período', () => {
    const u = usageRepo();
    u.recordUsage({ command: 'menu', userId: USER2, groupId: GROUP2, ok: true, durationMs: 3, at: '2026-09-14' });
    u.recordUsage({ command: 'ping', userId: USER2, groupId: GROUP2, ok: true, durationMs: 7, at: '2026-09-14' });

    const doUsuario = u.byUser(USER2);
    assert.strictEqual(doUsuario.length, 2, 'comandos do usuário: ' + doUsuario.length);
    assert.ok(doUsuario.every((r) => r.uses === 1));

    assert.strictEqual(u.byGroup(GROUP2).length, 2, 'comandos do grupo');
    assert.strictEqual(u.countUsage({ sinceDay: '2026-09-14', untilDay: '2026-09-14' }).uses, 2, 'uso no período');
    assert.strictEqual(u.byDay({}).length, 2, 'dias distintos');
    assert.strictEqual(u.daysStored(), 2);
  });

  await check('command_usage: validação e retenção (prune)', () => {
    const u = usageRepo();
    assert.throws(() => u.recordUsage({ command: '' }), /INVALID_COMMAND/);
    assert.throws(() => u.recordUsage({ command: 'ping', at: 'ontem' }), /INVALID_DAY/);
    assert.strictEqual(u.dayOf('2026-01-05'), '2026-01-05');
    assert.strictEqual(u.dayOf(new Date('2026-03-04T10:00:00Z')), '2026-03-04');

    const antes = u.count();
    const removidas = u.prune('2026-09-15'); // apaga só o que é anterior a esse dia
    assert.ok(removidas > 0, 'prune não removeu nada');
    assert.strictEqual(u.daysStored(), 1, 'deveria sobrar só 2026-09-15');
    assert.ok(u.count() < antes, 'a contagem não caiu');
    assert.strictEqual(u.countUsage({ command: 'menu' }).uses, 0, 'dado antigo deveria ter sumido');
  });

  /* ------------------------------------------------ 4. scheduled_jobs */

  let jobId = 0;
  await check('scheduled_jobs: criação com defaults corretos', () => {
    const j = jobsRepo();
    const job = j.createJob({ type: 'reminder', payload: { userId: USER, message: 'oi' }, runAt: '2026-09-15T12:00:00.000Z' });
    jobId = job.id;
    assert.strictEqual(job.status, 'pending');
    assert.strictEqual(job.type, 'reminder');
    assert.deepStrictEqual(job.payload, { userId: USER, message: 'oi' });
    assert.strictEqual(job.run_at, '2026-09-15T12:00:00.000Z');
    assert.strictEqual(job.attempts, 0);
    assert.strictEqual(job.max_attempts, 3);
    assert.strictEqual(job.worker_id, '');
    assert.match(job.created_at, /^\d{4}-\d{2}-\d{2}T/);

    assert.throws(() => j.createJob({ type: '' }), /INVALID_TYPE/);
    assert.throws(() => j.createJob({ type: 'x', runAt: 'daqui a pouco' }), /INVALID_RUN_AT/);
    assert.throws(() => j.createJob({ type: 'x', payload: 42 }), /INVALID_PAYLOAD/);
    assert.throws(() => j.createJob({ type: 'x', payload: '{ quebrado' }), /SyntaxError|Unexpected/);
  });

  await check('scheduled_jobs: listDue respeita run_at', () => {
    const j = jobsRepo();
    j.createJob({ type: 'futuro', runAt: '2030-01-01T00:00:00.000Z' });
    const due = j.listDue(REF);
    assert.ok(due.some((x) => x.id === jobId), 'job vencido não apareceu');
    assert.ok(!due.some((x) => x.type === 'futuro'), 'job futuro não deveria aparecer');
    assert.strictEqual(j.countByStatus().running, 0);
    assert.strictEqual(j.listJobs({ status: 'pending' }).length >= 2, true);
    assert.throws(() => j.listJobs({ status: 'voando' }), /INVALID_STATUS/);
  });

  await check('scheduled_jobs: claim é atômico (pending → running uma única vez)', () => {
    const j = jobsRepo();
    const primeiro = j.claimJob('worker-A', REF);
    assert.ok(primeiro, 'nenhum job vencido foi assumido');
    assert.strictEqual(primeiro.status, 'running');
    assert.strictEqual(primeiro.worker_id, 'worker-A');
    assert.strictEqual(primeiro.attempts, 1, 'attempts deveria ir para 1');
    assert.match(primeiro.started_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.strictEqual(j.getJob(primeiro.id).status, 'running');

    // o job já assumido não pode ser entregue de novo
    const segundo = j.claimJob('worker-B', REF);
    assert.ok(!segundo || segundo.id !== primeiro.id, 'o mesmo job foi entregue a dois workers');
    j.completeJob(primeiro.id);
    if (segundo) j.completeJob(segundo.id);
  });

  await check('scheduled_jobs: transições de estado e guardas', () => {
    const j = jobsRepo();
    /** Coloca um job em 'running' de forma determinística (simula um claim). */
    const forcaRunning = (id, attempts) => {
      q().prepare(`UPDATE scheduled_jobs SET status = 'running', attempts = ?, worker_id = 'w', started_at = ? WHERE id = ?`)
        .run(attempts, new Date().toISOString(), id);
    };

    // running → completed (terminal)
    const a = j.createJob({ type: 'lembrete', runAt: '2026-09-15T12:30:00.000Z' });
    forcaRunning(a.id, 1);
    const done = j.completeJob(a.id);
    assert.strictEqual(done.status, 'completed');
    assert.match(done.finished_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.strictEqual(j.completeJob(a.id), null, 'completar duas vezes deveria retornar null');
    assert.strictEqual(j.cancelJob(a.id), null, 'cancelar job terminal deveria retornar null');
    assert.strictEqual(j.failJob(a.id, 'tarde demais'), null, 'falhar job terminal deveria retornar null');

    // running → failed (terminal)
    const b = j.createJob({ type: 'lembrete', runAt: '2026-09-15T12:30:00.000Z' });
    forcaRunning(b.id, 1);
    const falhou = j.failJob(b.id, 'destino indisponível');
    assert.strictEqual(falhou.status, 'failed');
    assert.strictEqual(falhou.last_error, 'destino indisponível');
    assert.match(falhou.finished_at, /^\d{4}-\d{2}-\d{2}T/);

    // pending não pode ser completado nem falhado (só quem está rodando)
    const p = j.createJob({ type: 'lembrete', runAt: '2026-09-15T12:30:00.000Z' });
    assert.strictEqual(j.completeJob(p.id), null, 'completar job pending deveria retornar null');
    assert.strictEqual(j.failJob(p.id, 'x'), null, 'falhar job pending deveria retornar null');
    assert.strictEqual(j.getJob(p.id).status, 'pending', 'o estado não deveria ter mudado');

    // running → pending (retry) enquanto houver tentativas
    const c = j.createJob({ type: 'lembrete', runAt: '2026-09-15T12:30:00.000Z', maxAttempts: 2 });
    forcaRunning(c.id, 1);
    const re = j.failJob(c.id, 'timeout', { requeue: true });
    assert.strictEqual(re.status, 'pending', 'deveria voltar para pending, veio ' + re.status);
    assert.strictEqual(re.attempts, 1, 'tentativa não deveria ser perdida');
    assert.strictEqual(re.worker_id, '', 'o worker deveria ser liberado no requeue');
    assert.strictEqual(re.started_at, '');
    assert.strictEqual(re.last_error, 'timeout', 'o erro deveria ficar registrado mesmo no retry');

    // tentativas esgotadas → falha terminal, mesmo pedindo requeue
    forcaRunning(c.id, 2);
    const re2 = j.failJob(c.id, 'timeout de novo', { requeue: true });
    assert.strictEqual(re2.status, 'failed', 'sem tentativas deveria falhar, veio ' + re2.status);
    assert.strictEqual(re2.attempts, 2);

    // pending → cancelled
    const d = j.createJob({ type: 'lembrete', runAt: '2027-01-01T00:00:00.000Z' });
    assert.strictEqual(j.cancelJob(d.id).status, 'cancelled');
    assert.strictEqual(j.cancelJob(d.id), null, 'cancelar duas vezes deveria retornar null');
    assert.strictEqual(j.getJob(999999), null);
  });

  await check('scheduled_jobs: retenção de jobs terminados (pruneFinished)', () => {
    const j = jobsRepo();
    const velho = j.createJob({ type: 'antigo', runAt: '2026-01-01T00:00:00.000Z' });
    q().prepare(`UPDATE scheduled_jobs SET status = 'completed', updated_at = ? WHERE id = ?`).run('2026-01-01T00:00:00.000Z', velho.id);
    const novo = j.createJob({ type: 'recente', runAt: '2026-09-15T12:00:00.000Z' });
    const antes = j.count();
    const removidos = j.pruneFinished('2026-06-01T00:00:00.000Z');
    assert.ok(removidos >= 1, 'pruneFinished não removeu nada');
    assert.strictEqual(j.getJob(velho.id), null, 'job terminado antigo deveria ter sido removido');
    assert.ok(j.getJob(novo.id), 'job pendente não deveria ser removido pela retenção');
    assert.ok(j.count() < antes, 'a contagem não caiu');
  });

  await check('scheduled_jobs: payload corrompido é tolerado e logado', () => {
    q().prepare(`UPDATE scheduled_jobs SET payload = '{ corrompido' WHERE id = ?`).run(jobId);
    assert.deepStrictEqual(jobsRepo().getJob(jobId).payload, {}, 'payload inválido deveria virar {} (com aviso no log)');
    q().prepare(`UPDATE scheduled_jobs SET payload = '{}' WHERE id = ?`).run(jobId);
  });

  /* ------------------------------------ 5. concorrência entre processos */

  await check('concorrência: dois processos não assumem o mesmo job', async () => {
    const dbFile = dbtmp.tmpFile('lua-fase4-concorrencia.db');
    limpaArquivo(dbFile);
    usaBanco(dbFile);
    const j = jobsRepo();

    // pilha grande de propósito: com poucos jobs um processo drena tudo antes do
    // outro começar e a "disputa" seria de fachada
    const TOTAL = 500;
    const passado = new Date(Date.now() - 1000).toISOString();
    for (let i = 0; i < TOTAL; i++) j.createJob({ type: 'lembrete', payload: { i }, runAt: passado });

    // Cada processo tenta no máximo CAP jobs. Com CAP < TOTAL nenhum dos dois
    // consegue esvaziar a fila sozinho, então a disputa é garantida por
    // construção — sem depender de quem acorda primeiro (assertiva não-flaky).
    const CAP = 300;
    const largada = Date.now() + 800; // barreira: os dois começam juntos
    const filho = spawn(
      process.execPath,
      [path.join(__dirname, 'db-claim-worker.js'), dbFile, 'worker-filho', String(CAP), String(largada), '1'],
      { cwd: process.cwd(), env: Object.assign({}, process.env, { DATABASE_FILE: dbFile }) }
    );
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => { stdout += d.toString(); });
    filho.stderr.on('data', (d) => { stderr += d.toString(); });
    const fimFilho = new Promise((resolve) => filho.on('close', (code) => resolve(code)));

    // espera o filho estar pronto (banco aberto) para a disputa ser real
    const esperaPronto = async () => {
      for (let i = 0; i < 1000 && !stdout.includes('__READY__'); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await esperaPronto();
    assert.ok(stdout.includes('__READY__'), 'o processo filho não ficou pronto: ' + stderr.slice(0, 300));
    const ateLargada = largada - Date.now();
    if (ateLargada > 0) await new Promise((r) => setTimeout(r, ateLargada));

    // o pai disputa ao mesmo tempo, usando o MESMO repository
    const doPai = [];
    const errosPai = [];
    for (let i = 0; i < CAP; i++) {
      try {
        const job = j.claimJob('worker-pai');
        if (!job) break;
        doPai.push(job.id);
      } catch (err) {
        errosPai.push(String(err.code || err.message));
        if (errosPai.length > 10) break;
      }
      // mesmo ritmo do filho: sem isso um lado esvazia a fila antes do outro
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    }

    const code = await fimFilho;
    const m = stdout.match(/__CLAIMS_BEGIN__([\s\S]*?)__CLAIMS_END__/);
    assert.ok(m, 'o processo filho não devolveu resultado (exit ' + code + ') ' + stderr.slice(0, 300));
    const { claimed: doFilho, errors: errosFilho } = JSON.parse(m[1]);

    const todos = doPai.concat(doFilho);
    assert.strictEqual(todos.length, TOTAL,
      `esperava ${TOTAL} claims, vieram ${todos.length} (pai ${doPai.length} + filho ${doFilho.length})`);
    assert.strictEqual(new Set(todos).size, TOTAL, 'houve job assumido por dois workers: ' + todos.join(','));
    assert.ok(doPai.length > 0 && doFilho.length > 0,
      `os dois processos precisavam disputar de verdade (pai ${doPai.length}, filho ${doFilho.length})`);

    // prova de que houve INTERCALAÇÃO (e não "um esvaziou, depois o outro"):
    // se fossem blocos sequenciais, todos os ids do filho seriam menores que
    // todos os do pai (a fila é consumida em ORDER BY run_at, id)
    assert.ok(Math.max(...doFilho) > Math.min(...doPai),
      'os processos não se intercalaram: um esvaziou a fila antes do outro começar');

    assert.strictEqual(q().prepare(`SELECT COUNT(*) AS c FROM scheduled_jobs WHERE status = 'running'`).get().c, TOTAL,
      'nem todo job ficou running');
    assert.strictEqual(q().prepare(`SELECT COUNT(DISTINCT id) AS c FROM scheduled_jobs`).get().c, TOTAL);
    const porWorker = q().prepare(`SELECT worker_id, COUNT(*) AS c FROM scheduled_jobs GROUP BY worker_id`).all();
    assert.ok(porWorker.length >= 2, 'esperava jobs dos dois workers: ' + JSON.stringify(porWorker));
    console.log(`      (pai ${doPai.length} / filho ${doFilho.length}; SQLITE_BUSY: pai ${errosPai.length}, filho ${errosFilho.length})`);

    usaBanco(DB_FILE);
  });

  /* ---------------------------------------- 6. planos de consulta (EXPLAIN) */

  await check('índices são usados pelas consultas críticas (EXPLAIN)', () => {
    const g = explain(`SELECT * FROM moderation_cases WHERE group_id = ? ORDER BY id DESC LIMIT ?`, [GROUP, 20]);
    assert.match(g, /idx_mod_cases_group/, 'casos por grupo não usou o índice: ' + g);

    const gu = explain(`SELECT * FROM moderation_cases WHERE user_id = ? AND group_id = ? ORDER BY id DESC LIMIT ?`, [USER, GROUP, 20]);
    assert.match(gu, /idx_mod_cases_user/, 'usuário+grupo não usou o índice: ' + gu);

    const u = explain(`SELECT * FROM moderation_cases WHERE user_id = ? ORDER BY id DESC LIMIT ?`, [USER, 20]);
    assert.match(u, /idx_mod_cases_user/, 'casos por usuário não usou o índice: ' + u);

    const dia = explain(`SELECT day, SUM(uses) FROM command_usage WHERE day >= ? AND day <= ? GROUP BY day`, ['2026-09-01', '2026-09-30']);
    assert.match(dia, /idx_cmd_usage_day/, 'consulta por período não usou o índice: ' + dia);

    const usr = explain(`SELECT command, SUM(uses) FROM command_usage WHERE user_id = ? GROUP BY command`, [USER]);
    assert.match(usr, /idx_cmd_usage_user/, 'uso por usuário não usou o índice: ' + usr);

    const grp = explain(`SELECT command, SUM(uses) FROM command_usage WHERE group_id = ? GROUP BY command`, [GROUP]);
    assert.match(grp, /idx_cmd_usage_group/, 'uso por grupo não usou o índice: ' + grp);

    const due = explain(`SELECT * FROM scheduled_jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT ?`, [REF, 10]);
    assert.match(due, /idx_sched_jobs_due/, 'busca do worker não usou o índice: ' + due);

    const prune = explain(`DELETE FROM command_usage WHERE day < ?`, ['2026-09-01']);
    assert.match(prune, /idx_cmd_usage_day/, 'retenção não usou o índice: ' + prune);

    for (const [nome, detalhe] of [['grupo', g], ['usuário+grupo', gu], ['período', dia], ['worker', due], ['retenção', prune]]) {
      assert.ok(!/SCAN (moderation_cases|command_usage|scheduled_jobs)\b/.test(detalhe),
        nome + ' faz varredura completa: ' + detalhe);
    }
  });

  /* ------------------------------------------------ 7. compatibilidade */

  await check('compatibilidade: tabelas antigas íntegras e graváveis', () => {
    const users = require('../database/users');
    const economy = require('../database/economy');
    users.upsert(USER, 'Teste Fase 4');
    assert.strictEqual(users.get(USER).name, 'Teste Fase 4');
    economy.ensure(USER);
    economy.addWallet(USER, 100);
    economy.deposit(USER, 40);
    const row = q().prepare('SELECT wallet, bank FROM economy WHERE user_id = ?').get(USER);
    assert.strictEqual(row.wallet, 60, 'carteira: ' + row.wallet);
    assert.strictEqual(row.bank, 40, 'banco: ' + row.bank);
    assert.ok(typeof D().stats().users === 'number', 'database.stats() quebrou');
    assert.strictEqual(q().prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c, 38);
  });

  /* ----------------------------------------------------------- resumo */
  const falhas = results.filter(([, ok]) => !ok);
  const tabelas = q().prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c;
  console.log(`\n=== DATABASE TEST: ${results.length - falhas.length} passou, ${falhas.length} falhou `
    + `(${tabelas} tabelas, 38 migrações) ===`);
  if (falhas.length) {
    for (const [label, , err] of falhas) console.log('  FALHA: ' + label + ' — ' + err);
    process.exitCode = 1;
  } else {
    console.log('=== DATABASE TEST: TUDO OK ===');
  }
  D().close();
})().catch((err) => { console.error('DATABASE TEST quebrou:', err); process.exitCode = 1; });
