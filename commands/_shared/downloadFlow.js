/**
 * commands/_shared/downloadFlow.js — fluxo em etapas para download de mídia.
 *
 * Centraliza a UX "Lua 2.0" dos comandos de mídia (play/ytmp3/ytmp4/video/...):
 *
 *   BUSCANDO → ENCONTRADO → BAIXANDO → CONVERTENDO → ENVIANDO → CONCLUÍDO
 *
 * Regras:
 *  - NUNCA mostra porcentagem inventada: só estados reais (ou % quando a fonte
 *    informar progresso verdadeiro);
 *  - UMA mensagem de progresso por operação (utils/progress reusa por chave);
 *  - transições validadas pela máquina de estados (nada de pular etapa);
 *  - timeout obrigatório em toda etapa externa;
 *  - erro vira card uniforme, sem stack/caminho/token.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ui = require('../../utils/uiKit');
const icons = require('../../utils/icons');
const fonts = require('../../utils/fonts');
const divider = require('../../utils/dividers');
const progressMod = require('../../utils/progress');
const stateMachine = require('../../utils/stateMachine');
const { withTimeout } = require('../../utils/resilience');
const { formatDuration } = require('../../utils/formatter');
const logger = require('../../utils/logger').child('dlflow');

const CONFIG = require('../../config');
const DEFAULT_STAGE_TIMEOUT_MS = (CONFIG.limits && CONFIG.limits.downloadTimeoutMs) || 90000;

/** Tamanho legível de um arquivo (0 quando não dá para saber). */
function fileSize(file) {
  try {
    const bytes = fs.statSync(file).size;
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  } catch (_) {
    return '';
  }
}

/**
 * Rótulo do formato. A extensão do arquivo é a fonte mais confiável; o mimetype
 * entra como reforço (audio/mpeg É mp3, não "áudio genérico").
 */
function formatOf(result) {
  const ext = String(path.extname((result && result.path) || '')).replace('.', '').toLowerCase();
  const byExt = { mp3: 'MP3', m4a: 'M4A', mp4: 'MP4', ogg: 'OGG', opus: 'OGG', webm: 'WEBM', webp: 'WEBP', jpg: 'JPG', png: 'PNG' };
  if (byExt[ext]) return byExt[ext];
  const mime = String((result && result.mimetype) || '');
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'MP3';
  if (mime.includes('audio/mp4') || mime.includes('m4a')) return 'M4A';
  if (mime.includes('video/mp4')) return 'MP4';
  if (mime.includes('ogg') || mime.includes('opus')) return 'OGG';
  if (mime.includes('webm')) return 'WEBM';
  if (mime.includes('webp')) return 'WEBP';
  return ext ? ext.toUpperCase() : mime || 'MÍDIA';
}

/**
 * Card de resultado (só com dados que realmente existem).
 * @param {object} result { title, author, duration, path, mimetype }
 * @param {object} [opts] { kind: 'audio'|'video', quality, tookMs }
 */
function resultCard(result, opts = {}) {
  const kind = opts.kind || 'audio';
  const rows = [];
  if (result.title) rows.push(['Título', ui.truncate(String(result.title), 60), icons.music]);
  if (result.author) rows.push([kind === 'video' ? 'Canal' : 'Artista/Canal', ui.truncate(String(result.author), 40), icons.get('info')]);
  const seconds = Number(result.duration) || 0;
  if (seconds > 0) rows.push(['Duração', formatDuration(seconds * 1000), icons.clock]);
  else if (result.durationText) rows.push(['Duração', String(result.durationText), icons.clock]);
  if (result.views) rows.push(['Views', Number(result.views).toLocaleString('pt-BR'), icons.get('eye')]);
  rows.push(['Formato', opts.format || formatOf(result), icons.get('download')]);
  if (opts.quality) rows.push(['Qualidade', String(opts.quality), icons.get('gear')]);
  const size = fileSize(result.path);
  if (size) rows.push(['Tamanho', size, icons.get('spark')]);
  if (opts.tookMs) rows.push(['Processamento', formatDuration(opts.tookMs), icons.get('clock')]);
  return ui.card(kind === 'video' ? 'VIDEO READY' : 'PLAY READY', rows, kind === 'video' ? 'download' : 'music');
}

