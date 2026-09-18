/**
 * utils/creatorProfile.js — identidade do criador/dono, editável por comando.
 *
 * FONTE ÚNICA DE VERDADE: os padrões deste arquivo (área editável) servem de
 * fallback; qualquer valor alterado por !setcriador fica no banco (tabela
 * settings, chave "creator.<campo>") e sobrevive a restart e a update.
 *
 * Quem consome: !criador (cartão rico), !owner (contato) e utils/consts.js
 * (selo). Nenhum deles guarda cópia própria dos dados.
 */

'use strict';

const settings = require('../database/settings');
const CONFIG = require('../config');

/* ══════════════════════════════════════════════════════════════════════════
   ✏️  PADRÕES — usados enquanto o dono não definir o campo por comando
   ══════════════════════════════════════════════════════════════════════════ */
const REPO_RAW = 'https://raw.githubusercontent.com/yanrpoliveira3108-bit/luas-bot-whats/main';

const DEFAULTS = {
  name: (CONFIG.owner && CONFIG.owner.name) || 'SEU NOME',
  developer: (CONFIG.bot && CONFIG.bot.author) || 'SEU NOME',
  about: ['desenvolvedor(a) do Lua Bot 🌙', 'Node.js + Baileys', 'disponível no suporte abaixo'],
  quote: 'Feito com café, código e um pouco de luar. 🌙',
  instagram: 'SEU_INSTAGRAM',
  instagramUrl: 'https://www.instagram.com/SEU_INSTAGRAM',
  tiktok: 'SEU_TIKTOK',
  tiktokUrl: 'https://www.tiktok.com/@SEU_TIKTOK',
  supportUrl: `https://wa.me/${((CONFIG.owner && CONFIG.owner.numbers) || ['5500000000000'])[0]}`,
  photoUrl: `${REPO_RAW}/assets/menu.jpg`,
  botPhotoUrl: `${REPO_RAW}/assets/menu.jpg`,
};
/* ══════════════════════════════════════════════════════ fim da área editável */

const KEY = (field) => `creator.${field}`;
const MAX_ABOUT_ITEMS = 6;

/** Campos aceitos por !setcriador, com regra de validação própria. */
const FIELDS = {
  name: { label: 'Nome do criador', max: 60, type: 'text' },
  developer: { label: 'Desenvolvedor', max: 60, type: 'text' },
  about: { label: 'Sobre (separe com |)', max: 400, type: 'about' },
  quote: { label: 'Frase do cartão', max: 160, type: 'text' },
  instagram: { label: 'Usuário do Instagram', max: 40, type: 'handle' },
  instagramUrl: { label: 'Link do Instagram', max: 200, type: 'url' },
  tiktok: { label: 'Usuário do TikTok', max: 40, type: 'handle' },
  tiktokUrl: { label: 'Link do TikTok', max: 200, type: 'url' },
  supportUrl: { label: 'Link de suporte/contato', max: 200, type: 'url' },
  photoUrl: { label: 'Foto do criador (URL)', max: 300, type: 'url' },
  botPhotoUrl: { label: 'Foto do bot no cartão (URL)', max: 300, type: 'url' },
};

/**
 * Acha o campo pelo nome digitado, ignorando caixa e separadores:
 * "supporturl", "support_url", "SUPPORT-URL" e "supportUrl" são o mesmo campo.
 */
function resolveField(input) {
  const raw = String(input == null ? '' : input).trim();
  if (Object.prototype.hasOwnProperty.call(FIELDS, raw)) return raw;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(raw);
  if (!target) return null;
  for (const field of Object.keys(FIELDS)) {
    if (norm(field) === target) return field;
  }
  return null;
}

function isUrl(value) {
  return /^https?:\/\/[^\s]+$/i.test(value) || /^wa\.me\/\d+$/i.test(value);
}

