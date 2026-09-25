/**
 * database/collections.js — Coleções de Itens, Descobertas e Vitrine do Perfil RPG.
 *
 * Características:
 * - Conjuntos de itens coerentes com as categorias do RPG
 * - Registro de itens já descobertos (permanece após venda)
 * - Conclusão de coleção com recompensa única registrada no extrato
 * - Vitrine de itens destacados no perfil (com validação de posse atual)
 */

'use strict';

const db = require('./database');
const economy = require('./economy');
const rpg = require('./rpg');

// Catálogo fixo e equilibrado de coleções do RPG baseado nos itens reais existentes
const COLLECTIONS = [
  {
    id: 'agricultor',
    name: 'Mestre da Agricultura',
    emoji: '🌾',
    description: 'Descubra todas as sementes tradicionais da terra.',
    items: ['semente_trigo', 'semente_milho', 'semente_cenoura', 'semente_morango', 'semente_batata', 'semente_tomate'],
    rewardCoins: 500,
    rewardXp: 100,
  },
  {
    id: 'fazendeiro',
    name: 'Criador de Rebanhos',
    emoji: '🚜',
    description: 'Encontre e crie os animais da fazenda.',
    items: ['galinha', 'vaca', 'cavalo', 'porco', 'ovelha', 'cabra'],
    rewardCoins: 1200,
    rewardXp: 250,
  },
  {
    id: 'pescador',
    name: 'Ictiologista dos Mares',
    emoji: '🎣',
    description: 'Pesque todas as variedades de peixes conhecidas.',
    items: ['sardinha', 'tilapia', 'peixe_raro', 'peixe_exotico', 'peixe_lendario'],
    rewardCoins: 2000,
    rewardXp: 400,
  },
  {
    id: 'minerador',
    name: 'Geólogo dos Vales Profundos',
    emoji: '⛏️',
    description: 'Extraia os minerais e gemas preciosas.',
    items: ['carvao', 'cobre', 'prata', 'ouro', 'diamante', 'esmeralda', 'minerio_raro'],
    rewardCoins: 3500,
    rewardXp: 600,
  },
  {
    id: 'ferramentas',
    name: 'Arsenal do Artesão',
    emoji: '🛠️',
    description: 'Obtenha os principais instrumentos de trabalho.',
    items: ['regador', 'machado', 'picareta', 'vara_pescar'],
    rewardCoins: 800,
    rewardXp: 150,
  },
];

function nowIso() {
  return new Date().toISOString();
}

/** Registra a descoberta de um item pelo usuário (idempotente). */
function recordDiscovery(userId, itemId) {
  if (!itemId) return;
  db.prepare(
    'record_discovery',
    `INSERT OR IGNORE INTO rpg_discoveries (user_id, item_id, discovered_at) VALUES (?, ?, ?)`
  ).run(userId, itemId, nowIso());
}

/** Sincroniza o inventário atual do jogador com as descobertas. */
function syncDiscoveriesFromInventory(userId) {
  const inv = economy.inventory(userId);
  for (const item of inv) {
    if (item.quantity > 0) {
      recordDiscovery(userId, item.item_id);
    }
  }
}

/** Retorna lista de IDs de itens já descobertos pelo jogador. */
function getDiscoveredItemIds(userId) {
  syncDiscoveriesFromInventory(userId);
  const rows = db.prepare(
    'get_user_discoveries',
    `SELECT item_id FROM rpg_discoveries WHERE user_id = ?`
  ).all(userId);
  return new Set(rows.map((r) => r.item_id));
}

/** Retorna o status de todas as coleções para o jogador. */
function getUserCollections(userId) {
  const discovered = getDiscoveredItemIds(userId);
  const completedRows = db.prepare(
    'get_completed_collections',
    `SELECT collection_id, completed_at FROM rpg_completed_collections WHERE user_id = ?`
  ).all(userId);
  const completedMap = new Map(completedRows.map((r) => [r.collection_id, r.completed_at]));

  return COLLECTIONS.map((col) => {
    const total = col.items.length;
    let foundCount = 0;
    const itemsDetails = col.items.map((itemId) => {
      const isDiscovered = discovered.has(itemId);
      if (isDiscovered) foundCount++;
      const itemDef = rpg.getShopItem(itemId) || { id: itemId, name: itemId, emoji: '📦' };
      const currentHas = economy.getItem(userId, itemId);
      return {
        id: itemId,
        name: itemDef.name,
        emoji: itemDef.emoji || '📦',
        discovered: isDiscovered,
        currentlyOwned: (currentHas && currentHas.quantity > 0) || false,
        ownedQty: (currentHas && currentHas.quantity) || 0,
      };
    });

    const isComplete = foundCount === total;
    const isClaimed = completedMap.has(col.id);

    return {
      id: col.id,
      name: col.name,
      emoji: col.emoji,
      description: col.description,
      total,
      foundCount,
      percent: Math.round((foundCount / total) * 100),
      items: itemsDetails,
      isComplete,
      isClaimed,
      claimedAt: completedMap.get(col.id) || null,
      rewardCoins: col.rewardCoins,
      rewardXp: col.rewardXp,
    };
  });
}

