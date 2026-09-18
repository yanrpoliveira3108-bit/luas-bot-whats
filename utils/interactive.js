/**
 * utils/interactive.js — envio de menus interativos (LISTA) com fallback.
 *
 * - LISTA nativa (native flow single_select) COM cabeçalho de imagem: UMA
 *   única mensagem (foto + lista integradas) — método PRIMÁRIO quando há imagem
 * - LISTA clássica (sections/listMessage): fallback sem imagem
 * - botões (buttons message) ficam disponíveis para casos pontuais
 * - em caso de falha, envia menu numerado em texto e registra as ações
 *   para que o usuário responda com o número (fallback "comando numérico")
 *
 * NORMALIZAÇÃO (ponto único de saneamento de texto):
 * Todo texto que sai por aqui passa por normalizeText/normalizeLabel:
 * - "\n" ESCAPADO (backslash + n, vindo de .env, banco ou string montada com
 *   aspas duplas — o famoso "\\n" duplicado) vira quebra de linha REAL.
 *   Sem isso o WhatsApp recebia a legenda com "\n" literal e a mensagem de
 *   botões era rejeitada → sendButtons caía no fallback sem avisar.
 * - rótulos de botão/linha NUNCA carregam quebra de linha (o WhatsApp trunca
 *   em 24 caracteres e quebra o layout): viram espaço.
 * - rótulos aceitam `text`, `label`, `displayText` ou `title` (os callers do
 *   projeto mandam `text`; antes só `label` era lido → botões "undefined").
 */

'use strict';

const fs = require('fs');
const CONFIG = require('../config');
const logger = require('./logger').child('interactive');

/* ------------------------- normalização de texto ------------------------- */

const LIMIT_TEXT = 4000; // legenda/corpo
const LIMIT_TITLE = 24; // rótulo de botão / linha
const LIMIT_DESC = 72; // descrição de linha
const LIMIT_FOOTER = 120;

/**
 * Converte sequências ESCAPADAS em caracteres reais.
 * "\n" (2 chars: backslash + n) → quebra de linha; "\t" → espaço.
 */
function unescapeText(value) {
  return String(value).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, ' ');
}

/**
 * Sanea texto longo (legenda, corpo, rodapé).
 * @param {*} value
 * @param {{maxLength?: number}} [opts]
 * @returns {string}
 */
function normalizeText(value, opts = {}) {
  if (value === undefined || value === null) return '';
  const maxLength = opts.maxLength || LIMIT_TEXT;
  let s = unescapeText(value);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/[ \t]+\n/g, '\n'); // sem espaço sobrando antes da quebra
  s = s.replace(/\n{3,}/g, '\n\n'); // no máximo uma linha em branco
  s = s.trim();
  if (s.length > maxLength) s = `${s.slice(0, maxLength - 1)}…`;
  return s;
}

/**
 * Sanea rótulo curto (botão, linha de lista): sem quebra de linha, sem
 * espaços duplos e truncado no limite do WhatsApp.
 * @param {*} value
 * @param {number} [maxLength]
 * @returns {string}
 */
function normalizeLabel(value, maxLength = LIMIT_TITLE) {
  let s = normalizeText(value, { maxLength: 500 });
  s = s.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (s.length > maxLength) s = `${s.slice(0, maxLength - 1)}…`;
  return s;
}

