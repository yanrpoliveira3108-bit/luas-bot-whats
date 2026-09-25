/**
 * utils/coopEvents.js — Sistema de Eventos Cooperativos (Raid de Grupo / Chefe).
 *
 * Características:
 * - Chefe de grupo cooperativo com HP compartilhado
 * - Entrada de participantes (!evento entrar)
 * - Ações limitadas por cooldown/rodada (!evento agir)
 * - Distribuição determinística de recompensas por contribuição
 * - Pagamento único registrado no economy_ledger
 * - Persistência em memória/banco e idempotência
 */

'use strict';

const economy = require('../database/economy');
const { withLock } = require('./keyedMutex');
const { formatMoney } = require('./formatter');

// Estado de eventos ativos por grupo: chatId -> EventState
const GROUP_EVENTS = new Map();

function getOrCreateEvent(chatId) {
  let ev = GROUP_EVENTS.get(chatId);
  if (!ev || ev.status === 'defeated' || Date.now() > ev.expiresAt) {
    ev = {
      id: `raid-${Date.now()}`,
      chatId,
      bossName: 'Dragão Carmesim de Fogo',
      bossEmoji: '🐉',
      maxHp: 1000,
      hp: 1000,
      totalReward: 5000,
      participants: new Map(), // userId -> { damage: number, lastAction: number, rewarded: boolean }
      status: 'active',
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hora de evento
    };
    GROUP_EVENTS.set(chatId, ev);
  }
  return ev;
}

async function handleEventCommand(ctx, sub) {
  const chatId = ctx.isGroup ? ctx.remoteJid : 'global';
  const sender = ctx.sender;
  const ev = getOrCreateEvent(chatId);

  if (sub === 'status' || sub === 'chefe' || sub === 'raid') {
    const partsCount = ev.participants.size;
    const hpPct = Math.max(0, Math.round((ev.hp / ev.maxHp) * 100));
    const bar = '█'.repeat(Math.ceil(hpPct / 10)) + '░'.repeat(10 - Math.ceil(hpPct / 10));

    let topDamagers = [...ev.participants.entries()]
      .sort((a, b) => b[1].damage - a[1].damage)
      .slice(0, 5)
      .map(([u, d], idx) => `${idx + 1}. @${u.split('@')[0]} — ${d.damage} dano`)
      .join('\n');

    const lines = [
      `⚔️ *EVENTO COOPERATIVO: ${ev.bossName.toUpperCase()}*`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `▸ Status: ${ev.status === 'active' ? '🟢 Em Batalha' : '🏁 Concluído'}`,
      `▸ Vida do Chefe: [${bar}] ${ev.hp}/${ev.maxHp} HP (${hpPct}%)`,
      `▸ Recompensa Total: ${formatMoney(ev.totalReward)} em disputa`,
      `▸ Participantes Ativos: ${partsCount}`,
      '',
      topDamagers ? `🏆 *Maiores Danos:*\n${topDamagers}\n` : 'Nenhum ataque desferido ainda.\n',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `👉 Digite *${ctx.prefix}evento entrar* para participar!`,
      `👉 Digite *${ctx.prefix}evento agir* para atacar o chefe!`,
    ];

    const mentions = [...ev.participants.keys()].slice(0, 5);
    return ctx.reply(lines.join('\n'), { mentions });
  }

  if (sub === 'entrar' || sub === 'join') {
    if (ev.status !== 'active') return ctx.reply('🏁 Este evento já foi concluído!');
    if (ev.participants.has(sender)) {
      return ctx.reply('✅ Você já está inscrito neste evento! Digite *!evento agir* para atacar.');
    }
    ev.participants.set(sender, { damage: 0, lastAction: 0, rewarded: false });
    return ctx.reply(
      `🎉 @${sender.split('@')[0]} juntou-se à batalha contra o *${ev.bossName}*!\n` +
      `Use *${ctx.prefix}evento agir* para desferir golpes!`,
      { mentions: [sender] }
    );
  }

  if (sub === 'agir' || sub === 'atacar' || sub === 'bater') {
    if (ev.status !== 'active') return ctx.reply('🏁 O chefe já foi derrotado!');
    if (!ev.participants.has(sender)) {
      ev.participants.set(sender, { damage: 0, lastAction: 0, rewarded: false });
    }

    return withLock(`raid-${chatId}`, async () => {
      const p = ev.participants.get(sender);
      const now = Date.now();
      const COOLDOWN_ACTION = 15 * 1000; // 15s entre ataques

      if (now - p.lastAction < COOLDOWN_ACTION) {
        const wait = Math.ceil((COOLDOWN_ACTION - (now - p.lastAction)) / 1000);
        return ctx.reply(`⏳ Descanse seus golpes! Tente atacar novamente em *${wait}s*.`);
      }

      // Cálculo de dano (base 30-70)
      const dmg = Math.floor(Math.random() * 41) + 30;
      p.damage += dmg;
      p.lastAction = now;
      ev.hp = Math.max(0, ev.hp - dmg);

      if (ev.hp === 0) {
        ev.status = 'defeated';
        // Distribuição determinística de recompensas
        const totalDamage = [...ev.participants.values()].reduce((sum, part) => sum + part.damage, 0);
        const rewardLines = [];
        const mentions = [];

        for (const [userId, part] of ev.participants.entries()) {
          if (part.damage > 0 && !part.rewarded) {
            part.rewarded = true;
            const share = Math.max(10, Math.floor((part.damage / totalDamage) * ev.totalReward));
            const opKey = `raid-reward-${ev.id}-${userId}`;
            economy.applyIdempotentOperation(opKey, userId, share, 'recompensa', `Vitória contra ${ev.bossName}`);
            rewardLines.push(`▸ @${userId.split('@')[0]}: ${part.damage} dano → *${formatMoney(share)}*`);
            mentions.push(userId);
          }
        }

        return ctx.reply(
          `🏆 *O ${ev.bossName.toUpperCase()} FOI DERROTADO!*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Parabéns aos guerreiros! A recompensa foi creditada no extrato de todos:\n\n` +
          `${rewardLines.join('\n')}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          { mentions }
        );
      }

      return ctx.reply(
        `💥 @${sender.split('@')[0]} atacou o *${ev.bossName}* e causou *${dmg} de dano*!\n` +
        `❤️ Vida restante do chefe: *${ev.hp}/${ev.maxHp} HP*`,
        { mentions: [sender] }
      );
    });
  }

  return ctx.reply(`💡 Use *${ctx.prefix}evento status*, *${ctx.prefix}evento entrar* ou *${ctx.prefix}evento agir*.`);
}

module.exports = {
  handleEventCommand,
  getOrCreateEvent,
};
