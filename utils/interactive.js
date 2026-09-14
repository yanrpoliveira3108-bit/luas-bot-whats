/**
 * utils/interactive.js — envio de menus interativos (LISTA) com fallback.
 *
 * - LISTA nativa (native flow single_select) COM cabeçalho de imagem: UMA
 *   única mensagem (foto + lista integradas) — método PRIMÁRIO quando há imagem
 * - LISTA clássica (sections/listMessage): fallback sem imagem
 * - botões (buttons message) ficam disponíveis para casos pontuais
 * - em caso de falha, envia menu numerado em texto e registra as ações
 *   para que o usuário responda com o número (fallback "comando numérico")
 */

'use strict';

const fs = require('fs');
const CONFIG = require('../config');
const logger = require('./logger').child('interactive');

/** Lê a mídia para Buffer (aceita Buffer, caminho local ou { url }). */
async function toBuffer(media) {
  try {
    if (Buffer.isBuffer(media)) return media;
    if (media && Buffer.isBuffer(media.buffer)) return media.buffer;
    const p = media && typeof media.url === 'string' ? media.url : typeof media === 'string' ? media : null;
    if (p && fs.existsSync(p)) return await fs.promises.readFile(p);
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Envia LISTA interativa nativa (single_select) com cabeçalho de imagem.
 * @returns {Promise<boolean>} true se enviou (uma única mensagem)
 */
async function sendListWithImage(sock, jid, { title, text, footer, sections, image, quoted }) {
  const buf = await toBuffer(image);
  if (!buf) return false;
  try {
    await sock.sendMessage(
      jid,
      {
        interactiveButtons: [
          {
            name: 'single_select',
            buttonParamsJson: JSON.stringify({
              title: title || CONFIG.bot.name,
              sections: sections.map((s) => ({
                title: s.title || title || CONFIG.bot.name,
                rows: s.rows.map((r) => ({
                  header: r.header || '',
                  title: String(r.title || '').slice(0, 24),
                  description: r.description ? String(r.description).slice(0, 72) : '',
                  id: r.id,
                })),
              })),
            }),
          },
        ],
        image: buf,
        caption: text || '',
        title: title || CONFIG.bot.name,
        footer: footer || CONFIG.bot.name,
      },
      { quoted }
    );
    return true;
  } catch (err) {
    logger.warn({ err: err.message, stack: err && err.stack }, 'lista nativa com imagem falhou');
    if (err && err.stack) {
      require('./activity').terminalLine(`[SEND] STACK(lista+imagem): ${String(err.stack).split('\n').slice(0, 6).join(' ⏎ ')}`);
    }
    return false;
  }
}

/**
 * Envia um menu em lista (listMessage/sections — sem imagem).
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
    logger.warn({ err: err.message, stack: err && err.stack }, 'lista falhou, usando fallback de texto');
    if (err && err.stack) {
      require('./activity').terminalLine(`[SEND] STACK(lista): ${String(err.stack).split('\n').slice(0, 6).join(' ⏎ ')}`);
    }
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

module.exports = { sendList, sendListWithImage, sendButtons };
