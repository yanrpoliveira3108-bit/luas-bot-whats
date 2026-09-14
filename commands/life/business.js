/**
 * commands/life/business.js — empresas, funcionários e coleta de lucro.
 */

'use strict';

const life = require('../../database/life');
const engine = require('../../plugins/life/engine');
const { BUSINESSES, EMPLOYEES } = require('../../plugins/life/config');
const { formatMoney } = require('../../utils/formatter');

module.exports = [
  {
    name: 'empresas',
    commands: ['empresas', 'negocios', 'funcionarios'],
    category: 'life',
    description: 'Lista suas empresas.',
    usage: '!empresas',
    cooldown: 2000,
    execute: async (ctx) => {
      const list = life.listBusinesses(ctx.sender);
      if (!list.length) {
        const lines = BUSINESSES.map((b) => `${b.emoji} *${b.name}* — ${formatMoney(b.price)} (nível ${b.levelReq}+)`);
        return ctx.reply(`🏢 *Empresas disponíveis*\n${lines.join('\n')}\n\nAbra com ${ctx.prefix}abrirempresa <tipo>.`);
      }
      const lines = list.map((b) => `#${b.id} ${BUSINESSES.find((x) => x.id === b.kind).emoji} *${b.name}* (nível ${b.level}) — ${b.employees} funcionário(s)\n▸ Coletar: ${ctx.prefix}coletar ${b.id}`);
      await ctx.reply(`🏢 *Suas empresas (${list.length})*\n${lines.join('\n')}`);
    },
  },
  {
    name: 'abrirempresa',
    commands: ['abrirempresa', 'criarempresa'],
    category: 'life',
    description: 'Abre uma empresa.',
    usage: '!abrirempresa <tipo> [nome]',
    cooldown: 3000,
    execute: async (ctx) => {
      const kind = String(ctx.args[0] || '').toLowerCase();
      const name = ctx.args.slice(1).join(' ').slice(0, 20) || '';
      if (!kind) return ctx.reply('⚠️ Use: !abrirempresa <tipo>. Tipos: ' + BUSINESSES.map((b) => b.id).join(', '));
      try {
        const r = await engine.openBusiness(ctx.sender, kind, name);
        await ctx.reply(`${r.def.emoji} *${r.def.name}* aberta! (ID ${r.id})\n▸ Coletar lucro: ${ctx.prefix}coletar ${r.id}\n▸ Contratar: ${ctx.prefix}contratar ${r.id} <tipo>`);
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível abrir a empresa.');
      }
    },
  },
  {
    name: 'contratar',
    commands: ['contratar', 'funcionario'],
    category: 'life',
    description: 'Contrata um funcionário para a empresa.',
    usage: '!contratar <empresaId> <tipo>',
    cooldown: 3000,
    execute: async (ctx) => {
      const bizId = parseInt(ctx.args[0], 10);
      const empId = String(ctx.args[1] || '').toLowerCase();
      if (!bizId || !empId) {
        const lines = EMPLOYEES.map((e) => `${e.emoji} *${e.name}* — ${formatMoney(e.wagePerH)}/h`);
        return ctx.reply(`👷 *Funcionários*\n${lines.join('\n')}\n\nContrate: ${ctx.prefix}contratar <empresaId> <tipo>`);
      }
      try {
        const emp = await engine.hireEmployee(ctx.sender, bizId, empId);
        await ctx.reply(`${emp.emoji} *${emp.name}* contratado! Ele aumenta a produção da empresa.`);
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível contratar.');
      }
    },
  },
  {
    name: 'coletar',
    commands: ['coletar', 'lucro', 'producao'],
    category: 'life',
    description: 'Coleta o lucro de uma empresa.',
    usage: '!coletar <empresaId>',
    cooldown: 3000,
    execute: async (ctx) => {
      const bizId = parseInt(ctx.args[0], 10);
      if (!bizId) return ctx.reply('⚠️ Use: !coletar <empresaId> (veja seus IDs em !empresas).');
      try {
        const r = await engine.collectBusiness(ctx.sender, bizId);
        const lines = [
          `🏢 *Lucro coletado (${Math.floor(r.hours)}h)*`,
          `▸ Receita: ${formatMoney(r.revenue)}`,
          `▸ Custos: ${formatMoney(r.costs)}`,
          `▸ Lucro: ${formatMoney(r.profit)}`,
        ];
        if (r.leveled) lines.push(`🎉 *Nível ${r.level}!*`);
        await ctx.reply(lines.join('\n'));
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível coletar.');
      }
    },
  },
];
