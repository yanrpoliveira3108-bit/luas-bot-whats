/**
 * utils/safety.js — política de "modo seguro" (anti-restrição de conta).
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Contas estavam caindo em "conta restrita" logo nos PRIMEIROS comandos
 * (!menu, !ping), sem flood e sem automação ligada. A auditoria do projeto
 * encontrou três payloads que o cliente OFICIAL do WhatsApp não é capaz de
 * produzir — e que o servidor trata como cliente modificado / automação:
 *
 *   1. interactiveMessage + nativeFlowMessage   (utils/interactive.js)
 *      → menu por "lista nativa"/botões, com headerParams/buttonParamsJson
 *   2. botForwardedMessage + richResponseMessage (utils/richHtml.js)
 *      → card HTML disfarçado de resposta de "bot IA" da Meta (forwardOrigin
 *        e forwardedAiBotMessageInfo apontando para um @bot falso)
 *   3. requestPaymentMessage em conta pessoal    (commands/general/selectivepay.js)
 *      → pedido de pagamento sem conta comercial
 *
 * O modo seguro bloqueia (1), (2) e (3) e também impede o bot de ABRIR
 * conversa no privado com quem nunca falou com ele (mensagem fria em PV é o
 * gatilho mais rápido de bloqueio em número novo).
 *
 * O bloqueio NÃO deixa o bot mudo: todos esses caminhos têm fallback textual
 * já implementado (o menu cai no modo numerado, o ping cai no cartão de texto,
 * o tigrinho cai no texto). O que muda é só o FORMATO — nunca o conteúdo.
 *
 * LIGAR/DESLIGAR
 * --------------
 *   .env .................. SAFE_MODE=0  (desliga tudo de uma vez)
 *   runtime ............... !freio seguro off   (persistido no banco)
 *   por payload ........... ALLOW_INTERACTIVE=1 / ALLOW_RICH_CARDS=1
 *                           / ALLOW_PAYMENT_TEST=1 (força só aquele caminho)
 *
 * Todas as leituras passam por aqui — nenhum outro módulo decide sozinho.
 */

'use strict';

const CONFIG = require('../config');

// cache curto: as flags são lidas a cada envio (menu, resposta, card…).
const CACHE_MS = 5000;
let cache = { at: 0, value: null };

/**
 * Valor efetivo do modo seguro: banco (via !freio seguro on/off) → .env.
 * Nunca lança: se o banco ainda não está aberto, usa o valor do .env.
 */
function safeMode() {
  const now = Date.now();
  if (cache.value !== null && now - cache.at < CACHE_MS) return cache.value;
  let value = !!CONFIG.safety.safeMode;
  try {
    const settings = require('../database/settings');
    value = settings.getBool('safe_mode', CONFIG.safety.safeMode);
  } catch (_) {
    /* banco indisponível (boot/teste) — usa o .env */
  }
  cache = { at: now, value };
  return value;
}

/** Grava o modo seguro no banco (usado pelo !freio). */
function setSafeMode(on) {
  const settings = require('../database/settings');
  settings.set('safe_mode', on ? 'true' : 'false');
  cache = { at: Date.now(), value: !!on };
  return !!on;
}

function invalidate() {
  cache = { at: 0, value: null };
}

/* --------------------------- decisões de envio -------------------------- */

/** Menu por lista/botões nativos (interactiveMessage/nativeFlowMessage). */
function blocksInteractive() {
  if (CONFIG.safety.allowInteractive) return false; // override explícito
  return safeMode();
}

/** Cards HTML "bot IA" (botForwardedMessage/richResponseMessage). */
function blocksRichCards() {
  if (CONFIG.safety.allowRichCards) return false;
  return safeMode();
}

/** Teste de pagamento (!sp / !st) em conta pessoal. */
function blocksPaymentTest() {
  if (CONFIG.safety.allowPaymentTest) return false;
  return safeMode();
}

/** Iniciar conversa no privado com quem nunca falou com o bot. */
function blocksColdPv() {
  return !!CONFIG.safety.send.blockColdPv;
}

/**
 * Resumo legível (usado no boot, no !freio e nos logs).
 */
function summary() {
  const on = safeMode();
  return {
    safeMode: on,
    interactive: !blocksInteractive(),
    richCards: !blocksRichCards(),
    paymentTest: !blocksPaymentTest(),
    coldPvBlocked: blocksColdPv(),
    reasons: on
      ? [
          'menu cai no modo numerado (sem lista/botões nativos)',
          'cards HTML (ping2/tigrinho) caem no texto',
          '!sp/!st de pagamento desativado',
          blocksColdPv() ? 'bot não inicia conversa no PV' : 'PV livre (SEND_BLOCK_COLD_PV=0)',
        ]
      : ['modo seguro DESLIGADO — payloads de risco liberados'],
  };
}

module.exports = {
  safeMode,
  setSafeMode,
  invalidate,
  blocksInteractive,
  blocksRichCards,
  blocksPaymentTest,
  blocksColdPv,
  summary,
};
