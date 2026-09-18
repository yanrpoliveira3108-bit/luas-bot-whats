/**
 * handlers/buttonHandler.js — roteador único de botões/listas.
 *
 * - IDs padronizados: "lua:<namespace>:<ação>" (ex.: lua:menu:games)
 * - valida o ID antes de executar
 * - não registra o mesmo handler duas vezes
 * - captura erros para nunca derrubar o bot
 * - DISPATCH DINÂMICO: IDs de sugestão (lua:suggest_<comando>,
 *   lua:help_<comando>, lua:use_<comando>) executam o comando na hora mesmo
 *   sem registro prévio — assim um botão enviado antes de um restart continua
 *   funcionando (os handlers registrados vivem só em memória).
 */

'use strict';

const logger = require('../utils/logger').child('buttons');
const { getInteractivePayload } = require('../utils/messages');
const errorHandler = require('./errorHandler');

const handlers = new Map(); // id -> { handler, registeredAt }

// aceita 'lua:menu:general' (estilo antigo) e 'lua_commands' (IDs estáveis de lista)
const ID_PATTERN = /^lua[a-z0-9:_-]+$/i;

/**
 * IDs dinâmicos: o nome do comando vai embutido no próprio ID.
 * Ordem importa — "lua:help_suggest_x" casa antes de "lua:help_x".
 */
const DYNAMIC_RULES = [
  { re: /^lua:(?:suggest|use|cmd|run)_([a-z0-9]+)$/i, kind: 'command' },
  { re: /^lua:help_suggest_([a-z0-9]+)$/i, kind: 'help' },
  { re: /^lua:help_([a-z0-9]+)$/i, kind: 'help' },
];

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
    return false; // já registrado — não é erro, apenas reuso silencioso
  }
  handlers.set(id, { handler, registeredAt: Date.now() });
  return true;
}

/** Registra só se o ID ainda não existe (evita retrabalho por mensagem). */
/** Remove um handler registrado (usa em ids temporários e em testes). */
function unregister(id) {
  return handlers.delete(id);
}

/**
 * Handler de uso único: some depois do primeiro clique e expira sozinho.
 * É o que torna seguro um botão de confirmação — reenviar o clique (ou clicar
 * tarde demais) não re-executa a ação destrutiva.
 */
function registerOnce(id, handler, ttlMs = 120000) {
  if (handlers.has(id)) return false;
  let timer = null;
  const wrapped = async (ctx) => {
    unregister(id); // consome ANTES de executar: duplo clique não duplica
    if (timer) clearTimeout(timer);
    await handler(ctx);
  };
  const registered = register(id, wrapped);
  if (!registered) return false;
  if (ttlMs > 0) {
    timer = setTimeout(() => unregister(id), ttlMs);
    if (typeof timer.unref === 'function') timer.unref();
  }
  return true;
}

function has(id) {
  return handlers.has(id);
}

function count() {
  return handlers.size;
}

/**
 * Interpreta um ID dinâmico de sugestão/ajuda.
 * @param {string} id
 * @returns {{kind: 'command'|'help', name: string}|null}
 */
function resolveDynamic(id) {
  if (typeof id !== 'string') return null;
  for (const rule of DYNAMIC_RULES) {
    const m = id.match(rule.re);
    if (m) return { kind: rule.kind, name: m[1].toLowerCase() };
  }
  return null;
}

/** Monta o handler de um ID dinâmico (executa o comando embutido no ID). */
function dynamicHandler(target) {
  return async (ctx) => {
    const { registry } = require('../engine/plugins');
    const commandHandler = require('./commandHandler');
    const name = target.name;
    const cmd = registry.getCommand(name) || registry.resolveTrigger(name);
    if (!cmd) {
      logger.warn({ id: name }, 'botão dinâmico aponta para comando inexistente');
      await ctx.reply(`⚠️ O comando *${name}* não está mais disponível. Use ${ctx.prefix || '!'}menu para ver a lista.`);
      return;
    }
    if (target.kind === 'help') {
      await commandHandler.runByName(ctx, 'help', [cmd.name]);
      return;
    }
    await commandHandler.runByName(ctx, cmd.name, ctx.args || []);
  };
}

/**
 * Processa uma mensagem de resposta interativa.
 * @returns {Promise<boolean>} true se a mensagem era um botão/lista e foi tratada
 */
async function process(ctx) {
  const payload = getInteractivePayload(ctx.message);
  if (!payload || !payload.id) return false;

  let entry = handlers.get(payload.id);
  let dynamic = null;
  if (!entry) {
    dynamic = resolveDynamic(payload.id);
    if (dynamic) entry = { handler: dynamicHandler(dynamic) };
  }
  if (!entry) {
    logger.warn({ id: payload.id, type: payload.type }, 'resposta interativa sem handler registrado');
    return false; // consumimos a mensagem, mas não há ação
  }

  logger.info(
    { tag: 'BUTTONS', id: payload.id, user: ctx.sender, type: payload.type, dynamic: !!dynamic },
    `[LUA][BUTTONS] Interação recebida: ${payload.id}${dynamic ? ` (dinâmico → ${dynamic.kind}:${dynamic.name})` : ''}`
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

module.exports = { register, registerOnce, unregister, has, count, process, listIds, resolveDynamic, dynamicHandler, ID_PATTERN };
