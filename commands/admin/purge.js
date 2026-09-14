'use strict';

/**
 * commands/admin/purge.js — apagar histórico de mensagens de um usuário
 *
 * !apagar @user [quantidade] — apaga N mensagens recentes do usuário (padrão 10, max 50)
 * !apagar 10 — apaga 10 mensagens do grupo (recentes, se bot admin)
 * !limpar @user — alias
 * !purge @user 20 — alias
 */

const antiManager = require('../../utils/antiManager');

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
    adminOnly: true,
    groupOnly: true,
    description: 'Apaga histórico de mensagens de um usuário (últimas N). Use !apagar @user [qtd] ou responda a mensagem dele.',
    usage: '!apagar @user [quantidade] | !apagar [quantidade] (apaga do bot) | responda mensagem do alvo',
    cooldown: 2000,
    execute: async (ctx) => {
      if (!ctx.isBotAdmin) {
        return ctx.reply('⚠️ Preciso ser admin do grupo para apagar mensagens.');
      }

      let target = await resolveTarget(ctx);
      let limit = 10;

      // parse quantidade
      for (const a of ctx.args) {
        const n = parseInt(a, 10);
        if (!isNaN(n) && n > 0 && n <= 50) {
          limit = n;
          break;
        }
      }

      // se não tem alvo, tenta apagar mensagens recentes do grupo (últimas N do bot? ou geral?)
      // para segurança, exige alvo para purge de usuário
      if (!target) {
        // sem alvo: apaga apenas a mensagem citada se houver
        if (ctx.quotedKey) {
          try {
            await ctx.socket.sendMessage(ctx.remoteJid, { delete: ctx.quotedKey });
            return ctx.reply(`✅ Mensagem citada apagada.`);
          } catch (e) {
            return ctx.reply('❌ Não consegui apagar a mensagem citada.');
          }
        }
        return ctx.reply(
          '⚠️ Uso:\n' +
            '!apagar @usuario 10 — apaga 10 msgs do usuário\n' +
            '!apagar (respondendo msg do usuário) 15 — apaga 15\n' +
            '!apagar 5 — apaga 5 msgs recentes (se responder a alguém)\n\n' +
            'O bot mantém histórico de até 50 msgs por usuário para poder apagar quando o anti aciona.'
        );
      }

      // não apagar admin/dono/bot
      const { cache } = require('../../utils/cache');
      const meta = cache.get('meta:' + ctx.remoteJid);
      const participants = (meta && meta.participants) || [];
      const { isAdmin } = require('../../utils/permissions');
      if (isAdmin(participants, target)) {
        return ctx.reply('🚫 Não posso apagar mensagens de um admin.');
      }

      await ctx.reply(`🧹 Apagando ${limit} mensagens recentes de @${target.split('@')[0]}...`, { mentions: [target] });

      const res = await antiManager.purgeUserHistory(ctx.socket, ctx.remoteJid, target, limit, true);
      if (!res.ok) {
        if (res.reason === 'no_history') {
          return ctx.reply('⚠️ Sem histórico desse usuário (ele não falou desde que o bot ligou, ou histórico já foi limpo).');
        }
        return ctx.reply('❌ Não consegui apagar. Verifique se sou admin.');
      }

      await ctx.reply(`✅ ${res.count} mensagens apagadas de @${target.split('@')[0]}.`, { mentions: [target] });
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
