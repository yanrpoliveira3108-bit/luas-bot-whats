'use strict';

const logger = require('../../utils/logger').child('ai:groq');
const fs = require('fs');
const path = require('path');
const CONFIG = require('../../config');

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

function apiKey() { return String(process.env.GROQ_API_KEY || '').trim(); }
function model() { return String(process.env.GROQ_MODEL || DEFAULT_MODEL).trim(); }
function isConfigured() { return Boolean(apiKey()); }

function errorForStatus(status) {
  const httpStatus = Number(status);
  if (httpStatus === 401) return { code: 'GROQ_UNAUTHORIZED', httpStatus, message: '❌ A chave da Groq foi rejeitada.' };
  if (httpStatus === 403) return { code: 'GROQ_FORBIDDEN', httpStatus, message: '❌ A Groq recusou o acesso para esta chave.' };
  if (httpStatus === 400) return { code: 'GROQ_BAD_REQUEST', httpStatus, message: '⚠️ A Groq recusou o formato da solicitação.' };
  if (httpStatus === 404) return { code: 'GROQ_NOT_FOUND', httpStatus, message: '⚠️ Endpoint ou modelo da Groq não encontrado.' };
  if (httpStatus === 413) return { code: 'GROQ_PAYLOAD_TOO_LARGE', httpStatus, message: '⚠️ Solicitação grande demais para a Groq.' };
  if (httpStatus === 422) return { code: 'GROQ_INVALID_REQUEST', httpStatus, message: '⚠️ Solicitação inválida para a Groq.' };
  if (httpStatus === 429) return { code: 'GROQ_RATE_LIMIT', httpStatus, message: '⏳ A Groq atingiu o limite temporário. Tente novamente em instantes.' };
  if (httpStatus >= 500) return { code: 'GROQ_SERVER_ERROR', httpStatus, message: '⚠️ A Groq está temporariamente indisponível.' };
  return { code: `GROQ_HTTP_${httpStatus}`, httpStatus, message: '⚠️ A Groq recusou a solicitação.' };
}

