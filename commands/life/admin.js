/**
 * commands/life/admin.js — comandos administrativos do Lua Life (SOMENTE dono).
 *
 * Todos com ownerOnly:true (gate no pipeline central). Nunca acessíveis a
 * usuários comuns. Toda alteração monetária é registrada em economy_logs.
 */

'use strict';

const life = require('../../database/life');
const economy = require('../../database/economy');
const rpg = require('../../database/rpg');
const engine = require('../../plugins/life/engine');
const market = require('../../plugins/life/market');
const settings = require('../../database/settings');
const { formatMoney } = require('../../utils/formatter');
const { withLock } = require('../../utils/keyedMutex');
const { dropMentionArgs } = require('../../utils/messages');

module.exports = [
  {
    name: 'economia',
    commands: ['economia'],
    ownerOnly: true,
    category: 'life',
    description: 'Painel de economia do Lua Life (dono).',
    usage: '!economia',
    cooldown: 2000,
    execute: async (ctx) => {
      const s = life.stats();
      await ctx.reply(
        [
          '💰 *ECONOMIA DO LUA LIFE*',
          `▸ Jogadores: ${s.players}`,
          `▸ Com dinheiro: ${s.playersWithMoney}`,
          `▸ Carteira total: ${formatMoney(s.totalWallet)}`,
          `▸ Banco total: ${formatMoney(s.totalBank)}`,
          `▸ Dinheiro total: ${formatMoney(s.totalMoney)}`,
          `▸ Propriedades: ${s.properties} · Empresas: ${s.businesses}`,
          `▸ Ofertas ativas: ${s.marketOffers}`,
          `▸ Trabalhos: ${s.jobsDone} · Pesca: ${s.fishCaught} · Mineração: ${s.oresMined}`,
          `▸ Vendas: ${s.itemsSold} · Compras: ${s.itemsBought}`,
        ].join('\n')
      );
    },
  },
  {
    name: 'givecoin',
    commands: ['givecoin'],
    ownerOnly: true,
    category: 'life',
    description: 'Dá LuaCoins a um usuário (dono).',
    usage: '!givecoin @usuario <valor>',
    cooldown: 1000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0];
      // a menção também está dentro de ctx.args: sem remover, o valor lido
      // era o texto "@fulano" (parseInt -> NaN) e o comando nunca funcionava
      const args = dropMentionArgs(ctx.args, ctx.mentionedJid);
      const amount = parseInt(args[0], 10);
      if (!target || !Number.isFinite(amount)) return ctx.reply('⚠️ Use: !givecoin @usuario <valor> (negativo remove)');
      await withLock(target, () => {
        economy.addWallet(target, amount);
        life.logEconomy(target, 'admin_give', '', amount, economy.get(target).wallet, economy.get(target).wallet, `por ${ctx.sender}`);
      });
      await ctx.reply(`✅ Moedas concedidas: ${formatMoney(amount)} para @${target.split('@')[0]}.`);
    },
  },
  {
    name: 'setmoney',
    commands: ['setmoney'],
    ownerOnly: true,
    category: 'life',
    description: 'Define o saldo de um usuário (dono).',
    usage: '!setmoney @usuario <valor>',
    cooldown: 1000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0];
      // a menção também está dentro de ctx.args: sem remover, o valor lido
      // era o texto "@fulano" (parseInt -> NaN) e o comando nunca funcionava
      const args = dropMentionArgs(ctx.args, ctx.mentionedJid);
      const amount = parseInt(args[0], 10);
      if (!target || !Number.isFinite(amount)) return ctx.reply('⚠️ Use: !setmoney @usuario <valor>');
      await withLock(target, () => {
        economy.setWallet(target, Math.max(0, amount));
        life.logEconomy(target, 'admin_set', '', amount, economy.get(target).wallet, economy.get(target).wallet, `por ${ctx.sender}`);
      });
      await ctx.reply(`✅ Saldo definido: ${formatMoney(Math.max(0, amount))} para @${target.split('@')[0]}.`);
    },
  },
  {
    name: 'giveitem',
    commands: ['giveitem', 'additem'],
    ownerOnly: true,
    category: 'life',
    description: 'Dá um item (dono).',
    usage: '!giveitem @usuario <item> [qtd]',
    cooldown: 1000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0];
      // a menção também está dentro de ctx.args: sem remover, o valor lido
      // era o texto "@fulano" (parseInt -> NaN) e o comando nunca funcionava
      const args = dropMentionArgs(ctx.args, ctx.mentionedJid);
      const itemId = String(args[0] || '').toLowerCase();
      const qty = parseInt(args[1], 10) || 1;
      if (!target || !itemId) return ctx.reply('⚠️ Use: !giveitem @usuario <item> [qtd]');
      const item = rpg.getShopItem(itemId);
      if (!item) return ctx.reply('❌ Item não encontrado.');
      await withLock(target, () => {
        economy.addItem(target, itemId, qty);
        life.logEconomy(target, 'admin_item', itemId, qty, economy.get(target).wallet, economy.get(target).wallet, `por ${ctx.sender}`);
      });
      await ctx.reply(`✅ ${item.emoji} *${item.name}* x${qty} para @${target.split('@')[0]}.`);
    },
  },
  {
    name: 'removeitem',
    commands: ['removeitem'],
    ownerOnly: true,
    category: 'life',
    description: 'Remove um item (dono).',
    usage: '!removeitem @usuario <item> [qtd]',
    cooldown: 1000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0];
      // a menção também está dentro de ctx.args: sem remover, o valor lido
      // era o texto "@fulano" (parseInt -> NaN) e o comando nunca funcionava
      const args = dropMentionArgs(ctx.args, ctx.mentionedJid);
      const itemId = String(args[0] || '').toLowerCase();
      const qty = parseInt(args[1], 10) || 1;
      if (!target || !itemId) return ctx.reply('⚠️ Use: !removeitem @usuario <item> [qtd]');
      try {
        await withLock(target, () => {
          economy.removeItem(target, itemId, qty);
          life.logEconomy(target, 'admin_remove', itemId, -qty, economy.get(target).wallet, economy.get(target).wallet, `por ${ctx.sender}`);
        });
        await ctx.reply(`✅ Removido ${itemId} x${qty} de @${target.split('@')[0]}.`);
      } catch (_) {
        await ctx.reply('📦 O usuário não possui essa quantidade.');
      }
    },
  },
  {
    name: 'setlevel',
    commands: ['setlevel'],
    ownerOnly: true,
    category: 'life',
    description: 'Define o nível de vida de um usuário (dono).',
    usage: '!setlevel @usuario <nível>',
    cooldown: 1000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0];
      // a menção também está dentro de ctx.args: sem remover, o valor lido
      // era o texto "@fulano" (parseInt -> NaN) e o comando nunca funcionava
      const args = dropMentionArgs(ctx.args, ctx.mentionedJid);
      const value = parseInt(args[0], 10);
      if (!target || !Number.isFinite(value) || value < 1) return ctx.reply('⚠️ Use: !setlevel @usuario <nível>');
      await withLock(target, () => {
        life.updatePlayer(target, { level: Math.max(1, value), xp: Math.pow(Math.max(0, value - 1), 2) * 50 });
        life.logEconomy(target, 'admin_level', '', value, 0, 0, `por ${ctx.sender}`);
      });
      const p = life.getPlayer(target);
      await ctx.reply(`✅ ${displayName(target)}: nível ${p.level}, ${p.xp} XP.`);
    },
  },
  {
    name: 'setxp',
    commands: ['setxp'],
    ownerOnly: true,
    category: 'life',
    description: 'Define o XP de vida de um usuário (dono).',
    usage: '!setxp @usuario <xp>',
    cooldown: 1000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0];
      // a menção também está dentro de ctx.args: sem remover, o valor lido
      // era o texto "@fulano" (parseInt -> NaN) e o comando nunca funcionava
      const args = dropMentionArgs(ctx.args, ctx.mentionedJid);
      const value = parseInt(args[0], 10);
      if (!target || !Number.isFinite(value) || value < 0) return ctx.reply('⚠️ Use: !setxp @usuario <xp>');
      await withLock(target, () => {
        const level = life.lifeLevelFromXp(value);
        life.updatePlayer(target, { xp: value, level });
        life.logEconomy(target, 'admin_xp', '', value, 0, 0, `por ${ctx.sender}`);
      });
      const p = life.getPlayer(target);
      await ctx.reply(`✅ ${displayName(target)}: nível ${p.level}, ${p.xp} XP.`);
    },
  },
  {
    name: 'setprice',
    commands: ['setprice'],
    ownerOnly: true,
    category: 'life',
    description: 'Ajusta o preço de um item (dono).',
    usage: '!setprice <item> <base> [min] [max]',
    cooldown: 1000,
    execute: async (ctx) => {
      const itemId = String(ctx.args[0] || '').toLowerCase();
      const base = parseInt(ctx.args[1], 10);
      const min = parseInt(ctx.args[2], 10);
      const max = parseInt(ctx.args[3], 10);
      if (!itemId || !Number.isFinite(base)) return ctx.reply('⚠️ Use: !setprice <item> <base> [min] [max]');
      market.setPriceOverride(itemId, { base, min: Number.isFinite(min) ? min : undefined, max: Number.isFinite(max) ? max : undefined });
      await ctx.reply(`✅ Preço de *${itemId}* ajustado (base ${formatMoney(base)}).`);
    },
  },
  {
    name: 'event',
    commands: ['event'],
    ownerOnly: true,
    category: 'life',
    description: 'Força/desativa o evento ativo (dono).',
    usage: '!event <id|off>',
    cooldown: 1000,
    execute: async (ctx) => {
      const arg = String(ctx.args[0] || '').toLowerCase();
      if (!arg) return ctx.reply('⚠️ Use: !event <id|off>. Eventos: ' + require('../../plugins/life/config').EVENTS.map((e) => e.id).join(', '));
      if (arg === 'off') {
        settings.set('life_event_override', 'off');
        return ctx.reply('✅ Evento forçado: nenhum (ciclo normal pausado).');
      }
      const ev = require('../../plugins/life/config').EVENTS.find((e) => e.id === arg);
      if (!ev) return ctx.reply('❌ Evento inválido.');
      settings.set('life_event_override', ev.id);
      await ctx.reply(`✅ Evento forçado: ${ev.emoji} *${ev.name}*.`);
    },
  },
  {
    name: 'player',
    commands: ['player', 'jogador'],
    ownerOnly: true,
    category: 'life',
    description: 'Inspeciona um jogador (dono).',
    usage: '!player @usuario',
    cooldown: 1000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0] || ctx.sender;
      const p = life.getPlayer(target);
      const eco = economy.get(target);
      await ctx.reply(
        [
          `👤 *${displayName(target)}* (admin)`,
          `▸ ID: \`${target}\``,
          `▸ Personagem: ${p.name || '-'} · Nível ${p.level} · ${p.xp} XP`,
          `▸ Cargo: ${p.career_level} (${p.career_xp} XP)`,
          `▸ Carteira: ${formatMoney(eco.wallet)} · Banco: ${formatMoney(eco.bank)}`,
          `▸ Energia: ${p.energy}/200 · Sorte: ${p.luck}`,
        ].join('\n')
      );
    },
  },
  {
    name: 'economylog',
    commands: ['economy'],
    ownerOnly: true,
    category: 'life',
    description: 'Últimos logs econômicos (dono).',
    usage: '!economy',
    cooldown: 2000,
    execute: async (ctx) => {
      const logs = life.recentLogs(10);
      if (!logs.length) return ctx.reply('📜 Nenhum log econômico ainda.');
      const lines = logs.map((l) => `${l.action} ${l.item || ''} ${l.amount >= 0 ? '+' : ''}${l.amount} (${displayName(l.user_id)})`);
      await ctx.reply(`📜 *Logs econômicos (últimos ${logs.length})*\n${lines.join('\n')}`);
    },
  },
];

function displayName(jid) {
  const users = require('../../database/users');
  const u = users.get(jid);
  return u && u.name ? u.name : '@' + String(jid).split('@')[0];
}