/** Valida e normaliza. Retorna {ok, value} ou {ok:false, error}. */
function validate(fieldInput, rawValue) {
  const field = resolveField(fieldInput) || fieldInput;
  const spec = FIELDS[field];
  if (!spec) return { ok: false, error: `Campo desconhecido: *${field}*` };

  const value = String(rawValue == null ? '' : rawValue).trim();
  if (!value) return { ok: false, error: `O campo *${field}* não pode ficar vazio.` };

  if (spec.type === 'about') {
    const items = value
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length < 1) return { ok: false, error: 'Informe pelo menos um item em *about*.' };
    if (items.length > MAX_ABOUT_ITEMS) {
      return { ok: false, error: `Máximo de ${MAX_ABOUT_ITEMS} itens em *about* (vieram ${items.length}).` };
    }
    const long = items.find((i) => i.length > 90);
    if (long) return { ok: false, error: `Item longo demais em *about*: “${long.slice(0, 30)}…” (máx. 90).` };
    return { ok: true, value: items };
  }

  if (value.length > spec.max) {
    return { ok: false, error: `*${field}* tem ${value.length} caracteres (máximo ${spec.max}).` };
  }
  if (spec.type === 'url' && !isUrl(value)) {
    return { ok: false, error: `*${field}* precisa ser um link http(s)://… (recebi “${value.slice(0, 30)}”).` };
  }
  if (spec.type === 'handle' && !/^@?[\w.]{2,40}$/.test(value)) {
    return { ok: false, error: `*${field}* parece inválido: use apenas letras, números, ponto e underline.` };
  }
  return { ok: true, value };
}

/** Valor efetivo de um campo (banco > padrão). */
function get(field) {
  if (field === 'about') {
    const raw = settings.get(KEY('about'), null);
    if (!raw) return DEFAULTS.about.slice();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed.map(String);
    } catch (_) {
      /* valor corrompido: volta ao padrão */
    }
    return DEFAULTS.about.slice();
  }
  const stored = settings.get(KEY(field), null);
  if (stored === null || stored === '') return DEFAULTS[field];
  return stored;
}

/** Todos os campos efetivos. */
function all() {
  const out = {};
  for (const field of Object.keys(FIELDS)) out[field] = get(field);
  return out;
}

/** Grava um campo. Retorna {ok} ou {ok:false, error}. */
function set(fieldInput, rawValue) {
  const field = resolveField(fieldInput) || fieldInput;
  const checked = validate(field, rawValue);
  if (!checked.ok) return checked;
  const stored = checked.value === null || typeof checked.value !== 'object'
    ? String(checked.value)
    : JSON.stringify(checked.value);
  settings.set(KEY(field), stored);
  return { ok: true, value: checked.value };
}

/** Volta ao padrão do arquivo (campo único ou todos). */
function reset(fieldInput) {
  if (fieldInput) {
    const field = resolveField(fieldInput);
    if (!field) return { ok: false, error: `Campo desconhecido: *${fieldInput}*` };
    settings.set(KEY(field), '');
    return { ok: true, field };
  }
  for (const f of Object.keys(FIELDS)) settings.set(KEY(f), '');
  return { ok: true, field: null };
}

/** Diz se o campo está vindo do banco (true) ou do padrão do arquivo (false). */
function isCustom(field) {
  const stored = settings.get(KEY(field), null);
  return stored !== null && stored !== '';
}

/* ------------------------------------------------------------- selo (card) */

/**
 * Selo usado no cartão: 'random' sorteia a cada envio; qualquer outro valor é o
 * nome fixo do selo (veja utils/consts.js → SEALS).
 */
function sealChoice() {
  return settings.get(KEY('seal'), 'lua');
}

function setSealChoice(name) {
  settings.set(KEY('seal'), String(name || 'lua').toLowerCase());
  return sealChoice();
}

module.exports = {
  DEFAULTS,
  FIELDS,
  REPO_RAW,
  get,
  all,
  set,
  reset,
  validate,
  resolveField,
  isCustom,
  sealChoice,
  setSealChoice,
};
