/**
 * test/infra.test.js — single instance (briefing 23) e backup automático (22).
 *
 * Single instance é testado com processos REAIS: um filho segura o lock, outro
 * tenta entrar. Backup é testado no fluxo real (staging .tmp → validação →
 * rename atômico → rotação), inclusive o descarte de backup inválido.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

process.chdir(path.resolve(__dirname, '..'));
const ROOT = path.resolve(__dirname, '..');

const singleInstance = require('../utils/singleInstance');
const backup = require('../utils/autoBackup');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return true;
    await sleep(100);
  }
  return false;
}

async function singleInstanceChecks() {
  const LOCK = singleInstance.LOCK_FILE;
  fs.rmSync(LOCK, { force: true });

  // ---- processo A adquire o lock e continua vivo
  const A = spawn(
    process.execPath,
    ['-e', "const si=require('./utils/singleInstance'); si.acquireLock(); console.log('READY'); setInterval(()=>{},1000);"],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }
  );
  let ready = false;
  A.stdout.on('data', (d) => { if (String(d).includes('READY')) ready = true; });
  assert.ok(await waitFor(() => ready && fs.existsSync(LOCK)), 'A deveria criar o lock');
  assert.strictEqual(singleInstance.readLockPid(), A.pid, 'lock guarda o PID de A');
  ok(`single instance: lock criado com o PID real (${A.pid})`);

  // ---- processo B tenta entrar com A vivo
  const B = spawnSync(
    process.execPath,
    ['-e', "require('./utils/singleInstance').acquireLock(); console.log('NAO_DEVERIA');"],
    { cwd: ROOT, encoding: 'utf-8', timeout: 30000 }
  );
  const bOut = `${B.stdout || ''}${B.stderr || ''}`;
  assert.strictEqual(B.status, 1, 'segunda instância deve sair com exit 1');
  assert.match(bOut, /Outra instância do bot já está rodando/, 'mensagem de instância duplicada');
  assert.ok(!bOut.includes('NAO_DEVERIA'), 'segunda instância não pode seguir');
  assert.strictEqual(singleInstance.readLockPid(), A.pid, 'lock de A não pode ser apagado por B');
  ok('single instance: 2ª instância aborta (exit 1) e NÃO apaga o lock vivo');

  // ---- A morre; o lock fica obsoleto e deve ser substituído
  A.kill('SIGTERM');
  await waitFor(() => A.exitCode !== null, 5000);
  assert.ok(fs.existsSync(LOCK), 'lock permanece no disco após crash/kill');
  const C = spawnSync(
    process.execPath,
    ['-e', "require('./utils/singleInstance').acquireLock(); console.log(process.pid);"],
    { cwd: ROOT, encoding: 'utf-8', timeout: 30000 }
  );
  // o logger do projeto escreve JSON no stdout — o PID é a última linha numérica
  const pidLines = String(C.stdout || '').split('\n').map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
  const cPid = parseInt(pidLines[pidLines.length - 1], 10);
  assert.strictEqual(C.status, 0, 'lock obsoleto deve ser reaproveitado');
  assert.ok(Number.isFinite(cPid), `C deveria imprimir o próprio PID (stdout: ${JSON.stringify(C.stdout)})`);
  assert.strictEqual(singleInstance.readLockPid(), cPid, 'lock passa a ter o PID de C');
  ok(`single instance: lock obsoleto (PID morto) é substituído sem intervenção (${cPid})`);

  // ---- quem não é dono não remove o lock
  const D = spawnSync(
    process.execPath,
    ['-e', "require('./utils/singleInstance').releaseLock(); console.log('ok');"],
    { cwd: ROOT, encoding: 'utf-8', timeout: 30000 }
  );
  assert.strictEqual(D.status, 0, 'releaseLock de terceiro não pode lançar');
  assert.ok(fs.existsSync(LOCK), 'releaseLock de quem não é dono não apaga o lock');
  assert.strictEqual(singleInstance.readLockPid(), cPid, 'PID do dono preservado');
  ok('single instance: releaseLock() de outro processo não remove o lock alheio');

  fs.rmSync(LOCK, { force: true });
}

function backupChecks() {
  const AUTO = backup.AUTO_DIR;

  // ---- backup real: destino final, sem sufixo .tmp, com info.json
  const dest = backup.doBackup('teste');
  assert.ok(dest, 'doBackup deve devolver o caminho');
  assert.ok(!dest.endsWith('.tmp'), 'caminho final não pode ser o staging');
  assert.ok(fs.existsSync(dest), 'diretório final existe');
  const info = JSON.parse(fs.readFileSync(path.join(dest, 'info.json'), 'utf-8'));
  assert.ok(info.files >= 1, `info.json declara ${info.files} arquivo(s)`);
  assert.strictEqual(info.reason, 'teste', 'motivo registrado');
  ok(`backup: criado e validado em ${path.basename(dest)} (${info.files} arquivos)`);

  // ---- nenhum staging sobra depois de um backup bem-sucedido
  const leftovers = fs.readdirSync(AUTO).filter((d) => d.endsWith('.tmp'));
  assert.deepStrictEqual(leftovers, [], 'nenhum .tmp residual');
  ok('backup: rename atômico não deixa staging .tmp para trás');

  // ---- staging em andamento nunca aparece como backup disponível
  const staging = path.join(AUTO, 'backup_em_andamento.tmp');
  fs.mkdirSync(staging, { recursive: true });
  assert.ok(!backup.listBackups().some((b) => b.name.endsWith('.tmp')), 'listBackups ignora staging');
  ok('backup: listBackups() não expõe staging incompleto');

  // ---- validação pega contagem divergente e staging vazio
  const badCount = path.join(AUTO, 'backup_invalido.tmp');
  fs.mkdirSync(badCount, { recursive: true });
  fs.writeFileSync(path.join(badCount, 'info.json'), JSON.stringify({ files: 99 }));
  assert.ok(backup.validateBackup(badCount, 1).length > 0, 'contagem divergente = inválido');
  const empty = path.join(AUTO, 'backup_vazio.tmp');
  fs.mkdirSync(empty, { recursive: true });
  const problems = backup.validateBackup(empty, 0);
  assert.ok(problems.some((p) => /nenhum arquivo/.test(p)), 'staging vazio = inválido');
  assert.ok(problems.some((p) => /info\.json/.test(p)), 'info.json ausente = inválido');
  fs.rmSync(badCount, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
  ok('backup: validateBackup() rejeita contagem divergente, staging vazio e info.json ausente');

  // ---- staging velho é varrido
  const stale = path.join(AUTO, 'backup_orfao.tmp');
  fs.mkdirSync(stale, { recursive: true });
  const old = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
  fs.utimesSync(stale, old, old);
  const swept = backup.sweepStaleTmp();
  assert.ok(swept >= 1, `varredura removeu ${swept} staging(s)`);
  assert.ok(!fs.existsSync(stale), 'staging órfão removido');
  ok('backup: sweepStaleTmp() remove staging abandonado por crash');

  // ---- rotação mantém os MAX_BACKUPS mais recentes
  const dummies = [];
  for (let i = 0; i < backup.MAX_BACKUPS + 3; i += 1) {
    const d = path.join(AUTO, `backup_dummy_${i}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'info.json'), JSON.stringify({ files: 1 }));
    const age = (Date.now() - (i + 10) * 60 * 60 * 1000) / 1000;
    fs.utimesSync(d, age, age);
    dummies.push(d);
  }
  backup.doBackup('rotacao');
  const remaining = backup.listBackups();
  assert.ok(
    remaining.length <= backup.MAX_BACKUPS,
    `rotação deve manter <= ${backup.MAX_BACKUPS}, restaram ${remaining.length}`
  );
  assert.ok(!remaining.some((b) => b.name === 'backup_dummy_9'), 'mais antigo foi rotacionado');
  fs.rmSync(staging, { recursive: true, force: true });
  for (const d of dummies) fs.rmSync(d, { recursive: true, force: true });
  ok(`backup: rotação mantém os ${backup.MAX_BACKUPS} mais recentes (restaram ${remaining.length})`);
}

(async () => {
  await singleInstanceChecks();
  backupChecks();
  console.log(`\n✅ infra (single instance/backup): ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ infra: ${err.message}`);
  process.exit(1);
});
