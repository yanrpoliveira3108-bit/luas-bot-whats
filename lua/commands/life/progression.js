/**
 * commands/life/progression.js — missões e conquistas.
 */

'use strict';

const life = require('../../database/life');
const engine = require('../../plugins/life/engine');
const networth = require('../../plugins/life/networth');
const { MISSIONS, ACHIEVEMENTS } = require('../../plugins/life/config');
const { formatMoney } = require('../../utils/formatter');

module.exports = [
  {
    name: 'missoes',
    commands: ['missoes', 'missao'],
    category: 'life',
    description: 'Lista suas missões (ou resgata: !missao <id>).',
    usage: '!missoes | !missao <id>',
    cooldown: 2000,
    execute: async (ctx) => {
      const id = String(ctx.args[0] || '').toLowerCase();
      if (id && MISSIONS.find((m) => m.id === id)) {
        try {
          const def = await engine.claimMissionReward(ctx.sender, id);
          return ctx.reply(`🎉 *Missão concluída!*\n▸ ${def.desc}\n▸ Recompensa: ${formatMoney(def.reward)}\n▸ XP: +${def.xp}`);
        } catch (err) {
          return ctx.reply((err && err.message) || '😕 Não foi possível resgatar.');
        }
      }

      const rows = life.listMissions(ctx.sender);
      const byId = new Map(rows.map((r) => [r.mission_id, r]));
      const nw = networth.compute(ctx.sender).total;
      const lines = MISSIONS.map((m) => {
        const row = byId.get(m.id);
        const progress = m.metric === 'networth' ? nw
          : m.metric === 'house' ? life.listProperties(ctx.sender).filter((p) => p.kind === 'casa').length
            : row ? row.progress : 0;
        const done = progress >= m.target;
        const status = row && row.status === 'claimed' ? '✅' : done ? '🎁 (resgate: !missao ' + m.id + ')' : `${progress}/${m.target}`;
        return `${m.emoji} *${m.desc}* — ${status}\n▸ Recompensa: ${formatMoney(m.reward)} + ${m.xp} XP`;
      });
      const { maybeReadMore } = require('../../utils/readmore');
      await ctx.reply(maybeReadMore(`📜 *MISSÕES*\n${lines.join('\n')}`));
    },
  },
  {
    name: 'conquistas',
    commands: ['conquistas', 'achievements'],
    category: 'life',
    description: 'Lista suas conquistas.',
    usage: '!conquistas',
    cooldown: 2000,
    execute: async (ctx) => {
      const unlocked = new Set(life.listAchievements(ctx.sender).map((a) => a.achievement_id));
      const lines = ACHIEVEMENTS.map((a) => {
        const has = unlocked.has(a.id);
        return `${has ? '✅' : '🔒'} ${a.emoji} *${a.name}* — ${a.desc}${has ? '' : ` (recompensa: ${formatMoney(a.reward)})`}`;
      });
      const { maybeReadMore } = require('../../utils/readmore');
      await ctx.reply(maybeReadMore(`🏆 *CONQUISTAS (${unlocked.size}/${ACHIEVEMENTS.length})*\n${lines.join('\n')}`));
    },
  },
];
