'use strict';

const fs = require('fs');
const path = require('path');
const CONFIG = require('../../config');
const db = require('../../database/database');
const { confirmAction } = require('../_shared/confirm');

module.exports = [
  {
    name: 'backup',
    commands: ['backup'],
    category: 'owner',
    ownerOnly: true,
    description: 'Faz backup do banco de dados.',
    usage: '!backup',
    cooldown: 10000,
    execute: async (ctx) => {
      const dest = path.join(CONFIG.paths.backupDir, `lua-backup-${Date.now()}.db`);
      await db.backup(dest);
      const size = Math.round(fs.statSync(dest).size / 1024);
      await ctx.reply(`💾 Backup criado: \`${path.basename(dest)}\` (${size} KB)`);
      try {
        await ctx.sendDocument(dest, { fileName: path.basename(dest), mimetype: 'application/octet-stream' });
      } catch (_) {
        /* arquivo continua salvo no disco */
      }
    },
  },
  {
    name: 'restore',
    commands: ['restore'],
    category: 'owner',
    ownerOnly: true,
    description: 'Restaura o backup mais recente.',
    usage: '!restore',
    cooldown: 10000,
    execute: async (ctx) => {
      const files = fs
        .readdirSync(CONFIG.paths.backupDir)
        .filter((f) => f.startsWith('lua-backup-'))
        .sort();
      if (!files.length) {
        await ctx.reply('❌ Nenhum backup encontrado.');
        return;
      }
      const latest = path.join(CONFIG.paths.backupDir, files[files.length - 1]);
      await confirmAction(ctx, `restaurar o backup ${files[files.length - 1]}`, async (c) => {
        try {
          db.restore(latest);
          await c.reply('✅ Backup restaurado com sucesso.');
        } catch (err) {
          await c.reply(`❌ Falha ao restaurar: ${err.message}`);
        }
      });
    },
  },
];
