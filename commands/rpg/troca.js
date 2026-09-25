/**
 * commands/rpg/troca.js — Sistema seguro de trocas atômicas entre jogadores.
 *
 * Máquina de estado:
 * 1. Proposta com itens e valores de ambos os lados (!troca @jogador dar <itens/moedas> pedir <itens/moedas>)
 * 2. Visualização clara dos dois lados
 * 3. Confirmação explícita de ambos (!troca aceitar | !troca recusar)
 * 4. Qualquer alteração ou nova proposta invalida confirmação anterior
 * 5. Revalidação atômica e indivisível de saldos e inventários com withMultiLock
 * 6. Prazo de validade (timeout de 3 minutos)
 * 7. Sem troca do jogador consigo mesmo
 */

'use strict';

const economy = require('../../database/economy');
const rpg = require('../../database/rpg');
const alvoUtil = require('../../utils/alvo');
const { withMultiLock } = require('../../utils/keyedMutex');
const { formatMoney } = require('../../utils/formatter');

// Sessões de trocas em andamento: chatId -> { id, p1, p2, offer1, offer2, accepted: Set, expiresAt }
const ACTIVE_TRADES = new Map();
const TRADE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutos

function getActiveTrade(chatId, userId) {
  const trade = ACTIVE_TRADES.get(chatId);
  if (!trade) return null;
  if (Date.now() > trade.expiresAt) {
    ACTIVE_TRADES.delete(chatId);
    return null;
  }
  if (trade.p1 === userId || trade.p2 === userId) return trade;
  return null;
}

