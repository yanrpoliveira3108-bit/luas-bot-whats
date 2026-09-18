/**
 * database/commandUsage.js — uso de comandos persistido (Fase 4).
 *
 * DECISÃO DE GRANULARIDADE (documentada em docs/AUDIT-ARQUITETURA.md):
 * contadores AGREGADOS por (comando, usuário, grupo, dia, sucesso) em vez de
 * uma linha por execução. Motivos:
 *   • volume — o bot tem 332 comandos; 1 linha por execução cresce com o número
 *     de MENSAGENS, enquanto o agregado cresce com o número de COMBINAÇÕES
 *     distintas por dia (limitado por usuários × comandos realmente usados);
 *   • as perguntas do futuro !analytics são todas de agregação (mais usado,
 *     quantas vezes, qual falha mais, por grupo, por usuário, por período) —
 *     com o agregado elas viram SUM() sobre poucas linhas;
 *   • retenção — apagar um período é um único DELETE por `day` indexado.
 * O detalhe por execução (linha a linha, com args) continua coberto em memória
 * por utils/activity.js (ring buffer de 200) para !logs e o terminal. Não há
 * duplicação de utils/perf.js: perf.js é volátil (contadores do processo),
 * esta tabela é o histórico persistente entre reinícios.
 *
 * RETENÇÃO: prune(beforeDay) apaga tudo anterior a um dia. Quem chama é a
 * Fase 6 (scheduler) ou o dono manualmente; a estrutura já está pronta e a
 * consulta usa idx_cmd_usage_day.
 */

'use strict';

const { prepare } = require('./database');

const now = () => new Date().toISOString();
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------ helpers ------------------------------ */

