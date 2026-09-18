/**
 * test/db-claim-worker.js — segundo PROCESSO do teste de concorrência da Fase 4.
 *
 * Abre o MESMO arquivo de banco com uma conexão própria e disputa jobs com o
 * processo pai. Usa o repository real (database/scheduledJobs.js) — não uma
 * cópia do SQL — para que o teste exercite exatamente o código entregue.
 *
 * Uso: node test/db-claim-worker.js <arquivo-do-banco> <workerId> [máx] [largada]
 * `largada` é um epoch ms: o processo avisa que está pronto (__READY__) e espera
 * até esse instante para começar — assim pai e filho disputam AO MESMO TEMPO.
 * Saída: "__CLAIMS_BEGIN__{json}__CLAIMS_END__" (o pino também escreve em stdout,
 * por isso o resultado vai delimitado — não dá para confiar em "última linha").
 */

'use strict';

const dbFile = process.argv[2];
const workerId = process.argv[3] || 'worker-filho';
const maxTentativas = Number(process.argv[4] || 200);
const largada = Number(process.argv[5] || 0);
// atraso opcional entre claims: alarga a janela em que os dois processos
// disputam ao mesmo tempo (sem isso um deles esvazia a fila antes do outro acordar)
const atrasoMs = Number(process.argv[6] || 0);

if (!dbFile) {
  process.stdout.write('__CLAIMS_BEGIN__' + JSON.stringify({ claimed: [], errors: ['sem arquivo de banco'] }) + '__CLAIMS_END__');
  process.exit(2);
}

process.env.DATABASE_FILE = dbFile;
process.env.LUA_TEST = '1';

const db = require('../database/database');
const jobs = require('../database/scheduledJobs');

db.open();

const claimed = [];
const errors = [];

// avisa que está pronto e espera a largada combinada com o processo pai
process.stdout.write('__READY__');
if (largada) {
  const espera = largada - Date.now();
  if (espera > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, espera);
}

for (let i = 0; i < maxTentativas; i++) {
  let job = null;
  try {
    job = jobs.claimJob(workerId);
  } catch (err) {
    // SQLITE_BUSY é informação relevante: registra e tenta de novo
    errors.push(String(err.code || err.message));
    if (errors.length > 10) break;
    continue;
  }
  if (!job) break;
  claimed.push(job.id);
  if (atrasoMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, atrasoMs);
}

process.stdout.write('__CLAIMS_BEGIN__' + JSON.stringify({ claimed, errors }) + '__CLAIMS_END__');
db.close();
