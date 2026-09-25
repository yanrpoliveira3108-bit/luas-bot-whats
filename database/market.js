/**
 * database/market.js — Feira de Itens entre Jogadores (RPG).
 *
 * Características:
 * - Listagens com identificador, item, vendedor, quantidade, preço unitário e validade (24h padrão)
 * - Escrow automático no inventário do vendedor
 * - Suporte a busca, filtros e paginação
 * - Compra atômica (parcial ou total) com withMultiLock([comprador, vendedor])
 * - Extrato detalhado no economy_ledger
 * - Cancelamento seguro (devolve itens restantes uma única vez)
 * - Expiração automática com devolução consistente
 */

'use strict';

const db = require('./database');
const economy = require('./economy');
const rpg = require('./rpg');
const settings = require('./settings');
const { withMultiLock } = require('../utils/keyedMutex');

const DEFAULT_EXPIRATION_HOURS = 24;

function nowIso() {
  return new Date().toISOString();
}

function isMarketEnabled() {
  return settings.getBool('feira_enabled', true);
}

function getMaxListingsPerUser() {
  return settings.getInt('feira_max_listings', 5);
}

function getExpirationMs() {
  const hours = settings.getInt('feira_duration_hours', DEFAULT_EXPIRATION_HOURS);
  return hours * 60 * 60 * 1000;
}

/** Cria um anúncio na feira. Transfere os itens para custódia (escrow). */
async function createListing(sellerId, itemId, quantity, unitPrice) {
  if (!isMarketEnabled()) {
    throw new Error('A feira está temporariamente desativada pela administração.');
  }

  const cleanItemId = String(itemId || '').trim().toLowerCase();
  const qty = Math.floor(Number(quantity));
  const price = Math.floor(Number(unitPrice));

  if (!cleanItemId) throw new Error('ID do item inválido.');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantidade deve ser um número inteiro positivo.');
  if (!Number.isFinite(price) || price <= 0) throw new Error('Preço unitário deve ser maior que zero.');

  const itemDef = rpg.getShopItem(cleanItemId);
  if (!itemDef) throw new Error(`O item "${cleanItemId}" não existe no catálogo do RPG.`);

  return withMultiLock([sellerId], async () => {
    // Verificar limite de anúncios ativos do vendedor
    const activeCountRow = db.prepare(
      'count_seller_active_listings',
      `SELECT COUNT(*) AS c FROM rpg_market_listings WHERE seller_id = ? AND status = 'active'`
    ).get(sellerId);
    const activeCount = (activeCountRow && activeCountRow.c) || 0;
    const maxListings = getMaxListingsPerUser();
    if (activeCount >= maxListings) {
      throw new Error(`Você já atingiu o limite de ${maxListings} anúncios ativos na feira.`);
    }

    // Verificar se possui os itens no inventário
    const inv = economy.getItem(sellerId, cleanItemId);
    if (!inv || inv.quantity < qty) {
      throw new Error(`Você não possui ${qty}x de ${itemDef.name} no seu inventário.`);
    }

    const expiresAt = Date.now() + getExpirationMs();
    const createdAt = nowIso();

    // Transação atômica: retira itens do inventário e cria anúncio
    const tx = db.get().transaction(() => {
      economy.removeItem(sellerId, cleanItemId, qty);

      const info = db.prepare(
        'insert_rpg_listing',
        `INSERT INTO rpg_market_listings (seller_id, item_id, quantity, unit_price, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`
      ).run(sellerId, cleanItemId, qty, price, createdAt, expiresAt);

      return Number(info.lastInsertRowid);
    });

    const listingId = tx();
    return {
      listingId,
      item: itemDef,
      quantity: qty,
      unitPrice: price,
      expiresAt,
    };
  });
}

/** Obtém um anúncio pelo ID. */
function getListing(listingId) {
  return db.prepare(
    'get_rpg_listing',
    `SELECT l.*, r.name AS item_name, r.emoji AS item_emoji, r.type AS item_type, r.description AS item_desc
     FROM rpg_market_listings l
     LEFT JOIN rpg_items r ON r.id = l.item_id
     WHERE l.id = ?`
  ).get(listingId) || null;
}

