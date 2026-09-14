/**
 * commands/general/ping2.js — !ping2 · central de diagnóstico HTML (LUA).
 *
 * Usa utils/pingHtml.js (HTML roxo/lunar + gráfico de latência) e envia via
 * relayMessage. Se o HTML falhar por qualquer motivo, envia um cartão de
 * status em texto — nunca deixa o bot mudo.
 */

'use strict';

const pingHtml = require('../../utils/pingHtml');
const theme = require('../../utils/theme');

module.exports = [
  {
    name: 'ping2',
    commands: ['ping2'],
    category: 'general',
    description: 'Central de diagnóstico visual (HTML) do bot.',
    usage: '!ping2',
    cooldown: 8000,
    execute: async (ctx) => {
      const { registry } = require('../../engine/plugins');
      const { formatUptime } = require('../../utils/formatter');
      const users = require('../../database/users');
      const CONFIG = require('../../config');

      const u = users.get(ctx.sender);
      const usuario = (u && u.name) || ctx.message.pushName || 'Usuário';

      const ts = ctx.message.messageTimestamp ? Number(ctx.message.messageTimestamp) * 1000 : Date.now();
      const latencia = Math.max(0, Date.now() - ts);

      const ok = await pingHtml.sendHtmlPing(ctx.socket, ctx.remoteJid, {
        sender: ctx.sender,
        usuario,
        ping: `${latencia}ms`,
        latencia: `${latencia}ms`,
        totalcmd: String(registry.count()),
        theme: theme.activeId(),
      });

      if (!ok) {
        // fallback textual — nunca deixa o comando "mudo"
        const ram = process.memoryUsage();
        await ctx.reply(
          [
            '🌙 LUA • SYSTEM PING',
            '━━━━━━━━━━━━━━━━━━━━',
            `⚡ Latência: ${latencia}ms`,
            `💾 RAM: ${Math.round(ram.rss / 1024 / 1024)} MB`,
            `⏱️ Uptime: ${formatUptime(CONFIG.bot.startedAt)}`,
            `📡 Conexão: ${require('../../connection/connect').isConnected() ? 'Online 🟢' : 'Desconectada 🔴'}`,
            `📦 Comandos: ${registry.count()}`,
            '━━━━━━━━━━━━━━━━━━━━',
            '☾ LUA • Beyond the ordinary.',
          ].join('\n')
        );
      }
    },
  },
];
