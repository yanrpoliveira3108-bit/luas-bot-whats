/**
 * engine/interactionEngine.js — motor de interações (zueira).
 *
 * Dezenas de comandos de interação reutilizam esta engine:
 *   { action, actor, target, responses, chance, cooldown }
 *
 * - respostas aleatórias com {actor} e {target}
 * - registro de estatísticas (topzueira) e karma
 * - sem conteúdo sexual
 */

'use strict';

const users = require('../database/users');
const games = require('../database/games');
const { sanitize } = require('../utils/formatter');
const actionImage = require('../utils/actionImage');

function displayName(jid) {
  const u = users.get(jid);
  if (u && u.name) return sanitize(u.name);
  return '@' + String(jid).split('@')[0];
}

/** Resolve o alvo da interação (mencionado ou o próprio autor). */
function resolveTarget(ctx) {
  const mentioned = (ctx.mentionedJid || []).filter((j) => j !== ctx.sender && j !== ctx.socket.user.id);
  if (mentioned.length > 0) return mentioned[0];
  return ctx.sender;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(template, actor, target) {
  return template
    .replace(/\{actor\}/g, actor)
    .replace(/\{target\}/g, target);
}

/**
 * Executa uma interação.
 * @param {object} ctx
 * @param {object} opts { action, responses, selfResponses, chance, karma, record }
 * @returns {Promise<string>} texto enviado
 */
async function runInteraction(ctx, opts) {
  const action = opts.action || 'interaction';
  const target = resolveTarget(ctx);
  const self = target === ctx.sender;
  const actor = displayName(ctx.sender);
  const targetName = self ? 'si mesmo(a)' : displayName(target);

  const bank = self && opts.selfResponses ? opts.selfResponses : opts.responses;
  let text = fill(pick(bank), actor, targetName);

  // chance de resposta especial
  if (opts.chance && Array.isArray(opts.special) && Math.random() < opts.chance) {
    text = fill(pick(opts.special), actor, targetName);
  }

  // estatísticas
  try {
    games.recordGame(ctx.sender, 'zueira', 'win');
    const karmaDelta = opts.karma || 1;
    users.addKarma(ctx.sender, karmaDelta);
    if (!self) users.addKarma(target, Math.max(0, karmaDelta - 1));
  } catch (_) {
    /* não interrompe a brincadeira */
  }

  // imagem ilustrativa opcional (assets/actions/<action>.jpg); sem imagem, só texto
  await actionImage.send(ctx, opts.image || action, text);
  return text;
}

/** Comando simples de medidor (ex.: !gaymer) com valor persistente por usuário. */
async function runMeter(ctx, label, phrase) {
  // valor determinístico por usuário + data (muda a cada dia)
  const day = Math.floor(Date.now() / 86400000);
  const seed = (String(ctx.sender).split('').reduce((a, c) => a + c.charCodeAt(0), 0) + day) % 100;
  const pct = seed === 0 ? 1 : seed;
  const name = displayName(ctx.sender);
  const text = phrase.replace('{actor}', name).replace('{pct}', pct);
  await ctx.reply(text);
  games.recordGame(ctx.sender, 'zueira', 'win');
  users.addKarma(ctx.sender, 1);
}

module.exports = { runInteraction, runMeter, resolveTarget, displayName, fill, pick };
