/**
 * test/update-scenarios.test.js — matriz de cenários do update.sh
 * (briefing 24-30 e 73-76).
 *
 * Monta um "GitHub" local em /tmp (o remote precisa ter "luas-bot-whats" no
 * nome, como o script valida) e roda o update.sh REAL em clones descartáveis:
 *
 *   dirty · clean+behind · ahead · diverged · single-branch · --force ·
 *   --delete-source
 *
 * Nada aqui toca a rede nem o repositório de trabalho.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'lua-update-'));
const ORIGIN = path.join(BASE, 'luas-bot-whats.git'); // nome exigido pelo script
const SEED = path.join(BASE, 'seed');

const GIT = '-c user.name=LuaTest -c user.email=lua@test.local';

function sh(cmd, cwd = BASE) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
}
/** Roda e devolve { code, out } sem lançar em exit != 0. */
function run(cmd, cwd) {
  try {
    return { code: 0, out: sh(cmd, cwd) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

// ------------------------------------------------------------------ ambiente
fs.mkdirSync(SEED, { recursive: true });
sh(`cp -a "${ROOT}/." "${SEED}/"`);
for (const d of ['.git', 'node_modules', 'backup', 'logs', 'tmp', 'session']) {
  fs.rmSync(path.join(SEED, d), { recursive: true, force: true });
}
// database/ tem código-fonte RASTREADO (database/database.js etc.); só os
// binários *.db são ignorados — remover a pasta inteira quebraria o seed
for (const f of fs.readdirSync(path.join(SEED, 'database'))) {
  if (/\.db(-.+)?$/.test(f)) fs.rmSync(path.join(SEED, 'database', f), { force: true });
}
sh(`git init -q -b main . && git add -A && git ${GIT} commit -qm "seed Lua Bot"`, SEED);
const SEED_SHA = sh('git rev-parse HEAD', SEED).trim();

// branch arena antiga (committerdate de 2020) para provar a escolha por data
sh(
  `GIT_AUTHOR_DATE='2020-01-01T00:00:00' GIT_COMMITTER_DATE='2020-01-01T00:00:00' git ${GIT} commit -q --allow-empty -m "arena antiga" && git branch arena/00000000-antiga && git reset -q --hard ${SEED_SHA} && git branch arena/01a0a187-luas-bot-whats`,
  SEED
);
sh(`git clone -q --bare "${SEED}" "${ORIGIN}"`);
// o bare clone copia refs/heads/* do seed; o seed precisa do remote para os
// cenários que avançam o "GitHub" depois (behind e diverged)
sh(`git remote add origin "${ORIGIN}"`, SEED);

/** Clone de trabalho com node_modules (symlink) e .env — o update.sh roda audit+smoke no fim. */
function makeClone(name, extraArgs = '') {
  const dir = path.join(BASE, name);
  sh(`git clone -q ${extraArgs} "${ORIGIN}" "${dir}"`);
  sh(`git ${GIT} config user.name LuaTest && git ${GIT} config user.email lua@test.local`, dir);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.copyFileSync(path.join(ROOT, '.env'), path.join(dir, '.env'));
  return dir;
}

// ------------------------------------------------------- 1) árvore suja aborta
{
  const dir = makeClone('clone-dirty');
  fs.appendFileSync(path.join(dir, 'README.md'), '\nalteração local do teste\n');
  const r = run('bash ./update.sh', dir);
  const out = strip(r.out);
  assert.strictEqual(r.code, 1, 'árvore suja deve abortar com exit 1');
  assert.match(out, /alterações locais em arquivos versionados/i, 'mensagem de alterações locais');
  assert.match(out, /--force/, 'aponta o --force como saída');
  assert.ok(
    fs.readFileSync(path.join(dir, 'README.md'), 'utf-8').includes('alteração local do teste'),
    'a alteração local NÃO pode ser destruída'
  );
  ok('update.sh: árvore suja → aborta (exit 1) e preserva a alteração local');
}

// ------------------------------------------------- 2) limpo + atrás → atualiza
{
  const dir = makeClone('clone-behind');
  sh(`echo "conteúdo novo" > NOVO_DO_REMOTE.txt && git add -A && git ${GIT} commit -qm "commit remoto" && git push -q origin main`, SEED);
  const r = run('bash ./update.sh', dir);
  const out = strip(r.out);
  assert.strictEqual(r.code, 0, `update limpo+atrás deve terminar em 0 (saida: ${out.slice(-400)})`);
  assert.match(out, /Atualizado: [0-9a-f]{7} → [0-9a-f]{7}/, 'mostra antes → depois');
  assert.match(out, /Atualização concluída!/, 'conclui');
  assert.ok(fs.existsSync(path.join(dir, 'NOVO_DO_REMOTE.txt')), 'arquivo novo do remote presente');
  assert.match(out, /Auditoria: OK/, 'auditoria roda após atualizar');
  assert.match(out, /Smoke test: OK/, 'smoke roda após atualizar');
  ok('update.sh: clean + behind → ff-only atualiza, roda audit+smoke e conclui (exit 0)');
}

// ---------------------------------------------------- 3) commits locais (ahead)
{
  const dir = makeClone('clone-ahead');
  sh(`echo local > SO_LOCAL.txt && git add -A && git ${GIT} commit -qm "commit local"`, dir);
  const r = run('bash ./update.sh', dir);
  const out = strip(r.out);
  assert.strictEqual(r.code, 1, 'ahead deve abortar sem resetar');
  assert.match(out, /à frente de origin\/main/, 'informa que está à frente');
  assert.match(out, /commit local/, 'lista o commit local');
  assert.ok(sh('git log --oneline', dir).includes('commit local'), 'commit local preservado');
  ok('update.sh: ahead → aborta listando commits locais, sem reset automático');
}

// ---------------------------------------------------------------- 4) divergido
{
  const dir = makeClone('clone-diverged');
  sh(`echo local > DIVERGE_LOCAL.txt && git add -A && git ${GIT} commit -qm "commit divergente"`, dir);
  sh(`echo remote > DIVERGE_REMOTE.txt && git add -A && git ${GIT} commit -qm "commit remoto 2" && git push -q origin main`, SEED);
  const r = run('bash ./update.sh', dir);
  const out = strip(r.out);
  assert.strictEqual(r.code, 1, 'divergência deve abortar');
  assert.match(out, /atrás e .* à frente|diverg/i, 'detecta divergência');
  assert.ok(!/Reset feito/.test(out), 'nunca reset --hard automático');
  assert.ok(sh('git log --oneline', dir).includes('commit divergente'), 'commit local preservado');
  ok('update.sh: divergido → aborta sem reset --hard e preserva os dois lados');
}

// ----------------------------------------------------- 5) clone single-branch
{
  const dir = makeClone('clone-single', '--single-branch --branch main');
  const remotesBefore = sh('git branch -r', dir);
  assert.ok(/origin\/main/.test(remotesBefore), 'clone single-branch vê a main');
  assert.ok(!/arena\//.test(remotesBefore), 'clone single-branch NÃO vê as arena/* antes do fix');
  const r = run('bash ./update.sh', dir);
  const out = strip(r.out);
  assert.match(out, /Clone single-branch detectado/, 'detecta o refspec limitado');
  assert.match(out, /Fetch concluído \(3 branch\(es\) remota\(s\)\)/, 'busca todas as branches');
  assert.match(
    out,
    /Branch arena remota mais recente: arena\/01a0a187-luas-bot-whats/,
    'aponta a arena MAIS RECENTE (não a alfabética)'
  );
  assert.match(out, /Há 2 branches arena\/\*/, 'informa quantas arena/* existem');
  ok('update.sh: single-branch → fetch completo (3 branches) + arena mais recente');
}

// ----------------------------------------------------------- 6) --force + stash
{
  const dir = makeClone('clone-force');
  fs.appendFileSync(path.join(dir, 'README.md'), '\nEDIÇÃO_LOCAL_PRECIOSA\n');
  const r = run('bash ./update.sh --force', dir);
  const out = strip(r.out);
  assert.strictEqual(r.code, 0, `--force deve concluir (saida: ${out.slice(-400)})`);
  assert.match(out, /Alterações guardadas em stash: lua-update-auto-\d{8}-\d{6}/, 'stash nomeado');
  assert.match(out, /git stash list/, 'ensina como recuperar');
  assert.ok(
    fs.readFileSync(path.join(dir, 'README.md'), 'utf-8').includes('EDIÇÃO_LOCAL_PRECIOSA'),
    'a edição local volta depois do update (stash restaurado)'
  );
  assert.strictEqual(sh('git stash list', dir).trim(), '', 'stash consumido (pop) ao final');
  ok('update.sh: --force → stash lua-update-auto-*, atualiza e devolve a edição local');
}

// --------------------------------------------------- 7) --delete-source (allowlist)
{
  const dir = makeClone('clone-delete');
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tmp', 'a.log'), 'log velho\n');
  fs.writeFileSync(path.join(dir, 'tmp', 'importante.txt'), 'nao sou log\n');
  fs.writeFileSync(path.join(dir, 'tmp', '.lock'), '99999');
  for (const d of ['player-scripts', '.gyp', 'cards']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'player-scripts', 'x.js'), '// x');
  fs.writeFileSync(path.join(dir, '.gyp', 'test'), 'g');
  fs.writeFileSync(path.join(dir, 'cards', 'a.png'), 'png');
  fs.writeFileSync(path.join(dir, 'arquivo-importante.txt'), 'ME PRESERVE\n');
  const r = run('bash ./update.sh --delete-source', dir);
  const out = strip(r.out);
  assert.strictEqual(r.code, 0, `--delete-source deve concluir (saida: ${out.slice(-300)})`);
  for (const gone of ['tmp/a.log', 'player-scripts/x.js', '.gyp/test', 'cards/a.png']) {
    assert.ok(!fs.existsSync(path.join(dir, gone)), `${gone} deveria ser removido`);
  }
  for (const kept of ['arquivo-importante.txt', 'tmp/importante.txt', 'tmp/.lock', '.env']) {
    assert.ok(fs.existsSync(path.join(dir, kept)), `${kept} deveria ser PRESERVADO`);
  }
  ok('update.sh: --delete-source remove só a allowlist (tmp/*.log, player-scripts/, .gyp/, cards/)');
}

fs.rmSync(BASE, { recursive: true, force: true });
console.log(`\n✅ update (cenários reais): ${n} verificações, 0 falhas`);
process.exit(0);
