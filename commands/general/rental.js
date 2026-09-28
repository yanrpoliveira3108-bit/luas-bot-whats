'use strict';

const rental = require('../../database/rental');
const poster = require('../../utils/rentalPoster');
const htmlRental = require('../../utils/htmlRental');
const { detectMediaType } = require('../../utils/messages');

const label = { NUMBER: 'Número', BOT: 'Bot', RENTAL: 'Aluguel', DATABASE: 'Database', HOST: 'Host' };
function planLabel(p) { return ({ FREE: 'GRÁTIS', TEST: 'TESTE', RENTAL: 'ALUGUEL' }[p] || p); }
function fmtDate(v) { return v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'; }
function remaining(ms) { if (ms === null) return 'infinito'; if (!ms || ms < 0) return 'expirado'; const d = Math.floor(ms / 86400000); const h = Math.floor(ms % 86400000 / 3600000); return `${d}d ${h}h`; }
function statusText(ctx) { const s = rental.getGroupSubscription(ctx.remoteJid); return ['🌙 *LUA • PLANO*', '', `Grupo: ${ctx.groupName || 'este grupo'}`, `Plano: ${planLabel(s.plan)}`, `Status: ${s.status === 'ACTIVE' ? 'ATIVO' : 'EXPIRADO'}`, `Início: ${fmtDate(s.started_at)}`, `Expira: ${fmtDate(s.expires_at)}`, `Tempo restante: ${remaining(s.remainingMs)}`, `Modo aluguel: ${s.rentalModeEnabled ? 'ATIVO' : 'INATIVO'}`].join('\n'); }
async function ownerOnly(ctx) { if (!ctx.isOwner) { await ctx.reply('🚫 Apenas o dono pode alterar esta configuração.'); return false; } return true; }
function catalogText(includeInactive) { return ['🌙 *LUA • VALORES*', '', ...rental.getCatalog(includeInactive).map((i) => `${label[i.key] || i.label}: ${rental.formatMoney(i.price_cents, i.currency)}${i.active ? '' : ' (inativo)'}`)].join('\n'); }

const aluguel = {
  name: 'aluguel', commands: ['aluguel'], category: 'general', cooldown: 1500,
  description: 'Mostra o catálogo de valores.', usage: ',aluguel',
  execute: async (ctx) => {
    const sub = String(ctx.args[0] || '').toLowerCase();
    if (!sub) return htmlRental.send(ctx);
    if (sub === 'valores' || sub === 'valor' || sub === 'status') {
      if (sub === 'status' && !ctx.isOwner) return ctx.reply(catalogText(false));
      if (sub === 'status' && ctx.isOwner) return ctx.reply(catalogText(true));
      if (sub === 'valor' && ctx.args.length === 1) return ctx.reply(catalogText(ctx.isOwner));
      if (!(await ownerOnly(ctx))) return;
      const key = ({ numero: 'NUMBER', number: 'NUMBER', bot: 'BOT', aluguel: 'RENTAL', rental: 'RENTAL', database: 'DATABASE', host: 'HOST' })[String(ctx.args[1] || '').toLowerCase()] || String(ctx.args[1] || '').toUpperCase();
      const price = ctx.args[2];
      if (!key || price === undefined) return ctx.reply('Uso: ,aluguel valor numero <valor>');
      try { const item = rental.setCatalogPrice(key, price); return ctx.reply(`✅ ${item.label}: ${rental.formatMoney(item.price_cents, item.currency)}`); } catch (e) { return ctx.reply(e.message === 'MONEY_INVALID' ? '❌ Valor inválido. Use 7, 7,50 ou 7.50.' : '❌ Categoria inválida.'); }
    }
    if (sub === 'tempo') {
      if (!(await ownerOnly(ctx))) return;
      const plan = String(ctx.args[1] || '').toUpperCase(); const raw = ctx.args[2];
      if (!plan || raw === undefined) return ctx.reply('Uso: ,aluguel tempo teste 24h');
      try { const ms = raw.toLowerCase() === 'infinito' ? null : rental.parseDuration(raw); rental.setPlanDefaultDuration(plan, ms); return ctx.reply(`✅ Duração padrão ${planLabel(plan)}: ${rental.durationLabel(ms)}.`); } catch (_) { return ctx.reply('❌ Plano ou duração inválida. Use 30m, 12h, 1d, 7d, 30d ou infinito.'); }
    }
    if (sub === 'modo') return ctx.reply('Use ,modoaluguel on|off|status.');
    return ctx.reply('Use ,aluguel para ver o catálogo ou ,aluguel valor.');
  },
};

const atualizar = {
  name: 'atualizar', commands: ['atualizar'], category: 'general', ownerOnly: true, cooldown: 3000,
  description: 'Atualiza o cartaz comercial respondido.', usage: ',atualizar aluguel',
  execute: async (ctx) => {
    if (String(ctx.args[0] || '').toLowerCase() !== 'aluguel') return ctx.reply('Uso: ,atualizar aluguel respondendo a uma imagem.');
    if (!ctx.quoted || detectMediaType({ message: ctx.quoted }) !== 'image') return ctx.reply('❌ Responda a uma imagem válida.');
    const media = await ctx.downloadMedia();
    if (!media || media.type !== 'image') return ctx.reply('❌ Não foi possível baixar a imagem.');
    try { const result = await poster.update(media.buffer, ctx.quoted.imageMessage && ctx.quoted.imageMessage.mimetype, ctx.sender); await ctx.sendImage(result.path, '✅ Cartaz de aluguel atualizado.'); } catch (_) { await ctx.reply('❌ Imagem inválida, corrompida ou acima do limite permitido.'); }
  },
};

const plano = {
  name: 'plano', commands: ['plano'], category: 'general', cooldown: 1500,
  description: 'Consulta ou altera o plano do grupo.', usage: ',plano [free|teste|aluguel] [duração]',
  execute: async (ctx) => {
    if (!ctx.isGroup) return ctx.reply('❌ Este comando precisa ser usado em um grupo.');
    const p = String(ctx.args[0] || '').toLowerCase();
    if (!p || p === 'status') return ctx.reply(statusText(ctx));
    if (!(await ownerOnly(ctx))) return;
    const plan = ({ free: 'FREE', teste: 'TEST', aluguel: 'RENTAL' })[p]; if (!plan) return ctx.reply('❌ Plano inválido.');
    try { const durationMs = ctx.args[1] ? rental.parseDuration(ctx.args[1]) : undefined; const s = rental.setGroupPlan(ctx.remoteJid, plan, { durationMs, activatedBy: ctx.sender }); return ctx.reply(`✅ Plano ${planLabel(s.plan)} ativado.\nStatus: ${s.status === 'ACTIVE' ? 'ATIVO' : 'EXPIRADO'}\nExpira: ${fmtDate(s.expires_at)}`); } catch (_) { return ctx.reply('❌ Duração inválida. Use 30m, 12h, 1d, 7d ou 30d.'); }
  },
};

const modo = {
  name: 'modoaluguel', commands: ['modoaluguel'], category: 'general', cooldown: 1500,
  description: 'Ativa o acesso ao modo aluguel no grupo.', usage: ',modoaluguel on|off|status',
  execute: async (ctx) => { if (!ctx.isGroup) return ctx.reply('❌ Use em um grupo.'); const op = String(ctx.args[0] || 'status').toLowerCase(); if (op === 'status') { const s = rental.getGroupSubscription(ctx.remoteJid); return ctx.reply(`🌙 Modo aluguel: ${s.rentalModeEnabled ? 'ATIVO' : 'INATIVO'}`); } if (!(await ownerOnly(ctx))) return; if (!['on','off'].includes(op)) return ctx.reply('Uso: ,modoaluguel on|off|status'); const s = rental.setRentalMode(ctx.remoteJid, op === 'on'); return ctx.reply(`✅ Modo aluguel ${s.rentalModeEnabled ? 'ativado' : 'desativado'}.`); },
};

const bot = {
  name: 'bot', commands: ['bot'], category: 'general', cooldown: 1000,
  description: 'Ativa ou desativa o bot neste grupo.', usage: ',bot on|off|status',
  execute: async (ctx) => { if (!ctx.isGroup) return ctx.reply('❌ Use em um grupo.'); const op = String(ctx.args[0] || 'status').toLowerCase(); const s = rental.getGroupSubscription(ctx.remoteJid); if (op === 'status') return ctx.reply(`🤖 *LUA • STATUS DO GRUPO*\n\nBot: ${s.botEnabled ? 'ATIVO' : 'DESATIVADO'}\nPlano: ${planLabel(s.plan)}\nModo aluguel: ${s.rentalModeEnabled ? 'ATIVO' : 'INATIVO'}`); if (!(await ownerOnly(ctx))) return; if (!['on','off'].includes(op)) return ctx.reply('Uso: ,bot on|off|status'); rental.setGroupBotEnabled(ctx.remoteJid, op === 'on'); return ctx.reply(`✅ Bot ${op === 'on' ? 'ativado' : 'desativado'} neste grupo.`); },
};

module.exports = [aluguel, atualizar, plano, modo, bot];
