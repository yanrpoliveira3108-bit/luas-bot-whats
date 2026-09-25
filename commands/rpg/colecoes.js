/**
 * commands/rpg/colecoes.js — Coleções de Itens e Vitrine de Destaques no Perfil.
 */

'use strict';

const collections = require('../../database/collections');
const { formatMoney } = require('../../utils/formatter');

module.exports = [
  {
    name: 'colecoes',
    commands: ['colecoes', 'colecao', 'collections'],
    category: 'rpg',
    description: 'Acompanhe suas coleções de itens do RPG e resgate recompensas.',
    usage: '!colecoes [identificador | resgatar <id>]',
    cooldown: 2500,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();

      // Subcomando: RESGATAR RECOMPENSA
      if (sub === 'resgatar' || sub === 'claim' || sub === 'recompensa') {
        const colId = ctx.args[1];
        if (!colId) return ctx.reply(`⚠️ Informe o ID da coleção. Ex: *${ctx.prefix}colecoes resgatar agricultor*`);

        try {
          const res = await collections.claimCollectionReward(ctx.sender, colId);
          return ctx.reply(
            `🎉 *COLEÇÃO CONCLUÍDA COM SUCESSO!*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `▸ Coleção: ${res.collection.emoji} *${res.collection.name}*\n` +
            `▸ Recompensa Recebida: *+${formatMoney(res.rewardCoins)}* e *+${res.rewardXp} XP*\n` +
            `▸ A recompensa financeira foi creditada no seu extrato (*${ctx.prefix}extrato*).`
          );
        } catch (err) {
          return ctx.reply(`❌ ${err.message}`);
        }
      }

      // Ver detalhes de UMA coleção específica
      if (sub && sub !== 'todas' && sub !== 'listar') {
        const col = collections.getUserCollection(ctx.sender, sub);
        if (!col) {
          return ctx.reply(`❌ Coleção "*${sub}*" não encontrada. Digite *${ctx.prefix}colecoes* para ver a lista.`);
        }

        const itemsLines = col.items.map((it) => {
          const statusDisc = it.discovered ? '✅ Descoberto' : '❓ Não encontrado';
          const statusOwned = it.currentlyOwned ? `(Possui x${it.ownedQty})` : '(Não possui)';
          return `▸ ${it.emoji} *${it.name}* — ${statusDisc} ${statusOwned}`;
        }).join('\n');

        const statusLabel = col.isClaimed
          ? '🏆 Concluída e Recompensada'
          : col.isComplete
            ? `🎁 Concluída! Digite *${ctx.prefix}colecoes resgatar ${col.id}*`
            : `⏳ Em progresso (${col.foundCount}/${col.total} itens)`;

        return ctx.reply(
          `📜 *COLEÇÃO: ${col.emoji} ${col.name.toUpperCase()}*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `▸ Descrição: _${col.description}_\n` +
          `▸ Progresso: *${col.foundCount}/${col.total}* (${col.percent}%)\n` +
          `▸ Status: ${statusLabel}\n` +
          `▸ Recompensa: *${formatMoney(col.rewardCoins)}* e *${col.rewardXp} XP*\n\n` +
          `📦 *Itens do Conjunto:*\n${itemsLines}`
        );
      }

      // Listar todas as coleções do usuário
      const list = collections.getUserCollections(ctx.sender);
      const lines = list.map((c) => {
        const bar = '█'.repeat(Math.ceil(c.percent / 20)) + '░'.repeat(5 - Math.ceil(c.percent / 20));
        const badge = c.isClaimed ? '🏆' : c.isComplete ? '🎁' : '⏳';
        return `${badge} ${c.emoji} *${c.name}* [${bar}] ${c.foundCount}/${c.total} (${c.percent}%)\n   └ Id: \`${c.id}\` • Prêmio: ${formatMoney(c.rewardCoins)}`;
      }).join('\n\n');

      return ctx.reply(
        `📚 *SUAS COLEÇÕES DE ITENS DO RPG*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${lines}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 Ver itens de uma coleção: *${ctx.prefix}colecoes <id>*\n` +
        `💡 Resgatar prêmio de coleção completa: *${ctx.prefix}colecoes resgatar <id>*`
      );
    },
  },
  {
    name: 'vitrine',
    commands: ['vitrine', 'showcase', 'destaques'],
    category: 'rpg',
    description: 'Mostre ou defina até 3 itens em destaque no seu perfil.',
    usage: '!vitrine [definir <item1> [item2] [item3]]',
    cooldown: 2500,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();

      if (sub === 'definir' || sub === 'set') {
        const itemsToSet = ctx.args.slice(1);
        if (!itemsToSet.length) {
          return ctx.reply(`⚠️ Informe os itens que quer destacar. Ex: *${ctx.prefix}vitrine definir espada_ferro picareta*`);
        }

        try {
          const res = collections.setShowcase(ctx.sender, itemsToSet);
          const lines = res.map((s) => `▸ Slot ${s.slot}: ${s.emoji} *${s.name}*`).join('\n');
          return ctx.reply(
            `✨ *VITRINE ATUALIZADA COM SUCESSO!*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${lines}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Esses itens agora aparecem no seu card de perfil (*${ctx.prefix}perfil*).`
          );
        } catch (err) {
          return ctx.reply(`❌ ${err.message}`);
        }
      }

      // Apenas visualizar vitrine atual
      const current = collections.getShowcase(ctx.sender);
      if (!current.length) {
        return ctx.reply(
          `🖼️ *Sua vitrine está vazia.*\n` +
          `Destaque até 3 itens do seu inventário com:\n` +
          `👉 *${ctx.prefix}vitrine definir <item1> [item2] [item3]*`
        );
      }

      const lines = current.map((s) => `▸ Slot ${s.slot}: ${s.emoji} *${s.name}* (\`${s.itemId}\`)`).join('\n');
      return ctx.reply(
        `✨ *SUA VITRINE DE ITENS DESTACADOS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${lines}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 Altere a qualquer momento com: *${ctx.prefix}vitrine definir <itens>*`
      );
    },
  },
];
