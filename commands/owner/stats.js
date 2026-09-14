'use strict';

const os = require('os');
const fs = require('fs');
const CONFIG = require('../../config');
const db = require('../../database/database');
const users = require('../../database/users');
const { registry } = require('../../engine/plugins');
const { formatUptime, formatDuration } = require('../../utils/formatter');
const logger = require('../../utils/logger');
const activity = require('../../utils/activity');

module.exports = [
  {
    name: 'statsbot',
    commands: ['statsbot', 'estatisticas'],
    category: 'owner',
    ownerOnly: true,
    description: 'Estatísticas gerais do bot.',
    usage: '!statsbot',
    cooldown: 3000,
    execute: async (ctx) => {
      const s = db.stats();
      await ctx.reply(
        [
          `📊 *Estatísticas do ${CONFIG.bot.name}*`,
          `▸ Comandos: ${registry.count()}`,
          `▸ Plugins: ${registry.plugins.size}`,
          `▸ Usuários: ${s.users}`,
          `▸ Grupos: ${s.groups}`,
          `▸ Advertências: ${s.warnings}`,
          `▸ Jogadores RPG: ${s.rpg_players}`,
          `▸ Plantações: ${s.plantations}`,
          `▸ Animais: ${s.animals}`,
          `▸ Eventos X9: ${s.group_logs}`,
          `▸ Perguntas quiz: ${s.quiz_questions}`,
        ].join('\n')
      );
    },
  },
  {
    name: 'uptime',
    commands: ['uptime', 'runtime'],
    category: 'owner',
    ownerOnly: true,
    description: 'Tempo online do bot.',
    usage: '!uptime',
    cooldown: 2000,
    execute: async (ctx) => {
      await ctx.reply(`⏱️ *Uptime*\n▸ ${formatUptime(CONFIG.bot.startedAt)}\n▸ Desde: ${new Date(CONFIG.bot.startedAt).toLocaleString('pt-BR')}`);
    },
  },
  {
    name: 'memory',
    commands: ['memory'],
    category: 'owner',
    ownerOnly: true,
    description: 'Uso de memória do processo.',
    usage: '!memory',
    cooldown: 2000,
    execute: async (ctx) => {
      const m = process.memoryUsage();
      const mb = (n) => Math.round(n / 1024 / 1024);
      await ctx.reply(
        [
          '🧠 *Memória*',
          `▸ RSS: ${mb(m.rss)} MB`,
          `▸ Heap usado: ${mb(m.heapUsed)} MB`,
          `▸ Heap total: ${mb(m.heapTotal)} MB`,
          `▸ Externo: ${mb(m.external)} MB`,
          `▸ Sessões de jogo ativas: ${require('../../utils/session').size()}`,
        ].join('\n')
      );
    },
  },
  {
    name: 'system',
    commands: ['system', 'sistema', 'cpu', 'ram', 'disk'],
    category: 'owner',
    ownerOnly: true,
    description: 'Informações do sistema.',
    usage: '!system',
    cooldown: 2000,
    execute: async (ctx) => {
      const total = os.totalmem();
      const free = os.freemem();
      await ctx.reply(
        [
          '🖥️ *Sistema*',
          `▸ SO: ${os.type()} ${os.release()}`,
          `▸ Arch: ${os.arch()}`,
          `▸ CPU: ${os.cpus().length} núcleos`,
          `▸ RAM: ${Math.round((total - free) / 1024 / 1024)}/${Math.round(total / 1024 / 1024)} MB`,
          `▸ Node: ${process.version}`,
          `▸ Uptime do SO: ${formatDuration(os.uptime() * 1000)}`,
        ].join('\n')
      );
    },
  },
  {
    name: 'logs',
    commands: ['logs'],
    category: 'owner',
    ownerOnly: true,
    description: 'Últimos comandos executados (organizado). "!logs arquivo" = log bruto.',
    usage: '!logs | !logs arquivo',
    cooldown: 3000,
    execute: async (ctx) => {
      try {
        // "!logs arquivo" → cauda do log bruto (diagnóstico)
        if (String(ctx.args[0] || '').toLowerCase() === 'arquivo') {
          const file = logger.currentLogFile();
          if (!fs.existsSync(file)) {
            await ctx.reply('📄 Nenhum log gravado ainda.');
            return;
          }
          const content = fs
            .readFileSync(file, 'utf8')
            .split('\n')
            .filter(Boolean)
            .slice(-15)
            .join('\n');
          await ctx.reply(`📄 *Últimas linhas do log bruto:*\n\`\`\`${content.slice(0, 1800)}\`\`\``);
          return;
        }

        // padrão: atividade organizada
        const recent = activity.recent(15);
        if (!recent.length) {
          await ctx.reply('📋 Nenhum comando registrado ainda nesta execução.');
          return;
        }
        const lines = recent.map((e) => activity.formatLine(e)).reverse();
        await ctx.reply(`📋 *Atividade recente* (${recent.length})\n\`\`\`${lines.join('\n').slice(0, 1600)}\`\`\``);
      } catch (err) {
        await ctx.reply('❌ Não foi possível ler os logs.');
      }
    },
  },
  {
    name: 'database',
    commands: ['database'],
    category: 'owner',
    ownerOnly: true,
    description: 'Resumo do banco de dados.',
    usage: '!database',
    cooldown: 3000,
    execute: async (ctx) => {
      const s = db.stats();
      const lines = Object.entries(s).map(([k, v]) => `▸ ${k}: ${v}`);
      await ctx.reply(`🗄️ *Banco de dados*\n${lines.join('\n')}`);
    },
  },
];
