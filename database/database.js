/**
 * database/database.js — núcleo do banco (SQLite via better-sqlite3).
 *
 * - migrações versionadas
 * - seed de itens da loja e perguntas do quiz
 * - helpers de prepared statements
 * - backup
 *
 * A camada de domínio (users/groups/economy/rpg) é escrita em cima de
 * prepared statements simples, facilitando futura migração para PostgreSQL.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const CONFIG = require('../config');
const logger = require('../utils/logger').child('db');

let db = null;
const prepared = new Map();

/* --------------------------- migrations --------------------------- */

const MIGRATIONS = [
  // 1 — usuários
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    is_registered INTEGER DEFAULT 1,
    messages INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    reputation INTEGER DEFAULT 0,
    karma INTEGER DEFAULT 0,
    afk INTEGER DEFAULT 0,
    afk_reason TEXT DEFAULT '',
    about TEXT DEFAULT '',
    first_seen TEXT DEFAULT '',
    last_seen TEXT DEFAULT ''
  );`,

  // 2 — grupos
  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    welcome_enabled INTEGER DEFAULT 0,
    welcome_msg TEXT DEFAULT '',
    goodbye_enabled INTEGER DEFAULT 0,
    goodbye_msg TEXT DEFAULT '',
    settings TEXT DEFAULT '{}'
  );`,

  // 3 — membros de grupo
  `CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT DEFAULT '',
    message_count INTEGER DEFAULT 0,
    last_seen TEXT DEFAULT '',
    UNIQUE(group_id, user_id)
  );`,

  // 4 — advertências
  `CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT DEFAULT '',
    admin_id TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  );`,

  // 5 — economia (carteira + banco)
  `CREATE TABLE IF NOT EXISTS economy (
    user_id TEXT PRIMARY KEY,
    wallet INTEGER DEFAULT 0,
    bank INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0
  );`,

  // 6 — transações
  `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT DEFAULT '',
    amount INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  );`,

  // 7 — inventário
  `CREATE TABLE IF NOT EXISTS inventory (
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER DEFAULT 0,
    UNIQUE(user_id, item_id)
  );`,

  // 8 — jogadores do RPG
  `CREATE TABLE IF NOT EXISTS rpg_players (
    user_id TEXT PRIMARY KEY,
    profession TEXT DEFAULT '',
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    energy INTEGER DEFAULT 100,
    reputation INTEGER DEFAULT 0,
    achievements TEXT DEFAULT '[]'
  );`,

  // 9 — itens da loja
  `CREATE TABLE IF NOT EXISTS rpg_items (
    id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    type TEXT DEFAULT 'item',
    price INTEGER DEFAULT 0,
    sell_price INTEGER DEFAULT 0,
    emoji TEXT DEFAULT '📦',
    description TEXT DEFAULT ''
  );`,

  // 10 — fazendas
  `CREATE TABLE IF NOT EXISTS farms (
    user_id TEXT PRIMARY KEY,
    name TEXT DEFAULT 'Fazenda',
    level INTEGER DEFAULT 1
  );`,

  // 11 — plantações
  `CREATE TABLE IF NOT EXISTS plantations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    crop TEXT NOT NULL,
    planted_at TEXT DEFAULT '',
    watered_at TEXT DEFAULT '',
    ready_at TEXT DEFAULT '',
    harvested INTEGER DEFAULT 0
  );`,

  // 12 — animais
  `CREATE TABLE IF NOT EXISTS animals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT DEFAULT '',
    fed_at TEXT DEFAULT '',
    born_at TEXT DEFAULT '',
    sold INTEGER DEFAULT 0
  );`,

  // 13 — cooldowns persistentes (recompensas diárias, empregos etc.)
  `CREATE TABLE IF NOT EXISTS cooldowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    command TEXT NOT NULL,
    expires_at TEXT DEFAULT '',
    UNIQUE(scope, key, command)
  );`,

  // 14 — configurações do bot (prefixo, plugins etc.)
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );`,

  // 15 — registro de eventos administrativos (X9)
  `CREATE TABLE IF NOT EXISTS group_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    actor_id TEXT DEFAULT '',
    type TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  );`,

  // 16 — usuários bloqueados
  `CREATE TABLE IF NOT EXISTS blocked (
    user_id TEXT PRIMARY KEY,
    reason TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  );`,

  // 17 — estatísticas de jogos
  `CREATE TABLE IF NOT EXISTS game_stats (
    user_id TEXT NOT NULL,
    game TEXT NOT NULL,
    plays INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    UNIQUE(user_id, game)
  );`,

  // 18 — banco de perguntas do quiz
  `CREATE TABLE IF NOT EXISTS quiz_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    answer_index INTEGER NOT NULL
  );`,

  // 19 — pontuação do quiz
  `CREATE TABLE IF NOT EXISTS quiz_scores (
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    correct INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    UNIQUE(user_id, category)
  );`,

  // 20 — índice único para evitar perguntas duplicadas
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_unique ON quiz_questions(category, question);`,

  // 21 — jogadores do Lua Life (identidade + vitais + atributos + XP/carreira)
  `CREATE TABLE IF NOT EXISTS life_players (
    user_id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    age INTEGER DEFAULT 18,
    city TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    energy INTEGER DEFAULT 100,
    health INTEGER DEFAULT 100,
    hunger INTEGER DEFAULT 100,
    happiness INTEGER DEFAULT 100,
    knowledge INTEGER DEFAULT 1,
    efficiency INTEGER DEFAULT 1,
    luck INTEGER DEFAULT 1,
    reputation INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    career_xp INTEGER DEFAULT 0,
    career_level INTEGER DEFAULT 1,
    last_activity TEXT DEFAULT ''
  );`,

  // 22 — propriedades (casas, terrenos, galinheiros, estábulos, veículos, comércios)
  `CREATE TABLE IF NOT EXISTS life_properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    spec TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    bought_at TEXT DEFAULT '',
    UNIQUE(user_id, kind, spec)
  );`,

  // 23 — empresas
  `CREATE TABLE IF NOT EXISTS life_businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT DEFAULT '',
    level INTEGER DEFAULT 1,
    employees INTEGER DEFAULT 0,
    last_collect_at TEXT DEFAULT ''
  );`,

  // 24 — funcionários (NPCs)
  `CREATE TABLE IF NOT EXISTS life_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    hired_at TEXT DEFAULT ''
  );`,

  // 25 — ofertas do mercado entre jogadores
  `CREATE TABLE IF NOT EXISTS life_market (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    buyer_id TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  );`,

  // 26 — missões
  `CREATE TABLE IF NOT EXISTS life_missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    expires_at TEXT DEFAULT ''
  );`,

  // 27 — conquistas
  `CREATE TABLE IF NOT EXISTS life_achievements (
    user_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at TEXT DEFAULT '',
    PRIMARY KEY(user_id, achievement_id)
  );`,

  // 28 — presente diário (sequência/streak)
  `CREATE TABLE IF NOT EXISTS life_daily (
    user_id TEXT PRIMARY KEY,
    streak INTEGER DEFAULT 0,
    last_claim TEXT DEFAULT '',
    total_claims INTEGER DEFAULT 0
  );`,

  // 29 — durabilidade de ferramentas (mineração/pesca)
  `CREATE TABLE IF NOT EXISTS life_tools (
    user_id TEXT NOT NULL,
    tool_id TEXT NOT NULL,
    uses_left INTEGER DEFAULT 0,
    PRIMARY KEY(user_id, tool_id)
  );`,

  // 30 — logs econômicos (auditoria anti-exploit)
  `CREATE TABLE IF NOT EXISTS economy_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT DEFAULT '',
    item TEXT DEFAULT '',
    amount INTEGER DEFAULT 0,
    balance_before INTEGER DEFAULT 0,
    balance_after INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  );`,

  // 20 — carteira de criptomoedas
  `CREATE TABLE IF NOT EXISTS crypto_wallet (
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    amount REAL DEFAULT 0,
    total_cost INTEGER DEFAULT 0,
    UNIQUE(user_id, symbol)
  );`,

  // 21 — investimentos (fundo com rendimento variável)
  `CREATE TABLE IF NOT EXISTS investments (
    user_id TEXT PRIMARY KEY,
    invested INTEGER DEFAULT 0,
    invested_at TEXT DEFAULT ''
  );`,

  // 22 — LUA TIGRINHO (minigame arcade de fichas virtuais)
  `CREATE TABLE IF NOT EXISTS tigrinho_players (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 1000,
    spins INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    jackpots INTEGER NOT NULL DEFAULT 0,
    best_win INTEGER NOT NULL DEFAULT 0,
    last_spin_at INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS tigrinho_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    reels TEXT NOT NULL,
    bet INTEGER NOT NULL DEFAULT 0,
    reward INTEGER NOT NULL DEFAULT 0,
    jackpot INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_tigrinho_history_user ON tigrinho_history(user_id);`,

  // 23 — Welcome/Goodbye visual (cards): estado por grupo + eventos (fake IDs)
  `CREATE TABLE IF NOT EXISTS welcome_state (
    group_id TEXT PRIMARY KEY,
    welcome_enabled INTEGER NOT NULL DEFAULT 0,
    welcome_random INTEGER NOT NULL DEFAULT 1,
    welcome_mention INTEGER NOT NULL DEFAULT 1,
    goodbye_enabled INTEGER NOT NULL DEFAULT 0,
    goodbye_random INTEGER NOT NULL DEFAULT 1,
    last_welcome_template TEXT DEFAULT '',
    last_goodbye_template TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS welcome_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    fake_id TEXT NOT NULL,
    template TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_welcome_events_group ON welcome_events(group_id);`,

  // 40 — aniversários (AutoBot: !aniversario)
  `CREATE TABLE IF NOT EXISTS birthdays (
    user_id TEXT PRIMARY KEY,
    day INTEGER NOT NULL,
    month INTEGER NOT NULL,
    created_at TEXT DEFAULT '',
    last_announced TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_birthdays_day_month ON birthdays(day, month);`,
];

