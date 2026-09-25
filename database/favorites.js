/**
 * database/favorites.js — persistência de comandos favoritos por usuário.
 *
 * Requisitos:
 * - Armazena a referência canônica ao comando original (cmd.name), evitando dados desatualizados.
 * - Identidade normalizada do usuário.
 * - Deduplicação automática: aliases do mesmo comando apontam para o mesmo favorito.
 * - Não concede permissões extras: a permissão continua revalidada no uso.
 */

'use strict';

const { prepare } = require('./database');
const { registry } = require('../engine/plugins');

const now = () => new Date().toISOString();

/**
 * Adiciona um comando aos favoritos de um usuário.
 * Resolve o trigger para o nome canônico do comando.
 * @param {string} userId
 * @param {string} cmdOrTrigger
 * @returns {{ ok: boolean, command: object|null, reason?: string }}
 */
function addFavorite(userId, cmdOrTrigger) {
  if (!userId || !cmdOrTrigger) return { ok: false, command: null, reason: 'PARAM_MISSING' };
  const normalizedUser = String(userId).trim();
  const canonical = registry.getCanonicalName(cmdOrTrigger);
  const cmd = canonical ? registry.getCommand(canonical) : null;

  if (!cmd) {
    return { ok: false, command: null, reason: 'COMMAND_NOT_FOUND' };
  }

  try {
    prepare(
      'add_fav',
      `INSERT INTO user_favorites (user_id, command_name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, command_name) DO UPDATE SET created_at = excluded.created_at`
    ).run(normalizedUser, cmd.name, now());

    return { ok: true, command: cmd };
  } catch (err) {
    return { ok: false, command: null, reason: err.message };
  }
}

/**
 * Remove um comando dos favoritos do usuário.
 * @param {string} userId
 * @param {string} cmdOrTrigger
 * @returns {{ ok: boolean, commandName: string }}
 */
function removeFavorite(userId, cmdOrTrigger) {
  if (!userId || !cmdOrTrigger) return { ok: false, commandName: '' };
  const normalizedUser = String(userId).trim();
  const canonical = registry.getCanonicalName(cmdOrTrigger) || String(cmdOrTrigger).toLowerCase().trim();

  const res = prepare(
    'del_fav',
    `DELETE FROM user_favorites WHERE user_id = ? AND command_name = ?`
  ).run(normalizedUser, canonical);

  return { ok: res.changes > 0, commandName: canonical };
}

/**
 * Lista todos os comandos favoritos válidos do usuário.
 * @param {string} userId
 * @returns {Array<{ name: string, cmd: object, created_at: string }>}
 */
function listFavorites(userId) {
  if (!userId) return [];
  const normalizedUser = String(userId).trim();
  const rows = prepare(
    'list_fav',
    `SELECT command_name, created_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC`
  ).all(normalizedUser);

  const results = [];
  for (const row of rows) {
    const cmd = registry.getCommand(row.command_name);
    if (cmd) {
      results.push({
        name: cmd.name,
        cmd,
        created_at: row.created_at,
      });
    }
  }
  return results;
}

/**
 * Verifica se um comando está nos favoritos do usuário.
 * @param {string} userId
 * @param {string} cmdOrTrigger
 * @returns {boolean}
 */
function isFavorite(userId, cmdOrTrigger) {
  if (!userId || !cmdOrTrigger) return false;
  const canonical = registry.getCanonicalName(cmdOrTrigger);
  if (!canonical) return false;
  const row = prepare(
    'has_fav',
    `SELECT 1 FROM user_favorites WHERE user_id = ? AND command_name = ?`
  ).get(String(userId).trim(), canonical);
  return !!row;
}

module.exports = {
  addFavorite,
  removeFavorite,
  listFavorites,
  isFavorite,
};
