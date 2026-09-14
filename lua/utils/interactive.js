/**
 * utils/interactive.js — envio de menus interativos (botões/listas) com fallback.
 *
 * - tenta lista (list message) e botões (buttons message) do Baileys
 * - em caso de falha, envia menu numerado em texto e registra as ações
 *   para que o usuário responda com o número (fallback "comando numérico")
 */

'use strict';

const CONFIG = require('../config');
const logger = require('./logger').child('interactive');

/**
 * Envia um menu em lista.
 * @returns {Promise<boolean>} true se enviou a lista, false se caiu no fallback
 */
async function sendList(sock, jid, { title, text, footer, buttonText = 'Selecionar', sections, quoted }) {
  try {
    await sock.sendMessage(
      jid,
      {
        text,
        footer: footer || CONFIG.bot.name,
        title: title || CONFIG.bot.name,
        buttonText,
        sections: sections.map((s) => ({
          title: s.title || title,
          rows: s.rows.map((r) => ({
            title: String(r.title).slice(0, 24),
            rowId: r.id,
            description: r.description ? String(r.description).slice(0, 72) : undefined,
          })),
        })),
      },
      { quoted }
    );
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'lista falhou, usando fallback de texto');
    return false;
  }
}

/**
 * Envia mensagem com botões (máx. 3).
 * headerType: 1 = texto, 4 = imagem.
 */
async function sendButtons(sock, jid, { text, footer, buttons, headerType = 1, headerText, image, quoted }) {
  try {
    const payload = {
      text,
      footer: footer || CONFIG.bot.name,
      buttons: buttons.slice(0, 3).map((b) => ({
        buttonId: b.id,
        buttonText: { displayText: String(b.label).slice(0, 24) },
        type: 1,
      })),
      headerType,
    };
    if (headerType === 1) payload.headerText = headerText || '';
    if (headerType === 4 && image) payload.image = image;
    await sock.sendMessage(jid, payload, { quoted });
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'botões falharam, usando fallback de texto');
    return false;
  }
}

module.exports = { sendList, sendButtons };
