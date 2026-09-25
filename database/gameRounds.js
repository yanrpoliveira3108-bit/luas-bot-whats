/**
 * database/gameRounds.js — RODADAS dos jogos (tabela `game_rounds`).
 *
 * Serve para o que o dinheiro sozinho não conta: guardar a rodada ANTES de
 * pagar, para que uma queda no meio do caminho não deixe o jogador com a
 * aposta cobrada e sem resultado.
 *
 * Ciclo de uma rodada:
 *   1. a aposta é cobrada por utils/gameWallet (livro-caixa `game_bets`,
 *      chave de idempotência = id da rodada);
 *   2. o RESULTADO (símbolos/prêmio calculados no backend) é gravado aqui com
 *      `state = 'pending'` — a partir daqui o resultado não se perde;
 *   3. o prêmio é creditado (gameWallet.pagarPremio, idempotente);
 *   4. a rodada é marcada `settled` junto com as estatísticas
 *      (database/tigrinho.registrarRodada), numa transação só.
 *
 * Se o processo cair entre 2 e 4, `pendente()` encontra a rodada e o jogo
 * termina de pagar/registrar exatamente uma vez (nada de pagar de novo).
 */

'use strict';

const { prepare } = require('./database');
const logger = require('../utils/logger').child('gameRounds');

const ESTADO = { PENDENTE: 'pending', CONCLUIDA: 'settled' };

const agora = () => new Date().toISOString();

function hidratar(row) {
  if (!row) return null;
  let payload = null;
  try {
    payload = row.payload ? JSON.parse(row.payload) : null;
  } catch (_) {
    payload = null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    game: row.game,
    bet: Number(row.bet) || 0,
    reward: Number(row.reward) || 0,
    state: row.state,
    payload,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

function get(id) {
  return hidratar(prepare('get_round', `SELECT * FROM game_rounds WHERE id = ?`).get(String(id || '')));
}

/**
 * Grava a rodada (idempotente pelo id: repetir devolve a existente).
 * @param {{id:string, userId:string, game:string, bet:number, reward:number, state?:string, payload?:object}} r
 */
function criar({ id, userId, game, bet, reward = 0, state = ESTADO.PENDENTE, payload = null }) {
  const chave = String(id || `${game}:${userId}:${Date.now()}`);
  const existente = get(chave);
  if (existente) return existente;
  const iso = agora();
  prepare(
    'ins_round',
    `INSERT INTO game_rounds (id, user_id, game, bet, reward, state, payload, created_at, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`
  ).run(
    chave,
    userId,
    String(game || 'tigrinho'),
    Math.max(0, Math.floor(Number(bet) || 0)),
    Math.max(0, Math.floor(Number(reward) || 0)),
    state,
    payload ? JSON.stringify(payload) : '',
    iso
  );
  logger.info({ rodada: chave, game, bet, reward, state }, '[RODADA] gravada');
  return get(chave);
}

/** Rodada que ficou sem conclusão (dinheiro/resultado no meio do caminho). */
function pendente(userId, game) {
  const row = prepare(
    'pend_round',
    `SELECT * FROM game_rounds WHERE user_id = ? AND game = ? AND state = ? ORDER BY created_at DESC LIMIT 1`
  ).get(userId, String(game), ESTADO.PENDENTE);
  return hidratar(row);
}

/** Última rodada concluída (para o card mostrar o resultado validado). */
function ultima(userId, game) {
  const row = prepare(
    'ult_round',
    `SELECT * FROM game_rounds WHERE user_id = ? AND game = ? AND state = ? ORDER BY created_at DESC LIMIT 1`
  ).get(userId, String(game), ESTADO.CONCLUIDA);
  return hidratar(row);
}

/** Marca a rodada como concluída (usada junto das estatísticas). */
function concluir(id, { reward, payload } = {}) {
  const atual = get(id);
  if (!atual) return null;
  prepare(
    'done_round',
    `UPDATE game_rounds SET state = ?, reward = ?, payload = COALESCE(NULLIF(?, ''), payload), settled_at = ? WHERE id = ?`
  ).run(
    ESTADO.CONCLUIDA,
    reward === undefined ? atual.reward : Math.max(0, Math.floor(Number(reward) || 0)),
    payload ? JSON.stringify(payload) : '',
    agora(),
    id
  );
  return get(id);
}

/** Rodadas recentes do jogador (auditoria). */
function historico(userId, game, limit = 10) {
  const n = Math.min(50, Math.max(1, Math.floor(Number(limit) || 10)));
  return prepare(
    'hist_rounds',
    `SELECT * FROM game_rounds WHERE user_id = ? AND game = ? ORDER BY created_at DESC LIMIT ?`
  )
    .all(userId, String(game), n)
    .map(hidratar);
}

module.exports = { ESTADO, get, criar, pendente, ultima, concluir, historico };
