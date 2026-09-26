'use strict';

const groups = require('../../database/groups');
const SECRET = /(gsk_[a-z0-9_-]+|bearer\s+[a-z0-9._-]+|(?:api[_ -]?key|token|senha|password|cookie)\s*[:=]\s*\S+)/ig;
const MAX_RECENT = 12;
const MAX_MEMORY = 30;

function scrub(value) {
  return String(value || '').replace(SECRET, '[REDACTED]').slice(0, 1200);
}
function defaultState() {
  return { enabled: false, memoryEnabled: true, styleLearningEnabled: true, recent: [], memories: [], style: { formality: 0.5, verbosity: 0.5, humor: 0.2, emojiUsage: 0.1, slangAffinity: 0.1, technicalLevel: 0.5, updatedAt: null } };
}
function normalize(raw) {
  const d = defaultState(); const r = raw && typeof raw === 'object' ? raw : {};
  return { ...d, ...r, recent: Array.isArray(r.recent) ? r.recent.slice(-MAX_RECENT) : [], memories: Array.isArray(r.memories) ? r.memories.slice(-MAX_MEMORY) : [], style: { ...d.style, ...(r.style || {}) } };
}
function get(chatId) {
  try { return normalize(groups.getSettings(chatId).aiCharacter); } catch (_) { return defaultState(); }
}
function update(chatId, mutate) {
  let output;
  groups.patchSettings(chatId, (settings) => { const next = normalize(settings.aiCharacter); mutate(next); next.updatedAt = new Date().toISOString(); settings.aiCharacter = next; output = next; });
  return output;
}
function setEnabled(chatId, enabled) { return update(chatId, (s) => { s.enabled = !!enabled; }); }
function setMemoryEnabled(chatId, enabled) { return update(chatId, (s) => { s.memoryEnabled = !!enabled; }); }
function clearMemory(chatId) { return update(chatId, (s) => { s.recent = []; s.memories = []; }); }
function addRecent(chatId, role, content, participant) {
  const text = scrub(content); if (!text) return get(chatId);
  return update(chatId, (s) => { if (s.memoryEnabled) { s.recent.push({ role, content: text, participant: participant || null, timestamp: new Date().toISOString() }); s.recent = s.recent.slice(-MAX_RECENT); } });
}
function learn(chatId, text) {
  return update(chatId, (s) => {
    if (!s.styleLearningEnabled) return;
    const value = scrub(text).toLowerCase();
    const informal = /\b(mano|véi|vei|kkkk|slk|pqp|porra|caralho)\b/.test(value);
    const technical = /\b(api|código|bug|erro|node|javascript|banco|deploy|stack|função)\b/.test(value);
    if (informal) s.style.slangAffinity = Math.min(1, s.style.slangAffinity * 0.85 + 0.15);
    if (technical) s.style.technicalLevel = Math.min(1, s.style.technicalLevel * 0.9 + 0.1);
    if (/[!?]/.test(value)) s.style.humor = Math.min(1, s.style.humor * 0.95 + 0.05);
    s.style.updatedAt = new Date().toISOString();
  });
}
function addMemory(chatId, text) {
  const clean = scrub(text); if (!clean) return;
  return update(chatId, (s) => { if (s.memoryEnabled && !s.memories.some((m) => m.text === clean)) s.memories.push({ text: clean, confidence: 0.5, updatedAt: new Date().toISOString() }); s.memories = s.memories.slice(-MAX_MEMORY); });
}
function memoryText(chatId) {
  const s = get(chatId); if (!s.memoryEnabled) return '';
  const style = Object.entries(s.style).filter(([k]) => k !== 'updatedAt').map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join(', ');
  return [...s.memories.map((m) => `- ${m.text}`), `- Tendências de estilo: ${style}`].join('\n');
}
module.exports = { scrub, get, update, setEnabled, setMemoryEnabled, clearMemory, addRecent, learn, addMemory, memoryText, MAX_RECENT, MAX_MEMORY };
