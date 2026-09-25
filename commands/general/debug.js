/**
 * commands/general/debug.js — !debug · painel de diagnóstico.
 *
 * Mostra o estado real do bot (conexão, banco, memória, cache, handlers,
 * métricas) em um cartão com a identidade visual do LUA. Não expõe
 * credenciais nem dados sensíveis.
 */

'use strict';

const os = require('os');

const ui = require('../../utils/ui');
const theme = require('../../utils/theme');
const perf = require('../../utils/perf');

const CONFIG = require('../../config');
const { registry } = require('../../engine/plugins');
const { formatUptime } = require('../../utils/formatter');

/** Estado do banco: roda uma consulta trivial. */
function checkDatabase() {
  try {
    const db = require('../../database/database');
    const stats = db.stats && db.stats();
    const users = (stats && stats.users != null) ? `${stats.users} usuários` : 'OK';
    return { ok: true, detail: users };
  } catch (e) {
    return { ok: false, detail: e && e.message ? String(e.message).slice(0, 30) : 'erro' };
  }
}

/** Estado do cache. */
function checkCache() {
  try {
    const { cache } = require('../../utils/cache');
    return { ok: true, detail: `${cache.store ? cache.store.size : 0} itens` };
  } catch (_) {
    return { ok: false, detail: 'indisponível' };
  }
}

function baileysVersion() {
  try {
    const pkg = require('@lucasmod/boruto-vk7-baileys/package.json');
    return pkg && pkg.version ? `v${pkg.version}` : 'Baileys';
  } catch (_) {
    return 'Baileys';
  }
}

function cpuPercent() {
  const cpus = os.cpus();
  if (!cpus.length) return 0;
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    if (!c || !c.times) continue;
    idle += c.times.idle;
    for (const k in c.times) total += c.times[k];
  }
  if (!total) return 0;
  return Math.round((1 - idle / total) * 100);
}

module.exports = [
  {
    name: 'debug',
    commands: ['debug'],
    category: 'general',
    description: 'Painel de diagnóstico rápido do bot.',
    usage: '!debug',
    cooldown: 8000,
    execute: async (ctx) => {
      const conn = require('../../connection/connect');
      const connected = conn.isConnected();
      const status = conn.getStatus && conn.getStatus();
      const db = checkDatabase();
      const cache = checkCache();
      const ram = process.memoryUsage();
      const snap = perf.snapshot();
      const t = theme.active();

      const ok = (v) => (v ? '🟢' : '🔴');
      const lines = [
        ui.createHeader('🌙 LUA DEBUG', `tema: ${t.emoji} ${t.name}`),
        ui.createDivider(),
        `${ok(connected)} WhatsApp: ${connected ? 'Online' : 'Desconectado'}`,
        `${ok(true)} Baileys: OK (${baileysVersion()})`,
        `${ok(db.ok)} Banco: ${db.ok ? 'OK' : 'FALHA'} (${db.detail})`,
        `${ok(true)} Memória: ${Math.round(ram.rss / 1024 / 1024)} MB`,
        `${ok(cache.ok)} Cache: ${cache.detail}`,
        `${ok(true)} Handlers: ${require('../../handlers/buttonHandler').count()} registrados`,
        ui.createDivider(),
        `🧠 CPU: ${cpuPercent()}%`,
        `💾 RAM: ${Math.round(ram.rss / 1024 / 1024)} MB`,
        `⏱️ Uptime: ${formatUptime(CONFIG.bot.startedAt)}`,
        `📡 Última queda: ${(status && status.lastReason) || '—'}`,
        ui.createDivider(),
        `📨 Mensagens: ${snap.messages}`,
        `⚡ Comandos: ${snap.commands} (${registry.count()} disponíveis)`,
        `🐞 Erros: ${snap.errors}`,
        `⏱️ Resposta média: ${snap.avgResponseMs}ms`,
        `💾 Cache: ${snap.cacheHits} hits / ${snap.cacheMisses} misses`,
        ui.createDivider(),
        ui.formatFooter('☾ LUA • Beyond the ordinary.'),
      ];
      await ctx.reply(lines.join('\n'));
    },
  },
];
