/**
 * database/tigrinho.js — armazenamento do 🐯 LUA TIGRINHO.
 *
 * Camada de STORAGE separada da lógica (utils/tigrinhoGame.js) e da interface
 * (commands/rpg/tigrinho.js). O SALDO vem da carteira RPG (database/economy.js
 * — os mesmos LuaCoins/LC do cassino, cripto e investimentos). NÃO existe
 * economia paralela de "fichas".
 *
 * Esta tabela guarda apenas as estatísticas (giros/vitórias/jackpots) e o
 * histórico limitado. Toda alteração de saldo é atômica (withLock + transações
 * do economy) e NUNCA permite saldo negativo.
 */

'use strict';

const { prepare, get: getDb } = require('./database');
const economy = require('./economy');
const { withLock } = require('../utils/keyedMutex');
const { TIGRINHO_CONFIG } = require('../utils/tigrinhoGame');
const logger = require('../utils/logger').child('tigrinho');

const now = () => new Date().toISOString();

/** Cria o registro de estatísticas do jogador se não existir. */
function ensure(userId) {
  const res = prepare(
    'ens_tigrinho',
    `INSERT OR IGNORE INTO tigrinho_players (user_id, created_at) VALUES (?, ?)`
  ).run(userId, now());
  if (res.changes > 0) logger.info({ user: userId }, '[LUA TIGRINHO] Jogador criado');
}

/** Estatísticas do jogador + saldo atual da carteira RPG. */
function getPlayer(userId) {
  ensure(userId);
  const row = prepare('get_tigrinho', `SELECT * FROM tigrinho_players WHERE user_id = ?`).get(userId);
  return Object.assign({}, row, { balance: economy.get(userId).wallet });
}

function createPlayer(userId) {
  ensure(userId);
  return getPlayer(userId);
}

/** Saldo = carteira RPG (LuaCoins). */
function getBalance(userId) {
  return economy.get(userId).wallet;
}

/**
 * Aplica um giro de forma ATÔMICA (withLock por usuário):
 *  1. cobra a aposta da carteira RPG (economy.addWallet -bet);
 *  2. credita a recompensa (economy.addWallet +reward);
 *  3. atualiza estatísticas + histórico (limitado).
 * Lança 'INSUFFICIENT_FUNDS' se a aposta exceder o saldo (nunca fica negativo).
 * @returns {{balance:number, reward:number, won:boolean, jackpot:boolean}}
 */
