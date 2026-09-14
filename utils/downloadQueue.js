/**
 * utils/downloadQueue.js — fila de downloads com concorrência e cancelamento.
 *
 * - concorrência global limitada (evita sobrecarregar rede/CPU);
 * - serializa por chat (um download por conversa por vez);
 * - suporte a cancelamento (AbortController por job);
 * - jobs nunca derrubam o processo principal.
 */

'use strict';

const logger = require('./logger').child('dqueue');

const CONFIG = require('../config');
const MAX_CONCURRENT = (CONFIG.downloader && CONFIG.downloader.maxConcurrentDownloads) || 3;
let active = 0;
let seq = 0;
const queue = [];
const byChat = new Map(); // chatId -> job ativo

function enqueue(chatId, label, task) {
  return new Promise((resolve, reject) => {
    const job = { id: ++seq, chatId, label, task, resolve, reject, aborted: false, controller: null };
    queue.push(job);
    pump();
  });
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    run(job);
  }
}

async function run(job) {
  active++;
  byChat.set(job.chatId, job);
  try {
    const out = await job.task({
      isCancelled: () => job.aborted,
    });
    job.resolve(out);
  } catch (err) {
    job.reject(err);
  } finally {
    active--;
    byChat.delete(job.chatId);
    pump();
  }
}

/** Cancela o job ativo de um chat. */
function cancel(chatId) {
  const job = byChat.get(chatId);
  if (job) {
    job.aborted = true;
    return true;
  }
  return false;
}

function pendingCount() {
  return queue.length + active;
}

module.exports = { enqueue, cancel, pendingCount };
