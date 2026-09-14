/**
 * plugins/life/leveling.js — progressão de nível, títulos, carreira e atributos.
 *
 * Atributos influenciam atividades de forma MODERADA (nunca quebram a economia).
 */

'use strict';

const life = require('../../database/life');
const { titleForLevel, TITLES } = require('./config');

/** Título do nível de vida. */
function title(level) {
  return titleForLevel(level);
}

/** Próximo título a ser desbloqueado (ou null). */
function nextTitle(level) {
  return TITLES.find((t) => t.level > level) || null;
}

/** Nível de carreira (1-based) a partir do XP acumulado na profissão. */
function careerLevelFromXp(careerXp, tiers) {
  const maxTier = Math.max(1, (tiers && tiers.length) || 1);
  return Math.min(maxTier, Math.floor(Math.max(0, careerXp) / 100) + 1);
}

/** Título da carreira atual. */
function careerTitle(job, careerLevel) {
  const tiers = (job && job.tiers) || [];
  return tiers[Math.max(0, careerLevel - 1)] || tiers[tiers.length - 1] || (job && job.name) || '-';
}

/* ----------------------- efeitos de atributos ------------------------- */

const ATTR_MAX_EFFECT = 0.5; // teto de 50% de bônus por atributo

/** Multiplicador de salário pela eficiência (cada ponto +2%, máx +50%). */
function efficiencySalaryMul(efficiency) {
  return 1 + Math.min(ATTR_MAX_EFFECT, (Math.max(0, efficiency) * 0.02));
}

/** Multiplicador de XP pelo conhecimento (cada ponto +1%, máx +50%). */
function knowledgeXpMul(knowledge) {
  return 1 + Math.min(ATTR_MAX_EFFECT, (Math.max(0, knowledge) * 0.01));
}

/** Bônus de sorte (peso de itens raros), em pontos percentuais. */
function luckBonus(luck) {
  return Math.min(20, Math.max(0, luck));
}

/** Redutor de cooldown de trabalho pelo melhor veículo (speedBonus). */
function vehicleCooldownMul(bestSpeedBonus) {
  return typeof bestSpeedBonus === 'number' && bestSpeedBonus > 0 ? bestSpeedBonus : 1;
}

module.exports = {
  title,
  nextTitle,
  careerLevelFromXp,
  careerTitle,
  efficiencySalaryMul,
  knowledgeXpMul,
  luckBonus,
  vehicleCooldownMul,
};
