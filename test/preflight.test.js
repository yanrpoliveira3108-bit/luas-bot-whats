/**
 * test/preflight.test.js — validações de partida do start.sh (briefing 32/51).
 *
 * Cada cenário roda o start.sh REAL num diretório descartável, com apenas o
 * mínimo de arquivos, e verifica a mensagem + o exit code. Todos os cenários
 * são de FALHA (saem antes de subir o bot), então nada é conectado ao WhatsApp.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

const SECRET = '5511987654321';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lua-preflight-'));
  fs.copyFileSync(path.join(ROOT, 'start.sh'), path.join(dir, 'start.sh'));
  fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(dir, '.env.example'));
  for (const f of ['package.json', 'index.js', 'config.js']) {
    fs.writeFileSync(path.join(dir, f), '{}\n');
  }
  fs.writeFileSync(path.join(dir, '.env'), `OWNER_NUMBER=${SECRET}\nBOT_PREFIX=!\n`);
  // node_modules mínimo que passa no passo 6 (dotenv presente)
  fs.mkdirSync(path.join(dir, 'node_modules', 'dotenv'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'dotenv', 'package.json'), '{"name":"dotenv"}');
  return dir;
}

/** Roda start.sh e devolve { code, out } sem lançar em exit != 0. */
function run(dir, opts = {}) {
  const env = Object.assign({}, process.env, opts.env || {});
  try {
    const out = execFileSync('bash', ['start.sh'], {
      cwd: dir,
      env,
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ---------------------------------------------------------------- 1) Node < 22
{
  const dir = sandbox();
  const bin = path.join(dir, 'fakebin');
  fs.mkdirSync(bin, { recursive: true });
  // shim: responde -v e -e como se fosse Node 18
  fs.writeFileSync(
    path.join(bin, 'node'),
    '#!/bin/sh\ncase "$1" in\n  -v) echo "v18.20.0";;\n  *) echo "18";;\nesac\n',
    { mode: 0o755 }
  );
  const r = run(dir, { env: { PATH: `${bin}:${process.env.PATH}` } });
  assert.strictEqual(r.code, 1, 'Node antigo deve abortar com exit 1');
  assert.match(r.out, /Node\.js 22\+ é obrigatório|Lua requer Node 22\+/, 'mensagem clara sobre Node 22+');
  assert.ok(!/Iniciando o Lua/i.test(r.out), 'não pode subir o bot com Node antigo');
  ok(`start.sh: Node 18 simulado → aborta (${r.code}) com mensagem de Node 22+`);
  cleanup(dir);
}

// ---------------------------------------------------------------- 2) .env ausente
{
  const dir = sandbox();
  fs.rmSync(path.join(dir, '.env'));
  const r = run(dir);
  assert.strictEqual(r.code, 1, 'sem .env deve abortar');
  assert.match(r.out, /\.env não encontrado/, 'avisa que falta .env');
  assert.match(r.out, /cp \.env\.example \.env/, 'ensina como criar');
  ok('start.sh: .env ausente → aborta e ensina "cp .env.example .env"');
  cleanup(dir);
}

// ------------------------------------------------------- 3) OWNER_NUMBER vazio
{
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, '.env'), `OWNER_NUMBER=\nBOT_PREFIX=!\n`);
  const r = run(dir);
  assert.strictEqual(r.code, 1, 'OWNER_NUMBER vazio deve abortar');
  assert.match(r.out, /OWNER_NUMBER não configurado/, 'aponta o OWNER_NUMBER');
  ok('start.sh: OWNER_NUMBER vazio → aborta apontando a variável');
  cleanup(dir);
}

// ------------------------------------------- 4) segredo nunca vai para a saída
{
  // OWNER_NUMBERS (plural) é aceito pelo preflight, então o script AVANÇA com o
  // número real configurado e só morre depois (better-sqlite3). Se ele imprimisse
  // o dono em qualquer ponto, o segredo apareceria na saída.
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, '.env'), `OWNER_NUMBER=\nOWNER_NUMBERS=${SECRET}\nBOT_PREFIX=!\n`);
  const r = run(dir);
  assert.strictEqual(r.code, 1, 'deve abortar (sem better-sqlite3)');
  assert.match(r.out, /\.env configurado/, 'precisa ter passado pela checagem do dono');
  assert.ok(!r.out.includes(SECRET), 'número do dono não pode aparecer na saída');
  ok('start.sh: passa pela checagem do dono sem imprimir o número');
  cleanup(dir);
}

// ------------------------------------------------------- 5) node_modules falta
{
  const dir = sandbox();
  fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
  const r = run(dir);
  assert.strictEqual(r.code, 1, 'sem node_modules deve abortar');
  assert.match(r.out, /Dependências não instaladas/, 'mensagem de dependências');
  assert.match(r.out, /update\.sh|npm install/, 'indica como instalar');
  ok('start.sh: node_modules ausente → aborta e indica ./update.sh');
  cleanup(dir);
}

// ------------------------------------------------- 6) better-sqlite3 não carrega
{
  const dir = sandbox();
  // dotenv presente (passa no passo 6), better-sqlite3 inexistente (falha no 7)
  const r = run(dir);
  assert.strictEqual(r.code, 1, 'better-sqlite3 ausente deve abortar');
  assert.match(r.out, /better-sqlite3 não carrega/, 'explica o módulo nativo');
  assert.match(r.out, /python make clang|build-release/, 'mostra a solução de compilação');
  ok('start.sh: better-sqlite3 quebrado → aborta com o passo de compilação');
  cleanup(dir);
}

console.log(`\n✅ preflight (start.sh): ${n} verificações, 0 falhas`);
process.exit(0);