/** Card final (conclusão). */
function completeCard(result, opts = {}) {
  const kind = opts.kind || 'audio';
  const box = divider.box(`${icons.music} ${fonts.safe('COMPLETE', 'boldScript')}`);
  const lines = [];
  if (result.title) lines.push(`${icons.music} ${ui.truncate(String(result.title), 60)}`);
  if (result.author) lines.push(`${icons.get('info')} ${ui.truncate(String(result.author), 40)}`);
  const seconds = Number(result.duration) || 0;
  if (seconds > 0) lines.push(`${icons.clock} ${formatDuration(seconds * 1000)}`);
  lines.push(`${icons.get('download')} ${formatOf(result)}`);
  return [box.top, box.body, box.bottom, '', lines.join('\n')].join('\n');
}

/**
 * Executa um fluxo em etapas.
 *
 * @param {object} ctx contexto do comando
 * @param {object} opts
 * @param {string} opts.title título do cabeçalho (ex.: 'PLAY')
 * @param {string} [opts.category] categoria visual (music/download)
 * @param {string} opts.key chave única da operação (ex.: `play:${videoId}`)
 * @param {Function} opts.run recebe { stage, machine, tracker }
 * @param {number} [opts.timeoutMs] timeout por etapa
 * @returns {Promise<*>} retorno de run
 */
async function runStaged(ctx, opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_STAGE_TIMEOUT_MS;
  const machine = stateMachine.create('SEARCHING', stateMachine.MEDIA_FLOW, { command: opts.title });
  const tracker = await progressMod.progressMessage(ctx, {
    key: opts.key || `${String(opts.title || 'dl').toLowerCase()}:${ctx.remoteJid}`,
    title: opts.title || 'DOWNLOAD',
    category: opts.category || 'music',
    state: machine.label(),
  });

  const startedAt = Date.now();
  let stageTimer = null;

  /**
   * Muda de estado com validação + timeout por etapa.
   * Declarar de novo o estado atual é no-op (não é transição): evita quebrar o
   * fluxo quando o caller marca a etapa em que a máquina já nasceu.
   */
  const stage = async (next, meta) => {
    if (next !== machine.state) machine.to(next, meta);
    else if (meta) Object.assign(machine.meta, meta);
    if (stageTimer) clearTimeout(stageTimer);
    stageTimer = setTimeout(() => {
      logger.warn({ command: opts.title, state: machine.state, timeoutMs }, 'etapa excedeu o tempo limite');
    }, timeoutMs);
    await tracker.state(machine.label());
    return machine;
  };

  try {
    const out = await withTimeout(
      () => opts.run({ stage, machine, tracker, timeoutMs }),
      timeoutMs * 4,
      opts.title || 'download'
    );
    // fluxo de busca termina em FOUND (o usuário escolhe depois): só marca DONE
    // quando a transição existe, sem inventar etapa.
    if (!machine.settled() && machine.can('DONE')) machine.to('DONE');
    await tracker.complete(null);
    logger.info(
      { command: opts.title, path: machine.path(), tookMs: Date.now() - startedAt },
      'fluxo de mídia concluído'
    );
    return out;
  } catch (err) {
    machine.fail(err);
    logger.warn({ command: opts.title, err: err.message, path: machine.path() }, 'fluxo de mídia falhou');
    await tracker.fail('Não consegui concluir o download.', {
      reason: err && err.code === 'TIMEOUT' ? 'tempo limite excedido' : undefined,
      hint: 'Tente outro link ou uma qualidade menor.',
    });
    throw err;
  } finally {
    if (stageTimer) clearTimeout(stageTimer);
  }
}

module.exports = { runStaged, resultCard, completeCard, fileSize, formatOf };
