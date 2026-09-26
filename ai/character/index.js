'use strict';

const crypto = require('crypto');
const logger = require('../../utils/logger').child('ai:character');
const router = require('../router');
const state = require('./state');
const persona = require('./persona');
const { sendLongMessage } = require('../../utils/aiResponse');
const keyed = new Map();
const autoLast = new Map();

function withChatLock(chatId, task) {
  const previous = keyed.get(chatId) || Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => {});
  keyed.set(chatId, tail);
  return current.finally(() => { if (keyed.get(chatId) === tail) keyed.delete(chatId); });
}
function status(chatId) { const s = state.get(chatId); const r = router.status(); return { enabled: s.enabled, memoryEnabled: s.memoryEnabled, styleLearningEnabled: s.styleLearningEnabled, provider: 'groq', groqConfigured: r.groqConfigured, model: r.groqModel, lastAiStatus: s.lastAiStatus, lastRequestAt: s.lastRequestAt, lastErrorCode: s.lastErrorCode, recentCount: s.recent.length, memoryCount: s.memories.length }; }
function setEnabled(chatId, on) { return state.setEnabled(chatId, on); }
function clearMemory(chatId) { return state.clearMemory(chatId); }
function memoryStatus(chatId) { const s = state.get(chatId); return { enabled: s.memoryEnabled, recentCount: s.recent.length, memoryCount: s.memories.length, styleLearningEnabled: s.styleLearningEnabled }; }

async function ask({ chatId, userId, text, mode = 'chat', participant, diagnosticId = crypto.randomUUID() }) {
  logger.info({ chatId, id: diagnosticId }, '[AI_CHARACTER] queued');
  return withChatLock(chatId, async () => {
    logger.info({ chatId, id: diagnosticId }, '[AI_CHARACTER] start');
    const original = String(text || '');
    const clean = state.scrub(original);
    const fingerprint = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
    logger.info({ originalLength: original.length, characterInputLength: clean.length, originalHash: fingerprint(original), characterInputHash: fingerprint(clean) }, '[AI_INPUT]');
    const current = state.get(chatId);
    const memoryText = current.memoryEnabled ? state.memoryText(chatId) : '';
    const system = persona.systemPrompt(mode, memoryText);
    const recent = current.memoryEnabled ? current.recent.map((m) => ({ role: m.role, content: m.content })) : [];
    const messages = [
      { role: 'system', content: system },
      ...recent,
      { role: 'user', content: clean },
    ];
    const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
    const refusalMemory = [...current.memories.map((m) => m.text), ...current.recent.map((m) => m.content)]
      .some((value) => /(?:can.?t help|não posso ajudar|não ajudar|recus|não fornecer código)/i.test(String(value)));
    logger.info({ chatType: chatId.endsWith('@g.us') ? 'group' : 'pv', messagesCount: messages.length, systemLength: system.length, systemHash: hash(system), currentUserLength: clean.length, currentUserHash: hash(clean), historyCount: recent.length, memoryCount: current.memories.length, totalChars: messages.reduce((n, m) => n + String(m.content || '').length, 0), roles: messages.map((m) => m.role), groupAuthorMetadataAdded: false, styleProfilePresent: Boolean(current.style), refusalLikeMemory: refusalMemory }, '[AI_CONTEXT]');
    const result = await router.ask({ chatId, userId, text: clean, mode, messages, remember: false });
    state.update(chatId, (s) => {
      s.lastAiStatus = result && result.ok ? 'success' : 'error';
      s.lastRequestAt = new Date().toISOString();
      s.lastErrorCode = result && result.ok ? null : (result && result.code) || null;
      s.lastHttpStatus = result && result.httpStatus ? result.httpStatus : null;
      s.lastLatencyMs = result && result.latencyMs ? result.latencyMs : null;
    });
    const outputHash = result && result.ok ? crypto.createHash('sha256').update(String(result.text)).digest('hex').slice(0, 16) : null;
    logger.info({ chatId, id: diagnosticId, provider: result && result.provider, ok: Boolean(result && result.ok), code: result && result.code, httpStatus: result && result.httpStatus, latencyMs: result && result.latencyMs, characterOutputLength: result && result.ok ? String(result.text).length : 0, characterOutputHash: outputHash }, '[AI_CHARACTER] provider-result');
    if (result && result.ok) {
      state.addRecent(chatId, 'user', clean, participant || userId);
      state.addRecent(chatId, 'assistant', result.text, 'bot');
      state.learn(chatId, clean);
      if (clean.length > 80 && !/ignore|revele|mostre|api[_ -]?key|token|senha/i.test(clean)) state.addMemory(chatId, `Assunto recorrente: ${clean.slice(0, 180)}`);
      logger.info({ chatId, id: diagnosticId, mode, provider: result.provider, latencyMs: result.latencyMs }, '[AI_CHARACTER] response');
    }
    return result;
  });
}

function shouldAutoRespond({ ctx, botName }) {
  if (!ctx || (ctx.message && ctx.message.key && ctx.message.key.fromMe)) return false;
  const text = String(ctx.text || '').trim();
  if (!text || text.startsWith(ctx.prefix)) return false;
  if (!state.get(ctx.remoteJid).enabled) return false;
  if (!ctx.isGroup) return true;
  const mentioned = !!ctx.botAddressed;
  const named = botName && text.toLowerCase().includes(String(botName).toLowerCase());
  return mentioned || named;
}

async function handleAutomatic(ctx) {
  if (!shouldAutoRespond({ ctx, botName: require('../../config').bot.name })) return false;
  const cooldownMs = Number(require('../../config').ai.cooldownMs) || 6000;
  const last = autoLast.get(ctx.remoteJid) || 0;
  if (Date.now() - last < cooldownMs) return false;
  autoLast.set(ctx.remoteJid, Date.now());
  const diagnosticId = crypto.randomUUID();
  logger.info({ chatId: ctx.remoteJid, id: diagnosticId, triggerType: ctx.isGroup ? (ctx.botAddressed ? 'mention-or-reply' : 'name') : 'private' }, '[AI_CHARACTER] trigger');
  const result = await ask({ chatId: ctx.remoteJid, userId: ctx.sender, participant: ctx.sender, text: ctx.text, mode: 'chat', diagnosticId });
  if (!result || !result.ok) { if (result && result.message) await ctx.reply(result.message); return true; }
  const antiBan = require('../../utils/antiBan');
  await antiBan.simulateTyping(ctx.socket, ctx.remoteJid, result.text, 'composing');
  logger.info({ chatId: ctx.remoteJid, id: diagnosticId }, '[AI_CHARACTER] send');
  await sendLongMessage(ctx, result.text);
  logger.info({ chatId: ctx.remoteJid, id: diagnosticId }, '[AI_CHARACTER] done');
  return true;
}

module.exports = { ask, status, setEnabled, clearMemory, memoryStatus, handleAutomatic, state, persona };
