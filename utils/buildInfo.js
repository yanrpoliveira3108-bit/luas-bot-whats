/**
 * utils/buildInfo.js — QUAL CÓDIGO ESTÁ NO AR (e qual está no disco).
 *
 * Por que existe: em 25/09/2026 o dono rodou `git pull` e o bot continuou com os
 * mesmos erros — porque o PROCESSO em execução tinha carregado o código antigo
 * (Node carrega os módulos na conexão; `git pull` muda o disco, não o processo).
 * O doctor então mostrava as falhas antigas e a conclusão era "não resolveu".
 *
 * Aqui ficam duas marcas do processo:
 *   • `rev`     — versão do git no momento do boot (`git rev-parse --short HEAD`);
 *   • `mtimeMs` — o arquivo de código modificado mais recentemente no disco
 *                 naquele momento (pega até alteração feita fora do git).
 *
 * O boot registra isso no log; o doctor compara com o disco ATUAL e diz, sem
 * margem para dúvida: "o bot no ar está no código X, o disco está em Y —
 * REINICIE" ou "o bot no ar já é o código atual ✅".
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');

/** Pastas com código do bot (varredura limitada: não entra em node_modules/data/logs). */
const PASTAS = [
  'connection',
  'handlers',
  'engine',
  'commands',
  'database',
  'menus',
  'utils',
  'scripts',
  'vendor',
];
const ARQUIVOS_RAIZ = ['index.js', 'config.js', 'package.json'];

/** Quando ESTE processo carregou o módulo (equivalente ao boot). */
const carregadoEm = new Date().toISOString();

let revCache = null;
let discoCache = null;

/** Versão do git no disco (null se não for repositório). */
function rev() {
  if (revCache !== undefined && revCache !== null) return revCache;
  try {
    revCache = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch (_) {
    revCache = null;
  }
  return revCache;
}

/** Versão do git segundo o log do processo em execução (assinatura do boot). */
function assinatura() {
  const d = disco();
  return { rev: rev(), mtimeMs: d.mtimeMs, carregadoEm };
}

/** Arquivo de código modificado mais recentemente no disco (com cache curto). */
function disco() {
  if (discoCache && Date.now() - discoCache.em < 30000) return discoCache;
  let mtimeMs = 0;
  let arquivo = null;
  const olhar = (p) => {
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.mtimeMs > mtimeMs) {
        mtimeMs = st.mtimeMs;
        arquivo = p;
      }
    } catch (_) {
      /* arquivo sumiu no meio da varredura */
    }
  };
  for (const f of ARQUIVOS_RAIZ) olhar(path.join(RAIZ, f));
  for (const pasta of PASTAS) {
    const base = path.join(RAIZ, pasta);
    let entradas = [];
    try {
      entradas = fs.readdirSync(base, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entradas) {
      const p = path.join(base, e.name);
      if (e.isDirectory()) {
        // um nível a mais (ex.: vendor/boruto-vk7-baileys/lib/...)
        let subs = [];
        try {
          subs = fs.readdirSync(p, { withFileTypes: true });
        } catch (_) {
          continue;
        }
        for (const s of subs) {
          const sp = path.join(p, s.name);
          if (s.isDirectory()) {
            let netos = [];
            try {
              netos = fs.readdirSync(sp, { withFileTypes: true });
            } catch (_) {
              continue;
            }
            for (const n of netos) if (n.isFile()) olhar(path.join(sp, n.name));
          } else {
            olhar(sp);
          }
        }
      } else {
        olhar(p);
      }
    }
  }
  discoCache = { em: Date.now(), mtimeMs, arquivo };
  return discoCache;
}

/**
 * Compara o que o processo no ar carregou com o que está no disco agora.
 * `noAr` = assinatura registrada no boot (vinda do log pelo doctor).
 * Devolve { igual, motivo, agora, noAr }.
 */
function comparar(noAr) {
  const agora = assinatura();
  if (!noAr) return { igual: null, motivo: 'sem registro de boot no log', agora, noAr: null };
  const revDiferente = Boolean(noAr.rev && agora.rev && noAr.rev !== agora.rev);
  const discoMaisNovo = Boolean(
    noAr.mtimeMs && agora.mtimeMs && agora.mtimeMs > noAr.mtimeMs + 1000
  );
  if (revDiferente && discoMaisNovo) {
    return { igual: false, motivo: `código atualizado (${noAr.rev} → ${agora.rev})`, agora, noAr };
  }
  if (revDiferente) return { igual: false, motivo: `versão do git diferente (${noAr.rev} → ${agora.rev})`, agora, noAr };
  if (discoMaisNovo) {
    return { igual: false, motivo: 'há arquivo de código mais novo no disco do que no boot', agora, noAr };
  }
  return { igual: true, motivo: 'o processo no ar é o código atual', agora, noAr };
}

/** Linha curta para o terminal/status ("rev abc1234 · carregado 00:05"). */
function resumo() {
  const a = assinatura();
  const hora = new Date(a.carregadoEm);
  const hh = String(hora.getHours()).padStart(2, '0');
  const mm = String(hora.getMinutes()).padStart(2, '0');
  return `${a.rev || 'sem git'} · carregado ${hh}:${mm}`;
}

module.exports = { assinatura, comparar, rev, disco, resumo, RAIZ, carregadoEm };
