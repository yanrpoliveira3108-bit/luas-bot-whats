/**
 * utils/menuIdentity.js — dados do painel de identificação dos menus HTML.
 *
 * Quatro pessoas/contas DIFERENTES — nunca confundir:
 *   solicitante → quem pediu ESTE menu (nome do WhatsApp; sem nome, o número
 *                 verificado; LID/identificador interno nunca vira "telefone");
 *   prefixo     → o prefixo efetivo do chat (o mesmo do pipeline de comandos);
 *   dono        → o dono do BOT (CONFIG.owner.numbers[0], a mesma regra de
 *                 "dono principal" do !dono e do !report) — não é admin de grupo;
 *   bot         → a conta CONECTADA agora (sock.user da sessão autenticada),
 *                 não um número fixo de configuração.
 *
 * Consultado a cada menu gerado (reflete troca de prefixo, dono ou sessão).
 * Cada campo falha sozinho: um erro vira "não identificado", nunca derruba o
 * menu. Nada de sessão, token ou credencial sai daqui — só os 4 campos.
 * Os valores saem CRUS (sem HTML); quem escapa é o componente que desenha.
 */

'use strict';

const MAX_NOME = 40;

/** Remove controles/quebras e limita o tamanho (por caractere real). */
function limparNome(v) {
  const s = String(v || '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  const chars = Array.from(s);
  return chars.length > MAX_NOME ? chars.slice(0, MAX_NOME - 1).join('') + '…' : s;
}

/** Número de telefone legível a partir de dígitos verificados. */
function formatarTelefone(digitos) {
  const d = String(digitos || '').replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) return null;
  try {
    const r = require('../connection/phoneParser').parsePhoneNumber('+' + d);
    if (r && r.valid && r.international) return r.international;
  } catch (_) {
    /* sem libphonenumber: formato cru */
  }
  return '+' + d;
}

/** Dígitos de um JID de TELEFONE (PN). LID/grupo/outros → null. */
function digitosDePn(jid) {
  const s = String(jid || '');
  if (!/@(s\.whatsapp\.net|c\.us)$/.test(s)) return null;
  const d = s.split('@')[0].split(':')[0].replace(/\D/g, '');
  return d || null;
}

function solicitante(ctx) {
  try {
    const nomeMsg = limparNome(ctx && ctx.message && ctx.message.pushName);
    if (nomeMsg) return { texto: nomeMsg, tipo: 'nome' };
  } catch (_) {}
  try {
    const u = require('../database/users').get(ctx && ctx.sender);
    const nomeDb = limparNome(u && u.name);
    if (nomeDb) return { texto: nomeDb, tipo: 'nome' };
  } catch (_) {}
  // número só se alguma forma do remetente for PN (resolvida pelo pipeline)
  const formas = (ctx && (ctx.identidades && ctx.identidades.length ? ctx.identidades : [ctx.sender])) || [];
  for (const f of formas) {
    const tel = formatarTelefone(digitosDePn(f));
    if (tel) return { texto: tel, tipo: 'numero' };
  }
  return { texto: null, tipo: 'desconhecido' };
}

function dono() {
  try {
    const CONFIG = require('../config');
    const principal = (CONFIG.owner && CONFIG.owner.numbers && CONFIG.owner.numbers[0]) || '';
    return { texto: formatarTelefone(principal) };
  } catch (_) {
    return { texto: null };
  }
}

function contaConectada(ctx) {
  try {
    const u = (ctx && ctx.socket && ctx.socket.user) || {};
    const numero = formatarTelefone(digitosDePn(u.id));
    const nome = limparNome(u.name || u.verifiedName || u.notify);
    return { numero, nome: nome || null };
  } catch (_) {
    return { numero: null, nome: null };
  }
}

/**
 * Coleta os 4 campos. Nunca lança.
 * @returns {{solicitante:{texto:string|null,tipo:string}, prefixo:string, dono:{texto:string|null}, bot:{numero:string|null,nome:string|null}}}
 */
function coletar(ctx) {
  let prefixo = '';
  try {
    prefixo = require('./prefixReply').prefixoEfetivo(ctx);
  } catch (_) {
    prefixo = '';
  }
  return {
    solicitante: solicitante(ctx),
    prefixo,
    dono: dono(),
    bot: contaConectada(ctx),
  };
}

module.exports = { coletar, limparNome, formatarTelefone, digitosDePn, MAX_NOME };
