'use strict';

const logger = require('../../utils/logger').child('ai:groq');

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

function apiKey() { return String(process.env.GROQ_API_KEY || '').trim(); }
function model() { return String(process.env.GROQ_MODEL || DEFAULT_MODEL).trim(); }
function isConfigured() { return Boolean(apiKey()); }

function errorForStatus(status) {
  if (status === 401) return { code: 'GROQ_UNAUTHORIZED', message: '❌ A chave da Groq foi rejeitada.' };
  if (status === 403) return { code: 'GROQ_FORBIDDEN', message: '❌ A Groq recusou o acesso para esta chave.' };
  if (status === 429) return { code: 'GROQ_RATE_LIMIT', message: '⏳ A Groq atingiu o limite temporário. Tente novamente em instantes.' };
  if (status >= 500) return { code: 'GROQ_SERVER_ERROR', message: '⚠️ A Groq está temporariamente indisponível.' };
  return { code: `GROQ_HTTP_${status}`, message: '⚠️ A Groq recusou a solicitação.' };
}

async function handle({ messages, text, mode, history, temperature = 0.7, maxTokens = 800, timeoutMs = 45000 }) {
  const key = apiKey();
  const selectedModel = model();
  if (!key) return { ok: false, code: 'GROQ_NOT_CONFIGURED', message: '❌ A IA ainda não foi configurada.' };
  const normalizedMessages = Array.isArray(messages) ? messages : [
    { role: 'system', content: mode === 'code' ? 'Você é um assistente de programação em português do Brasil.' : 'Você é um assistente útil em português do Brasil.' },
    ...(history || []),
    { role: 'user', content: String(text || '') },
  ];
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
    if (!response.ok) return { ok: false, ...errorForStatus(response.status) };
    let json;
    try { json = await response.json(); } catch (_) { return { ok: false, code: 'GROQ_INVALID_RESPONSE', message: '⚠️ A Groq retornou uma resposta inválida.' }; }
    const output = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (typeof output !== 'string' || !output.trim()) return { ok: false, code: 'GROQ_INVALID_RESPONSE', message: '⚠️ A Groq retornou uma resposta vazia.' };
    return { ok: true, provider: 'groq', model: selectedModel, text: output.trim(), latencyMs: Date.now() - started };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, code: 'GROQ_TIMEOUT', message: '⚠️ A IA demorou demais para responder.' };
    logger.warn({ errorName: err && err.name, errorCode: err && err.code, errorMessage: err && err.message }, 'falha de rede Groq');
    return { ok: false, code: 'GROQ_NETWORK_ERROR', message: '⚠️ O serviço de IA está temporariamente indisponível.' };
  } finally { clearTimeout(timer); }
}

module.exports = { ENDPOINT, DEFAULT_MODEL, apiKey, model, isConfigured, handle, errorForStatus };
