/**
 * utils/prefixReply.js — resposta ÚNICA para "qual é o prefixo?".
 *
 * O prefixo vem da MESMA resolução usada pelo processamento dos comandos
 * (`settings.effectivePrefix()`, lida em handlers/commandHandler.js ao montar o
 * contexto). Hoje o projeto tem um prefixo GLOBAL (vale em todos os chats,
 * alterado com `!prefix <novo>` pelo dono); se um dia houver prefixo por
 * grupo, basta mudar `prefixoEfetivo()` e todos os pontos acompanham.
 *
 * Nunca fixa o caractere no código: o exemplo de menu usa o mesmo valor.
 */

'use strict';

const { tokens } = require('./reactionTopics');

/** Prefixo efetivo do contexto (o mesmo do pipeline de comandos). */
function prefixoEfetivo(ctx) {
  try {
    return require('../database/settings').effectivePrefix();
  } catch (_) {
    // banco indisponível: o valor que o pipeline já resolveu para esta mensagem
    return (ctx && ctx.prefix) || require('../config').bot.prefix;
  }
}

/** Texto da resposta de prefixo (com o atalho do menu no mesmo prefixo). */
function textoPrefixo(ctx) {
  const p = prefixoEfetivo(ctx);
  const onde = ctx && ctx.isGroup ? 'neste grupo' : 'nesta conversa';
  return `💻 Meu prefixo ${onde} é: ${p}\n🧭 Para abrir o menu, envie: ${p}menu`;
}

// Palavras aceitas num pedido CLARO de prefixo (tudo mais desqualifica).
const PERMITIDAS = new Set([
  'qual', 'e', 'eh', 'o', 'seu', 'teu', 'prefixo', 'prefix', 'do', 'bot', 'me', 'passa', 'fala', 'diz',
  'manda', 'ai', 'voce', 'vc', 'por', 'favor', 'pf', 'pfv', 'atual', 'mesmo', 'entao',
]);

/**
 * É um pedido claro de prefixo? ("prefixo", "qual o prefixo?", "qual é o seu
 * prefixo"). Frases que só MENCIONAM a palavra ("não gostei desse prefixo")
 * não contam. Só é consultado quando a mensagem responde ao bot.
 */
function ehPedidoDePrefixo(texto) {
  const t = tokens(texto);
  if (!t.length || t.length > 7) return false;
  if (!t.includes('prefixo') && !t.includes('prefix')) return false;
  return t.every((w) => PERMITIDAS.has(w));
}

module.exports = { prefixoEfetivo, textoPrefixo, ehPedidoDePrefixo };
