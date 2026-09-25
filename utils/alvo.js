/**
 * utils/alvo.js — QUEM é o alvo de um comando. Resolvedor único para todos os
 * comandos que aceitam "@fulano".
 *
 * Ordem (a primeira que existir vence):
 *   1. menção de verdade (@ escolhido na lista do WhatsApp) → contextInfo.mentionedJid
 *   2. RESPOSTA a uma mensagem → autor da mensagem citada (contextInfo.participant)
 *   3. número digitado (só onde o comando aceita: `numero: true`)
 *
 * O pipeline (commandHandler) já converte LID → PN quando a lista de
 * participantes do grupo permite, tanto nas menções quanto na citação.
 *
 * Resposta a uma mensagem DO BOT não conta como alvo (quem responde ao bot
 * normalmente está falando com ele, não pedindo para agir sobre ele), a não
 * ser com `incluirBot: true`.
 */

'use strict';

const { toJid } = require('./messages');

/** "5511...:3@s.whatsapp.net" → "5511...@s.whatsapp.net" (c.us = s.whatsapp.net). */
function canonico(jid) {
  const s = String(jid || '').trim();
  if (!s.includes('@')) return '';
  const [userDev, server] = s.split('@');
  const user = userDev.split(':')[0];
  const srv = server === 'c.us' ? 's.whatsapp.net' : server;
  return user && srv ? `${user}@${srv}` : '';
}

/** Os dois JIDs são a mesma conta? (ignora sufixo de aparelho) */
function mesmo(a, b) {
  const x = canonico(a);
  return !!x && x === canonico(b);
}

/** O JID é a conta conectada do bot (por número ou LID)? */
function ehBot(ctx, jid) {
  const u = (ctx && ctx.socket && ctx.socket.user) || {};
  return mesmo(jid, u.id) || (!!u.lid && mesmo(jid, u.lid));
}

/** O JID é quem mandou o comando (qualquer forma conhecida do remetente)? */
function ehAutor(ctx, jid) {
  if (!ctx) return false;
  const formas = [ctx.sender].concat(Array.isArray(ctx.identidades) ? ctx.identidades : []);
  return formas.some((f) => mesmo(f, jid));
}

/** Autor da mensagem respondida (ou null). */
function autorCitado(ctx) {
  const k = ctx && ctx.quotedKey;
  if (!k || !k.id) return null;
  const p = canonico(k.participant);
  return p || null;
}

/**
 * Lista de alvos, sem repetição.
 * @param {object} ctx
 * @param {object} [opts]
 * @param {boolean} [opts.incluirBot=false] aceita o próprio bot como alvo
 * @param {boolean} [opts.incluirAutor=true] aceita quem mandou o comando
 * @param {boolean} [opts.numero=false] aceita número digitado nos args
 * @returns {{ jids: string[], origem: 'mencao'|'resposta'|'numero'|null }}
 */
function alvos(ctx, opts = {}) {
  const incluirBot = !!opts.incluirBot;
  const incluirAutor = opts.incluirAutor !== false;
  const ok = (j) => j && (incluirBot || !ehBot(ctx, j)) && (incluirAutor || !ehAutor(ctx, j));
  const unicos = (lista) => {
    const out = [];
    for (const j of lista) {
      const c = canonico(j);
      if (ok(c) && !out.includes(c)) out.push(c);
    }
    return out;
  };

  const mencoes = unicos((ctx && ctx.mentionedJid) || []);
  if (mencoes.length) return { jids: mencoes, origem: 'mencao' };

  const citado = unicos([autorCitado(ctx)].filter(Boolean));
  if (citado.length) return { jids: citado, origem: 'resposta' };

  if (opts.numero) {
    for (const a of (ctx && ctx.args) || []) {
      const raw = String(a).trim().replace(/^[<]?@+/, '').replace(/>$/, '');
      if (!/^\+?[\d\s().-]{8,}$/.test(raw)) continue;
      const j = unicos([toJid(raw)].filter(Boolean));
      if (j.length) return { jids: j, origem: 'numero' };
    }
  }
  return { jids: [], origem: null };
}

/** Primeiro alvo (ou null). Mesmas opções de `alvos`. */
function alvo(ctx, opts = {}) {
  return alvos(ctx, opts).jids[0] || null;
}

/**
 * Argumentos SEM os que identificam o alvo (tokens "@..." e o número usado
 * como alvo). Assim "!addmoney @fulano 100" e "!addmoney 100" respondendo a
 * mensagem do fulano deixam o valor na mesma posição: resto(ctx)[0] === '100'.
 */
function resto(ctx, opts = {}) {
  const args = ((ctx && ctx.args) || []).map(String);
  const r = alvos(ctx, opts);
  let numeroUsado = r.origem === 'numero';
  return args.filter((a) => {
    if (/^[<]?@/.test(a)) return false;
    if (numeroUsado) {
      const raw = a.replace(/^\+/, '');
      if (/^\+?[\d\s().-]{8,}$/.test(a) && r.jids[0] && r.jids[0].startsWith(raw.replace(/\D/g, ''))) {
        numeroUsado = false; // remove só a primeira ocorrência
        return false;
      }
    }
    return true;
  });
}

/** "@5511999999999" — texto da menção (o WhatsApp destaca quando vai em `mentions`). */
function marca(jid) {
  return '@' + String(canonico(jid) || jid || '').split('@')[0];
}

/** Dica padrão para quando não há alvo. */
function dica(prefixo, comando, extra = '') {
  const p = prefixo || '';
  return `⚠️ Marque a pessoa (${p}${comando} @usuario${extra}) ou *responda a mensagem dela* com ${p}${comando}${extra}.`;
}

module.exports = { canonico, mesmo, ehBot, ehAutor, autorCitado, alvos, alvo, resto, marca, dica };
