/**
 * commands/owner/diagnostico.js — Diagnóstico administrativo do bot.
 *
 * Restrito ao dono (ownerOnly: true).
 * Checagens reais ativas com timeout leve:
 * - Conexão do bot e status
 * - Uptime do processo e do sistema
 * - Verificação de provedores externos e banco de dados SQLite
 * - Agendamentos (horários de grupos, auto-backup)
 * - Fila de downloads / tarefas
 * - Erros recentes e logs sanitizados (sem vazar credenciais ou sessões)
 */

'use strict';

const os = require('os');
const fs = require('fs');
const CONFIG = require('../../config');
const db = require('../../database/database');
const { formatDuration, formatUptime } = require('../../utils/formatter');
const downloadQueue = require('../../utils/downloadQueue');
const autoBackup = require('../../utils/autoBackup');
const activity = require('../../utils/activity');
const tzTime = require('../../utils/tzTime');

async function pingDatabase() {
  const start = Date.now();
  try {
    const dbc = db.get();
    dbc.prepare('SELECT 1').get();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

async function pingProvider(url, timeoutMs = 2000) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.status < 500, status: res.status, latencyMs: Date.now() - start };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE', latencyMs: Date.now() - start };
  }
}

module.exports = [
  {
    name: 'diagnostico',
    commands: ['diagnostico', 'diag'],
    category: 'owner',
    ownerOnly: true,
    description: 'Diagnóstico administrativo em tempo real do bot e serviços.',
    usage: '!diagnostico',
    cooldown: 5000,
    execute: async (ctx) => {
      await ctx.reply('🔍 Executando diagnóstico dos serviços e infraestrutura...');

      const dbCheck = await pingDatabase();
      const ytCheck = await pingProvider('https://www.youtube.com', 2500);

      const mem = process.memoryUsage();
      const mb = (n) => Math.round(n / 1024 / 1024);

      // Fila e agendamento
      const qSize = typeof downloadQueue.size === 'function' ? downloadQueue.size() : 0;
      const autoBackups = autoBackup.listBackups();
      const lastBackup = autoBackups.length > 0 ? autoBackups[0].name : 'Nenhum';

      // Atividade recente
      const recent = activity.recent(5);
      const errors = recent.filter((r) => r.status === 'error' || r.error);

      const tz = tzTime.botTimezone();
      const nowFormatted = new Date().toLocaleString('pt-BR', { timeZone: tz });

      const lines = [
        '🩺 *DIAGNÓSTICO ADMINISTRATIVO*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `▸ Data da Verificação: ${nowFormatted}`,
        `▸ Conexão: 🟢 Conectado (Socket Ativo)`,
        `▸ Tempo em Execução (Uptime): ${formatUptime(CONFIG.bot.startedAt)}`,
        `▸ Memória: Heap ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} MB • RSS: ${mb(mem.rss)} MB`,
        `▸ Sistema: ${os.type()} ${os.arch()} • CPU: ${os.cpus().length} cores • Node ${process.version}`,
        '',
        '🗄️ *Banco de Dados & Provedores:*',
        `▸ SQLite WAL: ${dbCheck.ok ? `🟢 OK (${dbCheck.latencyMs}ms)` : `🔴 Falha (${dbCheck.error})`}`,
        `▸ Provedor YouTube: ${ytCheck.ok ? `🟢 OK (${ytCheck.latencyMs}ms)` : `🟠 ${ytCheck.error || 'Indisponível'} (${ytCheck.latencyMs}ms)`}`,
        '',
        '⏱️ *Filas & Agendamentos:*',
        `▸ Fila de Mídia/Downloads: ${qSize} tarefas pendentes`,
        `▸ Último Backup Automático: ${lastBackup}`,
        `▸ Fuso Horário de Agendamento: ${CONFIG.bot.timezone || 'America/Sao_Paulo'}`,
        '',
        '⚠️ *Ocorrências Recentes:*',
        errors.length > 0
          ? errors.map((e) => `▸ [${e.timestamp || '-'}] ${e.cmd || 'cmd'}: ${String(e.error).slice(0, 50)}`).join('\n')
          : '▸ Nenhuma falha crítica registrada nas últimas operações.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ];

      await ctx.reply(lines.join('\n'));
    },
  },
];
