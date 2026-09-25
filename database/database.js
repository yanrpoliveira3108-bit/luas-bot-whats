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

/**
 * SQL das tabelas dos JOGOS (livro-caixa de apostas, expedições e rodadas).
 *
 * Entra na migração 36 (bancos novos/atualizados normalmente) — e, por ser
 * `CREATE TABLE IF NOT EXISTS`, também é reaproveitado pela CURA POR MEDIÇÃO
 * (`ensureEsquemaReal`) quando a migração não roda.
 *
 * Por que a cura existe: a `version` de `schema_migrations` (índice + 1) NÃO
 * prova que a tabela existe. Um banco vindo de outro deploy pode ter números à
 * frente (o do aparelho tinha version 38 com o código tendo 36 migrações) — aí
 * a migração nova nunca roda e as tabelas ficam faltando ("algo deu errado" com
 * erro de SQLite). Depois de migrar, o `open()` compara as tabelas/colunas
 * declaradas nas migrações com as que existem de verdade e cria o que faltar,
 * sem apagar nada.
 */
const GAME_TABELAS_SQL = `CREATE TABLE IF NOT EXISTS game_bets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    game TEXT NOT NULL,
    bet INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'settled',
    reward INTEGER NOT NULL DEFAULT 0,
    ref_id TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    settled_at TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS treasure_games (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat_id TEXT DEFAULT '',
    size INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    bet INTEGER NOT NULL DEFAULT 0,
    reward INTEGER NOT NULL DEFAULT 0,
    digs_total INTEGER NOT NULL DEFAULT 0,
    digs_used INTEGER NOT NULL DEFAULT 0,
    treasures_total INTEGER NOT NULL DEFAULT 0,
    treasures_found INTEGER NOT NULL DEFAULT 0,
    traps_total INTEGER NOT NULL DEFAULT 0,
    secret TEXT NOT NULL DEFAULT '{}',
    revealed TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT '',
    expires_at TEXT DEFAULT '',
    finished_at TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS game_rounds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT 'tigrinho',
    bet INTEGER NOT NULL DEFAULT 0,
    reward INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'settled',
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT '',
    settled_at TEXT DEFAULT ''
  );`;

const GAME_INDICES_SQL = `CREATE INDEX IF NOT EXISTS idx_game_bets_user_game ON game_bets(user_id, game, created_at);
  CREATE INDEX IF NOT EXISTS idx_game_bets_ref ON game_bets(ref_id);
  CREATE INDEX IF NOT EXISTS idx_treasure_user ON treasure_games(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_treasure_chat ON treasure_games(chat_id, status);
  CREATE INDEX IF NOT EXISTS idx_game_rounds_user ON game_rounds(user_id, game, created_at);`;

/**
 * SQL completo do esquema dos jogos (tabelas + índices) — usado pela
 * migração. A separação existe porque `ensureGameSchema()` precisa criar
 * TABELAS, depois as COLUNAS que faltam, e só então os ÍNDICES: um índice
 * em cima de coluna que ainda não existe derruba a abertura do banco.
 */
const GAME_SCHEMA_SQL = GAME_TABELAS_SQL + '\n' + GAME_INDICES_SQL;

/**
 * Lê o corpo `(...)` de um `CREATE TABLE` a partir do `(` de abertura.
 * Conta parênteses e respeita strings — o corpo pode ter `CHECK (x IN (...))`,
 * `DEFAULT (datetime('now'))` e vírgulas dentro dessas expressões.
 */
function corpoDoCreate(sql, abre) {
  let nivel = 0;
  let aspas = null;
  for (let i = abre; i < sql.length; i++) {
    const c = sql[i];
    if (aspas) {
      if (c === aspas) aspas = null;
      continue;
    }
    if (c === "'" || c === '"') aspas = c;
    else if (c === '(') nivel++;
    else if (c === ')') {
      nivel--;
      if (nivel === 0) return sql.slice(abre + 1, i);
    }
  }
  return '';
}

/** O `CREATE TABLE ...;` completo que começa em `i`. */
function extrairCreate(sql, i) {
  let nivel = 0;
  let aspas = null;
  for (let j = i; j < sql.length; j++) {
    const c = sql[j];
    if (aspas) {
      if (c === aspas) aspas = null;
      continue;
    }
    if (c === "'" || c === '"') aspas = c;
    else if (c === '(') nivel++;
    else if (c === ')') nivel--;
    else if (c === ';' && nivel === 0) return sql.slice(i, j + 1);
  }
  return sql.slice(i);
}

