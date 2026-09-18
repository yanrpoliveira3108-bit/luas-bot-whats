/**
 * database/scheduledJobs.js — jobs agendados (Fase 4).
 *
 * O SCHEDULER NÃO EXISTE AINDA: esta é apenas a camada persistente que a
 * Fase 6 vai usar. Nenhum timer, cron ou worker é criado aqui.
 *
 * MÁQUINA DE ESTADOS (simples e previsível):
 *
 *     pending ──claimJob()──▶ running ──completeJob()──▶ completed  (terminal)
 *        │                       │
 *        │                       └──failJob()──▶ failed             (terminal)
 *        │                       └──failJob({requeue:true})──▶ pending (se attempts < max_attempts)
 *        └──cancelJob()──▶ cancelled                                 (terminal)
 *                            (cancelJob também vale para um job 'running':
 *                             o worker consulta o status antes de agir)
 *
 * CONCORRÊNCIA: claimJob() é UM ÚNICO statement UPDATE com subconsulta e a
 * guarda `AND status = 'pending'` — um compare-and-set no nível do banco. Não
 * há SELECT seguido de UPDATE em passos separados, então dois workers (mesmo
 * em processos diferentes) não conseguem ficar com o mesmo job: o segundo vê
 * status='running', a guarda falha e a operação não retorna linha. O SQLite
 * serializa escritas (WAL + busy timeout do better-sqlite3), e cada statement
 * é atômico.
 */

'use strict';

const { prepare } = require('./database');
const logger = require('../utils/logger').child('sched-jobs');

const now = () => new Date().toISOString();

/** Estados existentes — não há outros de propósito. */
const STATUSES = Object.freeze(['pending', 'running', 'completed', 'failed', 'cancelled']);
const TERMINAL = Object.freeze(['completed', 'failed', 'cancelled']);

/* ------------------------------ helpers ------------------------------ */

function parsePayload(raw) {
  if (raw === null || raw === undefined || raw === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    logger.warn({ err: err.message, raw: String(raw).slice(0, 80) }, 'payload de job corrompido');
    return {};
  }
}

function stringifyPayload(payload) {
  if (payload === null || payload === undefined || payload === '') return '{}';
  if (typeof payload === 'string') {
    JSON.parse(payload); // lança se for inválido — nunca gravamos payload corrompido
    return payload;
  }
  if (typeof payload !== 'object') throw new Error('INVALID_PAYLOAD');
  return JSON.stringify(payload);
}

/** run_at obrigatório e em ISO-8601: a ordenação léxica é a cronológica. */
function runAtOf(runAt) {
  if (!runAt) return now();
  if (runAt instanceof Date) {
    if (Number.isNaN(runAt.getTime())) throw new Error('INVALID_RUN_AT');
    return runAt.toISOString();
  }
  const d = new Date(String(runAt));
  if (Number.isNaN(d.getTime())) throw new Error('INVALID_RUN_AT');
  return d.toISOString();
}

function shape(row) {
  if (!row) return null;
  return Object.assign({}, row, { payload: parsePayload(row.payload) });
}

/* ------------------------------ escrita ------------------------------ */

/**
 * Cria um job.
 * @param {object} data
 * @param {string} data.type            tipo do job (obrigatório; a Fase 6 decide os tipos)
 * @param {object|string} [data.payload] dados do job (JSON em TEXT)
 * @param {Date|string} [data.runAt]    quando executar (default: agora)
 * @param {number} [data.maxAttempts=3]
 * @returns {object|null} o job criado
 */
function createJob(data) {
  const d = data || {};
  const type = String(d.type || '').toLowerCase().trim();
  if (!type) throw new Error('INVALID_TYPE');
  const maxAttempts = Math.max(1, Math.floor(Number(d.maxAttempts) || 3));
  const ts = now();
  const info = prepare(
    'create_sched_job',
    `INSERT INTO scheduled_jobs
       (type, payload, status, run_at, created_at, updated_at, max_attempts)
     VALUES (?, ?, 'pending', ?, ?, ?, ?)`
  ).run(type, stringifyPayload(d.payload), runAtOf(d.runAt), ts, ts, maxAttempts);
  return getJob(info.lastInsertRowid);
}

/**
 * Assume o próximo job vencido — atomicamente.
 * @param {string} workerId identificação de quem executa (para diagnóstico)
 * @param {Date|string} [at] instante de referência (default: agora)
 * @returns {object|null} o job assumido, ou null se não havia nenhum
 */
function claimJob(workerId, at) {
  const ref = runAtOf(at || new Date());
  const row = prepare(
    'claim_sched_job',
    `UPDATE scheduled_jobs
        SET status = 'running',
            worker_id = ?,
            started_at = ?,
            updated_at = ?,
            attempts = attempts + 1
      WHERE status = 'pending'
        AND run_at <= ?
        AND id = (
          SELECT id FROM scheduled_jobs
           WHERE status = 'pending' AND run_at <= ?
           ORDER BY run_at, id
           LIMIT 1
        )
      RETURNING *`
  ).get(String(workerId || ''), ref, ref, ref, ref); // worker, started, updated, run_at (externo), run_at (subconsulta)
  return shape(row);
}

