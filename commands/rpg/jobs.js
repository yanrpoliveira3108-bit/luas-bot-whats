/**
 * commands/rpg/jobs.js — profissões evoluídas do Lua Life.
 *
 * !empregos / !emprego escolhem a profissão (persistida em rpg_players).
 * !trabalhar usa o motor do Lua Life (energia, atributos, carreira, XP,
 * cooldown, eventos) — UMA única implementação de trabalho.
 */

'use strict';

const rpg = require('../../database/rpg');
const economy = require('../../database/economy');
const actionImage = require('../../utils/actionImage');
const life = require('../../database/life');
const engine = require('../../plugins/life/engine');
const { JOBS } = require('../../plugins/life/config');
const { formatMoney, formatDuration } = require('../../utils/formatter');
const { withLock } = require('../../utils/keyedMutex');

function hasJobTool(userId, job) {
  if (!job.requires) return true;
  return job.requires.some((id) => {
    const item = economy.getItem(userId, id);
    if (item && item.quantity >= 1) return true;
    const t = life.getTool(userId, id);
    return t && t.uses_left > 0;
  });
}

module.exports = [
  {
    name: 'empregos',
    commands: ['empregos', 'profissoes', 'trabalhos'],
    category: 'rpg',
    description: 'Lista as profissões disponíveis.',
    usage: '!empregos',
    cooldown: 2000,
    execute: async (ctx) => {
      const lines = JOBS.map((j) => {
        const req = j.requires ? ` — requer ${j.requires[0].replace(/_/g, ' ')}` : '';
        const lvl = j.levelReq > 1 ? ` — nível ${j.levelReq}+` : '';
        return `${j.emoji} *${j.name}* — ${formatMoney(j.reward[0])}-${formatMoney(j.reward[1])} a cada ${formatDuration(j.cooldownMs)}${req}${lvl}`;
      });
      const { maybeReadMore } = require('../../utils/readmore');
      await ctx.reply(maybeReadMore(`💼 *Profissões* (${JOBS.length})\n${lines.join('\n')}\n\nUse ${ctx.prefix}emprego <profissão> para escolher.\nCarreira: ${ctx.prefix}carreira`));
    },
  },
  {
    name: 'emprego',
    commands: ['emprego', 'profissao'],
    category: 'rpg',
    description: 'Escolhe sua profissão.',
    usage: '!emprego <profissão>',
    cooldown: 2000,
    execute: async (ctx) => {
      const id = (ctx.args[0] || '').toLowerCase();
      const job = JOBS.find((j) => j.id === id || j.name.toLowerCase() === id);
      if (!job) return ctx.reply(`⚠️ Profissão não encontrada. Veja: ${ctx.prefix}empregos`);
      if (!hasJobTool(ctx.sender, job)) {
        return ctx.reply(`🛠️ Para ser *${job.name}* você precisa de: ${job.requires.join(' ou ')}. Compre na loja (${ctx.prefix}loja).`);
      }
      const p = life.getPlayer(ctx.sender);
      if (p.level < (job.levelReq || 1)) {
        return ctx.reply(`📈 Você precisa do nível *${job.levelReq}* para ser ${job.name} (seu nível: ${p.level}).`);
      }
      await withLock(ctx.sender, () => {
        const rp = rpg.getPlayer(ctx.sender);
        if (rp.profession && rp.profession !== job.name) {
          life.updatePlayer(ctx.sender, { career_xp: 0, career_level: 1 });
        }
        rpg.setProfession(ctx.sender, job.name);
      });
      await ctx.reply(`✅ Profissão definida: ${job.emoji} *${job.name}*.\nTrabalhe com ${ctx.prefix}trabalhar!`);
    },
  },
  {
    name: 'trabalhar',
    commands: ['trabalhar', 'work'],
    category: 'rpg',
    description: 'Trabalha e ganha LuaCoins.',
    usage: '!trabalhar',
    cooldown: 3000,
    execute: async (ctx) => {
      try {
        const r = await engine.work(ctx.sender);
        const lines = [
          `${r.job.emoji} *TRABALHO*`,
          `▸ Cargo: ${r.careerTitle}`,
          `▸ Pagamento: ${formatMoney(r.reward)}`,
          `▸ XP: +${r.xp}`,
          `▸ Energia: -${r.job.energy} (${r.energy}/200)`,
        ];
        if (r.leveled) lines.push(`🎉 *Você subiu para o nível ${r.level}!* Novo título: ${r.newTitle}`);
        await actionImage.send(ctx, 'trabalhar', lines.join('\n'));
      } catch (err) {
        if (err && err.code === 'COOLDOWN') {
          const remaining = rpg.getCooldownRemaining('life', ctx.sender, 'trabalhar');
          return ctx.reply(`⏳ Você já trabalhou. Aguarde ${formatDuration(remaining)}.`);
        }
        await ctx.reply((err && err.message) || '😕 Não foi possível trabalhar.');
      }
    },
  },
  {
    name: 'carreira',
    commands: ['carreira'],
    category: 'rpg',
    description: 'Mostra sua carreira atual.',
    usage: '!carreira',
    cooldown: 2000,
    execute: async (ctx) => {
      const rp = rpg.getPlayer(ctx.sender);
      const p = life.getPlayer(ctx.sender);
      const job = JOBS.find((j) => j.name === rp.profession);
      if (!job) return ctx.reply(`⚠️ Você ainda não tem profissão. Use ${ctx.prefix}empregos.`);
      const tier = job.tiers[Math.min(p.career_level, job.tiers.length) - 1];
      const next = job.tiers[p.career_level] || null;
      await ctx.reply(
        [
          `💼 *Sua carreira*`,
          `▸ Profissão: ${job.emoji} ${job.name}`,
          `▸ Cargo: ${tier}`,
          `▸ XP de carreira: ${p.career_xp}/100${next ? ` (próximo: ${next})` : ' (cargo máximo)'}`,
          `▸ Nível de vida: ${p.level}`,
        ].join('\n')
      );
    },
  },
];
