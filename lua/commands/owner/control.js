'use strict';

const fs = require('fs');
const path = require('path');
const CONFIG = require('../../config');
const loader = require('../loader');
const { registry } = require('../../engine/plugins');
const { confirmAction } = require('../_shared/confirm');
const logger = require('../../utils/logger').child('owner');

const SHUTDOWN_FLAG = path.join(CONFIG.paths.root, '.shutdown');

function pluginStatusLabel(p) {
  if (p.status === 'error') return '❌ erro';
  if (p.status === 'disabled') return '⛔ desativado';
  return '✅';
}

module.exports = [
  {
    name: 'restart',
    commands: ['restart', 'reiniciar'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reinicia o bot.',
    usage: '!restart',
    cooldown: 5000,
    execute: async (ctx) => {
      await confirmAction(ctx, 'reiniciar o bot', async (c) => {
        await c.reply('🔄 Reiniciando...');
        setTimeout(() => process.exit(0), 800);
      });
    },
  },
  {
    name: 'shutdown',
    commands: ['shutdown', 'desligar'],
    category: 'owner',
    ownerOnly: true,
    description: 'Desliga o bot (não reinicia sozinho).',
    usage: '!shutdown',
    cooldown: 5000,
    execute: async (ctx) => {
      await confirmAction(ctx, 'desligar o bot', async (c) => {
        try {
          fs.writeFileSync(SHUTDOWN_FLAG, String(Date.now()));
        } catch (_) {}
        await c.reply('🛑 Desligando... Até logo! 🌙');
        setTimeout(() => process.exit(0), 800);
      });
    },
  },
  {
    name: 'reload',
    commands: ['reload', 'recarregar'],
    category: 'owner',
    ownerOnly: true,
    description: 'Recarrega todos os comandos (hot reload).',
    usage: '!reload',
    cooldown: 5000,
    execute: async (ctx) => {
      await ctx.reply('♻️ Recarregando comandos...');
      try {
        loader.loadCommands(true);
        await ctx.reply(`✅ Comandos recarregados. Total: ${registry.count()}.`);
      } catch (err) {
        logger.error({ err: err.message }, 'falha no reload');
        await ctx.reply('❌ Falha ao recarregar. Veja os logs.');
      }
    },
  },
  {
    name: 'plugins',
    commands: ['plugins'],
    category: 'owner',
    ownerOnly: true,
    description: 'Lista plugins ou ativa/desativa (on|off <nome>).',
    usage: '!plugins [on|off] <nome>',
    cooldown: 2000,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();
      const name = (ctx.args[1] || '').toLowerCase();

      if (sub === 'on' || sub === 'off') {
        if (!name) {
          await ctx.reply(`⚠️ Uso: ${ctx.prefix}plugins ${sub} <nome-do-plugin>`);
          return;
        }
        const enabled = sub === 'on';
        loader.setPluginEnabled(name, enabled);
        loader.loadCommands(true);
        await ctx.reply(`🔌 Plugin *${name}* ${enabled ? 'ativado' : 'desativado'}.`);
        return;
      }

      const list = registry.pluginList();
      const lines = list.map(
        (p) => `▸ ${pluginStatusLabel(p)} *${p.name}* — ${p.commands.length} comandos`
      );
      await ctx.reply(`🔌 *Plugins carregados (${list.length})*\n${lines.join('\n')}\n\nUse ${ctx.prefix}plugins on/off <nome>.`);
    },
  },
  {
    name: 'pluginsreload',
    commands: ['pluginsreload'],
    category: 'owner',
    ownerOnly: true,
    description: 'Recarrega os plugins do zero.',
    usage: '!pluginsreload',
    cooldown: 5000,
    execute: async (ctx) => {
      loader.loadCommands(true);
      await ctx.reply(`✅ Plugins recarregados. Total: ${registry.count()} comandos.`);
    },
  },
];
