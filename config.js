/**
 * config.js — Configuração central do Lua.
 *
 * Tudo que é sensível fica no .env (carregado via dotenv).
 * Este arquivo expõe um objeto CONFIG congelado, usado pelo resto do bot.
 */

'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config();

const ROOT = __dirname;

// phoneParser é puro (libphonenumber-js) e não depende do config — sem ciclo.
const phoneParser = require('./connection/phoneParser');

/* ------------------------- helpers ------------------------- */

function envStr(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === null || v === '' ? fallback : String(v).trim();
}

function envInt(key, fallback) {
  const n = parseInt(process.env[key], 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function envList(key) {
  const raw = process.env[key] || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Versão do protocolo do WhatsApp (WA_VERSION no .env), no formato
 * "2,3000,1043857760" (igual ao baileys-version.json). Retorna null se
 * não definida/inválida — nesse caso o bot usa fetchLatestBaileysVersion.
 */
function envVersion(key) {
  const raw = envStr(key, '');
  if (!raw) return null;
  const parts = raw.split(',').map((s) => parseInt(s.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * Prefixo de comando do bot.
 *
 * ⚠️ IMPORTANTE: em Termux a variável de ambiente PREFIX JÁ EXISTE e aponta
 * para o diretório de instalação (/data/data/com.termux/files/usr). Como o
 * dotenv NÃO sobrescreve variáveis já definidas, usar PREFIX direto fazia o
 * bot adotar esse caminho como prefixo — e NENHUM comando respondia.
 *
 * Solução: preferir BOT_PREFIX (novo), e aceitar o PREFIX legado apenas
 * quando ele não for um caminho de arquivo (ou seja, não for o do Termux).
 */
function botPrefix() {
  const custom = envStr('BOT_PREFIX', '');
  if (custom) return custom;
  const legacy = typeof process.env.PREFIX === 'string' ? process.env.PREFIX.trim() : '';
  if (legacy && !legacy.includes('/') && legacy.length <= 10) return legacy;
  return '!';
}

/* --------------------------- config ------------------------ */

const CONFIG = {
  bot: {
    name: envStr('BOT_NAME', 'Lua'),
    version: envStr('BOT_VERSION', '1.0.0'),
    author: envStr('AUTHOR_NAME', 'Lua Dev'),
    prefix: botPrefix(),
    language: envStr('LANGUAGE', 'pt-BR'),
    startedAt: Date.now(),
  },

  owner: {
    // lista de números (somente dígitos) com acesso de dono.
    // Aceita OWNER_NUMBER, OWNER_NUMBERS (vírgula) e OWNER_JID — todos
    // opcionais e combinados (dono múltiplo), normalizados via phoneParser.
    numbers: (() => {
      const set = new Set();
      for (const n of [...envList('OWNER_NUMBER'), ...envList('OWNER_NUMBERS'), ...envList('OWNER_JID')]) {
        const d = onlyDigits(n);
        if (d) set.add(d);
      }
      return [...set];
    })(),
    name: envStr('OWNER_NAME', 'Dono'),
    // número usado para o pairing code (opcional)
    pairingNumber: envStr('PAIRING_NUMBER', ''),
    // país padrão (ISO 2 letras) para números sem DDI explícito
    defaultCountry: envStr('DEFAULT_COUNTRY', 'BR'),
  },

  mode: {
    private: envBool('PRIVATE_MODE', false),
  },

  interactive: {
    // Botões interativos (menu por botões). Padrão do .env; em runtime pode
    // ser alterado com !botao on/off (persistido no banco).
    buttonsEnabled: envBool('BUTTONS_ENABLED', true),
  },

  /* ------------------ interface / identidade visual ------------------ */
  ui: {
    // Preset de tema (config/themes.js). Ex.: LUA_NIGHT, LUA_VIOLET, ...
    // Em runtime pode ser trocado com !tema <preset> (dono; persistido).
    theme: envStr('LUA_THEME', 'LUA_NIGHT'),
    // Modo de menu: 'text' | 'buttons' | 'auto' (auto = decide pelo suporte).
    uiMode: (envStr('LUA_UI_MODE', 'auto') || 'auto').toLowerCase(),
    // Proteção global contra flood de mensagens.
    antiFlood: envBool('ANTI_FLOOD', true),
    // Cache em memória (metadados, fotos, configs).
    cache: envBool('LUA_CACHE', true),
    // Log de debug extra (não expõe credenciais).
    debug: envBool('DEBUG', false),
    // Tagline exibida de forma discreta em menus/painéis.
    footerTagline: '☾ LUA • Beyond the ordinary.',
  },

  /* ------------------ métricas internas ----------------------------- */
  performance: {
    metricsEnabled: envBool('LUA_METRICS', true),
  },

  /* ------------------ menus (hierarquia + imagem) ------------------- */
  menu: {
    // Imagens de cabeçalho dos menus. Cada chave específica cai no fallback
    // MENU_IMAGE; se nenhuma existir, o menu é enviado sem imagem.
    images: {
      main: path.resolve(ROOT, envStr('MENU_IMAGE', './assets/menu.jpg')),
      admin: path.resolve(ROOT, envStr('MENU_IMAGE_ADMIN', envStr('MENU_IMAGE', './assets/menu.jpg'))),
      sticker: path.resolve(ROOT, envStr('MENU_IMAGE_STICKER', envStr('MENU_IMAGE', './assets/menu.jpg'))),
      life: path.resolve(ROOT, envStr('MENU_IMAGE_RPG', envStr('MENU_IMAGE', './assets/menu.jpg'))),
      download: path.resolve(ROOT, envStr('MENU_IMAGE_DOWNLOAD', envStr('MENU_IMAGE', './assets/menu.jpg'))),
      profile: path.resolve(ROOT, envStr('MENU_IMAGE_PROFILE', envStr('MENU_IMAGE', './assets/menu.jpg'))),
    },
  },

  /* ------------------ "ler mais" (read more) ------------------------ */
  readmore: {
    enabled: envBool('LUA_READMORE', true),
    minLength: 400, // só aplica em textos maiores que isto
    marker: '\u200e',
    repeat: 4000,
  },

  /* ------------------ Lua Life (simulador de vida) ------------------ */
  life: {
    // moeda virtual — usada também pelo RPG existente (carteira/banco)
    currency: {
      symbol: envStr('LUA_COIN_SYMBOL', 'LC'),
      emoji: envStr('LUA_COIN_EMOJI', '🪙'),
    },
    // criação do personagem
    start: {
      money: envInt('LUA_START_MONEY', 1000),
      energy: envInt('LUA_START_ENERGY', 100),
      energyMax: envInt('LUA_ENERGY_MAX', 200),
    },
    // economia (limites anti-exploit)
    limits: {
      dailyBase: envInt('LUA_DAILY_BASE', 250),
      dailyMax: envInt('LUA_DAILY_MAX', 500),
      dailyStreakMax: envInt('LUA_DAILY_STREAK_MAX', 7),
      lotteryMaxStake: envInt('LUA_LOTTERY_MAX', 500),
      lotteryMultiplier: 7,
      maxItemQuantity: 99999,
    },
  },

  /* ---------------- Welcome / Goodbye (cards visuais) ---------------- */
  welcome: {
    // identidade visual dos cards (tema único: roxo + lua + neon)
    theme: envStr('WELCOME_THEME', 'purple-moon'),
    botName: envStr('WELCOME_BOTNAME', envStr('BOT_NAME', 'LUA BOT')),
    width: envInt('WELCOME_WIDTH', 1280),
    height: envInt('WELCOME_HEIGHT', 720),
    // padrões globais (o on/off real é por grupo, via !welcome/!goodbye)
    mentionUser: envBool('WELCOME_MENTION', true),
    randomTemplate: envBool('WELCOME_RANDOM', true),
    // cache de foto de perfil (ms)
    photoTtlMs: envInt('WELCOME_PHOTO_TTL', 10 * 60 * 1000),
  },

  paths: {
    root: ROOT,
    sessionDir: path.resolve(ROOT, envStr('SESSION_DIR', './session')),
    databaseFile: path.resolve(ROOT, envStr('DATABASE_FILE', './database/lua.db')),
    databaseDir: path.resolve(ROOT, path.dirname(envStr('DATABASE_FILE', './database/lua.db'))),
    menuImage: path.resolve(ROOT, envStr('MENU_IMAGE', './assets/menu.jpg')),
    assetsDir: path.resolve(ROOT, 'assets'),
    tmpDir: path.resolve(ROOT, 'tmp'),
    logsDir: path.resolve(ROOT, 'logs'),
    backupDir: path.resolve(ROOT, 'backup'),
  },

  // versão do protocolo do WhatsApp. Se WA_VERSION estiver no .env
  // (ex.: "2,3000,1043857760"), o bot usa ela direto — evita o erro 405
  // ("client outdated") quando o WhatsApp sobe a versão. Se não definida,
  // usa fetchLatestBaileysVersion (que agora consulta o repositório oficial).
  waVersion: envVersion('WA_VERSION'),

  limits: {
    maxDownloadMB: envInt('DOWNLOAD_MAX_MB', envInt('MAX_DOWNLOAD_MB', 50)),
    downloadTimeoutMs: envInt('DOWNLOAD_TIMEOUT', 60000),
    maxUploadMB: envInt('MAX_UPLOAD_MB', 60),
    stickerMaxMB: envInt('STICKER_MAX_MB', 15),
    stickerMaxSeconds: envInt('STICKER_MAX_SECONDS', 10),
    defaultCooldownMs: envInt('DEFAULT_COOLDOWN_MS', 3000),
    maxArgsLength: 2000,
    evalEnabled: envBool('ENABLE_EVAL', false),
  },

  external: {
    openweatherKey: envStr('OPENWEATHER_API_KEY', ''),
    // serviços públicos usados pelos downloaders/adapters
    jikan: 'https://api.jikan.moe/v4',
    tikwm: 'https://www.tikwm.com/api/',
    viacep: 'https://viacep.com.br/ws',
    brasilApi: 'https://brasilapi.com.br/api',
    // emojis (sticker de emoji) e extração de mídia (Twitter/Reddit)
    twemoji: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72',
    fxtwitter: 'https://api.fxtwitter.com',
    reddit: 'https://www.reddit.com',
  },

  /* ------------------ IA (assistente) ----------------------------- */
  ai: {
    // provider ativo: 'auto' tenta API externa e cai no local; 'local' força o
    // assistente embutido (offline); 'api' exige API externa configurada.
    provider: envStr('AI_PROVIDER', 'auto'),
    // API externa compatível com OpenAI (chat/completions). Deixe em branco
    // para usar apenas o assistente local (offline).
    apiUrl: envStr('AI_API_URL', ''), // ex.: https://api.openai.com/v1/chat/completions
    apiKey: envStr('AI_API_KEY', ''),
    model: envStr('AI_MODEL', 'gpt-4o-mini'),
    systemPrompt: envStr('AI_SYSTEM_PROMPT', ''),
    memory: envBool('AI_MEMORY', true),
    maxInput: envInt('AI_MAX_INPUT', 500),
    maxHistory: envInt('AI_HISTORY', 8),
    timeoutMs: envInt('AI_TIMEOUT', 45000),
    cooldownMs: envInt('AI_COOLDOWN', 6000),
  },

  logging: {
    level: envStr('LOG_LEVEL', 'info'),
    toFile: envBool('LOG_TO_FILE', true),
  },

  /* ------------------ mensagens (pt-BR) -------------------- */
  messages: {
    deniedOwner: '🚫 Apenas o dono do bot pode usar este comando.',
    deniedAdmin: '🚫 Apenas administradores do grupo podem usar este comando.',
    deniedMember: '🚫 Você não tem permissão para usar este comando.',
    groupOnly: '👥 Este comando só funciona em grupos.',
    privateOnly: '🔒 Este comando só funciona no privado.',
    botNotAdmin: '⚠️ Eu preciso ser administrador do grupo para fazer isso.',
    notRegistered: '🔒 Modo privado ativo. Peça ao dono para liberar seu acesso.',
    cooldown: '⏳ Aguarde {time} antes de usar este comando novamente.',
    commandNotFound: '❌ Comando não encontrado. Digite {prefix}menu para ver os comandos.',
    error: '😕 Ops! Ocorreu um erro ao executar este comando. Tente novamente.',
    downloadError: '📥 Não consegui baixar. O link pode estar inválido ou o serviço indisponível.',
    fileTooBig: '📦 Arquivo muito grande (limite: {limit} MB).',
    needMedia: '🖼️ Envie ou marque uma imagem/vídeo com este comando.',
    onlyGroupAdmin: '👑 Você precisa ser admin do grupo.',
    processing: '⏳ Processando...',
    welcome: 'Bem-vindo(a), {user}! 🎉',
    goodbye: '{user} saiu do grupo. 👋',
  },
};

/* --------------------- helpers exportados ------------------- */

/**
 * Verifica se um JID pertence ao dono do bot.
 *
 * Normaliza tanto o JID quanto cada OWNER_NUMBER (aceita formatos como
 * "+55 (11) 99999-9999", "5511999999999", "5511999999999@s.whatsapp.net"
 * e JIDs com sufixo de dispositivo ":12") e compara os dígitos.
 *
 * @param {string} jid ex.: "5511999999999@s.whatsapp.net"
 */
function isOwnerNumber(jid) {
  const norm = phoneParser.normalizeJid(jid);
  if (!norm.digits) return false;
  return CONFIG.owner.numbers.some((n) => {
    const o = phoneParser.normalizeJid(n);
    const od = o.digits;
    if (!od) return false;
    if (norm.digits === od) return true;
    // dono configurado sem DDI (apenas número nacional): o número completo
    // termina com o do dono (ex.: dono "19999999999" casa "5519999999999")
    if (od.length >= 10 && norm.digits.endsWith(od)) return true;
    return false;
  });
}

/** Normaliza um número para o formato com DDI usado no pairing. */
function normalizePairingNumber(raw) {
  const d = onlyDigits(raw);
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

function getPrefix() {
  return CONFIG.bot.prefix;
}

function ensureDirs() {
  [
    CONFIG.paths.sessionDir,
    CONFIG.paths.databaseDir,
    CONFIG.paths.tmpDir,
    CONFIG.paths.logsDir,
    CONFIG.paths.backupDir,
    CONFIG.paths.assetsDir,
  ].forEach((d) => fs.mkdirSync(d, { recursive: true }));
}

module.exports = CONFIG;
module.exports.helpers = {
  isOwnerNumber,
  normalizePairingNumber,
  getPrefix,
  ensureDirs,
  onlyDigits,
};
