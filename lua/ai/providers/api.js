/**
 * ai/providers/api.js — provider de IA externo (compatível com OpenAI).
 *
 * Configurado via .env (AI_API_URL, AI_API_KEY, AI_MODEL). Se não houver URL
 * ou chave, `isConfigured()` retorna false e o router usa outro provider.
 * Falhas de rede/HTTP/timeout viram erro amigável — NUNCA derrubam o bot.
 */

'use strict';

const CONFIG = require('../../config');
const logger = require('../../utils/logger').child('ai:api');

const SYSTEM = {
  chat: 'Você é o assistente do bot Lua, um bot de WhatsApp em português do Brasil. Responda de forma clara, curta e amigável, em pt-BR.',
  code: 'Você é um assistente de programação. Responda SOMENTE com blocos de código (```lang ... ```) e uma breve explicação em pt-BR.',
  translate: 'Você é um tradutor. Traduza o texto recebido para o idioma pedido e responda SOMENTE com a tradução.',
  summarize: 'Você é um resumidor. Resuma o texto recebido em poucos parágrafos objetivos, em pt-BR.',
};

function isConfigured() {
  return Boolean(CONFIG.ai.apiUrl && CONFIG.ai.apiKey);
}

/** @returns {Promise<{ ok:true, text, provider:'api', model, latencyMs }>} */
async function handle({ chatId, text, mode, history }) {
  if (!isConfigured()) {
    return { ok: false, code: 'NOT_CONFIGURED' };
  }

  const started = Date.now();
  const messages = [];
  messages.push({
    role: 'system',
    content: CONFIG.ai.systemPrompt || SYSTEM[mode] || SYSTEM.chat,
  });
  for (const line of (history || []).slice(-6)) {
    messages.push({ role: line.role, content: line.content });
  }
  messages.push({ role: 'user', content: String(text) });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.ai.timeoutMs);
  try {
    const res = await fetch(CONFIG.ai.apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.ai.model,
        messages,
        temperature: 0.7,
        max_tokens: 800,
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, chatId }, 'IA externa respondeu com erro');
      return { ok: false, code: 'API_HTTP_' + res.status };
    }
    const json = await res.json();
    const textOut =
      (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) ||
      (json.output_text) ||
      '';
    if (!textOut) return { ok: false, code: 'API_EMPTY' };
    return {
      ok: true,
      text: textOut.trim(),
      provider: 'api',
      model: CONFIG.ai.model,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    logger.warn({ err: err.message, chatId }, 'IA externa falhou');
    const e = new Error('Provedor de IA externo indisponível.');
    e.code = err && err.name === 'AbortError' ? 'TIMEOUT' : 'API_UNREACHABLE';
    return { ok: false, code: e.code };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { handle, name: 'api', isConfigured };