function applySpin(userId, { bet, reward, reels, jackpot, won }) {
  return withLock(userId, () => {
    ensure(userId);
    if (!Number.isFinite(bet) || bet <= 0) throw new Error('INVALID_BET');

    // 1 + 2: carteira RPG (transações próprias; serializadas pelo withLock)
    economy.addWallet(userId, -bet);
    if (reward > 0) economy.addWallet(userId, reward);

    // 3: estatísticas
    prepare(
      'upd_tigrinho',
      `UPDATE tigrinho_players
         SET spins = spins + 1,
             wins = wins + ?,
             losses = losses + ?,
             jackpots = jackpots + ?,
             best_win = MAX(best_win, ?),
             last_spin_at = ?
       WHERE user_id = ?`
    ).run(won ? 1 : 0, won ? 0 : 1, jackpot ? 1 : 0, reward, Date.now(), userId);

    prepare(
      'ins_tigrinho_hist',
      `INSERT INTO tigrinho_history (user_id, reels, bet, reward, jackpot, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, JSON.stringify(reels), bet, reward, jackpot ? 1 : 0, now());

    // mantém só os últimos N giros por jogador (não cresce infinitamente)
    prepare(
      'trim_tigrinho_hist',
      `DELETE FROM tigrinho_history
        WHERE user_id = ?
          AND id NOT IN (
            SELECT id FROM tigrinho_history WHERE user_id = ? ORDER BY id DESC LIMIT ?
          )`
    ).run(userId, userId, TIGRINHO_CONFIG.historyLimit);

    const balance = economy.get(userId).wallet;
    logger.info({ user: userId, balance }, '[LUA TIGRINHO] Saldo atualizado');
    return { balance, reward, won, jackpot };
  });
}

/**
 * Registra o RESULTADO de uma rodada JÁ COBRADA/PAGA pela camada financeira
 * comum (utils/gameWallet): estatísticas + histórico + fecho da rodada numa
 * transação só. NÃO movimenta dinheiro — quem movimenta é o gameWallet.
 *
 * Usado pelo comando do tigrinho (débito e crédito ficam no livro-caixa
 * `game_bets`, com idempotência pelo id da rodada). `applySpin` continua
 * existindo para quem quiser o giro todo num passo (testes/compatibilidade).
 *
 * @param {object} p { userId, bet, reward, reels, jackpot, won, roundId }
 * @returns {{balance:number, reward:number, won:boolean, jackpot:boolean}}
 */
function registrarRodada({ userId, bet, reward = 0, reels = [], jackpot = false, won = false, roundId = null }) {
  const premio = Math.max(0, Math.floor(Number(reward) || 0));
  const valor = Math.max(0, Math.floor(Number(bet) || 0));
  return withLock(userId, () => {
    ensure(userId);
    const tx = getDb().transaction(() => {
      prepare(
        'upd_tigrinho',
        `UPDATE tigrinho_players
           SET spins = spins + 1,
               wins = wins + ?,
               losses = losses + ?,
               jackpots = jackpots + ?,
               best_win = MAX(best_win, ?),
               last_spin_at = ?
         WHERE user_id = ?`
      ).run(won ? 1 : 0, won ? 0 : 1, jackpot ? 1 : 0, premio, Date.now(), userId);

      prepare(
        'ins_tigrinho_hist',
        `INSERT INTO tigrinho_history (user_id, reels, bet, reward, jackpot, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(userId, JSON.stringify(reels), valor, premio, jackpot ? 1 : 0, now());

      prepare(
        'trim_tigrinho_hist',
        `DELETE FROM tigrinho_history
          WHERE user_id = ?
            AND id NOT IN (
              SELECT id FROM tigrinho_history WHERE user_id = ? ORDER BY id DESC LIMIT ?
            )`
      ).run(userId, userId, TIGRINHO_CONFIG.historyLimit);

      if (roundId) {
        prepare(
          'done_round',
          `UPDATE game_rounds SET state = 'settled', reward = ?, payload = ?, settled_at = ? WHERE id = ?`
        ).run(premio, JSON.stringify({ reels, jackpot, won }), now(), roundId);
      }
    });
    tx();
    const balance = economy.get(userId).wallet;
    logger.info({ user: userId, bet: valor, reward: premio, balance }, '[LUA TIGRINHO] Rodada registrada');
    return { balance, reward: premio, won: !!won, jackpot: !!jackpot };
  });
}

/** Últimos giros do jogador (mais recente primeiro). */
function getHistory(userId, limit = TIGRINHO_CONFIG.historyLimit) {
  const n = Math.min(50, Math.max(1, Number(limit) || TIGRINHO_CONFIG.historyLimit));
  return prepare('hist_tigrinho', `SELECT * FROM tigrinho_history WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, n);
}

/** Ranking por saldo (carteira RPG) — consulta leve e limitada. */
function getRanking(limit = TIGRINHO_CONFIG.rankingLimit) {
  const n = Math.min(50, Math.max(1, Number(limit) || TIGRINHO_CONFIG.rankingLimit));
  return prepare(
    'rank_tigrinho',
    `SELECT p.user_id, COALESCE(e.wallet, 0) AS balance, p.jackpots, p.spins,
            COALESCE(NULLIF(u.name, ''), p.user_id) AS name
       FROM tigrinho_players p
       LEFT JOIN economy e ON e.user_id = p.user_id
       LEFT JOIN users u ON u.id = p.user_id
      ORDER BY balance DESC, p.jackpots DESC
      LIMIT ?`
  ).all(n);
}

/**
 * Cooldown individual por jogador (timestamp em last_spin_at).
 * @returns {{allowed:boolean, remaining:number}}
 */
function canSpin(userId, nowMs = Date.now()) {
  ensure(userId);
  const row = prepare('get_tigrinho_cd', `SELECT last_spin_at FROM tigrinho_players WHERE user_id = ?`).get(userId);
  const elapsed = nowMs - (Number(row.last_spin_at) || 0);
  const remaining = TIGRINHO_CONFIG.cooldownMs - elapsed;
  return { allowed: remaining <= 0, remaining: remaining > 0 ? remaining : 0 };
}

module.exports = {
  getPlayer,
  createPlayer,
  getBalance,
  applySpin,
  registrarRodada,
  getHistory,
  getRanking,
  canSpin,
};
