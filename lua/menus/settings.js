/**
 * menus/settings.js — menu de configurações do grupo/bot.
 *
 * Mostra o estado real dos filtros e permite ligar/desligar com um toque.
 */

'use strict';

const settings = require('../database/settings');
const groups = require('../database/groups');
const { sendMenu } = require('../utils/menu');

const FILTERS = [
  { key: 'antilink', label: '🔗 Anti-link' },
  { key: 'antispam', label: '🗣️ Anti-spam' },
  { key: 'antiflood', label: '🌊 Anti-flood' },
  { key: 'antifake', label: '🛂 Anti-fake' },
  { key: 'antibot', label: '🤖 Anti-bot' },
  { key: 'antiparentese', label: '🧹 Anti-símbolos' },
  { key: 'antiinvite', label: '📨 Anti-convite' },
  { key: 'antimedia', label: '🖼️ Anti-mídia (geral)' },
  { key: 'antiimagem', label: '🖼️ Anti-imagem' },
  { key: 'antivideo', label: '🎬 Anti-vídeo' },
  { key: 'antiaudio', label: '🎵 Anti-áudio' },
  { key: 'antidocumento', label: '📄 Anti-documento' },
  { key: 'antisticker', label: '🎨 Anti-sticker' },
  { key: 'antiviewonce', label: '👁️ Anti-view once' },
];

module.exports = async (ctx) => {
  const s = groups.getSettings(ctx.remoteJid);
  const filters = s.filters || {};
  const g = groups.get(ctx.remoteJid);

  const status = (key) => (filters[key] ? '✅ ligado' : '❌ desligado');

  let summary = `*⚙️ Configurações*\n▸ Prefixo: ${settings.effectivePrefix()}\n`;
  if (ctx.isGroup) {
    summary +=
      `▸ Boas-vindas: ${g && g.welcome_enabled ? '✅' : '❌'}\n` +
      `▸ Despedida: ${g && g.goodbye_enabled ? '✅' : '❌'}\n` +
      `▸ Anti-link: ${status('antilink')}\n` +
      `▸ Anti-spam: ${status('antispam')}\n` +
      `▸ Anti-flood: ${status('antiflood')}\n` +
      `▸ Anti-mídia: ${status('antimedia')}\n`;
  } else {
    summary += `_As opções de grupo aparecem dentro de um grupo._\n`;
  }

  const rows = FILTERS.map((f) => ({
    id: f.key,
    title: `${f.label} — ${status(f.key)}`,
    description: 'Toque para alternar (requer admin do grupo).',
    run: (c) => toggle(c, f.key),
  }));

  await sendMenu(ctx, { id: 'settings', title: '⚙️ Configurações', text: summary, rows });
};

async function toggle(ctx, key) {
  if (ctx.isGroup && !ctx.isAdmin && !ctx.isOwner) {
    await ctx.reply('🛡️ Apenas administradores podem alterar filtros.');
    return;
  }
  const s = groups.getSettings(ctx.remoteJid);
  const filters = s.filters || {};
  const novo = !filters[key];
  groups.updateFilter(ctx.remoteJid, key, novo);
  await ctx.reply(`🔧 Filtro *${key}* ${novo ? '✅ ligado' : '❌ desligado'}.`);
}
