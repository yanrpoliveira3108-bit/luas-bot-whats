/**
 * commands/owner/fotomenubot.js — troca a IMAGEM DE CABEÇALHO DOS MENUS.
 *
 * Diferente de !fotobot (foto de perfil do bot no WhatsApp): aqui o alvo são os
 * arquivos de assets/ que o menu usa como cabeçalho (utils/menuImage.js).
 *
 * - `!fotomenubot`                  → imagem principal (assets/menu.jpg)
 * - `!fotomenubot admin`            → cabeçalho dos menus de admin
 *   chaves: main, admin, sticker, life, download, profile
 * - `!fotomenubot reset [chave]`    → volta o backup mais recente
 *
 * A imagem é validada (jimp) e regravada como JPEG de verdade — o caminho é
 * `.jpg`, então gravar PNG ali faria o mimetype sair errado no envio.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const CONFIG = require('../../config');
const icons = require('../../utils/icons');
const ui = require('../../utils/uiKit');

const MAX_BYTES = 8 * 1024 * 1024;
const BACKUP_DIR = path.join(CONFIG.paths.backupDir, 'menu');
const KEYS = Object.keys(CONFIG.menu.images || {});

function targetOf(key) {
  return CONFIG.menu.images[key] || CONFIG.menu.images.main;
}

function rel(p) {
  // caminho relativo ao projeto: útil e sem expor o diretório do usuário
  const root = CONFIG.paths.root;
  return String(p || '').startsWith(root) ? path.relative(root, p) : path.basename(String(p || ''));
}

function backupsOf(key) {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith(`${key}-`) && f.endsWith('.jpg'))
      .sort()
      .reverse();
  } catch (_) {
    return [];
  }
}

async function listStatus(ctx) {
  const lines = [
    `${icons.get('sticker') || '🖼️'} *Imagens do menu*`,
    '',
  ];
  for (const key of KEYS) {
    const p = targetOf(key);
    let info = 'ausente';
    try {
      if (fs.existsSync(p)) {
        const st = fs.statSync(p);
        info = `${(st.size / 1024).toFixed(0)} KB`;
      }
    } catch (_) {
      /* segue */
    }
    lines.push(`▸ *${key}* — ${rel(p)} — ${info} — ${backupsOf(key).length} backup(s)`);
  }
  lines.push('');
  lines.push(
    ui.truncate(
      `Marque uma imagem e use ${ctx.prefix}fotomenubot [${KEYS.join('|')}]\n` +
        `Para desfazer: ${ctx.prefix}fotomenubot reset [chave]`,
      400
    )
  );
  return ctx.reply(lines.join('\n'));
}

module.exports = [
  {
    name: 'fotomenubot',
    commands: ['fotomenubot', 'menufoto', 'fotomenu', 'setmenuimg', 'menuimage'],
    category: 'owner',
    ownerOnly: true,
    description: 'Troca a imagem de cabeçalho dos menus do bot (marque uma imagem).',
    usage: '!fotomenubot [main|admin|sticker|life|download|profile] | reset [chave]',
    examples: ['!fotomenubot', '!fotomenubot admin', '!fotomenubot reset'],
    cooldown: 8000,
    tags: ['menu', 'imagem', 'header', 'assets'],
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').trim().toLowerCase();

      // ---- reset: restaura o backup mais recente
      if (arg === 'reset' || arg === 'voltar') {
        const key = (ctx.args[1] || 'main').trim().toLowerCase();
        if (!KEYS.includes(key)) {
          return ctx.reply(`${icons.warning || '⚠️'} Chave inválida.\n▸ Válidas: ${KEYS.join(', ')}`);
        }
        const list = backupsOf(key);
        if (!list.length) {
          return ctx.reply(`${icons.warning || '⚠️'} Não há backup de *${key}* para restaurar.`);
        }
        const from = path.join(BACKUP_DIR, list[0]);
        try {
          fs.copyFileSync(from, targetOf(key));
          return ctx.reply(
            `${icons.get('done') || '✅'} Cabeçalho *${key}* restaurado de ${list[0]}.`
          );
        } catch (err) {
          return ctx.reply(ui.error('Não consegui restaurar o backup.', { reason: err.message }));
        }
      }

      // ---- sem mídia: mostra o estado atual (e as chaves)
      let media = null;
      try {
        media = await ctx.downloadMedia();
      } catch (_) {
        media = null;
      }
      if (!media || media.type !== 'image' || !media.buffer || !media.buffer.length) {
        return listStatus(ctx);
      }
      if (media.buffer.length > MAX_BYTES) {
        return ctx.reply(
          ui.error('Imagem grande demais.', {
            reason: `${(media.buffer.length / 1024 / 1024).toFixed(1)} MB`,
            hint: 'Envie uma imagem de até 8 MB',
          })
        );
      }

      const key = KEYS.includes(arg) ? arg : 'main';
      if (arg && !KEYS.includes(arg)) {
        return ctx.reply(
          `${icons.warning || '⚠️'} Chave *${arg}* não existe — use uma de: ${KEYS.join(', ')}\n▸ Ex.: ${ctx.prefix}fotomenubot admin`
        );
      }

      // valida de verdade (buffer corrompido não vira cabeçalho quebrado)
      let img = null;
      try {
        img = await Jimp.read(media.buffer);
      } catch (err) {
        return ctx.reply(
          ui.error('Não reconheci essa imagem.', {
            reason: String(err.message || 'arquivo inválido').slice(0, 100),
            hint: 'Envie JPG ou PNG',
          })
        );
      }

      const target = targetOf(key);
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.mkdirSync(BACKUP_DIR, { recursive: true });

        // backup do cabeçalho atual ANTES de sobrescrever
        let backupName = null;
        if (fs.existsSync(target)) {
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          backupName = `${key}-${ts}.jpg`;
          fs.copyFileSync(target, path.join(BACKUP_DIR, backupName));
        }

        await img.quality(90).writeAsync(target);
        const bytes = fs.statSync(target).size;

        return ctx.reply(
          [
            `${icons.get('done') || '✅'} Cabeçalho do menu atualizado.`,
            `▸ Chave: *${key}*`,
            `▸ Arquivo: ${rel(target)}`,
            `▸ Dimensões: ${img.bitmap.width}x${img.bitmap.height} → ${(bytes / 1024).toFixed(0)} KB`,
            backupName ? `▸ Backup: backup/menu/${backupName}` : '▸ Backup: (não havia imagem anterior)',
            '',
            `Desfazer: ${ctx.prefix}fotomenubot reset ${key}`,
          ].join('\n')
        );
      } catch (err) {
        return ctx.reply(ui.error('Falha ao gravar a imagem do menu.', { reason: err.message }));
      }
    },
  },
];
