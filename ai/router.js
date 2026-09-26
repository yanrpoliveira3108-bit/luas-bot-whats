/**
 * ai/router.js — decide qual provider de IA usar e aplica limites.
 *
 * Ordem (provider do .env):
 *   auto  → API externa (se configurada) → local → fallback
 *   api   → API externa → fallback
 *   local → local → fallback
 *
 * Limites: tamanho do prompt, timeout (no provider api) e cooldown (no comando).
 */

'use strict';

const CONFIG = require('../config');
const logger = require('../utils/logger').child('ai:router');
const memory = require('./memory');
const local = require('./providers/local');
const groq = require('./providers/groq');
const api = require('./providers/api');
const fallback = require('./providers/fallback');

const PROVIDERS = { local, groq, api, fallback };
const NON_FALLBACK_ERRORS = new Set(['GROQ_UNAUTHORIZED', 'GROQ_FORBIDDEN', 'GROQ_NOT_CONFIGURED']);

function providerOrder() {
  const mode = String(CONFIG.ai.provider || 'auto').toLowerCase();
  if (mode === 'local') return ['local', 'fallback'];
  if (mode === 'groq') return ['groq', 'fallback'];
  if (mode === 'api') return ['api', 'fallback']; // legacy
  if (groq.isConfigured()) return ['groq', 'local', 'fallback'];
  if (api.isConfigured()) return ['api', 'local', 'fallback']; // legacy
  return ['local', 'fallback'];
}

/**
 * Consulta a IA com fallback em cadeia.
 * @param {{ chatId, userId, text, mode }} params mode ∈ chat|code|translate|summarize
 * @returns {Promise<{ ok:true, text, provider, model, latencyMs, usedFallback?:boolean } | { ok:false, code, message }>}
 */
async function ask({ chatId, userId, text, mode = 'chat', messages, remember = true }) {
  const input = String(text || '').trim();
  if (!input) {
    return { ok: false, code: 'EMPTY_INPUT', message: '⚠️ Envie um texto para a IA.' };
  }
  if (input.length > CONFIG.ai.maxInput) {
    return {
      ok: false,
      code: 'INPUT_TOO_BIG',
      message: `📏 Texto muito longo (limite ${CONFIG.ai.maxInput} caracteres).`,
    };
  }

  const started = Date.now();
  const configuredProvider = String(CONFIG.ai.provider || 'auto').toLowerCase();
  logger.info({ configuredProvider, hasGroqKey: groq.isConfigured() }, '[AI_ROUTER] request');
  const explicitGroq = configuredProvider === 'groq';
  let lastFailure = null;
  let failedProvider = null;

  for (const name of providerOrder()) {
    const provider = PROVIDERS[name];
    if (!provider) continue;
    const requestMessages = Array.isArray(messages) ? messages : undefined;
    logger.info({ provider: name, mode, messagesCount: requestMessages ? requestMessages.length : undefined }, '[AI_ROUTER] attempt');
    try {
      const r = await provider.handle({ chatId, userId, text: input, mode, messages: requestMessages, history: requestMessages ? undefined : memory.history(chatId) });
      if (r && r.ok) {
        const latencyMs = Date.now() - started;
        if (remember) {
          memory.remember(chatId, 'user', input);
          memory.remember(chatId, 'assistant', r.text);
        }
        const result = { ...r, latencyMs, usedFallback: name !== 'groq' && name !== 'api' };
        if (failedProvider && name !== failedProvider) {
          result.fallbackFrom = failedProvider;
          result.fallbackReason = lastFailure;
          logger.info({ from: failedProvider, to: name, reason: lastFailure }, '[AI_ROUTER] fallback');
        }
        logger.info({ provider: result.provider || name, ok: true, fallbackFrom: result.fallbackFrom || null }, '[AI_ROUTER] result');
        return result;
      }
      const failure = { ...(r || { ok: false, code: 'PROVIDER_EMPTY_RESULT' }), latencyMs: Date.now() - started };
      logger.warn({ provider: name, ok: false, code: failure.code, httpStatus: failure.httpStatus, latencyMs: failure.latencyMs }, '[AI_ROUTER] result');
      lastFailure = failure.code;
      failedProvider = name;
      if (name === 'groq') logger.warn({ code: failure.code, httpStatus: failure.httpStatus, fallbackAllowed: !explicitGroq && !NON_FALLBACK_ERRORS.has(failure.code) }, '[AI_ROUTER] groq-failed');
      if (failure && (explicitGroq || NON_FALLBACK_ERRORS.has(failure.code))) return failure;
    } catch (err) {
      lastFailure = err && err.code ? err.code : 'PROVIDER_EXCEPTION';
      failedProvider = name;
      logger.warn({ provider: name, code: lastFailure }, '[AI_ROUTER] result');
      if (name === 'groq') logger.warn({ code: lastFailure, fallbackAllowed: !explicitGroq }, '[AI_ROUTER] groq-failed');
    }
  }

  const fb = await fallback.handle();
  return { ...fb, latencyMs: Date.now() - started, usedFallback: true };
}

/** Estado atual da IA (para !aistatus). Sem segredos. */
function status() {
  const order = providerOrder();
  return {
    provider: CONFIG.ai.provider || 'auto',
    active: groq.isConfigured() ? 'groq' : (api.isConfigured() ? 'api (legacy)' : 'local (offline)'),
    order,
    model: groq.isConfigured() ? groq.model() : (api.isConfigured() ? CONFIG.ai.model : 'assistente-local'),
    apiConfigured: groq.isConfigured() || api.isConfigured(),
    groqConfigured: groq.isConfigured(),
    groqModel: groq.model(),
    apiUrl: groq.isConfigured() ? 'Groq' : (CONFIG.ai.apiUrl ? 'configurada (legacy)' : '-'),
    memory: memory.enabled() ? `ativo (${memory.size()} conversas)` : 'desativado',
    limits: {
      maxInput: CONFIG.ai.maxInput,
      timeoutMs: CONFIG.ai.timeoutMs,
      cooldownMs: CONFIG.ai.cooldownMs,
    },
  };
}

module.exports = { ask, status, providerOrder };
