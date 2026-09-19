/**
 * utils/janitor.js — faxina única para estruturas em memória.
 *
 * Problema que isto resolve: vários módulos guardam Mapas em memória
 * (histórico de mensagens para purge, estado de spam/flood, XP, AFK,
 * view-once, cooldowns...). Cada um limpava "quando dava", ou nunca limpava —
 * em grupos movimentados isso vira vazamento de memória (o processo cresce
 * sem parar) e, pior, cada módulo criava o próprio setInterval.
 *
 * Aqui existe UM timer só (60s), que roda as tarefas registradas respeitando
 * o intervalo de cada uma. O timer é `unref()`: nunca segura o processo
 * aberto. Qualquer exceção numa tarefa é isolada (nunca derruba o bot).
 */

'use strict';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const TICK_MS = 60 * 1000; // resolução do agendador

const tasks = new Map(); // name -> { fn, intervalMs, last, runs, lastMs }
let timer = null;

/**
 * Registra (ou substitui) uma tarefa de limpeza.
 * @param {string} name identificador único
 * @param {() => void} fn função de limpeza (síncrona e rápida)
 * @param {number} [intervalMs] intervalo entre execuções
 */
function register(name, fn, intervalMs = DEFAULT_INTERVAL_MS) {
  if (typeof fn !== 'function') return false;
  tasks.set(String(name), {
    fn,
    intervalMs: Math.max(TICK_MS, Number(intervalMs) || DEFAULT_INTERVAL_MS),
    last: 0,
    runs: 0,
    lastMs: 0,
  });
  return true;
}

function unregister(name) {
  return tasks.delete(String(name));
}

/** Executa as tarefas vencidas. Exportado para testes (sem depender do timer). */
function sweep(now = Date.now()) {
  for (const [name, t] of tasks) {
    if (now - t.last < t.intervalMs) continue;
    t.last = now;
    const t0 = Date.now();
    try {
      t.fn();
    } catch (_) {
      /* limpeza nunca pode derrubar o bot */
    }
    t.lastMs = Date.now() - t0;
    t.runs++;
    if (t.lastMs > 250) {
      try {
        require('./activity').terminalLine(`[JANITOR] ${name} demorou ${t.lastMs}ms`);
      } catch (_) {}
    }
  }
}

function start() {
  if (timer) return timer;
  timer = setInterval(() => sweep(), TICK_MS);
  if (timer.unref) timer.unref();
  return timer;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Diagnóstico (usado por !debug). */
function stats() {
  return {
    running: !!timer,
    tasks: [...tasks.entries()].map(([name, t]) => ({
      name,
      intervalMs: t.intervalMs,
      runs: t.runs,
      lastMs: t.lastMs,
    })),
  };
}

module.exports = { register, unregister, sweep, start, stop, stats, DEFAULT_INTERVAL_MS, TICK_MS };
