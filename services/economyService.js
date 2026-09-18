/**
 * services/economyService.js — regras de negócio da economia (LuaCoins).
 *
 * Camada:
 *   Command → EconomyService → database/economy.js (repository) → SQLite
 *
 * O que mora AQUI (regra de negócio):
 *   • validar valor/destinatário;
 *   • serializar por usuário com o keyedMutex existente (utils/keyedMutex);
 *   • traduzir falha do banco em erro de domínio com `.code`;
 *   • lançar no histórico financeiro (tabela `transactions`, que já existia e
 *     era escrita só por compras/vendas — transferências ficavam de fora).
 *
 * O que NÃO mora aqui:
 *   • SQL (tudo via database/economy.js);
 *   • WhatsApp (nada de sock/reply/menção — o comando formata);
 *   • formatação de moeda (utils/formatter continua no comando).
 *
 * Erros seguem o padrão que já existe no projeto (plugins/life/engine.js:
 * `Error` com `.code`), não classes novas.
 */

'use strict';

const economy = require('../database/economy');
const { withLock } = require('../utils/keyedMutex');
const logger = require('../utils/logger').child('economy');

/** Códigos de erro de domínio (mesma convenção de plugins/life/engine.js). */
const CODES = {
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_TARGET: 'INVALID_TARGET',
  SELF_TRANSFER: 'SELF_TRANSFER',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
};

