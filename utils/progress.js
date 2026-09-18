/**
 * utils/progress.js — mensagens de progresso/estado (itens 18, 79 e 86).
 *
 * Regras do briefing:
 *  - NUNCA inventar porcentagem: `update({ percent })` só quando há progresso
 *    real; sem isso use `state('BAIXANDO')` (rótulo de etapa);
 *  - uma operação = UMA mensagem: duas operações concorrentes nunca disputam a
 *    mesma mensagem (tracker por chave, reuso em vez de duplicar);
 *  - estados temporários expiram (TTL) e param de editar sozinhos.
 */

'use strict';

const ui = require('./uiKit');
const icons = require('./icons');
const logger = require('./logger').child('progress');

const DEFAULT_MIN_INTERVAL_MS = 700;
const DEFAULT_MAX_LIFE_MS = 3 * 60 * 1000;

/** trackers ativos: `${jid}::${key}` -> tracker */
const trackers = new Map();

/** Formata o corpo conforme há percentual real ou só estado. */
function render(tracker, opts = {}) {
  const title = tracker.title;
  const label = opts.label || tracker.label;
  const parts = [ui.header(title, tracker.category, { pad: 2 })];
  if (label) parts.push(`${icons.loading} ${label}`);
  const percent = opts.percent !== undefined ? opts.percent : tracker.percent;
  if (percent !== undefined && percent !== null) {
    parts.push(ui.progress(percent, { showPercent: true }));
  } else if (tracker.stateLabel) {
    parts.push(`Estado: *${tracker.stateLabel}*`);
  }
  if (tracker.note) parts.push(tracker.note);
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Cria (ou reutiliza) uma mensagem de progresso.
 *
 * @param {object} ctx contexto do comando (usa ctx.remoteJid/ctx.socket/ctx.reply)
 * @param {object} opts { key, title, category, label, note, minIntervalMs, maxLifeMs, socket }
 */
async function progressMessage(ctx, opts = {}) {
  const jid = (ctx && ctx.remoteJid) || 'local';
  const key = String(opts.key || 'default');
  const id = `${jid}::${key}`;

  const existing = trackers.get(id);
  if (existing && !existing.done && Date.now() < existing.expiresAt) {
    return existing; // nunca cria uma segunda mensagem para a mesma operação
  }

  const sock = opts.socket || (ctx && ctx.socket) || null;
  const tracker = {
    id,
    jid,
    key,
    title: opts.title || 'PROCESSANDO',
    category: opts.category || 'system',
    label: opts.label || '',
    note: opts.note || '',
    stateLabel: opts.state || '',
    percent: undefined,
    messageKey: null,
    lastEdit: 0,
    done: false,
    edits: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + (opts.maxLifeMs || DEFAULT_MAX_LIFE_MS),
    minIntervalMs: opts.minIntervalMs || DEFAULT_MIN_INTERVAL_MS,
  };

  /** Envia/edita a mensagem (com fallback silencioso para texto). */
  tracker._paint = async (force = false) => {
    if (tracker.done || Date.now() > tracker.expiresAt) return false;
    const now = Date.now();
    if (!force && now - tracker.lastEdit < tracker.minIntervalMs) return false;
    tracker.lastEdit = now;
    const text = render(tracker);
    try {
      if (sock && tracker.messageKey && sock.sendMessage) {
        await sock.sendMessage(jid, { text, edit: tracker.messageKey });
        tracker.edits++;
        return true;
      }
      if (sock && sock.sendMessage) {
        const sent = await sock.sendMessage(jid, { text });
        tracker.messageKey = (sent && sent.key) || null;
        tracker.edits++;
        return true;
      }
    } catch (err) {
      // edição não suportada/ falha de rede: não derruba o comando
      logger.debug({ err: err.message }, 'progress: edição indisponível, usando texto');
    }
    if (ctx && typeof ctx.reply === 'function' && !tracker.messageKey) {
      try {
        await ctx.reply(text);
      } catch (_) {
        /* ignora */
      }
    }
    return false;
  };

  /**
   * Atualiza com progresso REAL (0..100).
   * @param {object} patch { percent, label, note, state }
   * @param {{force?: boolean}} [opts] force ignora o throttle (usado por etapa)
   */
  tracker.update = async (patch = {}, opts = {}) => {
    if (tracker.done) return tracker;
    if (patch.label !== undefined) tracker.label = String(patch.label);
    if (patch.note !== undefined) tracker.note = String(patch.note || '');
    if (patch.state) tracker.stateLabel = String(patch.state);
    if (patch.percent !== undefined && patch.percent !== null) {
      tracker.percent = Math.max(0, Math.min(100, Number(patch.percent) || 0));
    }
    // 100% é terminal e troca de etapa é marco: pintam mesmo dentro do throttle
    await tracker._paint(tracker.percent === 100 || opts.force === true);
    return tracker;
  };

  /** Muda só o estado (sem porcentagem inventada) — sempre visível. */
  tracker.state = (label) => tracker.update({ state: label }, { force: true });

  /** Conclui com sucesso. */
  tracker.complete = async (finalText) => {
    if (tracker.done) return false;
    tracker.done = true;
    tracker.percent = 100;
    tracker.stateLabel = 'CONCLUÍDO';
    trackers.delete(tracker.id);
    if (finalText && ctx && typeof ctx.reply === 'function') {
      try {
        await ctx.reply(finalText);
      } catch (_) {
        /* ignora */
      }
      return true;
    }
    return tracker._paint(true);
  };

  /** Falha (mensagem de erro uniforme, sem detalhes internos). */
  tracker.fail = async (message, opts2 = {}) => {
    if (tracker.done) return false;
    tracker.done = true;
    tracker.stateLabel = 'ERRO';
    trackers.delete(tracker.id);
    const text = ui.error(message || 'Não consegui concluir a operação.', opts2);
    if (ctx && typeof ctx.reply === 'function') {
      try {
        await ctx.reply(text);
      } catch (_) {
        /* ignora */
      }
      return true;
    }
    return tracker._paint(true);
  };

  trackers.set(id, tracker);
  await tracker._paint(true);
  return tracker;
}

/** GC: remove trackers expirados/concluídos (chamado no boot e periodicamente). */
function sweep() {
  const now = Date.now();
  let removed = 0;
  for (const [id, t] of [...trackers]) {
    if (t.done || now > t.expiresAt) {
      trackers.delete(id);
      removed++;
    }
  }
  return removed;
}

/** Quantidade de mensagens de progresso ativas. */
function activeCount() {
  return trackers.size;
}

/** Lista as chaves ativas (debug/!status). */
function list() {
  return [...trackers.values()].map((t) => ({
    key: t.key,
    jid: t.jid,
    state: t.stateLabel || (t.percent !== undefined ? `${t.percent}%` : '-'),
    ageMs: Date.now() - t.createdAt,
    expired: Date.now() > t.expiresAt,
  }));
}

module.exports = { progressMessage, sweep, activeCount, list, DEFAULT_MAX_LIFE_MS };