/* ----------------------------- core ------------------------------ */

function get() {
  if (!db) throw new Error('Banco de dados não inicializado. Chame database.open() primeiro.');
  return db;
}

function prepare(name, sql) {
  // chave = nome + SQL: permite reutilizar nomes com SQL diferentes
  const key = `${name}::${sql}`;
  if (!prepared.has(key)) prepared.set(key, get().prepare(sql));
  return prepared.get(key);
}

function open() {
  if (db) return db;
  CONFIG.helpers.ensureDirs();
  db = new Database(CONFIG.paths.databaseFile);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  migrate();
  seed();
  logger.info({ file: CONFIG.paths.databaseFile }, 'banco aberto');
  return db;
}

function migrate() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT ''
    );`
  );
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  const current = (row && row.v) || 0;
  const now = () => new Date().toISOString();

  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (version > current) {
      const apply = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, now());
      });
      apply();
      logger.info({ version }, 'migração aplicada');
    }
  });
}

/** Insere dados iniciais (idempotente — só insere se a tabela estiver vazia). */
function seed() {
  const shop = require('./seed/shop');
  const quiz = require('./seed/quiz');
  const lifeItems = require('./seed/life');
  const itemCount = db.prepare(`SELECT COUNT(*) AS c FROM rpg_items`).get().c;
  const quizCount = db.prepare(`SELECT COUNT(*) AS c FROM quiz_questions`).get().c;

  const insItem = db.prepare(
    `INSERT OR IGNORE INTO rpg_items (id, name, type, price, sell_price, emoji, description) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insQ = db.prepare(
    `INSERT OR IGNORE INTO quiz_questions (category, question, options, answer_index) VALUES (?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    if (itemCount === 0) {
      for (const it of shop) {
        insItem.run(it.id, it.name, it.type, it.price, it.sellPrice, it.emoji, it.description);
      }
    }
    // itens do Lua Life: INSERT OR IGNORE sempre (novos itens chegam a bancos existentes)
    for (const it of lifeItems) {
      insItem.run(it.id, it.name, it.type, it.price, it.sellPrice, it.emoji, it.description);
    }
    if (quizCount === 0) {
      for (const q of quiz) {
        insQ.run(q.category, q.question, JSON.stringify(q.options), q.answerIndex);
      }
    }
  });
  tx();
}

function close() {
  if (db) {
    try {
      db.close();
    } catch (_) {
      /* ignora */
    }
    db = null;
    prepared.clear();
    logger.info('banco fechado');
  }
}

/** Backup do banco para um arquivo .db. */
async function backup(destPath) {
  const dbc = get();
  await dbc.backup(destPath);
  return destPath;
}

/** Restaura um backup (fecha, copia por cima, reabre). */
function restore(backupPath) {
  if (!fs.existsSync(backupPath)) throw new Error('Arquivo de backup não encontrado');
  const dest = CONFIG.paths.databaseFile;
  close();
  fs.copyFileSync(backupPath, dest);
  // remove arquivos WAL antigos
  for (const suffix of ['-wal', '-shm']) {
    const p = dest + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  return open();
}

/** Estatísticas simples do banco (para !database / !statsbot). */
function stats() {
  const dbc = get();
  const tables = [
    'users',
    'groups',
    'group_members',
    'warnings',
    'economy',
    'inventory',
    'rpg_players',
    'rpg_items',
    'plantations',
    'animals',
    'group_logs',
    'quiz_questions',
    'quiz_scores',
  ];
  const out = {};
  for (const t of tables) {
    try {
      out[t] = dbc.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    } catch (_) {
      out[t] = 0;
    }
  }
  return out;
}

module.exports = {
  open,
  close,
  get,
  prepare,
  backup,
  restore,
  stats,
  migrate,
};