/** Lista anúncios com paginação, busca e filtros. */
function searchListings({ query = '', type = null, sellerId = null, limit = 10, offset = 0 } = {}) {
  // Limpa/expira anúncios vencidos antes da listagem
  expireListings();

  let sql = `
    SELECT l.*, r.name AS item_name, r.emoji AS item_emoji, r.type AS item_type, r.description AS item_desc
    FROM rpg_market_listings l
    LEFT JOIN rpg_items r ON r.id = l.item_id
    WHERE l.status = 'active'
  `;
  const params = [];

  if (sellerId) {
    sql += ` AND l.seller_id = ?`;
    params.push(sellerId);
  }

  if (type) {
    sql += ` AND r.type = ?`;
    params.push(type);
  }

  if (query) {
    sql += ` AND (l.item_id LIKE ? OR r.name LIKE ? OR r.description LIKE ?)`;
    const term = `%${query.toLowerCase()}%`;
    params.push(term, term, term);
  }

  sql += ` ORDER BY l.id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.get().prepare(sql).all(...params);
}

/** Conta total de anúncios correspondentes aos filtros para paginação. */
function countSearchListings({ query = '', type = null, sellerId = null } = {}) {
  let sql = `
    SELECT COUNT(*) AS c
    FROM rpg_market_listings l
    LEFT JOIN rpg_items r ON r.id = l.item_id
    WHERE l.status = 'active'
  `;
  const params = [];

  if (sellerId) {
    sql += ` AND l.seller_id = ?`;
    params.push(sellerId);
  }

  if (type) {
    sql += ` AND r.type = ?`;
    params.push(type);
  }

  if (query) {
    sql += ` AND (l.item_id LIKE ? OR r.name LIKE ? OR r.description LIKE ?)`;
    const term = `%${query.toLowerCase()}%`;
    params.push(term, term, term);
  }

  const r = db.get().prepare(sql).get(...params);
  return (r && r.c) || 0;
}

/** Compra um item (ou lote) de um anúncio na feira. */
async function buyListing(buyerId, listingId, quantityToBuy = null) {
  if (!isMarketEnabled()) {
    throw new Error('A feira está temporariamente desativada pela administração.');
  }

  const listing = getListing(listingId);
  if (!listing) throw new Error('Anúncio não encontrado.');
  if (listing.status !== 'active') throw new Error('Este anúncio não está mais ativo.');
  if (Date.now() > listing.expires_at) {
    expireListingSingle(listing.id);
    throw new Error('Este anúncio acabou de expirar.');
  }
  if (listing.seller_id === buyerId) {
    throw new Error('Você não pode comprar do seu próprio anúncio.');
  }

  const buyQty = quantityToBuy === null ? listing.quantity : Math.floor(Number(quantityToBuy));
  if (!Number.isFinite(buyQty) || buyQty <= 0) {
    throw new Error('Quantidade de compra inválida.');
  }
  if (buyQty > listing.quantity) {
    throw new Error(`Quantidade solicitada (${buyQty}) é maior que a disponível (${listing.quantity}).`);
  }

  const totalPrice = buyQty * listing.unit_price;

  // Trava mútua com withMultiLock para garantir ausência de concorrência e race condition
  return withMultiLock([buyerId, listing.seller_id], async () => {
    // Revalidação estrita dentro da trava
    const freshListing = getListing(listingId);
    if (!freshListing || freshListing.status !== 'active') {
      throw new Error('O anúncio foi cancelado ou vendido enquanto você confirmava.');
    }
    if (Date.now() > freshListing.expires_at) {
      expireListingSingle(freshListing.id);
      throw new Error('O anúncio expirou.');
    }
    if (buyQty > freshListing.quantity) {
      throw new Error(`Estoque insuficiente. Restam apenas ${freshListing.quantity} unidades.`);
    }

    const buyerEco = economy.get(buyerId);
    if (buyerEco.wallet < totalPrice) {
      throw new Error(`Saldo insuficiente na carteira. Necessário: ${totalPrice} LC.`);
    }

    const opKey = `feira-buy-${freshListing.id}-${Date.now()}-${buyQty}`;

    const tx = db.get().transaction(() => {
      // 1. Transferência atômica via economy_ledger
      economy.applyIdempotentTransfer(
        opKey,
        buyerId,
        freshListing.seller_id,
        totalPrice,
        `Compra na feira: ${buyQty}x ${freshListing.item_name || freshListing.item_id} (anúncio #${freshListing.id})`
      );

      // 2. Entrega dos itens da custódia para o comprador
      economy.addItem(buyerId, freshListing.item_id, buyQty);

      // 3. Atualizar estoque ou encerrar anúncio
      const remaining = freshListing.quantity - buyQty;
      if (remaining <= 0) {
        db.prepare(
          'close_rpg_listing',
          `UPDATE rpg_market_listings SET quantity = 0, status = 'sold', buyer_id = ? WHERE id = ?`
        ).run(buyerId, freshListing.id);
      } else {
        db.prepare(
          'reduce_rpg_listing',
          `UPDATE rpg_market_listings SET quantity = ? WHERE id = ?`
        ).run(remaining, freshListing.id);
      }

      return {
        listingId: freshListing.id,
        itemId: freshListing.item_id,
        itemName: freshListing.item_name || freshListing.item_id,
        itemEmoji: freshListing.item_emoji || '📦',
        buyQty,
        unitPrice: freshListing.unit_price,
        totalPrice,
        remaining,
        sellerId: freshListing.seller_id,
      };
    });

    return tx();
  });
}

