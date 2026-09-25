/**
 * commands/rpg/extrato.js — Extrato financeiro da carteira RPG/Vida.
 *
 * Exibe:
 * - Movimentações de saldo com identificador, horário, tipo, valor e saldo resultante
 * - Paginação (!extrato [página])
 * - Filtros por tipo (!extrato tipo <transfer|compra|venda|recompensa|aposta>)
 * - Privacidade estrita: consulta apenas a própria carteira
 */

'use strict';

const economy = require('../../database/economy');
const { formatMoney } = require('../../utils/formatter');
const { maybeReadMore } = require('../../utils/readmore');

const TYPE_LABELS = {
  compra: '🛒 Compra',
  venda: '💰 Venda',
  transfer_in: '📥 Recebido',
  transfer_out: '📤 Enviado',
  recompensa: '🎁 Recompensa',
  aposta: '🎲 Aposta',
  premio: '🏆 Prêmio',
  daily: '📅 Diário',
  trabalho: '💼 Trabalho',
  troca: '🔄 Troca',
  cripto_compra: '🪙 Cripto (Compra)',
  cripto_venda: '🪙 Cripto (Venda)',
};

module.exports = [
  {
    name: 'extrato',
    commands: ['extrato', 'historicoextrato'],
    category: 'rpg',
    description: 'Consulta o extrato detalhado de movimentações da sua carteira.',
    usage: '!extrato [pagina] | !extrato tipo <filtro>',
    cooldown: 3000,
    execute: async (ctx) => {
      const user = ctx.sender;
      let page = 1;
      let filterType = null;

      if (ctx.args[0] && ctx.args[0].toLowerCase() === 'tipo' && ctx.args[1]) {
        filterType = ctx.args[1].toLowerCase();
        page = Math.max(1, parseInt(ctx.args[2], 10) || 1);
      } else if (ctx.args[0]) {
        const parsed = parseInt(ctx.args[0], 10);
        if (Number.isFinite(parsed) && parsed > 0) page = parsed;
      }

      const PAGE_SIZE = 8;
      const offset = (page - 1) * PAGE_SIZE;

      const totalItems = economy.countHistory(user, filterType);
      const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
      if (page > totalPages) page = totalPages;

      const items = economy.history(user, PAGE_SIZE, offset, filterType);
      const eco = economy.get(user);

      if (!items.length) {
        return ctx.reply(
          `📜 *EXTRATO DA CARTEIRA*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `▸ Saldo em Carteira: ${formatMoney(eco.wallet)}\n` +
          `▸ Saldo no Banco: ${formatMoney(eco.bank)}\n\n` +
          `Nenhuma movimentação registrada${filterType ? ` para o tipo "${filterType}"` : ''}.`
        );
      }

      const lines = [
        '📜 *EXTRATO DETALHADO DA CARTEIRA*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `👤 Titular: Você`,
        `💵 Saldo Atual: ${formatMoney(eco.wallet)} (Carteira) • ${formatMoney(eco.bank)} (Banco)`,
        filterType ? `🔍 Filtro: *${filterType}*` : '🔍 Filtro: *Todas*',
        `📄 Página: ${page}/${totalPages} (Total: ${totalItems} registros)`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ];

      for (const tx of items) {
        const label = TYPE_LABELS[tx.type] || `▸ ${tx.type || 'Operação'}`;
        const sign = tx.amount >= 0 ? '+' : '';
        const dateStr = tx.created_at ? tx.created_at.slice(0, 16).replace('T', ' ') : '-';
        lines.push(`[#${tx.id}] ${label} • ${sign}${formatMoney(tx.amount)}`);
        lines.push(`   └ Data: ${dateStr} • ${tx.note || 'Sem detalhes'}`);
      }

      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      if (totalPages > 1) {
        lines.push(`💡 Navegar: *${ctx.prefix}extrato ${page < totalPages ? page + 1 : 1}*`);
      }
      lines.push(`💡 Filtrar por tipo: *${ctx.prefix}extrato tipo compra* | *${ctx.prefix}extrato tipo transfer_in*`);

      await ctx.reply(maybeReadMore(lines.join('\n')));
    },
  },
];
