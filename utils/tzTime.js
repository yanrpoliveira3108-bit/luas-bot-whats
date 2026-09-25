/**
 * utils/tzTime.js — calendário em um fuso IANA, sem depender do fuso do servidor.
 *
 * Por que existe: agendamentos diários ("abrir às 06:00") precisam ser
 * calculados na DATA e HORA LOCAIS do fuso do bot (CONFIG.bot.timezone), e não
 * somando 24h nem usando um deslocamento fixo de UTC. Tudo aqui usa só
 * `Intl.DateTimeFormat` (nativo do Node) para descobrir o deslocamento real de
 * cada instante — por isso mudanças de horário de verão são respeitadas.
 *
 * Regras de horário "impossível" (mudança de offset):
 *   - lacuna (o relógio pula, a hora local não existe): usa o primeiro instante
 *     válido depois do salto (comportamento "compatible" do Temporal);
 *   - sobreposição (a hora local acontece duas vezes): usa a PRIMEIRA.
 *
 * Todas as funções recebem/devolvem milissegundos (epoch) — o chamador passa o
 * "agora", o que permite testar com relógio controlado.
 */

'use strict';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const fmtCache = new Map();

/** Fuso efetivo do bot (config centralizada; padrão America/Sao_Paulo). */
function botTimezone() {
  try {
    const tz = require('../config').bot.timezone;
    if (isValidTimezone(tz)) return tz;
  } catch (_) {
    /* config indisponível: padrão */
  }
  return DEFAULT_TIMEZONE;
}

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Data/hora locais de um instante no fuso. */
function partsIn(ms, tz) {
  const out = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0; // defesa para motores antigos
  return { y: out.year, m: out.month, d: out.day, hh: out.hour, mm: out.minute, ss: out.second };
}

/** Deslocamento (minutos, local − UTC) do fuso naquele instante. */
function offsetMinutes(ms, tz) {
  const p = partsIn(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Soma dias de CALENDÁRIO a uma data local (sem horas envolvidas). */
function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/**
 * Instante (ms) em que o relógio local do fuso marca y-m-d hh:mm.
 * Trata lacunas e sobreposições (ver cabeçalho).
 */
function zonedToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const o1 = offsetMinutes(guess, tz);
  const c1 = guess - o1 * 60000;
  const o2 = offsetMinutes(c1, tz);
  const c2 = guess - o2 * 60000;
  const candidatos = [...new Set([c1, c2, guess - offsetMinutes(c2, tz) * 60000])];
  const confere = candidatos.filter((c) => {
    const p = partsIn(c, tz);
    return p.y === y && p.m === m && p.d === d && p.hh === hh && p.mm === mm;
  });
  if (confere.length) return Math.min(...confere);
  // lacuna: a hora não existe — primeiro instante válido depois do salto
  return Math.max(...candidatos);
}

/** "HH:MM" → { hh, mm } ou null. Aceita só 00:00–23:59 com dois dígitos. */
function parseHHMM(txt) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(txt || '').trim());
  if (!m) return null;
  return { hh: Number(m[1]), mm: Number(m[2]) };
}

/** Próxima ocorrência de HH:MM ESTRITAMENTE depois de `fromMs`. */
function nextOccurrence(hhmm, tz, fromMs) {
  const h = parseHHMM(hhmm);
  if (!h) return null;
  const p = partsIn(fromMs, tz);
  for (let i = 0; i <= 3; i++) {
    const dia = addDays(p.y, p.m, p.d, i);
    const t = zonedToUtc(dia.y, dia.m, dia.d, h.hh, h.mm, tz);
    if (t > fromMs) return t;
  }
  return null;
}

/** Última ocorrência de HH:MM em ou antes de `atMs`. */
function lastOccurrence(hhmm, tz, atMs) {
  const h = parseHHMM(hhmm);
  if (!h) return null;
  const p = partsIn(atMs, tz);
  for (let i = 0; i >= -3; i--) {
    const dia = addDays(p.y, p.m, p.d, i);
    const t = zonedToUtc(dia.y, dia.m, dia.d, h.hh, h.mm, tz);
    if (t <= atMs) return t;
  }
  return null;
}

/**
 * Estado que o grupo DEVERIA ter no instante `atMs`: vence o evento mais
 * recente (abertura ou fechamento). Funciona igual para intervalos que
 * atravessam a meia-noite (abrir 20:00 / fechar 06:00).
 * @returns {'open'|'closed'|null}
 */
function expectedState(openHHMM, closeHHMM, tz, atMs) {
  const lo = lastOccurrence(openHHMM, tz, atMs);
  const lc = lastOccurrence(closeHHMM, tz, atMs);
  if (lo === null || lc === null) return null;
  return lo > lc ? 'open' : 'closed';
}

/** Rótulo do deslocamento: "UTC−03:00". */
function offsetLabel(ms, tz) {
  const off = offsetMinutes(ms, tz);
  const sinal = off < 0 ? '−' : '+';
  const a = Math.abs(off);
  return `UTC${sinal}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** "sex., 26/09/2026 00:00" no fuso (sem ambiguidade de data). */
function formatLocal(ms, tz) {
  const p = partsIn(ms, tz);
  let semana = '';
  try {
    semana = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'short' }).format(new Date(ms));
  } catch (_) {
    semana = '';
  }
  const dd = String(p.d).padStart(2, '0');
  const mo = String(p.m).padStart(2, '0');
  const hh = String(p.hh).padStart(2, '0');
  const mi = String(p.mm).padStart(2, '0');
  return `${semana ? semana + ' ' : ''}${dd}/${mo}/${p.y} ${hh}:${mi}`;
}

module.exports = {
  DEFAULT_TIMEZONE,
  botTimezone,
  isValidTimezone,
  partsIn,
  offsetMinutes,
  addDays,
  zonedToUtc,
  parseHHMM,
  nextOccurrence,
  lastOccurrence,
  expectedState,
  offsetLabel,
  formatLocal,
};