async function handle({ messages, text, mode, history, temperature = 0.7, maxTokens = 800, timeoutMs = 45000 }) {
  console.log('[AI_PATH_PROBE] groq-enter', JSON.stringify({ pid: process.pid, mode }));
  console.log('[GROQ_PROBE] 01-enter');
  const key = apiKey();
  const selectedModel = model();
  const effectiveTimeoutMs = Math.max(1000, Number(timeoutMs) || 45000);
  console.log('[GROQ_PROBE] 02-config-read', JSON.stringify({ hasKey: Boolean(key), keyLength: key.length, model: selectedModel, timeoutMs: effectiveTimeoutMs }));
  const envPath = path.join(CONFIG.paths.root, '.env');
  logger.info({ hasGroqKey: Boolean(key), keyLength: key.length, model: selectedModel, configuredProvider: process.env.AI_PROVIDER || 'auto' }, '[AI_RUNTIME] groq-config');
  logger.info({ path: envPath, exists: fs.existsSync(envPath), hasGroqKey: Boolean(key), hasGroqModel: Boolean(process.env.GROQ_MODEL) }, '[AI_RUNTIME] env-path');
  if (!key) {
    console.log('[GROQ_PROBE] EXIT stage=02 code=GROQ_NOT_CONFIGURED');
    return { ok: false, provider: 'groq', code: 'GROQ_NOT_CONFIGURED', message: '❌ A IA ainda não foi configurada.' };
  }
  console.log('[GROQ_PROBE] 03-key-valid');
  const normalizedMessages = Array.isArray(messages) ? messages : [
    { role: 'system', content: mode === 'code' ? 'Você é um assistente de programação em português do Brasil.' : 'Você é um assistente útil em português do Brasil.' },
    ...(history || []),
    { role: 'user', content: String(text || '') },
  ];
  const shape = { array: Array.isArray(normalizedMessages), messagesCount: normalizedMessages.length, roles: normalizedMessages.map((m) => m && m.role), contentTypes: normalizedMessages.map((m) => typeof (m && m.content)) };
  console.log('[GROQ_PROBE] 04-input-valid', JSON.stringify(shape));
  logger.info({ messagesCount: normalizedMessages.length, roles: shape.roles, contentTypes: shape.contentTypes, totalChars: normalizedMessages.reduce((n, m) => n + String((m && m.content) || '').length, 0), model: selectedModel, maxTokens, temperature }, '[AI_RUNTIME] groq-request-shape');
  console.log('[GROQ_PROBE] 05-payload-built', JSON.stringify({ model: selectedModel, messagesCount: normalizedMessages.length }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  const started = Date.now();
  logger.info({ model: selectedModel, hasKey: Boolean(key), messagesCount: normalizedMessages.length, timeoutMs: effectiveTimeoutMs }, '[GROQ_TRACE] request-start');
  try {
    console.log('[GROQ_PROBE] 06-before-fetch');
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: selectedModel, messages: normalizedMessages, temperature, max_tokens: maxTokens }),
    });
    const responseLatencyMs = Date.now() - started;
    console.log('[GROQ_PROBE] 07-after-fetch', JSON.stringify({ status: response.status, ok: response.ok, latencyMs: responseLatencyMs }));
    logger.info({ status: response.status, ok: response.ok, latencyMs: responseLatencyMs, contentType: response.headers && response.headers.get ? response.headers.get('content-type') : null }, '[GROQ_TRACE] http-response');
    if (!response.ok) {
      const failure = { ok: false, provider: 'groq', ...errorForStatus(response.status), latencyMs: responseLatencyMs };
      console.log('[GROQ_PROBE] EXIT stage=07', JSON.stringify({ code: failure.code, httpStatus: failure.httpStatus }));
      logger.warn({ ok: false, provider: 'groq', code: failure.code, httpStatus: failure.httpStatus, latencyMs: failure.latencyMs }, '[GROQ_TRACE] provider-result');
      return failure;
    }
    let json;
    try { json = await response.json(); } catch (_) {
      logger.warn({ hasChoices: false, choicesLength: null, hasMessage: false, contentType: null, textLength: 0 }, '[GROQ_TRACE] parsed');
      console.log('[GROQ_PROBE] EXIT stage=07 code=GROQ_INVALID_RESPONSE');
      const failure = { ok: false, provider: 'groq', code: 'GROQ_INVALID_RESPONSE', message: '⚠️ A Groq retornou uma resposta inválida.', latencyMs: Date.now() - started };
      logger.warn({ ok: false, provider: 'groq', code: failure.code, latencyMs: failure.latencyMs }, '[GROQ_TRACE] provider-result');
      return failure;
    }
    console.log('[GROQ_PROBE] 08-json-parsed');
    const output = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    logger.info({ hasChoices: Boolean(json && json.choices), choicesLength: Array.isArray(json && json.choices) ? json.choices.length : null, hasMessage: Boolean(json && json.choices && json.choices[0] && json.choices[0].message), contentType: typeof output, textLength: typeof output === 'string' ? output.length : 0 }, '[GROQ_TRACE] parsed');
    if (typeof output !== 'string' || !output.trim()) {
      logger.warn({ hasChoices: Boolean(json && json.choices), choicesLength: Array.isArray(json && json.choices) ? json.choices.length : null, hasMessage: Boolean(json && json.choices && json.choices[0] && json.choices[0].message), hasContent: Boolean(json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content), contentType: typeof (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) }, '[AI_RUNTIME] groq-invalid-response');
      const failure = { ok: false, provider: 'groq', code: 'GROQ_INVALID_RESPONSE', message: '⚠️ A Groq retornou uma resposta vazia.', latencyMs: Date.now() - started };
      logger.warn({ ok: false, provider: 'groq', code: failure.code, latencyMs: failure.latencyMs }, '[GROQ_TRACE] provider-result');
      return failure;
    }
    console.log('[GROQ_PROBE] 09-success');
    const result = { ok: true, provider: 'groq', model: selectedModel, text: output.trim(), latencyMs: Date.now() - started };
    logger.info({ ok: true, provider: 'groq', textLength: output.trim().length, latencyMs: result.latencyMs }, '[GROQ_TRACE] provider-result');
    return result;
  } catch (err) {
    const elapsedMs = Date.now() - started;
    if (err && err.name === 'AbortError') {
      logger.warn({ timeoutMs: effectiveTimeoutMs, elapsedMs }, '[GROQ_TRACE] timeout');
      const failure = { ok: false, provider: 'groq', code: 'GROQ_TIMEOUT', message: '⚠️ A IA demorou demais para responder.', latencyMs: elapsedMs };
      console.log('[GROQ_PROBE] EXIT stage=06 code=GROQ_TIMEOUT');
      logger.warn({ ok: false, provider: 'groq', code: failure.code, latencyMs: elapsedMs }, '[GROQ_TRACE] provider-result');
      return failure;
    }
    logger.warn({ name: err && err.name, message: err && err.message, code: err && err.code, causeName: err && err.cause && err.cause.name, causeCode: err && err.cause && err.cause.code, latencyMs: elapsedMs }, '[GROQ_TRACE] fetch-error');
    console.log('[GROQ_PROBE] FETCH_ERROR', JSON.stringify({ name: err && err.name, code: err && err.code, causeCode: err && err.cause && err.cause.code, latencyMs: elapsedMs }));
    const failure = { ok: false, provider: 'groq', code: 'GROQ_NETWORK_ERROR', message: '⚠️ O serviço de IA está temporariamente indisponível.', latencyMs: elapsedMs };
    logger.warn({ ok: false, provider: 'groq', code: failure.code, latencyMs: elapsedMs }, '[GROQ_TRACE] provider-result');
    return failure;
  } finally { clearTimeout(timer); }
}

module.exports = { ENDPOINT, DEFAULT_MODEL, apiKey, model, isConfigured, handle, errorForStatus };
