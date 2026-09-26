'use strict';

const CONFIG = require('../config');
const logger = require('../utils/logger').child('ai:router');
const memory = require('./memory');
const groq = require('./providers/groq');

function publicError(code) {
  if (code === 'GROQ_NOT_CONFIGURED') return '⚠️ IA indisponível: Groq não está configurada.';
  if (code === 'GROQ_RATE_LIMIT') return '⚠️ A IA atingiu o limite temporário. Tente novamente em instantes.';
  return '⚠️ A IA está temporariamente indisponível.';
}

function providerOrder() { return ['groq']; }

async function ask({ chatId, userId, text, mode = 'chat', messages, remember = true }) {
  const input = String(text || '').trim();
  if (!input) return { ok: false, provider: 'groq', code: 'EMPTY_INPUT', message: '⚠️ Envie um texto para a IA.' };
  if (input.length > CONFIG.ai.maxInput) return { ok: false, provider: 'groq', code: 'INPUT_TOO_BIG', message: `📏 Texto muito longo (limite ${CONFIG.ai.maxInput} caracteres).` };

  const started = Date.now();
  logger.info({ configuredProvider: 'groq', hasGroqKey: groq.isConfigured(), mode }, '[AI_ROUTER] request');
  if (!groq.isConfigured()) {
    const result = { ok: false, provider: 'groq', code: 'GROQ_NOT_CONFIGURED', message: publicError('GROQ_NOT_CONFIGURED'), latencyMs: Date.now() - started };
    logger.warn({ provider: 'groq', code: result.code, latencyMs: result.latencyMs }, '[AI_ROUTER] provider-error');
    return result;
  }

  try {
    const result = await groq.handle({ chatId, userId, text: input, mode, messages, history: messages ? undefined : memory.history(chatId) });
    logger.info({ provider: 'groq', ok: Boolean(result && result.ok), code: result && result.code, httpStatus: result && result.httpStatus, latencyMs: result && result.latencyMs }, '[AI_ROUTER] groq-result');
    if (!result || !result.ok) {
      const failure = { ...(result || {}), ok: false, provider: 'groq', code: (result && result.code) || 'GROQ_INVALID_RESPONSE', latencyMs: (result && result.latencyMs) || Date.now() - started };
      failure.message = publicError(failure.code);
      logger.warn({ provider: 'groq', code: failure.code, httpStatus: failure.httpStatus, latencyMs: failure.latencyMs }, '[AI_ROUTER] provider-error');
      return failure;
    }
    if (remember) {
      memory.remember(chatId, 'user', input);
      memory.remember(chatId, 'assistant', result.text);
    }
    logger.info({ provider: 'groq', ok: true, latencyMs: result.latencyMs }, '[AI_ROUTER] result');
    return { ...result, provider: 'groq', usedFallback: false };
  } catch (err) {
    const code = err && err.code ? err.code : 'GROQ_NETWORK_ERROR';
    logger.warn({ provider: 'groq', code }, '[AI_ROUTER] provider-error');
    return { ok: false, provider: 'groq', code, message: publicError(code), latencyMs: Date.now() - started };
  }
}

function status() {
  return {
    provider: 'groq',
    active: groq.isConfigured() ? 'groq' : 'unavailable',
    order: ['groq'],
    model: groq.model(),
    groqConfigured: groq.isConfigured(),
    groqModel: groq.model(),
    apiConfigured: groq.isConfigured(),
    apiUrl: 'Groq',
    memory: memory.enabled() ? `ativo (${memory.size()} conversas)` : 'desativado',
    limits: { maxInput: CONFIG.ai.maxInput, timeoutMs: CONFIG.ai.timeoutMs, cooldownMs: CONFIG.ai.cooldownMs },
  };
}

module.exports = { ask, status, providerOrder };
