/**
 * services/rpgService.js — regras de progressão (XP/nível).
 *
 * Camada:
 *   Pipeline/Command → RpgService → database/users.js | database/rpg.js → SQLite
 *
 * Por que existe: o XP ganho por mensagem (intervalo mínimo + quantidade
 * aleatória) estava dentro de handlers/commandHandler.js, ou seja, regra de
 * negócio morando na infraestrutura. As curvas de nível continuam nos
 * repositórios, que são o lugar delas (users.levelFromXp / rpg.rpgLevelFromXp
 * são sistemas DIFERENTES: XP global divide por 60, XP de RPG por 40 — não é
 * duplicação, não foi unificado).
 *
 * O que NÃO está aqui de propósito: as regras de gameplay de Lua Life/RPG
 * (energia, profissões, colheita, recompensas). Elas já têm camada própria em
 * plugins/life/engine.js (799 linhas, 27 operações, usada por 10 arquivos de
 * comando). Criar um "LifeService" que só repassa o engine seria uma abstração
 * a mais sem regra nova — ver docs/AUDIT-ARQUITETURA.md, seção 12.
 */

'use strict';

const users = require('../database/users');
const logger = require('../utils/logger').child('xp');

/** Intervalo mínimo entre ganhos de XP do mesmo usuário (igual ao anterior). */
const XP_MIN_INTERVAL = 30 * 1000;

/** Última concessão por usuário (memória, como antes). */
const lastXp = new Map();

/**
 * Mesma estratégia da Fase 2 (C2 — pruneSpamState): o mapa só é podado quando
 * passa do teto, removendo entradas vencidas. Não muda o comportamento
 * visível: uma entrada com mais de 5 minutos já não bloquearia nada
 * (o intervalo é de 30 s).
 */
const XP_MAP_MAX = 5000;
const XP_STALE_MS = 5 * 60 * 1000;

function prune(now) {
  if (lastXp.size <= XP_MAP_MAX) return 0;
  let removed = 0;
  for (const [jid, at] of lastXp) {
    if (now - at > XP_STALE_MS) {
      lastXp.delete(jid);
      removed += 1;
    }
  }
  // rajada de entradas novas: descarta as mais antigas para o teto valer sempre
  while (lastXp.size > XP_MAP_MAX) {
    lastXp.delete(lastXp.keys().next().value);
    removed += 1;
  }
  return removed;
}

/**
 * Concede o XP de mensagem (1 a 3), respeitando o intervalo mínimo.
 * @returns {{xp:number, level:number}|null} null quando está no cooldown
 */
function grantMessageXp(sender, at = Date.now()) {
  if (!sender) return null;
  const last = lastXp.get(sender) || 0;
  if (at - last < XP_MIN_INTERVAL) return null;
  lastXp.set(sender, at);
  prune(at);

  const amount = 1 + Math.floor(Math.random() * 3);
  const result = users.addXp(sender, amount);
  if (result && result.level > 0) {
    logger.debug({ user: sender, xp: result.xp, level: result.level, amount }, 'xp concedido');
  }
  return result || null;
}

/**
 * Progressão de nível do usuário (XP global).
 * Usa as fórmulas que já existem em database/users.js.
 */
function progression(userId) {
  const u = users.get(userId);
  const xp = (u && u.xp) || 0;
  const level = (u && u.level) || users.levelFromXp(xp);
  const next = users.xpForNextLevel(level);
  const prev = level > 1 ? users.xpForNextLevel(level - 1) : 0;
  const span = Math.max(1, next - prev);
  return {
    xp,
    level,
    xpForNext: next,
    remaining: Math.max(0, next - xp),
    percent: Math.min(100, Math.max(0, Math.round(((xp - prev) / span) * 100))),
  };
}

/** Nível correspondente a um XP (delegado ao repositório — fonte única). */
function levelFromXp(xp) {
  return users.levelFromXp(xp);
}

/** XP necessário para alcançar `level` (delegado ao repositório). */
function xpForNextLevel(level) {
  return users.xpForNextLevel(level);
}

/* ------------------------- visibilidade p/ testes ------------------------ */

/** Remove o throttle de um usuário (testes). */
function resetThrottle(sender) {
  if (sender === undefined) return lastXp.clear();
  return lastXp.delete(sender);
}

module.exports = {
  XP_MIN_INTERVAL,
  grantMessageXp,
  progression,
  levelFromXp,
  xpForNextLevel,
  resetThrottle,
  /** tamanho atual do mapa de throttle (testes de vazamento). */
  get throttleSize() {
    return lastXp.size;
  },
};
