/**
 * connection/phoneParser.js — detecção, normalização e validação de números.
 *
 * Usa libphonenumber-js (mesma metadata do libphonenumber do Google):
 *  - identifica país pelo DDI (sem regras simplistas de quantidade de dígitos)
 *  - interpreta códigos regionais (DDD) de cada país corretamente
 *  - valida comprimento/possibilidade
 *  - formata para E.164 / internacional
 *
 * Funções: normalizePhoneNumber, parsePhoneNumber, validatePhoneNumber,
 * detectCountry, formatPhoneNumber, maskPhoneNumber, parseNational,
 * popularCountries, isSupportedCountry, countryName, countryFlag.
 */

'use strict';

const {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
} = require('libphonenumber-js');

/* ------------------------- nomes de países (pt-BR) -------------------- */

const FALLBACK_NAMES = {
  BR: 'Brasil', US: 'Estados Unidos', CA: 'Canadá', MX: 'México',
  PT: 'Portugal', GB: 'Reino Unido', JP: 'Japão', AR: 'Argentina',
  ES: 'Espanha', FR: 'França', DE: 'Alemanha', IT: 'Itália',
  CL: 'Chile', CO: 'Colômbia', PE: 'Peru', IN: 'Índia',
  ID: 'Indonésia', TR: 'Turquia', AT: 'Áustria', CH: 'Suíça',
  RS: 'Sérvia', XK: 'Kosovo', PK: 'Paquistão', NG: 'Nigéria',
  EG: 'Egito', ZA: 'África do Sul', NL: 'Holanda', AU: 'Austrália',
  NZ: 'Nova Zelândia', IE: 'Irlanda', FI: 'Finlândia', SE: 'Suécia',
  NO: 'Noruega', DK: 'Dinamarca', PL: 'Polônia', CZ: 'Rep. Tcheca',
  GR: 'Grécia', IL: 'Israel', AE: 'Emirados Árabes', SG: 'Singapura',
  TH: 'Tailândia', KR: 'Coreia do Sul', CN: 'China', HK: 'Hong Kong',
  TW: 'Taiwan', RU: 'Rússia', UA: 'Ucrânia', EC: 'Equador',
  GT: 'Guatemala', NP: 'Nepal',
};

let _displayNames;
function regionDisplayNames() {
  if (_displayNames === undefined) {
    try {
      _displayNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
    } catch (_) {
      _displayNames = null;
    }
  }
  return _displayNames;
}

/** Nome do país em pt-BR (Intl.DisplayNames com fallback). */
function countryName(iso) {
  const code = String(iso || '').toUpperCase();
  try {
    const dn = regionDisplayNames();
    if (dn) {
      const n = dn.of(code);
      if (n && n !== code) return n;
    }
  } catch (_) {
    /* ignora */
  }
  return FALLBACK_NAMES[code] || code;
}