module.exports = [
  {
    name: 'troca',
    commands: ['troca', 'trade', 'negociar'],
    category: 'rpg',
    description: 'Proponha ou confirme trocas seguras de itens e moedas com outro jogador.',
    usage: '!troca @usuario [dar <moedas>] [pedir <moedas>] | !troca aceitar | !troca cancelar',
    cooldown: 3000,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();
      const chatId = ctx.remoteJid;
      const sender = ctx.sender;

      // Aceitar troca
      if (sub === 'aceitar' || sub === 'confirmar' || sub === 'sim') {
        const trade = getActiveTrade(chatId, sender);
        if (!trade) return ctx.reply('❌ Nenhuma proposta de troca ativa para você neste chat.');

        trade.accepted.add(sender);

        if (trade.accepted.has(trade.p1) && trade.accepted.has(trade.p2)) {
          // Ambos aceitaram! Executar transferência atômica com trava mútua
          ACTIVE_TRADES.delete(chatId);

          return withMultiLock([trade.p1, trade.p2], async () => {
            // Revalidação estrita de saldo e itens
            const eco1 = economy.get(trade.p1);
            const eco2 = economy.get(trade.p2);

            if (trade.offer1.money > 0 && eco1.wallet < trade.offer1.money) {
              return ctx.reply('❌ Troca cancelada: o proponente não possui mais saldo suficiente.');
            }
            if (trade.offer2.money > 0 && eco2.wallet < trade.offer2.money) {
              return ctx.reply('❌ Troca cancelada: o destinatário não possui mais saldo suficiente.');
            }

            // Validação de itens
            for (const it of trade.offer1.items) {
              const has = economy.getItem(trade.p1, it.id);
              if (!has || has.quantity < it.qty) {
                return ctx.reply(`❌ Troca cancelada: proponente não possui mais ${it.qty}x de ${it.id}.`);
              }
            }
            for (const it of trade.offer2.items) {
              const has = economy.getItem(trade.p2, it.id);
              if (!has || has.quantity < it.qty) {
                return ctx.reply(`❌ Troca cancelada: destinatário não possui mais ${it.qty}x de ${it.id}.`);
              }
            }

            // Transferências atômicas via economy_ledger e inventário
            const tradeId = `trade-${Date.now()}`;
            if (trade.offer1.money > 0) {
              economy.applyIdempotentTransfer(`${tradeId}-m1`, trade.p1, trade.p2, trade.offer1.money, 'troca entre jogadores');
            }
            if (trade.offer2.money > 0) {
              economy.applyIdempotentTransfer(`${tradeId}-m2`, trade.p2, trade.p1, trade.offer2.money, 'troca entre jogadores');
            }

            // Transferência indivisível de itens
            for (const it of trade.offer1.items) {
              economy.removeItem(trade.p1, it.id, it.qty);
              economy.addItem(trade.p2, it.id, it.qty);
            }
            for (const it of trade.offer2.items) {
              economy.removeItem(trade.p2, it.id, it.qty);
              economy.addItem(trade.p1, it.id, it.qty);
            }

            return ctx.reply(
              `🎉 *TROCA CONCLUÍDA COM SUCESSO!*\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `▸ Participantes: @${trade.p1.split('@')[0]} e @${trade.p2.split('@')[0]}\n` +
              `▸ Troca executada e registrada com sucesso no extrato.`,
              { mentions: [trade.p1, trade.p2] }
            );
          });
        }

        const other = sender === trade.p1 ? trade.p2 : trade.p1;
        return ctx.reply(
          `✅ Você aceitou a troca! Aguardando confirmação de @${other.split('@')[0]}.\n` +
          `Para confirmar, a outra pessoa deve digitar: *${ctx.prefix}troca aceitar*`,
          { mentions: [other] }
        );
      }

      // Cancelar troca
      if (sub === 'cancelar' || sub === 'recusar' || sub === 'nao') {
        const trade = getActiveTrade(chatId, sender);
        if (!trade) return ctx.reply('❌ Nenhuma troca ativa para cancelar.');
        ACTIVE_TRADES.delete(chatId);
        return ctx.reply('🚫 A proposta de troca foi cancelada.');
      }

      // Iniciar ou atualizar proposta
      const target = alvoUtil.alvo(ctx);
      if (!target) {
        return ctx.reply(
          `💡 *Como usar o comando de troca:*\n` +
          `▸ Marque quem quer negociar: *${ctx.prefix}troca @usuario dar 500 pedir 200*\n` +
          `▸ Para aceitar: *${ctx.prefix}troca aceitar*\n` +
          `▸ Para cancelar: *${ctx.prefix}troca cancelar*`
        );
      }

      if (target === sender) {
        return ctx.reply('❌ Você não pode fazer uma troca consigo mesmo.');
      }

      // Analisar tokens da oferta descartando a menção ao alvo
      const tokens = ctx.args.filter((t) => !t.startsWith('@') && !t.includes('@'));

      function parseTradeOffer(list) {
        let giveMoney = 0;
        let askMoney = 0;
        const giveItems = [];
        const askItems = [];
        let mode = null;

        for (let i = 0; i < list.length; i++) {
          const raw = list[i].trim();
          if (!raw) continue;
          const lower = raw.toLowerCase();

          if (lower === 'dar' || lower === 'oferecer' || lower === 'envia' || lower === 'dou') {
            mode = 'dar';
            continue;
          }
          if (lower === 'pedir' || lower === 'receber' || lower === 'quer' || lower === 'peco') {
            mode = 'pedir';
            continue;
          }
          if (!mode) continue;

          if (/^\d+$/.test(lower)) {
            const num = parseInt(lower, 10);
            const next = list[i + 1] ? list[i + 1].trim().toLowerCase() : null;
            if (next && next !== 'dar' && next !== 'oferecer' && next !== 'pedir' && next !== 'receber' && !/^\d+$/.test(next)) {
              const targetList = mode === 'dar' ? giveItems : askItems;
              targetList.push({ id: next, qty: num });
              i++;
            } else {
              if (mode === 'dar') giveMoney += num;
              else askMoney += num;
            }
          } else {
            const targetList = mode === 'dar' ? giveItems : askItems;
            targetList.push({ id: lower, qty: 1 });
          }
        }
        return { giveMoney, askMoney, giveItems, askItems };
      }

      const parsed = parseTradeOffer(tokens);
      let giveMoney = parsed.giveMoney;
      let askMoney = parsed.askMoney;
      const giveItems = parsed.giveItems;
      const askItems = parsed.askItems;

      if (giveMoney <= 0 && askMoney <= 0 && giveItems.length === 0 && askItems.length === 0) {
        return ctx.reply('⚠️ Informe os recursos da troca. Ex: *!troca @usuario dar 300 espada_ferro pedir 150*');
      }

      const eco1 = economy.get(sender);
      if (giveMoney > 0 && eco1.wallet < giveMoney) {
        return ctx.reply(`❌ Você não tem ${formatMoney(giveMoney)} na carteira para oferecer.`);
      }

      for (const it of giveItems) {
        const has = economy.getItem(sender, it.id);
        if (!has || has.quantity < it.qty) {
          return ctx.reply(`❌ Você não possui ${it.qty}x de ${it.id} para oferecer.`);
        }
      }

      const trade = {
        id: `trade-${Date.now()}`,
        p1: sender,
        p2: target,
        offer1: { money: giveMoney, items: giveItems },
        offer2: { money: askMoney, items: askItems },
        accepted: new Set([sender]), // Quem propôs já sinaliza aceite
        expiresAt: Date.now() + TRADE_TIMEOUT_MS,
      };

      ACTIVE_TRADES.set(chatId, trade);

      const offer1Desc = [
        giveMoney > 0 ? formatMoney(giveMoney) : null,
        ...giveItems.map((i) => `${i.qty}x ${i.id}`),
      ].filter(Boolean).join(' + ') || 'Nada';

      const offer2Desc = [
        askMoney > 0 ? formatMoney(askMoney) : null,
        ...askItems.map((i) => `${i.qty}x ${i.id}`),
      ].filter(Boolean).join(' + ') || 'Nada';

      const msg = [
        '🤝 *PROPOSTA DE TROCA DE RECURSOS*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `👤 *De:* @${sender.split('@')[0]}`,
        `   └ Oferece: ${offer1Desc}`,
        '',
        `👤 *Para:* @${target.split('@')[0]}`,
        `   └ Solicita: ${offer2Desc}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `⏳ _A proposta expira em 3 minutos._`,
        `👉 @${target.split('@')[0]}, para aceitar digite: *${ctx.prefix}troca aceitar*`,
        `👉 Para recusar: *${ctx.prefix}troca cancelar*`,
      ].join('\n');

      await ctx.reply(msg, { mentions: [sender, target] });
    },
  },
];