/** Marca como concluído. Só vale para job 'running'. */
function completeJob(id) {
  const ts = now();
  const info = prepare(
    'complete_sched_job',
    `UPDATE scheduled_jobs
        SET status = 'completed', finished_at = ?, updated_at = ?, last_error = ''
      WHERE id = ? AND status = 'running'`
  ).run(ts, ts, Number(id)); // finished_at, updated_at, id
  return info.changes === 1 ? getJob(id) : null;
}

/**
 * Marca como falho.
 * @param {number} id
 * @param {string} error mensagem de erro (fica em last_error)
 * @param {object} [opts]
 * @param {boolean} [opts.requeue=false] reencaminhar como 'pending' se ainda
 *        houver tentativas (attempts < max_attempts)
 * @returns {object|null} o job, ou null se ele não estava 'running'
 */
function failJob(id, error, opts) {
  const o = opts || {};
  const ts = now();
  const msg = String(error || '').slice(0, 500);
  if (o.requeue) {
    const info = prepare(
      'requeue_sched_job',
      `UPDATE scheduled_jobs
          SET status = 'pending', updated_at = ?, last_error = ?, worker_id = '', started_at = ''
        WHERE id = ? AND status = 'running' AND attempts < max_attempts`
    ).run(ts, msg, Number(id));
    if (info.changes === 1) return getJob(id);
  }
  const info = prepare(
    'fail_sched_job',
    `UPDATE scheduled_jobs
        SET status = 'failed', updated_at = ?, finished_at = ?, last_error = ?
      WHERE id = ? AND status = 'running'`
  ).run(ts, ts, msg, Number(id));
  return info.changes === 1 ? getJob(id) : null;
}

/** Cancela um job pendente ou em execução. Estados terminais não mudam. */
function cancelJob(id) {
  const ts = now();
  const info = prepare(
    'cancel_sched_job',
    `UPDATE scheduled_jobs
        SET status = 'cancelled', updated_at = ?, finished_at = ?
      WHERE id = ? AND status IN ('pending', 'running')`
  ).run(ts, ts, Number(id));
  return info.changes === 1 ? getJob(id) : null;
}

/**
 * Retenção de jobs terminados (mesma filosofia de command_usage.prune).
 * @param {Date|string} before apaga terminados com updated_at < before
 * @returns {number} linhas removidas
 */
function pruneFinished(before) {
  const ref = runAtOf(before);
  return prepare(
    'prune_sched_jobs',
    `DELETE FROM scheduled_jobs
      WHERE status IN ('completed', 'failed', 'cancelled') AND updated_at < ?`
  ).run(ref).changes;
}

/* ------------------------------ leitura ------------------------------ */

function getJob(id) {
  return shape(prepare('get_sched_job', `SELECT * FROM scheduled_jobs WHERE id = ?`).get(Number(id)));
}

/** Lista por status (ou todos), mais antigos primeiro. */
function listJobs(opts = {}) {
  const limit = Number(opts.limit) || 20;
  if (opts.status) {
    if (!STATUSES.includes(String(opts.status))) throw new Error('INVALID_STATUS');
    return prepare(
      'list_sched_jobs_status',
      `SELECT * FROM scheduled_jobs WHERE status = ? ORDER BY run_at, id LIMIT ?`
    ).all(String(opts.status), limit).map(shape);
  }
  return prepare('list_sched_jobs', `SELECT * FROM scheduled_jobs ORDER BY run_at, id LIMIT ?`)
    .all(limit)
    .map(shape);
}

/** Jobs prontos para executar agora (a consulta que o worker da Fase 6 fará). */
function listDue(at, limit = 10) {
  const ref = runAtOf(at || new Date());
  return prepare(
    'list_sched_jobs_due',
    `SELECT * FROM scheduled_jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT ?`
  ).all(ref, Number(limit)).map(shape);
}

function countByStatus() {
  const rows = prepare(
    'count_sched_jobs_status',
    `SELECT status, COUNT(*) AS c FROM scheduled_jobs GROUP BY status`
  ).all();
  const out = {};
  for (const s of STATUSES) out[s] = 0;
  for (const r of rows) out[r.status] = r.c;
  return out;
}

function count() {
  return prepare('count_sched_jobs', `SELECT COUNT(*) AS c FROM scheduled_jobs`).get().c;
}

module.exports = {
  STATUSES,
  TERMINAL,
  createJob,
  getJob,
  listJobs,
  listDue,
  claimJob,
  completeJob,
  failJob,
  cancelJob,
  pruneFinished,
  countByStatus,
  count,
};
