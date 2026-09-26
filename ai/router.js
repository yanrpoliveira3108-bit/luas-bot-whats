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
  const explicitGroq = String(CONFIG.ai.provider || '').toLowerCase() === 'groq';
  let lastFailure = null;

  for (const name of providerOrder()) {
    const provider = PROVIDERS[name];
    if (!provider) continue;
    try {
      const r = await provider.handle({ chatId, userId, text: input, mode, messages, history: messages ? undefined : memory.history(chatId) });
      if (r && r.ok) {
        const latencyMs = Date.now() - started;
        if (remember) {
          memory.remember(chatId, 'user', input);
          memory.remember(chatId, 'assistant', r.text);
        }
        return { ...r, latencyMs, usedFallback: name !== 'groq' && name !== 'api' };
      }
      lastFailure = r && r.code;
      if (r && (explicitGroq || NON_FALLBACK_ERRORS.has(r.code))) return r;
    } catch (err) {
      lastFailure = err && err.message;
      logger.warn({ provider: name, err: err.message }, 'provider de IA falhou');
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
