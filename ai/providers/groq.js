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
  if (httpStatus === 429) return { code: 'GROQ_RATE_LIMIT', httpStatus, message: '⏳ A Groq atingiu o limite temporário. Tente novamente em instantes.' };
  if (httpStatus >= 500) return { code: 'GROQ_SERVER_ERROR', httpStatus, message: '⚠️ A Groq está temporariamente indisponível.' };
  return { code: `GROQ_HTTP_${httpStatus}`, httpStatus, message: '⚠️ A Groq recusou a solicitação.' };
}

async function handle({ messages, text, mode, history, temperature = 0.7, maxTokens = 800, timeoutMs = 45000 }) {
  const key = apiKey();
  const selectedModel = model();
  const envPath = path.join(CONFIG.paths.root, '.env');
  logger.info({ hasGroqKey: Boolean(key), keyLength: key.length, model: selectedModel, configuredProvider: process.env.AI_PROVIDER || 'auto' }, '[AI_RUNTIME] groq-config');
  logger.info({ path: envPath, exists: fs.existsSync(envPath), hasGroqKey: Boolean(key), hasGroqModel: Boolean(process.env.GROQ_MODEL) }, '[AI_RUNTIME] env-path');
  if (!key) return { ok: false, code: 'GROQ_NOT_CONFIGURED', message: '❌ A IA ainda não foi configurada.' };
  const normalizedMessages = Array.isArray(messages) ? messages : [
    { role: 'system', content: mode === 'code' ? 'Você é um assistente de programação em português do Brasil.' : 'Você é um assistente útil em português do Brasil.' },
    ...(history || []),
    { role: 'user', content: String(text || '') },
  ];
  logger.info({ messagesCount: normalizedMessages.length, roles: normalizedMessages.map((m) => m && m.role), contentTypes: normalizedMessages.map((m) => typeof (m && m.content)), totalChars: normalizedMessages.reduce((n, m) => n + String((m && m.content) || '').length, 0), model: selectedModel, maxTokens, temperature }, '[AI_RUNTIME] groq-request-shape');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 45000));
  const started = Date.now();
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: selectedModel, messages: normalizedMessages, temperature, max_tokens: maxTokens }),
    });
    if (!response.ok) return { ok: false, ...errorForStatus(response.status), latencyMs: Date.now() - started };
    let json;
    try { json = await response.json(); } catch (_) { return { ok: false, code: 'GROQ_INVALID_RESPONSE', message: '⚠️ A Groq retornou uma resposta inválida.', latencyMs: Date.now() - started }; }
    const output = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (typeof output !== 'string' || !output.trim()) return { ok: false, code: 'GROQ_INVALID_RESPONSE', message: '⚠️ A Groq retornou uma resposta vazia.', latencyMs: Date.now() - started };
    return { ok: true, provider: 'groq', model: selectedModel, text: output.trim(), latencyMs: Date.now() - started };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, code: 'GROQ_TIMEOUT', message: '⚠️ A IA demorou demais para responder.', latencyMs: Date.now() - started };
    logger.warn({ errorName: err && err.name, errorCode: err && err.code, errorMessage: err && err.message }, 'falha de rede Groq');
    return { ok: false, code: 'GROQ_NETWORK_ERROR', message: '⚠️ O serviço de IA está temporariamente indisponível.' };
  } finally { clearTimeout(timer); }
}

module.exports = { ENDPOINT, DEFAULT_MODEL, apiKey, model, isConfigured, handle, errorForStatus };
