/**
 * utils/resilience.js — timeout + retry com backoff (itens 46 e 47).
 *
 * Toda chamada externa do bot (API, download, conversão, consulta) deve passar
 * por aqui: nada de `await fetch(...)` sem limite de tempo, e retry só para
 * erro transitório — erro permanente (auth, input inválido, não encontrado,
 * permissão) NÃO é repetido.
 */

'use strict';

const logger = require('./logger').child('resilience');

const CONFIG = require('../config');
const DEFAULT_TIMEOUT_MS = (CONFIG.limits && CONFIG.limits.downloadTimeoutMs) || 90000;

/** Erros que nunca devem ser repetidos (item 47). */
const PERMANENT_CODES = new Set([
  'EACCES',
  'EPERM',
  'ENOENT',
  'ENOTDIR',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_URL',
  'AUTH_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INVALID_INPUT',
  'INVALID_URL',
  'NOT_FOUND',
  'NO_FORMAT',
  'BAD_REQUEST',
  'PERMISSION_DENIED',
]);

const PERMANENT_STATUS = new Set([400, 401, 403, 404, 405, 410, 422]);

/**
 * O erro é permanente (não vale retry)?
 * @param {Error & {code?: string, status?: number}} err
 */
function isPermanent(err) {
  if (!err) return true;
  const code = String(err.code || '').toUpperCase();
  if (PERMANENT_CODES.has(code)) return true;
  if (err.status && PERMANENT_STATUS.has(Number(err.status))) return true;
  const msg = String(err.message || '').toLowerCase();
  if (/invalid (token|url|input|argument)|não encontrado|not found|unauthorized|forbidden|permission denied/.test(msg)) {
    return true;
  }
  return false;
}

/** Cria um erro de timeout padronizado. */
function timeoutError(ms, label) {
  const err = new Error(`tempo limite de ${ms}ms excedido${label ? ` em ${label}` : ''}`);
  err.code = 'TIMEOUT';
  err.timeoutMs = ms;
  return err;
}

/**
 * Executa com timeout. Aceita:
 *  - função (recebe { signal, isCancelled }) — recomendada: permite abortar de verdade;
 *  - Promise — corrida simples (a promise continua, mas o caller não espera).
 *
 * @param {Function|Promise} target
 * @param {number} [ms]
 * @param {string} [label]
 */
async function withTimeout(target, ms = DEFAULT_TIMEOUT_MS, label = '') {
  const limit = Number(ms) > 0 ? Number(ms) : DEFAULT_TIMEOUT_MS;
  let controller = null;
  let timer = null;
  try {
    if (typeof target === 'function') {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), limit);
      return await target({ signal: controller.signal, isCancelled: () => controller.signal.aborted });
    }
    return await Promise.race([
      Promise.resolve(target),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(limit, label)), limit);
      }),
    ]);
  } catch (err) {
    if (err && (err.name === 'AbortError' || (controller && controller.signal.aborted))) {
      throw timeoutError(limit, label);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Retry com backoff exponencial + jitter.
 *
 * @param {Function} fn recebe ({ attempt, signal }) e pode retornar promise
 * @param {object} [opts]
 * @param {number} [opts.retries=2] tentativas extras
 * @param {number} [opts.baseDelayMs=300]
 * @param {number} [opts.maxDelayMs=4000]
 * @param {number} [opts.timeoutMs] timeout por tentativa
 * @param {Function} [opts.shouldRetry] (err, attempt) => boolean
 * @param {string} [opts.label]
 */
async function retry(fn, opts = {}) {
  const retries = Number.isFinite(opts.retries) ? opts.retries : 2;
  const baseDelay = Number.isFinite(opts.baseDelayMs) ? opts.baseDelayMs : 300;
  const maxDelay = Number.isFinite(opts.maxDelayMs) ? opts.maxDelayMs : 4000;
  const label = opts.label || 'operação';
  let lastErr = null;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const task = fn({ attempt });
      return opts.timeoutMs ? await withTimeout(task, opts.timeoutMs, `${label}#${attempt}`) : await task;
    } catch (err) {
      lastErr = err;
      const canRetry = attempt <= retries && !isPermanent(err) && (opts.shouldRetry ? opts.shouldRetry(err, attempt) !== false : true);
      if (!canRetry) {
        if (attempt > 1) {
          logger.warn({ err: err.message, label, attempt }, 'retry esgotado/permanente');
        }
        throw err;
      }
      const delay = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1)) + Math.floor(Math.random() * 120);
      logger.info({ label, attempt, nextAttemptInMs: delay, err: err.message }, `retry ${attempt}/${retries}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error('retry falhou');
}

module.exports = { withTimeout, retry, isPermanent, timeoutError, PERMANENT_CODES, DEFAULT_TIMEOUT_MS };
