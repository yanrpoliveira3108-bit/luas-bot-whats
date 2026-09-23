/**
 * utils/tmpdir.js — garante um diretório temporário ESCREVÍVEL.
 *
 * Por que isto existe (Android/Termux):
 * o Baileys grava o arquivo do upload de mídia em `os.tmpdir()`
 * (vendor/.../messages-media.js → prepareStream). No Termux, `os.tmpdir()`
 * usa a variável TMPDIR. Quando o bot é iniciado por um script, pelo
 * Termux:Boot, pelo cron ou com `env -i`, TMPDIR vem vazia e o Node cai no
 * padrão `/tmp` — que NÃO existe (ou não é gravável) no Android.
 *
 * Resultado: TODO envio de mídia falha (ENOENT), enquanto texto funciona.
 * Como todos os downloads terminam em envio de mídia, o sintoma é
 * "nenhum download funciona".
 *
 * Aqui a gente testa o diretório atual e, se não der para escrever, aponta
 * TMPDIR para o `tmp/` do projeto (que o boot já cria).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let resolved = null;
let motivo = '';

function escrevivel(dir) {
  try {
    if (!dir) return false;
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.lua-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Garante TMPDIR utilizável e devolve o diretório em uso.
 * @param {string} [fallbackDir] diretório preferido (normalmente o tmp/ do projeto)
 * @returns {{dir: string, changed: boolean, motivo: string}}
 */
function ensureTmpDir(fallbackDir) {
  if (resolved) return { dir: resolved, changed: false, motivo };

  const atual = os.tmpdir();
  if (escrevivel(atual)) {
    resolved = atual;
    return { dir: resolved, changed: false, motivo: 'ok' };
  }

  const candidatos = [fallbackDir, path.join(process.cwd(), 'tmp')].filter(Boolean);
  for (const c of candidatos) {
    if (escrevivel(c)) {
      process.env.TMPDIR = c;
      process.env.TMP = c;
      process.env.TEMP = c;
      resolved = c;
      motivo = `os.tmpdir() "${atual}" não é gravável — usando "${c}"`;
      return { dir: resolved, changed: true, motivo };
    }
  }

  motivo = `nenhum diretório temporário gravável (testei: ${atual} e ${candidatos.join(', ')})`;
  return { dir: atual, changed: false, motivo };
}

function tmpDir() {
  return resolved || os.tmpdir();
}

module.exports = { ensureTmpDir, tmpDir, escrevivel };