/** Emoji de bandeira a partir do código ISO (ex.: 'BR' -> 🇧🇷). */
function countryFlag(iso) {
  return String(iso || '')
    .toUpperCase()
    .replace(/[A-Z]/g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/* --------------------------- normalização de JID --------------------- */

/**
 * Normaliza um JID do WhatsApp para comparação.
 *
 * Aceita: '5511999999999@s.whatsapp.net', '5511999999999:12@s.whatsapp.net',
 * '5511999999999', '+55 (11) 99999-9999', '@s.whatsapp.net' (com :device),
 * e grupos ('120363...@g.us').
 *
 * Remove o sufixo de dispositivo (:12) ANTES de extrair os dígitos — sem
 * isso, '5511999999999:12' viraria '551199999999912' (errado).
 *
 * @param {string} jid
 * @returns {{ digits: string, isGroup: boolean, raw: string }}
 */
function normalizeJid(jid) {
  const s = String(jid || '');
  const isGroup = s.endsWith('@g.us');
  const bare = s.split('@')[0] || s;
  const noDevice = bare.split(':')[0]; // remove ':device'
  const digits = noDevice.replace(/\D/g, '');
  return { digits, isGroup, raw: s };
}

/* ----------------------------- normalização -------------------------- */

/**
 * Remove formatação mantendo o "+" apenas durante o processamento.
 * "+1 (742) 369-1883" -> "+17423691883"
 * "17423691883"      -> "17423691883"
 */
function normalizePhoneNumber(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const hasPlus = s.includes('+');
  const digits = s.replace(/\D/g, '');
  return hasPlus ? '+' + digits : digits;
}

/* ------------------------------- parsing ----------------------------- */

function buildResult(pn) {
  return {
    valid: true,
    country: pn.country,
    countryName: countryName(pn.country),
    flag: countryFlag(pn.country),
    ddi: String(pn.countryCallingCode),
    nationalNumber: String(pn.nationalNumber),
    e164: pn.number,                        // '+5519999999999'
    digits: String(pn.number).slice(1),     // '5519999999999' (Baileys)
    international: pn.formatInternational(),
    national: pn.formatNational(),
    type: (typeof pn.getType === 'function' && pn.getType()) || null,
  };
}

/** Ordem de prioridade para exibir candidatos (países mais comuns primeiro). */
const PRIORITY = ['US', 'CA', 'BR', 'MX', 'PT', 'GB', 'AR', 'ES', 'JP', 'FR', 'DE', 'IT', 'CL', 'CO', 'PE', 'IN', 'ID'];

function sortCandidates(cands) {
  const rank = (c) => {
    const i = PRIORITY.indexOf(c);
    return i === -1 ? PRIORITY.length : i;
  };
  return cands.slice().sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Interpreta uma string de dígitos (sem "+") tentando TODOS os países.
 * Retorna parse válido se houver UMA única interpretação, ou lista de
 * candidatos se houver ambiguidade. Nunca "inventa" o país.
 */
function detectFromDigits(digits) {
  const candidates = [];
  const seen = new Set();
  for (const cc of getCountries()) {
    try {
      const pn = parsePhoneNumberFromString(digits, cc);
      if (pn && pn.isValid() && !seen.has(pn.country)) {
        seen.add(pn.country);
        candidates.push(pn.country);
      }
    } catch (_) {
      /* ignora */
    }
  }
  if (candidates.length === 0) {
    return { valid: false, reason: 'invalid', digits };
  }
  const ordered = sortCandidates(candidates);
  if (ordered.length === 1) {
    const pn = parsePhoneNumberFromString(digits, ordered[0]);
    return buildResult(pn);
  }
  return {
    valid: false,
    reason: 'ambiguous',
    digits,
    candidates: ordered.map((cc) => ({
      country: cc,
      name: countryName(cc),
      flag: countryFlag(cc),
      ddi: String(getCountryCallingCode(cc)),
    })),
  };
}

/**
 * Função principal de parsing.
 * @param {string} input número em qualquer formato comum
 * @param {string} [defaultCountry] código ISO usado quando não há "+"
 * @returns {object}
 *   válido: { valid:true, country, ddi, e164, digits, nationalNumber, ... }
 *   ambíguo: { valid:false, reason:'ambiguous', candidates, digits }
 *   inválido: { valid:false, reason:'invalid'|'empty' }
 */
function parsePhoneNumber(input, defaultCountry) {
  const normalized = normalizePhoneNumber(input);
  if (!normalized || !/\d/.test(normalized)) {
    return { valid: false, reason: 'empty' };
  }

  // com "+": número internacional explícito
  if (normalized.startsWith('+')) {
    const pn = parsePhoneNumberFromString(normalized, undefined);
    if (pn && pn.isValid()) return buildResult(pn);
    return { valid: false, reason: 'invalid' };
  }

  // sem "+": tenta o país padrão primeiro
  if (defaultCountry) {
    try {
      const pn = parsePhoneNumberFromString(normalized, String(defaultCountry).toUpperCase());
      if (pn && pn.isValid()) return buildResult(pn);
    } catch (_) {
      /* ignora */
    }
  }

  // sem país padrão (ou padrão não resolveu): detecção global
  return detectFromDigits(normalized);
}

/** Valida um número (mesmo resultado de parsePhoneNumber). */
function validatePhoneNumber(input, defaultCountry) {
  return parsePhoneNumber(input, defaultCountry);
}

/**
 * Detecta o país de um número.
 * @returns {{country,name,flag,ddi} | {ambiguous:true,candidates} | null}
 */
function detectCountry(input, defaultCountry) {
  const res = parsePhoneNumber(input, defaultCountry);
  if (res.valid) {
    return { country: res.country, name: res.countryName, flag: res.flag, ddi: res.ddi };
  }
  if (res.reason === 'ambiguous') {
    return { ambiguous: true, candidates: res.candidates };
  }
  return null;
}

/**
 * Formata um número.
 * @param {string} format 'e164' (padrão) | 'international' | 'national'
 */
function formatPhoneNumber(input, defaultCountry, format = 'e164') {
  const res = parsePhoneNumber(input, defaultCountry);
  if (!res.valid) return null;
  if (format === 'international') return res.international;
  if (format === 'national') return res.national;
  return res.e164;
}

/** Mascara o número para exibição segura: "+55 ********9999". */
function maskPhoneNumber(input, defaultCountry) {
  const res = parsePhoneNumber(input, defaultCountry);
  if (res.valid) {
    const last = res.nationalNumber.slice(-4);
    const stars = '*'.repeat(Math.max(4, res.nationalNumber.length - 4));
    return `+${res.ddi} ${stars}${last}`;
  }
  // fallback: mascara dígitos crus sem vazar o número
  const digits = normalizePhoneNumber(input).replace('+', '');
  if (!digits) return '****';
  return '*' + '*'.repeat(Math.max(0, digits.length - 4)) + digits.slice(-4);
}

/** Constrói um número a partir de país + número nacional (modo manual). */
function parseNational(countryCode, nationalInput) {
  const cc = String(countryCode || '').toUpperCase();
  if (!isSupportedCountry(cc)) return { valid: false, reason: 'invalid' };
  const digits = String(nationalInput || '').replace(/\D/g, '');
  const ddi = String(getCountryCallingCode(cc));
  return parsePhoneNumber('+' + ddi + digits);
}

/* --------------------------- catálogo de países ---------------------- */

const POPULAR = ['BR', 'US', 'PT', 'GB', 'JP', 'AR', 'ES', 'MX', 'FR', 'DE', 'IT'];

/** Lista de países populares para o modo manual. */
function popularCountries() {
  return POPULAR.map((cc) => ({
    country: cc,
    name: countryName(cc),
    flag: countryFlag(cc),
    ddi: String(getCountryCallingCode(cc)),
  }));
}

module.exports = {
  normalizePhoneNumber,
  parsePhoneNumber,
  validatePhoneNumber,
  detectCountry,
  formatPhoneNumber,
  maskPhoneNumber,
  parseNational,
  popularCountries,
  isSupportedCountry,
  countryName,
  countryFlag,
  normalizeJid,
};
