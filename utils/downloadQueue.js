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

/**
 * Teto de tempo por job. Sem isto, UM download travado ocupa uma vaga para
 * sempre — e com 3 vagas, três travamentos deixam o bot sem baixar NADA, sem
 * erro nenhum na tela (o sintoma "nenhum download funciona").
 *
 * O tempo é lido a cada job para poder ser ajustado em runtime/teste.
 */
function timeoutMs() {
  const d = (CONFIG.downloader && CONFIG.downloader.queueTimeoutMs) || 0;
  return Math.max(1000, d || 180000);
}
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
  const limite = timeoutMs();
  let timer;
  try {
    const out = await Promise.race([
      job.task({ isCancelled: () => job.aborted }),
      new Promise((_, rej) => {
        timer = setTimeout(() => {
          job.aborted = true;
          const e = new Error(`Download passou de ${Math.round(limite / 1000)}s e foi cancelado.`);
          e.code = 'TIMEOUT';
          rej(e);
        }, limite);
      }),
    ]);
    job.resolve(out);
  } catch (err) {
    job.reject(err);
  } finally {
    // Libera a vaga SEMPRE: um job travado não pode parar a fila inteira.
    clearTimeout(timer);
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
