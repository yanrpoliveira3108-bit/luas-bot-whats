/**
 * utils/coopEvents.js — Sistema de Eventos Cooperativos (Raid de Grupo / Chefe).
 *
 * Características:
 * - Chefe de grupo cooperativo com HP compartilhado
 * - Entrada de participantes (!evento entrar)
 * - Ações limitadas por cooldown/rodada (!evento agir)
 * - Distribuição determinística de recompensas por contribuição
 * - Pagamento único registrado no economy_ledger
 * - Persistência completa em banco de dados SQLite (sobrevive a reinicializações)
 */

'use strict';

const db = require('../database/database');
const economy = require('../database/economy');
const { withLock } = require('./keyedMutex');
const { formatMoney } = require('./formatter');

function loadEventFromDb(chatId) {
  const row = db.prepare(
    'get_active_coop_event',
    `SELECT * FROM coop_events WHERE chat_id = ? AND status = 'active' ORDER BY expires_at DESC LIMIT 1`
  ).get(chatId);

  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare('expire_coop_event', `UPDATE coop_events SET status = 'expired' WHERE id = ?`).run(row.id);
    return null;
  }

  // Carregar participantes
  const partsRows = db.prepare(
    'get_coop_parts',
    `SELECT * FROM coop_participants WHERE event_id = ?`
  ).all(row.id);

  const participants = new Map();
  for (const p of partsRows) {
    participants.set(p.user_id, {
      damage: p.damage,
      lastAction: p.last_action,
      rewarded: Boolean(p.rewarded),
    });
  }

  return {
    id: row.id,
    chatId: row.chat_id,
    bossName: row.boss_name,
    bossEmoji: row.boss_emoji || '🐉',
    maxHp: row.max_hp,
    hp: row.hp,
    totalReward: row.total_reward,
    participants,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

function saveEventToDb(ev) {
  db.prepare(
    'upsert_coop_event',
    `INSERT INTO coop_events (id, chat_id, boss_name, boss_emoji, max_hp, hp, total_reward, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       hp = excluded.hp,
       status = excluded.status`
  ).run(
    ev.id,
    ev.chatId,
    ev.bossName,
    ev.bossEmoji,
    ev.maxHp,
    ev.hp,
    ev.totalReward,
    ev.status,
    ev.expiresAt,
    new Date().toISOString()
  );
}

function saveParticipantToDb(eventId, userId, part) {
  db.prepare(
    'upsert_coop_part',
    `INSERT INTO coop_participants (event_id, user_id, damage, last_action, rewarded)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(event_id, user_id) DO UPDATE SET
       damage = excluded.damage,
       last_action = excluded.last_action,
       rewarded = excluded.rewarded`
  ).run(eventId, userId, part.damage, part.lastAction, part.rewarded ? 1 : 0);
}

function getOrCreateEvent(chatId) {
  let ev = loadEventFromDb(chatId);
  if (!ev) {
    ev = {
      id: `raid-${Date.now()}`,
      chatId,
      bossName: 'Dragão Carmesim de Fogo',
      bossEmoji: '🐉',
      maxHp: 1000,
      hp: 1000,
      totalReward: 5000,
      participants: new Map(),
      status: 'active',
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hora de evento
    };
    saveEventToDb(ev);
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
    const part = { damage: 0, lastAction: 0, rewarded: false };
    ev.participants.set(sender, part);
    saveParticipantToDb(ev.id, sender, part);

    return ctx.reply(
      `🎉 @${sender.split('@')[0]} juntou-se à batalha contra o *${ev.bossName}*!\n` +
      `Use *${ctx.prefix}evento agir* para desferir golpes!`,
      { mentions: [sender] }
    );
  }

  if (sub === 'agir' || sub === 'atacar' || sub === 'bater') {
    if (ev.status !== 'active') return ctx.reply('🏁 O chefe já foi derrotado!');

    return withLock(`raid-${chatId}`, async () => {
      // Revalidação com estado mais recente
      const freshEv = loadEventFromDb(chatId) || ev;
      if (freshEv.status !== 'active') return ctx.reply('🏁 O chefe já foi derrotado!');

      let p = freshEv.participants.get(sender);
      if (!p) {
        p = { damage: 0, lastAction: 0, rewarded: false };
        freshEv.participants.set(sender, p);
      }

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
      freshEv.hp = Math.max(0, freshEv.hp - dmg);

      if (freshEv.hp === 0) {
        freshEv.status = 'defeated';
        saveEventToDb(freshEv);
        saveParticipantToDb(freshEv.id, sender, p);

        // Distribuição determinística de recompensas
        const totalDamage = [...freshEv.participants.values()].reduce((sum, part) => sum + part.damage, 0);
        const rewardLines = [];
        const mentions = [];

        for (const [userId, part] of freshEv.participants.entries()) {
          if (part.damage > 0 && !part.rewarded) {
            part.rewarded = true;
            saveParticipantToDb(freshEv.id, userId, part);
            const share = Math.max(10, Math.floor((part.damage / totalDamage) * freshEv.totalReward));
            const opKey = `raid-reward-${freshEv.id}-${userId}`;
            economy.applyIdempotentOperation(opKey, userId, share, 'recompensa', `Vitória contra ${freshEv.bossName}`);
            rewardLines.push(`▸ @${userId.split('@')[0]}: ${part.damage} dano → *${formatMoney(share)}*`);
            mentions.push(userId);
          }
        }

        return ctx.reply(
          `🏆 *O ${freshEv.bossName.toUpperCase()} FOI DERROTADO!*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Parabéns aos guerreiros! A recompensa foi creditada no extrato de todos:\n\n` +
          `${rewardLines.join('\n')}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          { mentions }
        );
      }

      saveEventToDb(freshEv);
      saveParticipantToDb(freshEv.id, sender, p);

      return ctx.reply(
        `💥 @${sender.split('@')[0]} atacou o *${freshEv.bossName}* e causou *${dmg} de dano*!\n` +
        `❤️ Vida restante do chefe: *${freshEv.hp}/${freshEv.maxHp} HP*`,
        { mentions: [sender] }
      );
    });
  }

  return ctx.reply(`💡 Use *${ctx.prefix}evento status*, *${ctx.prefix}evento entrar* ou *${ctx.prefix}evento agir*.`);
}

module.exports = {
  handleEventCommand,
  getOrCreateEvent,
  loadEventFromDb,
};