/** Colunas declaradas no corpo de um CREATE TABLE (sem as restrições de tabela). */
function colunasDeclaradas(corpo) {
  const partes = [];
  let nivel = 0;
  let aspas = null;
  let atual = '';
  for (const c of corpo) {
    if (aspas) {
      atual += c;
      if (c === aspas) aspas = null;
      continue;
    }
    if (c === "'" || c === '"') {
      aspas = c;
      atual += c;
    } else if (c === '(') {
      nivel++;
      atual += c;
    } else if (c === ')') {
      nivel--;
      atual += c;
    } else if (c === ',' && nivel === 0) {
      partes.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  partes.push(atual);

  return partes
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)\b/i.test(p))
    .map((def) => ({ nome: (def.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?/) || [])[1], def }))
    .filter((c) => !!c.nome);
}

/**
 * Definição aceita por `ALTER TABLE ... ADD COLUMN`: tipo + DEFAULT.
 * O que o ALTER não aceita (PRIMARY KEY, UNIQUE, NOT NULL, REFERENCES,
 * AUTOINCREMENT) fica de fora — a coluna nasce com o mesmo tipo e o mesmo
 * valor padrão declarados na migração.
 */
function definicaoParaAlter(def) {
  const tipo = def.match(/^"?[A-Za-z_][A-Za-z0-9_]*"?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/);
  const padrao = def.match(/DEFAULT\s+(('[^']*')|("[^"]*")|\([^)]*\)|[\w.+-]+)/i);
  return `${tipo ? tipo[1] : 'TEXT'}${padrao ? ` DEFAULT ${padrao[1]}` : ''}`;
}

/**
 * CURA POR MEDIÇÃO: compara o que as MIGRAÇÕES declaram (tabelas e colunas)
 * com o que existe DE VERDADE no banco e cria o que faltar.
 *
 * Por que existe: a `version` de `schema_migrations` (índice + 1) não prova
 * que a tabela existe. Um banco vindo de outro deploy pode ter números À
 * FRENTE — o do aparelho tinha version 38 com o código tendo 36 migrações — e
 * nesse caso a migração nova NUNCA roda e as tabelas ficam faltando (era a
 * origem dos "algo deu errado" nos jogos). Aqui a conferência é por medição:
 * tabela ausente é criada com o MESMO `CREATE TABLE IF NOT EXISTS` da
 * migração; coluna ausente é adicionada com o mesmo tipo/DEFAULT. Nada é
 * apagado, renomeado ou sobrescrito.
 *
 * @returns {string[]} o que foi criado/ajustado agora (vazio = tudo certo)
 */
function ensureEsquemaReal() {
  const ajustes = [];
  const declarado = new Map(); // tabela → { sql, colunas: Map<nome, def> }
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;

  for (const migracao of MIGRATIONS) {
    if (typeof migracao !== 'string') continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(migracao))) {
      const tabela = m[1];
      const abre = m.index + m[0].length - 1;
      const corpo = corpoDoCreate(migracao, abre);
      if (!declarado.has(tabela)) declarado.set(tabela, { sql: null, colunas: new Map() });
      const reg = declarado.get(tabela);
      for (const c of colunasDeclaradas(corpo)) if (!reg.colunas.has(c.nome)) reg.colunas.set(c.nome, c.def);
      if (!reg.sql) reg.sql = extrairCreate(migracao, m.index);
    }
  }

  for (const [tabela, reg] of declarado) {
    const existe = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tabela);
    if (!existe) {
      if (reg.sql) {
        db.exec(reg.sql);
        ajustes.push(`${tabela} (criada)`);
      }
      continue;
    }
    const colunas = new Set(db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name));
    for (const [nome, def] of reg.colunas) {
      if (colunas.has(nome)) continue;
      if (/PRIMARY\s+KEY/i.test(def)) {
        ajustes.push(`${tabela}.${nome} (chave primária ausente — tabela de outra linhagem)`);
        continue;
      }
      try {
        db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${definicaoParaAlter(def)}`);
        ajustes.push(`${tabela}.${nome}`);
      } catch (err) {
        ajustes.push(`${tabela}.${nome} (falhou: ${(err && err.message) || err})`);
      }
    }
  }

  if (ajustes.length) {
    logger.warn(
      {
        ajustes,
        versao: (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() || {}).v,
      },
      '[DB] esquema incompleto — ajustado por medição, sem apagar dados'
    );
  }
  return ajustes;
}

/** Nome antigo (era só dos jogos): agora é a cura geral, por medição. */
function ensureGameSchema() {
  return ensureEsquemaReal();
}

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

  // 36 — CAÇA AO TESOURO + apostas de jogos (caça e tigrinho)
  //
  // ATENÇÃO: a version é o ÍNDICE + 1 (não é o número deste comentário — os
  // comentários antigos repetem/saltam números). Esta é a 36ª migração.
  //
  // Três tabelas, cada uma com um papel claro:
  //   game_bets     → LIVRO-CAIXA das apostas (idempotência: uma linha por
  //                   operação, com chave única; é o que garante que uma
  //                   mensagem repetida/retransmitida não cobre duas vezes);
  //   treasure_games→ PARTIDA de caça ao tesouro (mapa oculto fica AQUI, no
  //                   banco — nunca no HTML; escavações e estado persistidos
  //                   para recuperar depois de reiniciar);
  //   game_rounds   → RODADA do tigrinho (o resultado é sorteado no backend e
  //                   gravado; reabrir/atualizar a tela NÃO sorteia de novo).
  //
  // O saldo continua sendo o de sempre: economy.wallet (LuaCoins). Nada de
  // carteira paralela — só o registro do que já foi cobrado/pago.
  GAME_SCHEMA_SQL,
];

/* ----------------------------- core ------------------------------ */

function get() {
  if (!db) throw new Error('Banco de dados não inicializado. Chame database.open() primeiro.');
  return db;
}

/**
 * Consultas que já tentaram curar o esquema e continuaram falhando (erro de
 * verdade, não de esquema): não curam de novo — evitam laço de cura em caminho
 * quente. O Set é limpo a cada cura que deu certo.
 */
const curaFalhou = new Set();
let curandoEsquema = false;

/**
 * Prepara (com cache) uma consulta.
 *
 * CURA NA HORA: se a tabela/coluna não existir — banco vindo de outro estado do
 * bot, restaurado de backup, ou tabela apagada por fora — o esquema é refeito
 * por medição (`ensureEsquemaReal`, que só CRIA o que falta) e a consulta roda
 * de novo. Sem isso, um único `no such table` derrubava o comando inteiro com
 * "⚠️ algo deu errado" no meio do jogo (foi o visto no aparelho: caça e tigrinho
 * morriam com `no such table: treasure_games/game_rounds`).
 */
function prepare(name, sql) {
  // chave = nome + SQL: permite reutilizar nomes com SQL diferentes
  const key = `${name}::${sql}`;
  if (prepared.has(key)) return prepared.get(key);
  try {
    const stmt = get().prepare(sql);
    prepared.set(key, stmt);
    return stmt;
  } catch (err) {
    const msg = String((err && err.message) || '');
    const faltaEsquema = /no such (table|column)/i.test(msg);
    if (!faltaEsquema || curandoEsquema || !db || curaFalhou.has(key)) throw err;
    curandoEsquema = true;
    let ajustes = [];
    try {
      ajustes = ensureEsquemaReal();
    } catch (errCura) {
      logger.error({ err: errCura && errCura.message }, '[DB] falha ao refazer o esquema por medição');
    } finally {
      curandoEsquema = false;
    }
    logger.warn(
      { sql: String(sql).replace(/\s+/g, ' ').slice(0, 90), ajustes: ajustes.length, err: msg },
      '[DB] consulta pediu tabela/coluna ausente — esquema refeito por medição'
    );
    prepared.clear();
    try {
      const stmt = get().prepare(sql);
      prepared.set(key, stmt);
      curaFalhou.clear();
      return stmt;
    } catch (err2) {
      curaFalhou.add(key);
      throw err2;
    }
  }
}

function open() {
  if (db) return db;
  CONFIG.helpers.ensureDirs();
  db = new Database(CONFIG.paths.databaseFile);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  migrate();
  ensureEsquemaReal();
  seed();
  logger.info({ file: CONFIG.paths.databaseFile }, 'banco aberto');
  return db;
}

/**
 * Nome estável de uma migração — é POR ELE que a aplicação decide o que falta.
 *
 * Por que não confiar só no número (`version`): a `version` é o índice + 1, e um
 * banco que passou por outro deploy pode ter números À FRENTE dos que este
 * código tem. Nesse caso `version > current` nunca é verdade e as migrações
 * NOVAS deste código nunca rodariam — foi essa a origem dos "algo deu errado"
 * nos jogos (tabelas ausentes com o número já "batido" por outra linhagem).
 */
function nomeDaMigracao(i) {
  return `v${i + 1}`;
}

/** Existe essa coluna? (usado no ALTER idempotente da coluna `nome`.) */
function colunaExiste(tabela, coluna) {
  return db
    .prepare(`PRAGMA table_info(${tabela})`)
    .all()
    .some((c) => c.name === coluna);
}

/**
 * Nome estável de uma migração — é POR ELE que a aplicação decide o que falta.
 *
 * Por que não confiar só no número (`version`): a `version` é o índice + 1 e um
 * banco vindo de outro deploy pode ter números À FRENTE dos que este código
 * tem — o do aparelho tinha version 38 com o código tendo 36 migrações. Nesse
 * caso `version > current` nunca é verdade e as migrações NOVAS deste código
 * nunca rodariam (era a origem dos "algo deu errado" nos jogos).
 *
 * INVARIANTE (garantida por teste): toda migração é só
 * `CREATE TABLE/INDEX IF NOT EXISTS` — nenhum ALTER, DROP, INSERT, UPDATE ou
 * DELETE. É isso que torna seguro reexecutar uma migração cujo nome não está
 * registrado (banco antigo, sem a coluna `nome`): a reexecução ou não faz nada,
 * ou cria o que estava faltando.
 */
function nomeDaMigracao(i) {
  return `v${i + 1}`;
}

/** Existe essa coluna? (usado no ALTER idempotente da coluna `nome`.) */
function colunaExiste(tabela, coluna) {
  return db
    .prepare(`PRAGMA table_info(${tabela})`)
    .all()
    .some((c) => c.name === coluna);
}

function migrate() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT ''
    );`
  );
  // `nome` foi adicionada depois: bancos antigos ganham a coluna aqui (as
  // linhas ficam com nome vazio e a migração correspondente é reexecutada)
  if (!colunaExiste('schema_migrations', 'nome')) {
    db.exec(`ALTER TABLE schema_migrations ADD COLUMN nome TEXT DEFAULT ''`);
  }

  const linhas = db.prepare('SELECT version, nome FROM schema_migrations ORDER BY version').all();
  const nomes = new Set(linhas.map((r) => String(r.nome || '')).filter(Boolean));
  let maior = linhas.reduce((m, r) => Math.max(m, Number(r.version) || 0), 0);
  const agora = () => new Date().toISOString();

  let aplicadas = 0;
  let reexecutadas = 0;
  MIGRATIONS.forEach((sql, i) => {
    const nome = nomeDaMigracao(i);
    if (nomes.has(nome)) return;
    const linha = db.prepare('SELECT version, nome FROM schema_migrations WHERE version = ?').get(i + 1);
    const legado = linha && !String(linha.nome || ''); // banco antigo: linha sem nome
    if (legado) reexecutadas++;
    const apply = db.transaction(() => {
      db.exec(sql); // idempotente por invariante (só CREATE ... IF NOT EXISTS)
      if (legado) {
        db.prepare('UPDATE schema_migrations SET nome = ?, applied_at = ? WHERE version = ?').run(
          nome,
          agora(),
          i + 1
        );
      } else {
        // número inexistente ou tomado por OUTRA linhagem: usa o próximo livre
        // (quem identifica a migração é o NOME, não o número)
        const version = linha ? maior + 1 : i + 1;
        db.prepare('INSERT INTO schema_migrations (version, applied_at, nome) VALUES (?, ?, ?)').run(
          version,
          agora(),
          nome
        );
        maior = Math.max(maior, version);
      }
      nomes.add(nome);
    });
    apply();
    aplicadas++;
  });

  if (aplicadas) logger.info({ aplicadas, reexecutadas, versaoBanco: maior }, 'migrações aplicadas/confirmadas');
  if (maior > MIGRATIONS.length) {
    logger.warn(
      { versaoBanco: maior, migracoesDoCodigo: MIGRATIONS.length },
      '[DB] banco à frente do código — o número virou só um contador; o que identifica a migração é o nome (v1..vN)'
    );
  }
  return aplicadas;
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
  ensureEsquemaReal,
  ensureGameSchema,
  MIGRATIONS,
};