/** 'YYYY-MM-DD' (UTC) de uma data, ISO string ou nada (= hoje). */
function dayOf(at) {
  if (!at) return now().slice(0, 10);
  if (at instanceof Date) return at.toISOString().slice(0, 10);
  const s = String(at);
  if (DAY_RE.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('INVALID_DAY');
  return d.toISOString().slice(0, 10);
}

/** Nome de comando normalizado (o registry já grava em minúsculas). */
function commandOf(command) {
  const c = String(command || '').toLowerCase().trim();
  if (!c) throw new Error('INVALID_COMMAND');
  return c;
}

/* ------------------------------ escrita ------------------------------ */

/**
 * Registra uma execução (soma no balde do dia).
 * @param {object} data
 * @param {string} data.command        nome do comando (obrigatório)
 * @param {string} [data.userId]       JID de quem executou
 * @param {string} [data.groupId]      JID do grupo ('' em conversa privada)
 * @param {boolean} [data.ok=true]     sucesso ou falha
 * @param {number} [data.durationMs=0] duração da execução
 * @param {Date|string} [data.at]      quando (default: agora)
 */
function recordUsage(data) {
  const d = data || {};
  const day = dayOf(d.at);
  return prepare(
    'record_cmd_usage',
    `INSERT INTO command_usage (command, user_id, group_id, day, ok, uses, total_ms, last_used_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(command, user_id, group_id, day, ok) DO UPDATE SET
       uses = uses + 1,
       total_ms = total_ms + excluded.total_ms,
       last_used_at = excluded.last_used_at`
  ).run(
    commandOf(d.command),
    String(d.userId || ''),
    String(d.groupId || ''),
    day,
    d.ok === false ? 0 : 1,
    Math.max(0, Math.floor(Number(d.durationMs) || 0)),
    now()
  );
}

/**
 * Apaga o histórico anterior a um dia (retenção).
 * @param {Date|string} beforeDay exclui tudo com day < beforeDay
 * @returns {number} linhas removidas
 */
function prune(beforeDay) {
  const day = dayOf(beforeDay);
  return prepare('prune_cmd_usage', `DELETE FROM command_usage WHERE day < ?`).run(day).changes;
}

/* ------------------------------ leitura ------------------------------ */

/** Filtro comum das consultas: monta WHERE parametrizado por campos opcionais. */
function buildFilter(opts) {
  const o = opts || {};
  const where = [];
  const values = [];
  if (o.command) { where.push('command = ?'); values.push(commandOf(o.command)); }
  if (o.userId) { where.push('user_id = ?'); values.push(String(o.userId)); }
  if (o.groupId) { where.push('group_id = ?'); values.push(String(o.groupId)); }
  if (o.sinceDay) { where.push('day >= ?'); values.push(dayOf(o.sinceDay)); }
  if (o.untilDay) { where.push('day <= ?'); values.push(dayOf(o.untilDay)); }
  if (o.ok === true || o.ok === false) { where.push('ok = ?'); values.push(o.ok ? 1 : 0); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', values };
}

/** Total de execuções (e de falhas) dentro do filtro. */
function countUsage(opts) {
  const f = buildFilter(opts);
  const row = prepare(
    'count_cmd_usage',
    `SELECT COALESCE(SUM(uses), 0) AS uses,
            COALESCE(SUM(CASE WHEN ok = 0 THEN uses ELSE 0 END), 0) AS failures,
            COALESCE(SUM(total_ms), 0) AS total_ms
       FROM command_usage ${f.sql}`
  ).get(...f.values);
  return { uses: row.uses, failures: row.failures, totalMs: row.total_ms };
}

/** Ranking de comandos. Usa o prefixo do PRIMARY KEY. */
function aggregateUsage(opts = {}) {
  const limit = Number(opts.limit) || 10;
  const f = buildFilter(opts);
  return prepare(
    'agg_cmd_usage',
    `SELECT command,
            SUM(uses) AS uses,
            SUM(CASE WHEN ok = 0 THEN uses ELSE 0 END) AS failures,
            SUM(total_ms) AS total_ms,
            MAX(last_used_at) AS last_used_at
       FROM command_usage ${f.sql}
      GROUP BY command
      ORDER BY uses DESC, command ASC
      LIMIT ?`
  ).all(...f.values, limit).map((r) => ({
    command: r.command,
    uses: r.uses,
    failures: r.failures,
    totalMs: r.total_ms,
    avgMs: r.uses ? Math.round(r.total_ms / r.uses) : 0,
    lastUsedAt: r.last_used_at,
  }));
}

/** Quais comandos mais falham. */
function topFailures(opts = {}) {
  return aggregateUsage(Object.assign({}, opts, { ok: false }));
}

/** Uso de um usuário, por comando. Usa idx_cmd_usage_user. */
function byUser(userId, opts = {}) {
  return aggregateUsage(Object.assign({}, opts, { userId }));
}

/** Quem usa determinado comando, por grupo. Usa idx_cmd_usage_group. */
function byGroup(groupId, opts = {}) {
  const limit = Number(opts.limit) || 10;
  const f = buildFilter(Object.assign({}, opts, { groupId }));
  return prepare(
    'agg_cmd_usage_group',
    `SELECT command, SUM(uses) AS uses, SUM(total_ms) AS total_ms
       FROM command_usage ${f.sql}
      GROUP BY command
      ORDER BY uses DESC, command ASC
      LIMIT ?`
  ).all(...f.values, limit);
}

/** Uso por dia (série temporal para relatórios). */
function byDay(opts = {}) {
  const f = buildFilter(opts);
  return prepare(
    'agg_cmd_usage_day',
    `SELECT day, SUM(uses) AS uses,
            SUM(CASE WHEN ok = 0 THEN uses ELSE 0 END) AS failures
       FROM command_usage ${f.sql}
      GROUP BY day
      ORDER BY day ASC`
  ).all(...f.values);
}

/** Dias distintos gravados (útil para saber o alcance da retenção). */
function daysStored() {
  return prepare('cmd_usage_days', `SELECT COUNT(DISTINCT day) AS c FROM command_usage`).get().c;
}

function count() {
  return prepare('count_cmd_usage_rows', `SELECT COUNT(*) AS c FROM command_usage`).get().c;
}

module.exports = {
  recordUsage,
  countUsage,
  aggregateUsage,
  topFailures,
  byUser,
  byGroup,
  byDay,
  prune,
  daysStored,
  count,
  dayOf,
};
