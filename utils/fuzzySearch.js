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
 * Busca comandos similares.
 *
 * Critério (o que o usuário vê como "quis dizer"):
 *  - distância de Levenshtein <= maxDistance (padrão 3) em relação a qualquer
 *    trigger/alias do comando; OU
 *  - o que foi digitado é substring do trigger (ex.: "stick" → "sticker"),
 *    desde que tenham pelo menos 3 caracteres.
 * Nada além disso entra na lista — sugestão distante atrapalha mais que ajuda.
 *
 * @param {string} query - comando digitado que não existe
 * @param {Array} allCommands - lista de comandos do registry
 * @param {number} limit - quantos sugerir
 * @param {{maxDistance?: number}} [opts]
 * @returns {Array<{cmd, score, trigger, distance}>}
 */
function findSimilarCommands(query, allCommands, limit = 3, opts = {}) {
  const q = String(query || '').toLowerCase().trim();
  if (!q || q.length < 2) return [];
  const maxDistance = Number.isFinite(opts.maxDistance) ? opts.maxDistance : 3;

  const candidates = [];

  for (const cmd of allCommands) {
    const triggers = [...(cmd.commands || []), ...(cmd.aliases || [])];
    for (const trig of triggers) {
      const t = String(trig).toLowerCase();
      if (!t) continue;
      const distance = levenshtein(q, t);
      const isSubstring = q.length >= 3 && (t.includes(q) || q.includes(t));
      if (distance > maxDistance && !isSubstring) continue;
      candidates.push({ cmd, score: similarityScore(q, t), trigger: trig, distance });
    }
  }

  // Ranking: distância menor primeiro; em empate vence o trigger mais curto
  // (erro de digitação costuma acrescentar caracteres), depois o nome canônico (não o alias),
  // depois a ordem alfabética — sem isso o empate era decidido pela ordem de
  // carregamento dos plugins ("pingg" → "ping2" em vez de "ping").
  const nameRank = (c) => (c.cmd.name === c.trigger ? 0 : 1);
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    const la = String(a.trigger).length;
    const lb = String(b.trigger).length;
    if (la !== lb) return la - lb;
    const na = nameRank(a);
    const nb = nameRank(b);
    if (na !== nb) return na - nb;
    if (a.score !== b.score) return a.score - b.score;
    return String(a.trigger).localeCompare(String(b.trigger));
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
