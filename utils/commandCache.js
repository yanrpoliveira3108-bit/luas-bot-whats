/**
 * utils/commandCache.js — cache O(1) do registry (itens 61 e 62).
 *
 * O lookup de comando NÃO pode percorrer a lista a cada mensagem: aqui ficam
 * mapas prontos (nome, trigger/alias, categoria) e um índice invertido para a
 * busca do `!menu <termo>`. O fuzzy (Levenshtein) continua sendo usado só quando
 * o lookup exato falha — nunca por mensagem.
 *
 * O cache é derivado do registry (fonte da verdade): `refresh()` rebuilda se a
 * quantidade de comandos mudou, então plugins/carregamento tardio continuam
 * corretos sem trabalho repetitivo.
 */

'use strict';

const logger = require('./logger').child('cmdcache');

let snapshot = null; // { count, byName, byTrigger, byCategory, index, keywords }
let builtAt = 0;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // sem acentos no índice
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function build() {
  const { registry } = require('../engine/plugins');
  const all = registry.all ? registry.all() : [];
  const byName = new Map();
  const byTrigger = new Map();
  const byCategory = new Map();
  const index = new Map(); // token -> Set(name)
  const keywords = new Map(); // name -> Set(token)

  const addToken = (name, token) => {
    if (!token || token.length < 2) return;
    if (!index.has(token)) index.set(token, new Set());
    index.get(token).add(name);
    if (!keywords.has(name)) keywords.set(name, new Set());
    keywords.get(name).add(token);
  };

  for (const cmd of all) {
    const name = String(cmd.name || '').toLowerCase();
    if (!name) continue;
    byName.set(name, cmd);

    const triggers = [...(cmd.commands || []), ...(cmd.aliases || [])];
    for (const t of triggers) {
      const key = String(t || '').toLowerCase();
      if (key && !byTrigger.has(key)) byTrigger.set(key, cmd);
      addToken(name, key);
    }
    addToken(name, name);

    const cat = String(cmd.category || 'general').toLowerCase();
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(cmd);
    addToken(name, cat);

    for (const tok of tokenize(cmd.description)) addToken(name, tok);
    for (const tag of cmd.tags || cmd.keywords || []) addToken(name, String(tag).toLowerCase());
  }

  snapshot = { count: all.length, byName, byTrigger, byCategory, index, keywords };
  builtAt = Date.now();
  logger.debug({ commands: all.length, triggers: byTrigger.size, tokens: index.size }, 'commandCache reconstruído');
  return snapshot;
}

/** Garante cache válido (rebuilda se o registry mudou). */
function ensure() {
  const { registry } = require('../engine/plugins');
  const current = registry.count ? registry.count() : 0;
  if (!snapshot || snapshot.count !== current) return build();
  return snapshot;
}

/** Força rebuild (após register/unregister). */
function invalidate() {
  snapshot = null;
  return ensure();
}

/** Resolve um trigger/alias em O(1). */
function resolve(trigger) {
  const key = String(trigger || '').toLowerCase().trim();
  if (!key) return null;
  return ensure().byTrigger.get(key) || null;
}

/** Busca por nome em O(1). */
function get(name) {
  const key = String(name || '').toLowerCase().trim();
  if (!key) return null;
  const s = ensure();
  return s.byName.get(key) || s.byTrigger.get(key) || null;
}

/** Comandos da categoria. */
function byCategory(category) {
  const key = String(category || '').toLowerCase().trim();
  return (ensure().byCategory.get(key) || []).slice();
}

/** Todas as categorias conhecidas. */
function categories() {
  return [...ensure().byCategory.keys()].sort();
}

/**
 * Busca textual (usada por `!menu <termo>` e `!help <termo>`).
 * Casa por nome, alias, categoria, descrição e keywords — case/acento
 * insensitive, com substring como reforço.
 * @param {string} query
 * @param {number} [limit]
 */
function search(query, limit = 30) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const s = ensure();
  const scored = new Map(); // name -> score

  for (const tok of tokenize(q)) {
    for (const [token, names] of s.index) {
      if (token.startsWith(tok) || tok.startsWith(token)) {
        const bonus = token === tok ? 3 : token.startsWith(tok) ? 2 : 1;
        for (const n of names) scored.set(n, (scored.get(n) || 0) + bonus);
      }
    }
  }

  // reforço: substring direta (pega trechos que o tokenizer separou)
  const plain = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const cmd of s.byName.values()) {
    const hay = [cmd.name, (cmd.commands || []).join(' '), (cmd.aliases || []).join(' '), cmd.category, cmd.description]
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (hay.includes(plain)) scored.set(cmd.name.toLowerCase(), (scored.get(cmd.name.toLowerCase()) || 0) + 2);
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, limit))
    .map(([name]) => s.byName.get(name))
    .filter((c) => c && !c.hidden);
}

/** Métricas do cache (observabilidade). */
function stats() {
  const s = ensure();
  return {
    commands: s.count,
    triggers: s.byTrigger.size,
    categories: s.byCategory.size,
    tokens: s.index.size,
    builtAt,
    ageMs: Date.now() - builtAt,
  };
}

module.exports = { ensure, build, invalidate, resolve, get, byCategory, categories, search, stats };