function fail(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

/**
 * Valor monetário válido: INTEIRO positivo (a regra do bot para parâmetros
 * numéricos). Aceita número ou string numérica; rejeita NaN, 0, negativo,
 * fração e texto.
 * @returns {number|null}
 */
function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Converte a falha do repository em erro de domínio com `.code`.
 * database/economy.js lança `new Error('INSUFFICIENT_FUNDS')` (mensagem =
 * código, sem `.code`); aqui ele vira o mesmo contrato dos demais erros.
 */
function toDomainError(err) {
  if (err && err.code) return err;
  const msg = String((err && err.message) || '');
  if (CODES[msg]) return fail(msg, msg);
  return err;
}

/** Saldo completo (carteira + banco). Nunca lança: cria a linha se não existir. */
function balance(userId) {
  const row = economy.get(userId);
  return { wallet: row.wallet, bank: row.bank, total: row.wallet + row.bank };
}

/**
 * Deposita da carteira para o banco.
 * @returns {Promise<{amount:number, wallet:number, bank:number}>}
 */
async function deposit(userId, amount) {
  const value = parseAmount(amount);
  if (!value) throw fail(CODES.INVALID_AMOUNT, 'valor inválido para depósito');
  try {
    await withLock(userId, () => economy.deposit(userId, value));
  } catch (err) {
    throw toDomainError(err);
  }
  const after = balance(userId);
  logger.debug({ user: userId, amount: value }, 'depósito');
  return Object.assign({ amount: value }, after);
}

/**
 * Saca do banco para a carteira.
 * @returns {Promise<{amount:number, wallet:number, bank:number}>}
 */
async function withdraw(userId, amount) {
  const value = parseAmount(amount);
  if (!value) throw fail(CODES.INVALID_AMOUNT, 'valor inválido para saque');
  try {
    await withLock(userId, () => economy.withdraw(userId, value));
  } catch (err) {
    throw toDomainError(err);
  }
  const after = balance(userId);
  logger.debug({ user: userId, amount: value }, 'saque');
  return Object.assign({ amount: value }, after);
}

/**
 * Transfere da carteira de `fromUserId` para a carteira de `toUserId`.
 *
 * A operação em si continua sendo a transaction real de database/economy.js
 * (nenhuma transaction paralela foi criada); o keyedMutex continua
 * serializando por usuário, como os comandos já faziam.
 *
 * @returns {Promise<{amount:number, from:string, to:string, wallet:number}>}
 */
async function transfer(fromUserId, toUserId, amount) {
  const value = parseAmount(amount);
  if (!value) throw fail(CODES.INVALID_AMOUNT, 'valor inválido para transferência');
  if (!toUserId || typeof toUserId !== 'string') throw fail(CODES.INVALID_TARGET, 'destinatário inválido');
  if (toUserId === fromUserId) throw fail(CODES.SELF_TRANSFER, 'não é possível transferir para si mesmo');

  try {
    await withLock(fromUserId, () => economy.transfer(fromUserId, toUserId, value));
  } catch (err) {
    throw toDomainError(err);
  }

  // histórico: os dois lados do lançamento (a tabela `transactions` já existia)
  economy.recordTransaction(fromUserId, 'transferencia', -value, `para ${toUserId}`);
  economy.recordTransaction(toUserId, 'transferencia', value, `de ${fromUserId}`);

  logger.debug({ from: fromUserId, to: toUserId, amount: value }, 'transferência');
  return { amount: value, from: fromUserId, to: toUserId, wallet: balance(fromUserId).wallet };
}

/**
 * Credita moedas sem contrapartida (dono/eventos). Não usa o histórico de
 * transferência: o lançamento é do tipo informado pelo chamador.
 */
async function grant(userId, amount, type = 'credito', note = '') {
  const value = parseAmount(amount);
  if (!value) throw fail(CODES.INVALID_AMOUNT, 'valor inválido para crédito');
  await withLock(userId, () => {
    economy.addWallet(userId, value);
    economy.recordTransaction(userId, type, value, note || 'crédito');
  });
  return Object.assign({ amount: value }, balance(userId));
}

/** Debita moedas sem contrapartida (dono/penalidade). */
async function deduct(userId, amount, type = 'debito', note = '') {
  const value = parseAmount(amount);
  if (!value) throw fail(CODES.INVALID_AMOUNT, 'valor inválido para débito');
  try {
    await withLock(userId, () => {
      const row = economy.get(userId);
      if (row.wallet < value) throw fail(CODES.INSUFFICIENT_FUNDS, 'saldo insuficiente');
      economy.addWallet(userId, -value);
      economy.recordTransaction(userId, type, -value, note || 'débito');
    });
  } catch (err) {
    throw toDomainError(err);
  }
  return Object.assign({ amount: value }, balance(userId));
}

/**
 * Vende `qty` unidades de um item: remove do inventário e credita na carteira,
 * atomicamente por usuário.
 *
 * O preço unitário vem do CHAMADOR de propósito: `!venderpeixes` paga
 * `sell_price` e `!precos` mostra o preço ajustado pelo mercado
 * (plugins/life/market.computeSellPrice). Centralizar o preço aqui mudaria o
 * valor pago — fora do escopo da Fase 5 (documentado como achado).
 *
 * @returns {Promise<{itemId:string, qty:number, unitPrice:number, total:number, wallet:number}>}
 */
async function sellItem(userId, itemId, qty, unitPrice) {
  const id = String(itemId || '').toLowerCase();
  const quantity = parseAmount(qty);
  const price = parseAmount(unitPrice);
  if (!id) throw fail(CODES.INVALID_TARGET, 'item inválido');
  if (!quantity || !price) throw fail(CODES.INVALID_AMOUNT, 'quantidade ou preço inválido');

  let sold = 0;
  try {
    await withLock(userId, () => {
      const has = economy.getItem(userId, id);
      if (!has || has.quantity < quantity) throw fail(CODES.INSUFFICIENT_FUNDS, 'quantidade indisponível');
      economy.removeItem(userId, id, quantity);
      economy.addWallet(userId, price * quantity);
      sold = quantity;
    });
  } catch (err) {
    throw toDomainError(err);
  }

  const total = price * sold;
  economy.recordTransaction(userId, 'venda', total, `${id} x${sold}`);
  logger.debug({ user: userId, item: id, qty: sold, total }, 'venda');
  return { itemId: id, qty: sold, unitPrice: price, total, wallet: balance(userId).wallet };
}

/**
 * Histórico financeiro (base do futuro !extrato). Reutiliza
 * database/economy.history — não cria uma segunda contabilidade.
 */
function ledger(userId, limit = 10) {
  return economy.history(userId, limit);
}

module.exports = {
  CODES,
  parseAmount,
  balance,
  deposit,
  withdraw,
  transfer,
  grant,
  deduct,
  sellItem,
  ledger,
};
