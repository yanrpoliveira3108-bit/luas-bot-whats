/**
 * ai/index.js — API pública do módulo de IA.
 *
 * Uso: const ai = require('./ai'); await ai.ask({ chatId, userId, text, mode })
 * Comandos em commands/ai/ chamam esta API (nada de lógica no handler).
 */

'use strict';

const router = require('./router');
const memory = require('./memory');
const { providerOrder } = require('./router');

module.exports = {
  ask: router.ask,
  status: router.status,
  providerOrder,
  memory,
};
