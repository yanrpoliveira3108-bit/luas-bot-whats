/**
 * utils/menu.js — construtor de menus interativos com fallback.
 *
 * Envia lista interativa; se não for suportada, envia texto numerado e
 * registra as ações no numberFallback. Toda linha tem um handler real.
 */

'use strict';

const fs = require('fs');
const CONFIG = require('../config');
const settings = require('../database/settings');
const { registry } = require('../engine/plugins');
const buttonHandler = require('../handlers/buttonHandler');
const commandHandler = require('../handlers/commandHandler');
const { commandEmoji } = require('./commandEmoji');
const interactive = require('./interactive');
const numberFallback = require('./numberFallback');

/**
 * Envia um menu.
 * @param {object} ctx contexto
 * @param {object} opts { id, title, text, rows, image, footer, buttonText }
 *   rows: [{ id?, title, description?, run?|command? }]
 * @returns {Promise<boolean>} true se enviou menu interativo
 */
async function sendMenu(ctx, opts = {}) {
  // Formato HTML: só quando temos uma CATEGORIA real do registro (os menus
  // montados com linhas próprias — x9, rankings, configurações — continuam no
  // formato tradicional, que é onde as ações delas fazem sentido).
  if (opts.category && opts.viaHtml !== false) {
    const menuFormat = require('./menuFormat');
    const enviado = await menuFormat.abrir(ctx, {
      kind: 'categoria',
      categoria: opts.category,
      foco: opts.foco || opts.category,
      forceText: ctx && ctx.forceTextMenu,
    });
    if (enviado) return true;
  }

  const menuId = String(opts.id || 'menu').replace(/[^a-z0-9-]/gi, '').slice(0, 24);
  const rows = opts.rows || [];

  const items = rows.map((row, i) => {
    const rowId = String(row.id || `item${i + 1}`).replace(/[^a-z0-9-]/gi, '').slice(0, 24);
    const fullId = `lua:${menuId}:${rowId}`.slice(0, 80);
    let run = typeof row.run === 'function' ? row.run : null;
    if (!run && row.command) {
      run = (c) => commandHandler.runByName(c, row.command);
    }
    if (run) buttonHandler.register(fullId, run);
    return { id: fullId, title: String(row.title || '').slice(0, 24), description: row.description || '', run };
  });

  // imagem opcional (header)
  if (opts.image && fs.existsSync(opts.image)) {
    try {
      await ctx.sendImage(opts.image, `${CONFIG.bot.name} v${CONFIG.bot.version}`);
    } catch (_) {
      /* segue sem imagem */
    }
  }

  const text = opts.text || opts.title || CONFIG.bot.name;
  const ok = await interactive.sendList(ctx.socket, ctx.remoteJid, {
    title: opts.title || CONFIG.bot.name,
    text,
    footer: opts.footer || `${CONFIG.bot.name} • ${settings.effectivePrefix()}menu para recarregar`,
    buttonText: opts.buttonText || '📂 Abrir',
    sections: [{ title: opts.title || CONFIG.bot.name, rows: items }],
    quoted: ctx.message,
  });

  if (!ok) {
    const lines = items.map((it, i) => `${i + 1}. ${it.title}`).join('\n');
    const body = `*${opts.title || CONFIG.bot.name}*\n${opts.text ? '\n' + opts.text + '\n' : ''}\n\n${lines}\n\n_Responda com o número da opção._`;
    await ctx.reply(body);
    numberFallback.setNumberMenu(
      ctx.remoteJid,
      items.map((it, i) => ({ num: i + 1, label: it.title, run: it.run }))
    );
  }
  return ok;
}

/**
 * Menu padrão de categoria: lista os comandos realmente carregados.
 */
async function categoryMenu(ctx, meta) {
  const cmds = registry.byCategory().get(meta.category) || [];
  if (cmds.length === 0) {
    await ctx.reply(`📂 Nenhum comando carregado na categoria *${meta.title}*.`);
    return false;
  }
  const rows = cmds.map((c) => ({
    id: c.name,
    title: `${commandEmoji(c)} ${ctx.prefix}${c.name}`,
    description: (c.description || '').slice(0, 60),
    command: c.name,
  }));
  return sendMenu(ctx, {
    id: meta.category,
    category: meta.category,
    title: meta.title,
    text: `${meta.description || ''}\n_Toque em um comando para executá-lo._`,
    rows,
  });
}

module.exports = { sendMenu, categoryMenu };