/** Escolhe o texto do rótulo entre os nomes aceitos pelos callers. */
function pickLabel(obj, ...keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

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
  const cleanTitle = normalizeLabel(title || CONFIG.bot.name, 60);
  const rows = normalizeSections(sections);
  if (!rows.length) {
    logger.warn('lista nativa sem linhas válidas — nada enviado');
    return false;
  }
  try {
    await sock.sendMessage(
      jid,
      {
        interactiveButtons: [
          {
            name: 'single_select',
            buttonParamsJson: JSON.stringify({
              title: cleanTitle,
              sections: rows,
            }),
          },
        ],
        image: buf,
        caption: normalizeText(text),
        title: cleanTitle,
        footer: normalizeText(footer || CONFIG.bot.name, { maxLength: LIMIT_FOOTER }),
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
 * Normaliza seções/linhas de lista: descarta linhas sem id ou sem rótulo e
 * aplica os limites do WhatsApp.
 * @returns {Array<{title: string, rows: Array}>}
 */
function normalizeSections(sections) {
  const out = [];
  for (const s of sections || []) {
    const rows = [];
    for (const r of (s && s.rows) || []) {
      const id = r && (r.id || r.rowId);
      const label = normalizeLabel(pickLabel(r, 'title', 'text', 'label', 'displayText'));
      if (!id || !label) continue;
      const description = pickLabel(r, 'description', 'desc');
      rows.push({
        header: normalizeLabel(r.header || '', LIMIT_TITLE),
        title: label,
        description: description ? normalizeLabel(description, LIMIT_DESC) : '',
        id: String(id),
      });
    }
    if (rows.length) out.push({ title: normalizeLabel((s && s.title) || CONFIG.bot.name, 24) || CONFIG.bot.name, rows });
  }
  return out;
}

/**
 * Envia um menu em lista (listMessage/sections — sem imagem).
 * @returns {Promise<boolean>} true se enviou a lista, false se caiu no fallback
 */
async function sendList(sock, jid, { title, text, footer, buttonText = 'Selecionar', sections, quoted }) {
  const cleanTitle = normalizeLabel(title || CONFIG.bot.name, 60);
  const cleanSections = normalizeSections(sections).map((s) => ({
    title: s.title,
    rows: s.rows.map((r) => ({
      title: r.title,
      rowId: r.id,
      description: r.description || undefined,
    })),
  }));
  if (!cleanSections.length) {
    logger.warn('lista sem linhas válidas — usando fallback de texto');
    return false;
  }
  try {
    await sock.sendMessage(
      jid,
      {
        text: normalizeText(text),
        footer: normalizeText(footer || CONFIG.bot.name, { maxLength: LIMIT_FOOTER }),
        title: cleanTitle,
        buttonText: normalizeLabel(buttonText, LIMIT_TITLE) || 'Selecionar',
        sections: cleanSections,
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
 *
 * Aceita botões como { id, text } (padrão do projeto) ou { id, label }.
 * @returns {Promise<boolean>} true se enviou, false para o caller usar texto
 */
async function sendButtons(sock, jid, { text, footer, buttons, headerType = 1, headerText, image, quoted }) {
  const cleanButtons = (buttons || [])
    .filter(Boolean)
    .map((b) => ({
      buttonId: String(b.id || b.buttonId || '').slice(0, 64),
      displayText: normalizeLabel(pickLabel(b, 'text', 'label', 'displayText', 'title')),
    }))
    .filter((b) => b.buttonId && b.displayText)
    .slice(0, 3)
    .map((b) => ({ buttonId: b.buttonId, buttonText: { displayText: b.displayText }, type: 1 }));

  if (!cleanButtons.length) {
    logger.warn('nenhum botão válido (id/texto) — usando fallback de texto');
    return false;
  }

  const cleanText = normalizeText(text);
  if (!cleanText) {
    logger.warn('botões sem texto — usando fallback de texto');
    return false;
  }

  try {
    const payload = {
      text: cleanText,
      footer: normalizeText(footer || CONFIG.bot.name, { maxLength: LIMIT_FOOTER }),
      buttons: cleanButtons,
      headerType,
    };
    if (headerType === 1) payload.headerText = normalizeText(headerText || '', { maxLength: 60 });
    if (headerType === 4 && image) payload.image = image;
    await sock.sendMessage(jid, payload, { quoted });
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'botões falharam, usando fallback de texto');
    return false;
  }
}

module.exports = { sendList, sendListWithImage, sendButtons, normalizeText, normalizeLabel, unescapeText };
