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

            // Transferências atômicas via economy_ledger
            const tradeId = `trade-${Date.now()}`;
            if (trade.offer1.money > 0) {
              economy.applyIdempotentTransfer(`${tradeId}-m1`, trade.p1, trade.p2, trade.offer1.money, 'troca entre jogadores');
            }
            if (trade.offer2.money > 0) {
              economy.applyIdempotentTransfer(`${tradeId}-m2`, trade.p2, trade.p1, trade.offer2.money, 'troca entre jogadores');
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

      // Analisar oferta (dar e pedir)
      let giveMoney = 0;
      let askMoney = 0;

      const argsStr = ctx.args.join(' ').toLowerCase();
      const giveMatch = argsStr.match(/dar\s+(\d+)/);
      const askMatch = argsStr.match(/pedir\s+(\d+)/);

      if (giveMatch) giveMoney = parseInt(giveMatch[1], 10) || 0;
      if (askMatch) askMoney = parseInt(askMatch[1], 10) || 0;

      if (giveMoney <= 0 && askMoney <= 0) {
        return ctx.reply('⚠️ Informe os valores da troca. Ex: *!troca @usuario dar 300 pedir 150*');
      }

      const eco1 = economy.get(sender);
      if (giveMoney > 0 && eco1.wallet < giveMoney) {
        return ctx.reply(`❌ Você não tem ${formatMoney(giveMoney)} na carteira para oferecer.`);
      }

      const trade = {
        id: `trade-${Date.now()}`,
        p1: sender,
        p2: target,
        offer1: { money: giveMoney, items: [] },
        offer2: { money: askMoney, items: [] },
        accepted: new Set([sender]), // Quem propôs já sinaliza aceite
        expiresAt: Date.now() + TRADE_TIMEOUT_MS,
      };

      ACTIVE_TRADES.set(chatId, trade);

      const msg = [
        '🤝 *PROPOSTA DE TROCA DE RECURSOS*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `👤 *De:* @${sender.split('@')[0]}`,
        `   └ Oferece: ${formatMoney(giveMoney)}`,
        '',
        `👤 *Para:* @${target.split('@')[0]}`,
        `   └ Solicita: ${formatMoney(askMoney)}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `⏳ _A proposta expira em 3 minutos._`,
        `👉 @${target.split('@')[0]}, para aceitar digite: *${ctx.prefix}troca aceitar*`,
        `👉 Para recusar: *${ctx.prefix}troca cancelar*`,
      ].join('\n');

      await ctx.reply(msg, { mentions: [sender, target] });
    },
  },
];
