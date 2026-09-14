/**
 * test/dbtmp.js — diretório temporário GRAVÁVEL e portátil para os testes.
 *
 * Problema real (Termux): os testes usavam /tmp como banco temporário, mas
 * no Termux /tmp NÃO é gravável (o better-sqlite3 falha com
 * "SQLITE_CANTOPEN: unable to open database file"). O tmp/ do próprio projeto
 * é criado pelo CONFIG.helpers.ensureDirs() e é sempre gravável.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TMP = path.resolve(__dirname, '..', 'tmp');

function ensure() {
  fs.mkdirSync(TMP, { recursive: true });
}

/** Caminho de um arquivo temporário dentro do tmp/ do projeto. */
function tmpFile(name) {
  ensure();
  return path.join(TMP, name);
}

/** Remove um arquivo temporário (ignora ausência/erro). */
function rm(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch (_) {
    /* ignora */
  }
}

module.exports = { TMP, tmpFile, rm };
