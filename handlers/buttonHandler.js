/**
 * handlers/buttonHandler.js — roteador único de botões/listas.
 *
 * - IDs padronizados: "lua:<namespace>:<ação>" (ex.: lua:menu:games)
 * - valida o ID antes de executar
 * - não registra o mesmo handler duas vezes
 * - captura erros para nunca derrubar o bot
 */

'use strict';

const logger = require('../utils/logger').child('buttons');
const { getInteractivePayload } = require('../utils/messages');
const errorHandler = require('./errorHandler');

const handlers = new Map(); // id -> { handler, registeredAt }

// aceita 'lua:menu:general' (estilo antigo) e 'lua_commands' (IDs estáveis de lista)
const ID_PATTERN = /^lua[a-z0-9:_-]+$/i;

/** Registra um handler para um ID de botão/lista. */
function register(id, handler) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    logger.warn({ id }, 'ID de botão inválido (deve casar com lua:...)');
    return false;
  }
  if (typeof handler !== 'function') {
    logger.warn({ id }, 'handler não é função');
    return false;
  }
  if (handlers.has(id)) {
    logger.warn({ id }, 'handler duplicado ignorado');
    return false;
  }
  handlers.set(id, { handler, registeredAt: Date.now() });
  return true;
}

function has(id) {
  return handlers.has(id);
}

function count() {
  return handlers.size;
}

/**
 * Processa uma mensagem de resposta interativa.
 * @returns {Promise<boolean>} true se a mensagem era um botão/lista e foi tratada
 */
async function process(ctx) {
  const payload = getInteractivePayload(ctx.message);
  if (!payload || !payload.id) return false;

  const entry = handlers.get(payload.id);
  if (!entry) {
    logger.warn({ id: payload.id, type: payload.type }, 'resposta interativa sem handler registrado');
    return false; // consumimos a mensagem, mas não há ação
  }

  logger.info(
    { tag: 'BUTTONS', id: payload.id, user: ctx.sender, type: payload.type },
    `[LUA][BUTTONS] Interação recebida: ${payload.id}`
  );
  try {
    await entry.handler(ctx);
  } catch (err) {
    await errorHandler.handle(ctx, err, { name: `button:${payload.id}` });
  }
  return true;
}

/** Lista os IDs registrados (para debug/auditoria). */
function listIds() {
  return [...handlers.keys()].sort();
}

module.exports = { register, has, count, process, listIds };
