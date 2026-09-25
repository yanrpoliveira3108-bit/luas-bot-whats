/**
 * utils/keyedMutex.js — fila de execução por chave.
 *
 * Serializa operações sensíveis por usuário (economia/RPG), evitando
 * race conditions e duplicação de dinheiro dentro do mesmo processo.
 */

'use strict';

const chains = new Map();

/**
 * Executa `fn` garantindo que duas execuções com a mesma `key`
 * nunca rodem ao mesmo tempo.
 */
function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn); // roda mesmo se a anterior falhar
  chains.set(
    key,
    run.catch(() => {})
  );
  // limpeza preguiçosa para não crescer indefinidamente
  if (chains.size > 5000) {
    for (const [k, v] of chains) {
      if (v === run) chains.delete(k);
    }
  }
  return run;
}

/**
 * Executa `fn` com trava ordenada para múltiplos participantes (ex: transferências, trocas).
 * Ordena as chaves lexicograficamente para prevenir impasses (deadlocks).
 */
function withMultiLock(keys, fn) {
  if (!Array.isArray(keys) || keys.length === 0) return Promise.resolve().then(fn);
  const sorted = [...new Set(keys.map(String))].sort();
  function chain(index) {
    if (index >= sorted.length) return Promise.resolve().then(fn);
    return withLock(sorted[index], () => chain(index + 1));
  }
  return chain(0);
}

module.exports = { withLock, withMultiLock };
