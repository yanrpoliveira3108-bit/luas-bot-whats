'use strict';

const fs = require('fs');
const path = require('path');
const CONFIG = require('../../config');
const db = require('../../database/database');
const { confirmAction } = require('../_shared/confirm');
const autoBackup = require('../../utils/autoBackup');

module.exports = [
  {
    name: 'backup',
    commands: ['backup'],
    category: 'owner',
    ownerOnly: true,
    description: 'Faz backup do banco de dados e lista backups automáticos.',
    usage: '!backup [auto|lista|criar]',
    cooldown: 5000,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();

      if (sub === 'listar' || sub === 'lista' || sub === 'list' || sub === 'auto') {
        const list = autoBackup.listBackups();
        const manual = fs
          .readdirSync(CONFIG.paths.backupDir)
          .filter((f) => f.startsWith('lua-backup-'))
          .sort()
          .slice(-5);

        let msg = '*💾 LISTA DE BACKUPS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
        msg += `*Manuais (últimos 5):*\n${manual.length ? manual.map((f) => '▸ ' + f).join('\n') : '(nenhum)'}\n\n`;
        msg += `*Automáticos (${list.length}):*\n`;
        if (!list.length) {
          msg += '(nenhum ainda — cria a cada 6h)\n';
        } else {
          for (const b of list.slice(0, 5)) {
            const date = b.mtime ? b.mtime.toLocaleString('pt-BR') : b.name;
            const reason = b.info && b.info.reason ? ` (${b.info.reason})` : '';
            msg += `▸ \`${b.name}\` — ${date}${reason}\n`;
          }
        }
        msg += `\n💡 Para restaurar use: *${ctx.prefix}backup restaurar <identificador>* ou *${ctx.prefix}restore*`;
        return ctx.reply(msg);
      }

      if (sub === 'restaurar' || sub === 'restore') {
        const targetId = ctx.args[1];
        let fileToRestore = null;

        if (targetId) {
          const autoPath = path.join(autoBackup.AUTO_DIR, targetId, 'lua.db');
          const manualPath = path.join(CONFIG.paths.backupDir, targetId);
          if (fs.existsSync(autoPath)) fileToRestore = autoPath;
          else if (fs.existsSync(manualPath)) fileToRestore = manualPath;
        }

        if (!fileToRestore) {
          const files = fs
            .readdirSync(CONFIG.paths.backupDir)
            .filter((f) => f.startsWith('lua-backup-'))
            .sort();
          if (files.length) fileToRestore = path.join(CONFIG.paths.backupDir, files[files.length - 1]);
        }

        if (!fileToRestore) {
          return ctx.reply(`❌ Nenhum backup encontrado para restaurar. Use *${ctx.prefix}backup listar*`);
        }

        // Validação de integridade antes da restauração
        const Database = require('better-sqlite3');
        try {
          const testConn = new Database(fileToRestore, { readonly: true });
          const integrity = testConn.prepare('PRAGMA integrity_check').get();
          testConn.close();
          if (!integrity || integrity.integrity_check !== 'ok') {
            return ctx.reply('❌ Falha na verificação de integridade do arquivo de backup.');
          }
        } catch (errTest) {
          return ctx.reply(`❌ Backup corrompido ou ilegível: ${errTest.message}`);
        }

        const bName = path.basename(fileToRestore);
        await confirmAction(ctx, `restaurar o backup ${bName}`, async (c) => {
          try {
            // Snapshot preventivo do estado atual
            const safetySnap = path.join(CONFIG.paths.backupDir, `pre-restore-snap-${Date.now()}.db`);
            await db.backup(safetySnap);

            db.restore(fileToRestore);
            await c.reply(`✅ Backup \`${bName}\` restaurado com sucesso! Cópia de segurança criada em \`${path.basename(safetySnap)}\`.`);
          } catch (err) {
            await c.reply(`❌ Falha ao restaurar: ${err.message}`);
          }
        });
        return;
      }

      if (sub === 'criar' || sub === 'now' || sub === 'forcar' || !sub) {
        // se for !backup sem args, faz manual + auto
        if (!sub) {
          const dest = path.join(CONFIG.paths.backupDir, `lua-backup-${Date.now()}.db`);
          await db.backup(dest);
          const size = Math.round(fs.statSync(dest).size / 1024);
          await ctx.reply(`💾 Backup manual criado: \`${path.basename(dest)}\` (${size} KB)`);
          try {
            await ctx.sendDocument(dest, { fileName: path.basename(dest), mimetype: 'application/octet-stream' });
          } catch (_) {}
          return;
        }
        // !backup criar — força auto backup completo
        await ctx.reply('⏳ Criando backup automático completo...');
        const p = autoBackup.doBackup('manual');
        if (p) {
          await ctx.reply(`✅ Backup automático criado em: \`${path.basename(p)}\`\n📁 ${p}`);
        } else {
          await ctx.reply('❌ Falha ao criar backup automático.');
        }
        return;
      }
    },
  },
  {
    name: 'restore',
    commands: ['restore', 'restaurar'],
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
        await ctx.reply('❌ Nenhum backup manual encontrado. Use !backup lista para ver automáticos.');
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
  {
    name: 'backupauto',
    commands: ['backupauto', 'autobackup'],
    category: 'owner',
    ownerOnly: true,
    description: 'Gerencia backups automáticos.',
    usage: '!backupauto lista|criar|limpar',
    cooldown: 5000,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || 'lista').toLowerCase();
      if (sub === 'lista' || sub === 'list') {
        const list = autoBackup.listBackups();
        if (!list.length) return ctx.reply('📭 Nenhum backup automático ainda.');
        let msg = `*💾 BACKUPS AUTOMÁTICOS (${list.length})*\n\n`;
        for (const b of list) {
          const date = b.mtime ? b.mtime.toLocaleString('pt-BR') : b.name;
          msg += `▸ ${b.name} — ${date}\n`;
        }
        return ctx.reply(msg);
      }
      if (sub === 'criar' || sub === 'now') {
        await ctx.reply('⏳ Criando backup automático...');
        const p = autoBackup.doBackup('manual');
        return ctx.reply(p ? `✅ Criado: ${p}` : '❌ Falha');
      }
      if (sub === 'limpar' || sub === 'clear') {
        const list = autoBackup.listBackups();
        for (const b of list) {
          try { fs.rmSync(b.path, { recursive: true, force: true }); } catch (_) {}
        }
        return ctx.reply(`✅ ${list.length} backups automáticos removidos.`);
      }
    },
  },
];
