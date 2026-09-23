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

/**
 * Booleano OPCIONAL: devolve null quando a variável não existe no .env.
 * Usado pelos overrides de payload de risco — "não definido" precisa ser
 * diferente de "definido como false", senão um override herdado do modo
 * seguro impediria o !freio seguro on/off de funcionar em runtime.
 */
function envBoolOrNull(key) {
  const v = process.env[key];
  if (v === undefined || v === null || v === '') return null;
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

// MODO SEGURO — padrão DESLIGADO (o comportamento normal do bot: HTML, cards,
// menu por lista/botões e pagamento funcionam). NÃO existe prova de que esses
// payloads causem restrição: vários bots rodam com HTML/cards sem cair. O modo
// seguro fica disponível como opção (!freio seguro on) para quem quiser testar.
const SAFE_MODE_DEFAULT = envBool('SAFE_MODE', false);

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

  /* ------------- segurança de envio (anti-restrição de conta) -------------
   *
   * Contexto real: os números do dono caíram em "conta restrita" logo nos
   * primeiros comandos — inclusive com `!ping`, que é TEXTO PURO. Isso mostra
   * que o gatilho principal não é o tipo de mensagem: aponta para a própria
   * conta (número novo/alternativo recém-pareado num cliente não oficial).
   *
   * Por isso o padrão aqui é o comportamento NORMAL do bot: HTML, cards,
   * menu por lista/botões e pagamento liberados. O "modo seguro" continua
   * existindo como OPÇÃO (SAFE_MODE=1 ou `!freio seguro on`) para quem quiser
   * testar sem eles.
   *
   * O que fica ligado por padrão é o FREIO DE RITMO (utils/sendGuard.js), que
   * não muda conteúdo nenhum: fila, intervalo, teto por minuto, anti-rajada,
   * pausa automática ao ver sinal de restrição e bloqueio de PV frio.
   */
  safety: {
    // MODO SEGURO (padrão: DESLIGADO). Ligue para bloquear lista/botões
    // nativos, cards HTML e pagamento — assumindo que você aceita perder isso.
    // Em runtime: !freio seguro on|off (persistido no banco).
    safeMode: SAFE_MODE_DEFAULT,

    // Overrides explícitos (só mude se aceitar o risco: reativam payload de
    // alto risco, que é justamente o que gera restrição em minutos).
    // null = não definido no .env → a decisão segue o modo seguro (inclusive
    // quando ele é trocado em runtime com !freio seguro on/off).
    allowInteractive: envBoolOrNull('ALLOW_INTERACTIVE'),
    allowRichCards: envBoolOrNull('ALLOW_RICH_CARDS'),
    allowPaymentTest: envBoolOrNull('ALLOW_PAYMENT_TEST'),

    // Freio de envio: fila única, intervalo entre mensagens e teto por minuto.
    send: {
      // intervalo mínimo GLOBAL entre dois envios (ms)
      minIntervalMs: envInt('SEND_MIN_INTERVAL_MS', 1200),
      // intervalo mínimo por CONVERSA (ms) — evita rajada no mesmo grupo
      chatIntervalMs: envInt('SEND_CHAT_INTERVAL_MS', 2000),
      // variação aleatória somada ao intervalo (deixa o ritmo humano)
      jitterMs: envInt('SEND_JITTER_MS', 900),
      // teto global de mensagens por minuto
      maxPerMinute: envInt('SEND_MAX_PER_MINUTE', 15),
      // teto de mensagens por minuto na MESMA conversa
      chatMaxPerMinute: envInt('SEND_CHAT_MAX_PER_MINUTE', 6),
      // mídia (foto/vídeo/áudio/documento/sticker) espera mais
      mediaMultiplier: Math.max(1, envInt('SEND_MEDIA_MULTIPLIER', 2)),
      // número recém-pareado: limites mais duros nas primeiras horas
      warmupHours: envInt('SEND_WARMUP_HOURS', 48),
      warmupFactor: Math.max(1, envInt('SEND_WARMUP_FACTOR', 3)),
      // trava de mensagem IDÊNTICA repetida em vários chats (broadcast).
      // 0 = desligado (padrão): o !broadcast do dono passa normalmente, só
      // respeitando o ritmo do freio. Ative (ex.: 3) se quiser o bloqueio.
      dupMaxChats: envInt('SEND_DUP_MAX_CHATS', 0),
      dupWindowMin: envInt('SEND_DUP_WINDOW_MIN', 10),
      // nunca abrir conversa no privado com quem nunca falou com o bot.
      // Não muda nada no uso normal (o bot só responde, nunca inicia), mas
      // evita o cenário clássico de "mensagem fria em PV" em qualquer caminho
      // futuro. Use SEND_BLOCK_COLD_PV=0 para liberar.
      blockColdPv: envBool('SEND_BLOCK_COLD_PV', true),
      // pausa automática de TODOS os envios ao detectar sinal de restrição
      pauseMinutes: envInt('SEND_PAUSE_MINUTES', 15),
      // espera após (re)conectar antes do primeiro envio (ms)
      connectGraceMs: envInt('SEND_CONNECT_GRACE_MS', 8000),
      // teto de itens na fila por conversa (evita fila infinita)
      maxQueuePerChat: envInt('SEND_MAX_QUEUE_PER_CHAT', 15),
      // PVs liberados sempre (além do dono e de quem já falou com o bot)
      allowJids: envList('SEND_PV_ALLOW'),
      // onde fica o estado (contadores, chats conhecidos, warmup).
      // O caminho é configurável para os testes trabalharem isolados.
      stateDir: path.resolve(ROOT, envStr('SEND_STATE_DIR', './data')),
    },
  },

  /* ---------------- segurança e anti-ban (camada humana) ---------------- */
  security: {
    // MESMA chave do modo seguro de payloads (ver bloco `safety` acima).
    // ATENÇÃO: aqui NÃO se controla o ritmo — as proteções abaixo são
    // controladas por HUMAN_DELAYS / OUTBOUND_INTERVAL_MS / SILENT_PV.
    safeMode: SAFE_MODE_DEFAULT,
    // Simula presença humana ("digitando..." / "gravando áudio...") antes de responder
    humanDelays: envBool('HUMAN_DELAYS', true),
    minTypingDelayMs: envInt('MIN_TYPING_DELAY_MS', 600),
    maxTypingDelayMs: envInt('MAX_TYPING_DELAY_MS', 2200),
    // Intervalo mínimo entre mensagens no envio (evita rajadas no WebSocket)
    outboundIntervalMs: envInt('OUTBOUND_INTERVAL_MS', 1000),
    // Modo privado silencioso: não responde estranhos no PV com menus/erros (evita denúncias)
    silentPv: envBool('SILENT_PV', true),
    // Tipo de assinatura de navegador: windows | macos | ubuntu
    browserName: envStr('BROWSER_NAME', 'windows'),
    // Ficar online 24h contínuas (false = mais natural, não mantém online artificialmente)
    markOnline: envBool('MARK_ONLINE_ON_CONNECT', false),
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
    maxDownloadMB: envInt('DOWNLOAD_MAX_MB', envInt('MAX_DOWNLOAD_MB', 100)),
    downloadTimeoutMs: envInt('DOWNLOAD_TIMEOUT', 90000),
    maxUploadMB: envInt('MAX_UPLOAD_MB', 60),
    stickerMaxMB: envInt('STICKER_MAX_MB', 15),
    stickerMaxSeconds: envInt('STICKER_MAX_SECONDS', 10),
    defaultCooldownMs: envInt('DEFAULT_COOLDOWN_MS', 3000),
    maxArgsLength: 2000,
    evalEnabled: envBool('ENABLE_EVAL', false),
  },

  /* ------------------ stickers (pack/author ricos) ------------------ */
  sticker: {
    // Templates opcionais — deixe vazio para usar geração automática rica
    // Placeholders: {bot}, {creator}, {owner}, {dev}, {group}, {origin}, {date}
    packname: envStr('STICKER_PACKNAME', ''),
    author: envStr('STICKER_AUTHOR', ''),
    // Incluir data na bio? false = mais limpo, true = mostra data
    includeDate: envBool('STICKER_INCLUDE_DATE', false),
    // Ativa bio rica completa (criador, origem, bot, dono, dev)
    richBio: envBool('STICKER_RICH_BIO', true),
  },

  /* ------------------ downloaders (qualidade e velocidade) ------------------ */
  downloader: {
    // YouTube — qualidade de vídeo: best, 2160, 1440, 1080, 720, 480, 360
    // best = sem limite de altura, pega a maior disponível que couber no limite de MB
    ytVideoQuality: (() => {
      const v = envStr('YT_VIDEO_QUALITY', '720').toLowerCase();
      if (v === 'best' || v === 'max') return 'best';
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : 720;
    })(),
    // Áudio: best, 320k, 256k, 192k, 128k
    ytAudioQuality: envStr('YT_AUDIO_QUALITY', 'best').toLowerCase(),
    // Fragmentos concorrentes (yt-dlp) — 1 a 16, maior = mais rápido em DASH
    ytConcurrentFragments: Math.min(16, Math.max(1, envInt('YT_CONCURRENT_FRAGMENTS', 8))),
    // Qualidade de imagem: original, high, medium
    imageQuality: envStr('IMAGE_QUALITY', 'high').toLowerCase(),
    // Tentativas de download (retry)
    downloadRetries: Math.min(5, Math.max(0, envInt('DOWNLOAD_RETRIES', 3))),
    // Usar aria2c se disponível (ainda mais rápido)
    useAria2c: envBool('USE_ARIA2C', false),
    // Concorrência global de downloads
    maxConcurrentDownloads: Math.min(5, Math.max(1, envInt('MAX_CONCURRENT_DOWNLOADS', 3))),
    // Preferir yt-dlp sempre que disponível (mais rápido e estável que ytdl-core)
    preferYtdlp: envBool('PREFER_YTDLP', true),
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
    CONFIG.safety.send.stateDir,
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
