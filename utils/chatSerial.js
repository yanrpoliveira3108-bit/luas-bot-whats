'use strict';

// Ordem local por chat, sem pacing, sem PPM e sem fila global.
const tails = new Map();
function enqueue(chatJid, task) {
  const key = String(chatJid || 'unknown');
  const previous = tails.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task).finally(() => {
    if (tails.get(key) === current) tails.delete(key);
  });
  tails.set(key, current);
  return current;
}
function stats() { return { activeChats: tails.size }; }
module.exports = { enqueue, stats };
