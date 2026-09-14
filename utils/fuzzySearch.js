'use strict';

/**
 * utils/fuzzySearch.js — busca difusa de comandos para "comando não existe, quis dizer?"
 *
 * Usa Levenshtein + substring para sugerir comandos próximos
 */

function levenshtein(a, b) {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const matrix = Array.from({ length: al + 1 }, () => Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) matrix[i][0] = i;
  for (let j = 0; j <= bl; j++) matrix[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // delete
        matrix[i][j - 1] + 1, // insert
        matrix[i - 1][j - 1] + cost // replace
      );
    }
  }
  return matrix[al][bl];
}

function similarityScore(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  // substring bonus
  if (t.includes(q) || q.includes(t)) {
    return 0.5; // muito próximo
  }
  // levenshtein
  const dist = levenshtein(q, t);
  // normaliza por tamanho
  const maxLen = Math.max(q.length, t.length);
  return dist / maxLen;
}

/**
 * Busca comandos similares
 * @param {string} query - comando digitado que não existe
 * @param {Array} allCommands - lista de comandos do registry
 * @param {number} limit - quantos sugerir
 * @returns {Array<{cmd, score, trigger}>}
 */
function findSimilarCommands(query, allCommands, limit = 3) {
  const q = String(query || '').toLowerCase().trim();
  if (!q || q.length < 2) return [];

  const candidates = [];

  for (const cmd of allCommands) {
    const triggers = [...(cmd.commands || []), ...(cmd.aliases || [])];
    for (const trig of triggers) {
      const t = String(trig).toLowerCase();
      if (!t) continue;
      const score = similarityScore(q, t);
      // só considera se score razoável (distância pequena ou substring)
      if (score <= 0.6 || levenshtein(q, t) <= 3) {
        candidates.push({ cmd, score, trigger: trig, distance: levenshtein(q, t) });
      }
    }
  }

  // ordena por distância (menor = mais similar) e score
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.score - b.score;
  });

  // remove duplicados (mesmo cmd)
  const seen = new Set();
  const result = [];
  for (const c of candidates) {
    if (seen.has(c.cmd.name)) continue;
    seen.add(c.cmd.name);
    result.push(c);
    if (result.length >= limit) break;
  }

  return result;
}

module.exports = {
  levenshtein,
  similarityScore,
  findSimilarCommands,
};
