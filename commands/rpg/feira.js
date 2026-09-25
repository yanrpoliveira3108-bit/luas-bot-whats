/**
 * commands/rpg/feira.js — Feira de itens entre jogadores com compras atômicas,
 * reservas seguras e suporte a cards visuais HTML.
 */

'use strict';

const market = require('../../database/market');
const economy = require('../../database/economy');
const settings = require('../../database/settings');
const { formatMoney } = require('../../utils/formatter');
const { confirmAction } = require('../_shared/confirm');

function renderListingLine(l) {
  const emoji = l.item_emoji || '📦';
  const name = l.item_name || l.item_id;
  const seller = l.seller_id.split('@')[0];
  const timeLeftMin = Math.max(0, Math.round((l.expires_at - Date.now()) / 60000));
  const timeDesc = timeLeftMin >= 60 ? `${Math.floor(timeLeftMin / 60)}h` : `${timeLeftMin}m`;

  return `🏷️ *#${l.id}* ${emoji} *${name}* x${l.quantity}\n▸ Preço: *${formatMoney(l.unit_price)}*/un (Total: ${formatMoney(l.quantity * l.unit_price)})\n▸ Vendedor: @${seller} • Expira em: ${timeDesc}`;
}

module.exports = [
  {
    name: 'feira',
    commands: ['feira', 'mercadinho', 'market', 'feirarp'],
    category: 'rpg',
    description: 'Feira de compra e venda de itens entre jogadores.',
    usage: '!feira [buscar <termo> | vender <item> <qtd> <preço> | comprar <id> [qtd] | meus | cancelar <id>]',
    cooldown: 2500,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();

      // Subcomando: VENDER
      if (sub === 'vender' || sub === 'anunciar' || sub === 'sell') {
        const itemId = ctx.args[1];
        const qty = parseInt(ctx.args[2], 10);
        const price = parseInt(ctx.args[3], 10);

        if (!itemId || !qty || !price) {
          return ctx.reply(
            `💡 *Como vender na feira:*\n` +
            `▸ Use: *${ctx.prefix}feira vender <item> <quantidade> <preco_unitario>*\n` +
            `▸ Exemplo: *${ctx.prefix}feira vender espada_ferro 1 800*\n` +
            `▸ Os itens ficam em custódia até a venda ou cancelamento.`
          );
        }

        try {
          const res = await market.createListing(ctx.sender, itemId, qty, price);
          return ctx.reply(
            `✅ *ANÚNCIO PUBLICADO NA FEIRA!*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `▸ Anúncio: *#${res.listingId}*\n` +
            `▸ Item: ${res.item.emoji || '📦'} *${res.item.name}* x${res.quantity}\n` +
            `▸ Preço Unitário: *${formatMoney(res.unitPrice)}*\n` +
            `▸ Preço Total do Lote: *${formatMoney(res.quantity * res.unitPrice)}*\n` +
            `▸ Duração: 24 horas\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 Cancele quando quiser com: *${ctx.prefix}feira cancelar ${res.listingId}*`
          );
        } catch (err) {
          return ctx.reply(`❌ ${err.message}`);
        }
      }

      // Subcomando: COMPRAR
      if (sub === 'comprar' || sub === 'buy') {
        const listingId = parseInt(ctx.args[1], 10);
        const buyQty = ctx.args[2] ? parseInt(ctx.args[2], 10) : null;

        if (!listingId) {
          return ctx.reply(`⚠️ Informe o número do anúncio. Ex: *${ctx.prefix}feira comprar 12 [quantidade]*`);
        }

        const listing = market.getListing(listingId);
        if (!listing || listing.status !== 'active') {
          return ctx.reply('❌ Anúncio não encontrado ou já encerrado.');
        }

        const qtyToBuy = buyQty !== null ? buyQty : listing.quantity;
        const totalCost = qtyToBuy * listing.unit_price;

        const buyerEco = economy.get(ctx.sender);
        if (buyerEco.wallet < totalCost) {
          return ctx.reply(`💸 Saldo insuficiente! Você precisa de ${formatMoney(totalCost)}, mas tem apenas ${formatMoney(buyerEco.wallet)} na carteira.`);
        }

        const promptText = `comprar ${qtyToBuy}x de ${listing.item_name || listing.item_id} por ${formatMoney(totalCost)}`;
        return confirmAction(ctx, promptText, async (c) => {
          try {
            const purchase = await market.buyListing(c.sender, listingId, qtyToBuy);
            return c.reply(
              `🎉 *COMPRA CONCLUÍDA COM SUCESSO!*\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `▸ Você comprou: ${purchase.itemEmoji} *${purchase.itemName}* x${purchase.buyQty}\n` +
              `▸ Valor pago: *${formatMoney(purchase.totalPrice)}*\n` +
              `▸ Vendedor: @${purchase.sellerId.split('@')[0]}\n` +
              `▸ Os itens já estão disponíveis no seu inventário (*${c.prefix}inventario*).`,
              { mentions: [purchase.sellerId] }
            );
          } catch (err) {
            return c.reply(`❌ Falha ao concluir a compra: ${err.message}`);
          }
        });
      }

      // Subcomando: CANCELAR
      if (sub === 'cancelar' || sub === 'remover' || sub === 'cancel') {
        const listingId = parseInt(ctx.args[1], 10);
        if (!listingId) {
          return ctx.reply(`⚠️ Informe o ID do anúncio a cancelar. Ex: *${ctx.prefix}feira cancelar 12*`);
        }

        try {
          const res = await market.cancelListing(ctx.sender, listingId);
          return ctx.reply(`✅ Anúncio *#${res.listingId}* cancelado! ${res.returnedQuantity}x de ${res.itemId} retornaram ao seu inventário.`);
        } catch (err) {
          return ctx.reply(`❌ ${err.message}`);
        }
      }

      // Subcomando: MEUS ANÚNCIOS
      if (sub === 'meus' || sub === 'meus_anuncios' || sub === 'my') {
        const myListings = market.searchListings({ sellerId: ctx.sender, limit: 15 });
        if (!myListings.length) {
          return ctx.reply(`📦 Você não possui nenhum anúncio ativo na feira.\nCrie um com: *${ctx.prefix}feira vender <item> <qtd> <preço>*`);
        }

        const lines = myListings.map(renderListingLine).join('\n\n');
        return ctx.reply(`🏪 *SEUS ANÚNCIOS NA FEIRA (${myListings.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${lines}`);
      }

      // Subcomando: BUSCAR
      let searchTerm = '';
      if (sub === 'buscar' || sub === 'procurar' || sub === 'search') {
        searchTerm = ctx.args.slice(1).join(' ').trim();
      } else if (sub && sub !== 'pagina' && sub !== 'p') {
        // Se digitou "!feira picareta", busca direto
        searchTerm = ctx.args.join(' ').trim();
      }

      const page = parseInt(ctx.args[ctx.args.length - 1], 10) || 1;
      const limit = 6;
      const offset = (Math.max(1, page) - 1) * limit;

      const listings = market.searchListings({ query: searchTerm, limit, offset });
      const totalCount = market.countSearchListings({ query: searchTerm });
      const totalPages = Math.ceil(totalCount / limit) || 1;

      if (!listings.length) {
        return ctx.reply(
          searchTerm
            ? `🔍 Nenhum anúncio encontrado para "*${searchTerm}*".`
            : `🏪 A feira está vazia no momento.\nSeja o primeiro a anunciar com: *${ctx.prefix}feira vender <item> <qtd> <preço>*`
        );
      }

      // Visual HTML se ativo
      if (settings.menuHtmlEnabled()) {
        try {
          const feiraHtmlView = require('../../utils/feiraHtmlView');
          const richHtml = require('../../utils/richHtml');
          const html = feiraHtmlView.renderFeiraHtml(listings, {
            query: searchTerm,
            page,
            totalPages,
            prefix: ctx.prefix,
          });
          await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, { title: 'FEIRA LIVRE DO RPG' });
          return;
        } catch (_) {}
      }

      const lines = listings.map(renderListingLine).join('\n\n');
      const mentions = listings.map((l) => l.seller_id);

      const msg = [
        `🏪 *FEIRA DE ITENS ENTRE JOGADORES* (Pág. ${page}/${totalPages})`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        lines,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `💡 Comprar: *${ctx.prefix}feira comprar <id> [quantidade]*`,
        `💡 Anunciar: *${ctx.prefix}feira vender <item> <qtd> <preço>*`,
        totalPages > 1 ? `📄 Próxima página: *${ctx.prefix}feira ${searchTerm ? `buscar ${searchTerm} ` : ''}${page + 1}*` : '',
      ].filter(Boolean).join('\n');

      return ctx.reply(msg, { mentions });
    },
  },
];
