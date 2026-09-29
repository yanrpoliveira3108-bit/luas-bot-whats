'use strict';

// FIFO somente por chat. Não mantém uma promessa global e remove entradas
// ociosas para não crescer sem limite.
const queues = new Map();

function enqueue(chatJid, task) {
  const key = String(chatJid || 'unknown');
  const previous = queues.get(key) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (queues.get(key) === current) queues.delete(key);
    });
  queues.set(key, current);
  return current;
}

function stats() {
  return { activeChats: queues.size, queuedChats: queues.size };
}

function reset() { queues.clear(); }

module.exports = { enqueue, stats, reset };
