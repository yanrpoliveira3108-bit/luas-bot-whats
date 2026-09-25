'use strict';

/**
 * commands/admin/purge.js — `!apagar`
 *
 * Duas formas de uso, com regras diferentes de propósito:
 *
 * 1) APAGAR A MENSAGEM MARCADA (respondendo a ela) — pedido do dono em 25/09/2026:
 *      • quem é DONO   → apaga qualquer mensagem;
 *      • quem é ADMIN  → apaga qualquer mensagem do grupo;
 *      • quem é MEMBRO → apaga somente a PRÓPRIA mensagem (a dele, enviada antes).
 *    As regras ficam em `commands/_shared/apagarMsg.js` (mesma fonte do `!d`).
 *
 * 2) APAGAR HISTÓRICO (com marcação de usuário e/ou quantidade) — recurso que já
 *    existia para moderação e para os antis:
 *      !apagar @user 10   → apaga as 10 últimas mensagens do usuário
 *      !apagar @user      → apaga 10 (padrão)
 *    Continua exigindo admin (o histórico é do bot; a revogação em lote mexe com
 *    várias mensagens de outra pessoa).
 */

const antiManager = require('../../utils/antiManager');
const { apagarMarcada, apagarUltima, apagarUltimaOuAviso, explicar } = require('../_shared/apagarMsg');

async function resolveTarget(ctx) {
  // menção
  if (ctx.mentionedJid && ctx.mentionedJid.length) {
    return ctx.mentionedJid[0];
  }
  // resposta a mensagem
  if (ctx.quotedKey && ctx.quotedKey.participant) {
    return ctx.quotedKey.participant;
  }
  // número digitado
  const raw = (ctx.args[0] || '').replace(/[^0-9]/g, '');
  if (raw.length >= 10) {
    return raw + '@s.whatsapp.net';
  }
  return null;
}

module.exports = [
  {
    name: 'apagar',
    commands: ['apagar', 'limpar', 'purge', 'limparhistorico', 'apagarhistorico', 'delhistorico'],
    category: 'admin',
    adminOnly: false, // membro também usa: apaga a PRÓPRIA mensagem marcada
    groupOnly: false,
    description:
      'Apaga a mensagem marcada (admin apaga qualquer uma; membro só a própria). Com @user + quantidade, apaga o histórico (admin).',
    usage: '!apagar (respondendo a mensagem) | !apagar @user [quantidade]',
    cooldown: 2000,
    execute: async (ctx) => {
      // ── 1) quantidade e/ou marcação de usuário → histórico (moderação) ──
      const temMencao = !!(ctx.mentionedJid && ctx.mentionedJid.length);
      const qtdDigitada = ctx.args
        .map((a) => parseInt(a, 10))
        .find((n) => !isNaN(n) && n > 0 && n <= 50);

      if (temMencao || (qtdDigitada && !ctx.quotedKey)) {
        if (!ctx.isOwner && !(ctx.isGroup && ctx.isAdmin)) {
          return ctx.reply(explicar('sem-permissao'));
        }
        if (!ctx.isBotAdmin) return ctx.reply(explicar('bot-nao-admin'));

        const target = await resolveTarget(ctx);
        if (!target) {
          return ctx.reply('⚠️ Marque o usuário: !apagar @usuario [quantidade]');
        }
        const limit = qtdDigitada || 10;
        // os participantes já vieram resolvidos no contexto (cache + prazo do
        // commandHandler): nada de consultar metadados de novo aqui
        const participants = ctx.participants || [];
        const { isAdmin } = require('../../utils/permissions');
        // admin do grupo pode ser alvo agora (o pedido do dono foi para permitir);
        // o que não pode é tentar apagar de quem o histórico nem tem
        const alvoEhAdmin = isAdmin(participants, target);
        await ctx.replyWithMentions(
          `🧹 Apagando até ${limit} mensagens recentes de @${String(target).split('@')[0]}...` +
            (alvoEhAdmin ? '\n_(esse usuário é admin — se o WhatsApp recusar, nada sai)_' : ''),
          [target]
        );
        const res = await antiManager.purgeUserHistory(ctx.socket, ctx.remoteJid, target, limit, true);
        if (!res.ok) {
          if (res.reason === 'no_history') {
            return ctx.reply(
              '⚠️ Sem histórico desse usuário (ele não falou desde que o bot ligou, ou o histórico já foi limpo).'
            );
          }
          return ctx.reply('❌ Não consegui apagar. Verifique se sou admin.');
        }
        return ctx.replyWithMentions(`✅ ${res.count} mensagens apagadas de @${String(target).split('@')[0]}.`, [target]);
      }

      // ── 2) respondendo uma mensagem → apaga ELA (regras de permissão) ──
      if (ctx.quotedKey) {
        const r = await apagarMarcada(ctx);
        return ctx.reply(r.resposta);
      }

      // ── 3) sem alvo nenhum ──
      //    membro: apaga a última DELE (a "enviada anteriormente");
      //    admin/dono: explica como marcar, sem apagar nada por engano
      const r = await apagarUltimaOuAviso(ctx);
      return ctx.reply(r.resposta);
    },
  },
  {
    name: 'apagartudo',
    commands: ['apagartudo', 'limpartudo', 'purgeall'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Apaga todo histórico rastreado de um usuário (até 50 msgs).',
    usage: '!apagartudo @user',
    cooldown: 3000,
    execute: async (ctx) => {
      if (!ctx.isBotAdmin) return ctx.reply('⚠️ Preciso ser admin.');
      const target = await resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !apagartudo @user');
      const res = await antiManager.purgeUserHistory(ctx.socket, ctx.remoteJid, target, 50, true);
      if (!res.ok) return ctx.reply('⚠️ Sem histórico ou falha ao apagar.');
      await ctx.reply(`✅ ${res.count} mensagens apagadas (tudo que tinha no histórico).`);
    },
  },
];
