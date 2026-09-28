'use strict';

const premium = require('../../database/premium');
const rental = require('../../database/rental');

function date(v) { return v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'; }
function left(ms) { if (!ms || ms <= 0) return 'expirado'; const d = Math.floor(ms / 86400000); const h = Math.floor(ms % 86400000 / 3600000); const m = Math.floor(ms % 3600000 / 60000); return `${d}d ${h}h ${m}m`; }
function target(ctx) { return (ctx.mentionedJid && ctx.mentionedJid[0]) || (ctx.quotedKey && ctx.quotedKey.participant) || null; }
function allowed(ctx, cap) { return premium.can(ctx, cap); }
function deny(ctx) { return ctx.reply('🚫 Você não possui a permissão comercial necessária.'); }
function keyText(k) { return [`🔑 *LUA • KEY GERADA*`, '', `Tipo: ${k.scope === 'GROUP' ? 'ALUGUEL / GROUP VIP' : 'VIP DE USUÁRIO'}`, `Duração: ${k.duration}`, `Key: ${k.key}`, 'Uso: 1 resgate', 'Status: NÃO UTILIZADA'].join('\n'); }
function keyList() { return ['🔑 *LUA • KEYS*', '', ...premium.listKeys().map((k) => `#${k.id}\nTipo: ${k.scope === 'GROUP' ? 'ALUGUEL' : 'VIP USER'}\nDuração: ${k.duration}\nStatus: ${k.status}\nCódigo: ${k.prefix}-****-****-${k.last4}`)].join('\n\n'); }
function vipText(scope, subject) { const e = premium.getEntitlement(scope, subject); if (!e || e.status !== 'ACTIVE') return scope === 'GROUP' ? 'Plano: FREE\nVIP DO GRUPO: INATIVO' : 'Plano: FREE\nStatus: INATIVO'; return [`💎 *LUA • ${scope === 'GROUP' ? 'VIP DO GRUPO' : 'VIP'}*`, '', 'Status: ATIVO', `Expira: ${date(e.expires_at)}`, `Tempo restante: ${left(e.remainingMs)}`].join('\n'); }

const keyCommand = {
  name: 'k', commands: ['k'], category: 'general', cooldown: 1200,
  description: 'Gera e administra chaves premium.', usage: ',k vip 7d',
  execute: async (ctx) => {
    const sub = String(ctx.args[0] || '').toLowerCase();
    if (sub === 'list') return allowed(ctx, 'KEY_LIST') ? ctx.reply(keyList()) : deny(ctx);
    if (sub === 'ver') { if (!allowed(ctx, 'KEY_LIST')) return deny(ctx); const k = premium.getKey(ctx.args[1]); return ctx.reply(k ? [`🔑 *KEY #${k.id}*`, `Tipo: ${k.scope}`, `Tier: ${k.tier}`, `Duração: ${k.duration}`, `Status: ${k.status}`, `Criada por: ${k.createdBy}`, `Criada em: ${date(k.createdAt)}`, `Resgatada em: ${date(k.redeemedAt)}`, `Resgatada por: ${k.redeemedBy || '—'}`, `Resgatada para: ${k.redeemedFor || '—'}`].join('\n') : '❌ Key não encontrada.'); }
    if (sub === 'revogar') { if (!allowed(ctx, 'KEY_REVOKE')) return deny(ctx); try { premium.revokeKey(ctx.args[1], ctx.sender); return ctx.reply('✅ Key revogada.'); } catch (_) { return ctx.reply('❌ Somente uma key NÃO UTILIZADA pode ser revogada.'); } }
    if (!allowed(ctx, 'KEY_CREATE')) return deny(ctx);
    const scope = sub === 'aluguel' ? 'GROUP' : sub === 'vip' ? 'USER' : null;
    if (!scope || !ctx.args[1]) return ctx.reply('Uso: ,k aluguel 7d ou ,k vip 7d');
    try { const durationMs = premium.parseDuration(ctx.args[1]); return ctx.reply(keyText(premium.createKey(scope, durationMs, ctx.sender))); } catch (_) { return ctx.reply('❌ Duração inválida. Use 30s, 5m, 1h, 12h, 1d, 7d ou 4w.'); }
  },
};

const redeem = {
  name: 'resgate', commands: ['resgate'], category: 'general', cooldown: 3000,
  description: 'Resgata uma key premium.', usage: ',resgate SUA-KEY',
  execute: async (ctx) => { try { const result = premium.redeem(ctx, ctx.args[0]); return ctx.reply([result.scope === 'GROUP' ? '🏷️ *GROUP VIP ATIVADO*' : '💎 *VIP ATIVADO*', '', `Duração: ${premium.durationLabel(result.durationMs)}`, `Expira: ${date(result.expiresAt)}`, `Tempo restante: ${left(Date.parse(result.expiresAt) - Date.now())}`].join('\n')); } catch (e) { return ctx.reply(e.publicMessage || '❌ Não foi possível resgatar esta key.'); } },
};

const vip = {
  name: 'vip', commands: ['vip'], category: 'general', cooldown: 1200,
  description: 'Consulta o VIP pessoal ou do grupo.', usage: ',vip',
  execute: async (ctx) => { const sub = String(ctx.args[0] || '').toLowerCase(); if (sub === 'remover') { if (!ctx.isOwner) return deny(ctx); const scope = ctx.isGroup ? 'GROUP' : 'USER'; try { premium.revokeEntitlement(scope, ctx.isGroup ? ctx.remoteJid : ctx.sender, ctx.sender); return ctx.reply('✅ VIP revogado.'); } catch (_) { return ctx.reply('❌ VIP ativo não encontrado.'); } } if (sub === 'ver') { if (!allowed(ctx, 'VIP_LOOKUP')) return deny(ctx); const t = target(ctx) || ctx.sender; return ctx.reply(vipText(ctx.isGroup && !target(ctx) ? 'GROUP' : 'USER', t)); } return ctx.reply(vipText('USER', ctx.sender)); },
};

const subowner = {
  name: 'subdono', commands: ['subdono'], category: 'general', ownerOnly: true, cooldown: 1000,
  description: 'Administra subdonos comerciais.', usage: ',subdono add @usuario',
  execute: async (ctx) => { const op = String(ctx.args[0] || 'list').toLowerCase(); if (op === 'list') return ctx.reply(['👑 *SUBDONOS*', ...premium.listSubowners().map((s) => `• ${s.user_id}`)].join('\n')); const t = target(ctx) || ctx.args[1]; if (!t) return ctx.reply('Responda ou mencione o usuário.'); if (op === 'add') { premium.addSubowner(t, ctx.sender); return ctx.reply('✅ Subdono comercial adicionado.'); } if (op === 'rm') { premium.removeSubowner(t); return ctx.reply('✅ Subdono removido.'); } return ctx.reply('Use ,subdono add|rm|list.'); },
};

module.exports = [keyCommand, redeem, vip, subowner];