/** Cancela um anúncio próprio e recupera os itens restantes da custódia. */
async function cancelListing(sellerId, listingId) {
  const listing = getListing(listingId);
  if (!listing) throw new Error('Anúncio não encontrado.');
  if (listing.seller_id !== sellerId) {
    throw new Error('Você só pode cancelar anúncios que você mesmo criou.');
  }
  if (listing.status !== 'active') {
    throw new Error(`Este anúncio não está mais ativo (status: ${listing.status}).`);
  }

  return withMultiLock([sellerId], async () => {
    const fresh = getListing(listingId);
    if (!fresh || fresh.seller_id !== sellerId || fresh.status !== 'active') {
      throw new Error('O anúncio já foi finalizado ou cancelado.');
    }

    const returnQty = fresh.quantity;

    const tx = db.get().transaction(() => {
      db.prepare(
        'cancel_rpg_listing',
        `UPDATE rpg_market_listings SET status = 'cancelled' WHERE id = ?`
      ).run(fresh.id);

      if (returnQty > 0) {
        economy.addItem(sellerId, fresh.item_id, returnQty);
      }
    });

    tx();
    return {
      listingId: fresh.id,
      itemId: fresh.item_id,
      returnedQuantity: returnQty,
    };
  });
}

/** Expira um anúncio específico e devolve os itens restantes para o vendedor. */
function expireListingSingle(listingId) {
  const l = getListing(listingId);
  if (!l || l.status !== 'active') return;

  const tx = db.get().transaction(() => {
    db.prepare('expire_rpg_listing', `UPDATE rpg_market_listings SET status = 'expired' WHERE id = ?`).run(l.id);
    if (l.quantity > 0) {
      economy.addItem(l.seller_id, l.item_id, l.quantity);
    }
  });
  tx();
}

/** Varre e expira todos os anúncios cujo prazo de validade já passou. */
function expireListings() {
  const now = Date.now();
  const expired = db.prepare(
    'get_expired_listings',
    `SELECT id, seller_id, item_id, quantity FROM rpg_market_listings WHERE status = 'active' AND expires_at < ?`
  ).all(now);

  if (!expired.length) return 0;

  const tx = db.get().transaction(() => {
    for (const l of expired) {
      db.prepare('expire_rpg_listing', `UPDATE rpg_market_listings SET status = 'expired' WHERE id = ?`).run(l.id);
      if (l.quantity > 0) {
        economy.addItem(l.seller_id, l.item_id, l.quantity);
      }
    }
  });
  tx();
  return expired.length;
}

// Registro no janitor para expiração automática periódica sem timers adicionais
try {
  const janitor = require('../utils/janitor');
  janitor.register('rpg-market-expiration', () => {
    expireListings();
  }, 10 * 60 * 1000); // a cada 10 minutos
} catch (_) {}

module.exports = {
  createListing,
  getListing,
  searchListings,
  countSearchListings,
  buyListing,
  cancelListing,
  expireListings,
  expireListingSingle,
  isMarketEnabled,
  getMaxListingsPerUser,
  getExpirationMs,
};
