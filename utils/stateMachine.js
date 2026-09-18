/**
 * utils/stateMachine.js — máquina de estados mínima para operações longas.
 *
 * Cada fluxo (play, download, sticker) tem estados identificáveis e transições
 * válidas. Isso evita "duas operações concorrentes disputando a mesma
 * mensagem" e deixa claro em qual etapa um job parou quando dá erro.
 *
 *   const sm = stateMachine.create('SEARCHING', stateMachine.MEDIA_FLOW);
 *   sm.to('FOUND');      // ok
 *   sm.to('DONE');       // lança INVALID_TRANSITION (não pode pular etapa)
 *   sm.to('ERROR');      // sempre permitido
 */

'use strict';

/** Fluxo padrão de mídia (busca → resultado → download → conversão → envio). */
const MEDIA_FLOW = {
  SEARCHING: ['FOUND', 'ERROR'],
  FOUND: ['DOWNLOADING', 'ERROR'],
  DOWNLOADING: ['CONVERTING', 'UPLOADING', 'DONE', 'ERROR'],
  CONVERTING: ['UPLOADING', 'ERROR'],
  UPLOADING: ['DONE', 'ERROR'],
  DONE: [],
  ERROR: [],
};

/** Fluxo simples (sem etapas de mídia). */
const SIMPLE_FLOW = {
  IDLE: ['RUNNING', 'ERROR'],
  RUNNING: ['DONE', 'ERROR'],
  DONE: [],
  ERROR: [],
};

const LABELS = {
  SEARCHING: 'BUSCANDO',
  FOUND: 'ENCONTRADO',
  DOWNLOADING: 'BAIXANDO',
  CONVERTING: 'CONVERTENDO',
  UPLOADING: 'ENVIANDO',
  DONE: 'CONCLUÍDO',
  ERROR: 'ERRO',
  IDLE: 'AGUARDANDO',
  RUNNING: 'PROCESSANDO',
};

class StateMachine {
  constructor(initial, flow = SIMPLE_FLOW, meta = {}) {
    if (!flow || !Object.prototype.hasOwnProperty.call(flow, initial)) {
      throw new Error(`estado inicial inválido: ${initial}`);
    }
    this.flow = flow;
    this.state = initial;
    this.meta = Object.assign({}, meta);
    this.history = [{ state: initial, at: Date.now() }];
    this.error = null;
  }

  /** Estado atual. */
  is(state) {
    return this.state === state;
  }

  /** Pode ir para `next`? */
  can(next) {
    if (next === this.state) return false;
    if (next === 'ERROR') return this.state !== 'ERROR';
    return (this.flow[this.state] || []).includes(next);
  }

  /**
   * Transiciona. Lança INVALID_TRANSITION quando a transição não existe.
   * @param {string} next
   * @param {object} [meta] dados extras (ex.: { videoId, bytes })
   */
  to(next, meta) {
    if (!Object.prototype.hasOwnProperty.call(this.flow, next)) {
      const err = new Error(`estado desconhecido: ${next}`);
      err.code = 'UNKNOWN_STATE';
      throw err;
    }
    if (!this.can(next)) {
      const err = new Error(`transição inválida: ${this.state} → ${next}`);
      err.code = 'INVALID_TRANSITION';
      err.from = this.state;
      err.to = next;
      throw err;
    }
    this.state = next;
    if (meta) Object.assign(this.meta, meta);
    this.history.push({ state: next, at: Date.now() });
    return this;
  }

  /** Atalho: vai para ERROR guardando o motivo (nunca lança). */
  fail(err) {
    this.error = err && err.message ? err.message : String(err || 'erro desconhecido');
    if (this.state !== 'ERROR') {
      this.state = 'ERROR';
      this.history.push({ state: 'ERROR', at: Date.now() });
    }
    return this;
  }

  /** Rótulo em português (para a interface). */
  label(state = this.state) {
    return LABELS[state] || state;
  }

  /** Terminou (DONE ou ERROR)? */
  settled() {
    return this.state === 'DONE' || this.state === 'ERROR';
  }

  /** Trajetória (para log/observabilidade). */
  path() {
    return this.history.map((h) => h.state).join(' → ');
  }

  /** Duração total em ms. */
  durationMs() {
    const first = this.history[0].at;
    const last = this.history[this.history.length - 1].at;
    return last - first;
  }
}

/**
 * Cria uma máquina de estados.
 * @param {string} initial
 * @param {object} [flow]
 * @param {object} [meta]
 */
function create(initial = 'SEARCHING', flow = MEDIA_FLOW, meta = {}) {
  return new StateMachine(initial, flow, meta);
}

module.exports = { create, StateMachine, MEDIA_FLOW, SIMPLE_FLOW, LABELS };
