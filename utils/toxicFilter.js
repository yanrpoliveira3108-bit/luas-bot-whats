'use strict';

/**
 * utils/toxicFilter.js — detecção de conteúdo tóxico/palavrões
 *
 * Lista base em PT-BR, pode ser estendida via .env ou banco.
 * Usa normalização (remove acentos, lower) e detecção por palavras inteiras.
 */

const toxicWords = [
  // palavrões comuns PT-BR (lista moderada, sem extremo)
  'fdp', 'filho da puta', 'vai se fuder', 'vsf', 'vtnc', 'vai tomar no cu',
  'arrombado', 'otario', 'otário', 'babaca', 'imbecil', 'idiota', 'burro',
  'retardado', 'mongol', 'corno', 'vagabunda', 'piranha', 'puta',
  'caralho', 'porra', 'buceta', 'cuzao', 'cuzão',
  // toxicidade / ódio leve
  'lixo', 'inutil', 'inútil', 'nojo', 'odeio',
];

const severeToxic = [
  'se mata', 'vai se matar', 'morre', 'tomara que morra',
  'racista', 'nazista', 'homofobico', 'homofóbico',
];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsToxic(text) {
  const norm = normalize(text);
  if (!norm) return { toxic: false, level: 0, matched: [] };

  const matched = [];
  let level = 0;

  for (const w of toxicWords) {
    const nw = normalize(w);
    // palavra inteira ou frase
    const re = new RegExp(`\\b${nw.replace(/ /g, '\\s+')}\\b`, 'i');
    if (re.test(norm)) {
      matched.push(w);
      level = Math.max(level, 1);
    }
  }

  for (const w of severeToxic) {
    const nw = normalize(w);
    const re = new RegExp(`\\b${nw.replace(/ /g, '\\s+')}\\b`, 'i');
    if (re.test(norm)) {
      matched.push(w);
      level = Math.max(level, 2);
    }
  }

  return { toxic: matched.length > 0, level, matched };
}

function isToxic(text, threshold = 1) {
  const res = containsToxic(text);
  return res.toxic && res.level >= threshold;
}

module.exports = {
  toxicWords,
  severeToxic,
  normalize,
  containsToxic,
  isToxic,
};