/** Retorna uma coleção específica. */
function getUserCollection(userId, collectionId) {
  const all = getUserCollections(userId);
  return all.find((c) => c.id.toLowerCase() === String(collectionId).toLowerCase()) || null;
}

/** Conclui a coleção e credita a recompensa uma única vez. */
function claimCollectionReward(userId, collectionId) {
  const col = getUserCollection(userId, collectionId);
  if (!col) throw new Error('Coleção não encontrada.');
  if (!col.isComplete) {
    throw new Error(`Coleção incompleta (${col.foundCount}/${col.total} itens descobertos).`);
  }
  if (col.isClaimed) {
    throw new Error('Você já resgatou o prêmio desta coleção anteriormente.');
  }

  const opKey = `collection-reward-${col.id}-${userId}`;

  const tx = db.get().transaction(() => {
    db.prepare(
      'insert_completed_collection',
      `INSERT INTO rpg_completed_collections (user_id, collection_id, completed_at) VALUES (?, ?, ?)`
    ).run(userId, col.id, nowIso());

    if (col.rewardCoins > 0) {
      economy.applyIdempotentOperation(
        opKey,
        userId,
        col.rewardCoins,
        'recompensa_colecao',
        `Conclusão da coleção "${col.name}"`
      );
    }

    if (col.rewardXp > 0) {
      rpg.addRpgXp(userId, col.rewardXp);
    }
  });

  tx();
  return {
    collection: col,
    rewardCoins: col.rewardCoins,
    rewardXp: col.rewardXp,
  };
}

/* ------------------------------- VITRINE ------------------------------- */

const MAX_SHOWCASE_SLOTS = 3;

/** Obtém os itens destacados na vitrine do jogador (limpando itens que não possui mais). */
function getShowcase(userId) {
  const rows = db.prepare(
    'get_showcase',
    `SELECT slot, item_id FROM rpg_showcase WHERE user_id = ? ORDER BY slot ASC`
  ).all(userId);

  const clean = [];
  for (const r of rows) {
    const inv = economy.getItem(userId, r.item_id);
    if (inv && inv.quantity > 0) {
      const def = rpg.getShopItem(r.item_id) || { id: r.item_id, name: r.item_id, emoji: '📦' };
      clean.push({
        slot: r.slot,
        itemId: r.item_id,
        name: def.name,
        emoji: def.emoji || '📦',
        type: def.type,
      });
    } else {
      // Remove da vitrine se o jogador não possui mais
      db.prepare('del_showcase_slot', `DELETE FROM rpg_showcase WHERE user_id = ? AND slot = ?`).run(userId, r.slot);
    }
  }

  return clean;
}

/** Define os itens da vitrine (até 3 itens que o jogador possui). */
function setShowcase(userId, itemIds = []) {
  const uniqueItems = [...new Set(itemIds.map((id) => String(id).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_SHOWCASE_SLOTS);

  for (const itemId of uniqueItems) {
    const inv = economy.getItem(userId, itemId);
    if (!inv || inv.quantity < 1) {
      const def = rpg.getShopItem(itemId);
      const name = def ? def.name : itemId;
      throw new Error(`Você não possui o item "${name}" no inventário para exibir na vitrine.`);
    }
  }

  const tx = db.get().transaction(() => {
    db.prepare('clear_showcase', `DELETE FROM rpg_showcase WHERE user_id = ?`).run(userId);
    const stmt = db.prepare('insert_showcase', `INSERT INTO rpg_showcase (user_id, slot, item_id) VALUES (?, ?, ?)`);
    uniqueItems.forEach((itemId, idx) => {
      stmt.run(userId, idx + 1, itemId);
      recordDiscovery(userId, itemId);
    });
  });

  tx();
  return getShowcase(userId);
}

module.exports = {
  COLLECTIONS,
  recordDiscovery,
  syncDiscoveriesFromInventory,
  getDiscoveredItemIds,
  getUserCollections,
  getUserCollection,
  claimCollectionReward,
  getShowcase,
  setShowcase,
  MAX_SHOWCASE_SLOTS,
};
