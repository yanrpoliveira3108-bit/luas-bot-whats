'use strict';

const groups = require('../../database/groups');
const { sendMenu } = require('../../utils/menu');
const { formatDate } = require('../../utils/formatter');

const PANEL = [
  { id: 'entradas', title: '🚪 ENTRADAS', type: 'entrada' },
  { id: 'saidas', title: '👋 SAÍDAS', type: 'saida' },
  { id: 'promote', title: '⬆️ ADM ↑', type: 'promote' },
  { id: 'demote', title: '⬇️ ADM ↓', type: 'demote' },
  { id: 'nome', title: '✏️ NOME', type: 'nome' },
  { id: 'descricao', title: '📝 DESCRIÇÃO', type: 'descricao' },
  { id: 'config', title: '⚙️ GRUPO', type: 'config' },
];

const TYPE_LABEL = {
  entrada: '🚪 Entrou no grupo',
  saida: '👋 Saiu do grupo',
  promote: '⬆️ Promovido a admin',
  demote: '⬇️ Rebaixado',
  nome: '✏️ Nome alterado',
  descricao: '📝 Descrição alterada',
  config: '⚙️ Configuração alterada',
};

module.exports = [
  {
    name: 'x9',
    commands: ['x9', 'registro', 'auditoria'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Painel de eventos administrativos do grupo.',
    usage: '!x9',
    cooldown: 3000,
    execute: async (ctx) => {
      await sendMenu(ctx, {
        id: 'x9',
        title: '🕵️ X9 — Registro do grupo',
        text: 'Escolha o tipo de evento para ver o histórico.',
        rows: PANEL.map((p) => ({
          id: p.id,
          title: p.title,
          description: `Ver eventos: ${TYPE_LABEL[p.type]}`,
          run: (c) => showLogs(c, p),
        })),
      });
    },
  },
];

async function showLogs(ctx, panel) {
  if (panel.type === 'foto') {
    return ctx.reply('ℹ️ O WhatsApp não expõe alterações de foto do grupo de forma confiável, então não registramos esse evento.');
  }
  const logs = groups.getLogs(ctx.remoteJid, [panel.type], 20);
  if (!logs.length) {
    return ctx.reply(`📭 Nenhum evento de *${TYPE_LABEL[panel.type]}* registrado.`);
  }
  const lines = logs.map((l) => {
    const actor = l.actor_id ? `@${l.actor_id.split('@')[0]}` : 'desconhecido';
    const detail = l.detail && l.detail !== l.user_id ? ` — ${String(l.detail).slice(0, 60)}` : '';
    return `▸ ${formatDate(new Date(l.created_at).getTime())} • ${actor}${detail}`;
  });
  const mentions = [...new Set(logs.map((l) => l.actor_id).filter(Boolean))];
  await ctx.reply(`🕵️ *${TYPE_LABEL[panel.type]} (${logs.length} recentes)*\n${lines.join('\n')}`, { mentions });
}
