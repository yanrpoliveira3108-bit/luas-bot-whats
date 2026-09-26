'use strict';

const logger = require('../../utils/logger').child('ai:character');
const router = require('../router');
const state = require('./state');
const persona = require('./persona');
const keyed = new Map();
const autoLast = new Map();

function withChatLock(chatId, task) {
  const previous = keyed.get(chatId) || Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => {});
  keyed.set(chatId, tail);
  return current.finally(() => { if (keyed.get(chatId) === tail) keyed.delete(chatId); });
}
function status(chatId) { const s = state.get(chatId); const r = router.status(); return { enabled: s.enabled, memoryEnabled: s.memoryEnabled, styleLearningEnabled: s.styleLearningEnabled, provider: r.active === 'local (offline)' ? 'local' : 'groq', model: r.model, recentCount: s.recent.length, memoryCount: s.memories.length }; }
function setEnabled(chatId, on) { return state.setEnabled(chatId, on); }
function clearMemory(chatId) { return state.clearMemory(chatId); }
function memoryStatus(chatId) { const s = state.get(chatId); return { enabled: s.memoryEnabled, recentCount: s.recent.length, memoryCount: s.memories.length, styleLearningEnabled: s.styleLearningEnabled }; }

async function ask({ chatId, userId, text, mode = 'chat', participant }) {
  return withChatLock(chatId, async () => {
    const clean = state.scrub(text);
    const current = state.get(chatId);
    const recent = current.memoryEnabled ? current.recent.map((m) => ({ role: m.role, content: m.content })) : [];
    const messages = [
      { role: 'system', content: persona.systemPrompt(mode, state.memoryText(chatId)) },
      ...recent,
      { role: 'user', content: clean },
    ];
    logger.info({ chatId, mode, recentCount: recent.length, memoryCount: current.memories.length }, '[AI_CHARACTER] context-built');
    const result = await router.ask({ chatId, userId, text: clean, mode, messages, remember: false });
    if (result && result.ok) {
      state.addRecent(chatId, 'user', clean, participant || userId);
      state.addRecent(chatId, 'assistant', result.text, 'bot');
      state.learn(chatId, clean);
      if (clean.length > 80 && !/ignore|revele|mostre|api[_ -]?key|token|senha/i.test(clean)) state.addMemory(chatId, `Assunto recorrente: ${clean.slice(0, 180)}`);
      logger.info({ chatId, mode, provider: result.provider, latencyMs: result.latencyMs }, '[AI_CHARACTER] response');
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
  logger.info({ chatId: ctx.remoteJid, triggerType: ctx.isGroup ? (ctx.botAddressed ? 'mention-or-reply' : 'name') : 'private' }, '[AI_CHARACTER] trigger');
  const result = await ask({ chatId: ctx.remoteJid, userId: ctx.sender, participant: ctx.sender, text: ctx.text, mode: 'chat' });
  if (!result || !result.ok) { if (result && result.message) await ctx.reply(result.message); return true; }
  const antiBan = require('../../utils/antiBan');
  await antiBan.simulateTyping(ctx.socket, ctx.remoteJid, result.text, 'composing');
  await ctx.reply(result.text);
  return true;
}

module.exports = { ask, status, setEnabled, clearMemory, memoryStatus, handleAutomatic, state, persona };
