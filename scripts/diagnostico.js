#!/usr/bin/env node
/**
 * scripts/diagnostico.js — "o bot parou de funcionar em chat nenhum".
 *
 * Responde, na ordem em que importa, com dado do PRÓPRIO aparelho — sem supor:
 *
 *   1) O bot está no ar? Quantos processos? (dois processos = sessão 440 =
 *      nada sai em chat nenhum, é o caso mais comum)
 *   2) Qual código está no ar × qual está no disco (o `git pull` sozinho não
 *      reinicia o processo)
 *   3) O que o LOG diz das últimas horas: conectou? caiu? deu erro de envio?
 *      apareceu sinal de restrição do WhatsApp (not-authorized/forbidden)?
 *   4) O código carrega neste aparelho? (require dos módulos alterados: se uma
 *      atualização quebrar algum, o erro aparece aqui, com arquivo e linha)
 *   5) Quais interruptores estão ligados e como desligar cada um em segundos
 *
 * Uso: npm run diagnostico
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const linhas = [];
const L = (t = '') => linhas.push(t);
const H = (t) => {
  L('');
  L('─'.repeat(62));
  L(t);
  L('─'.repeat(62));
};

let CONFIG = null;
try {
  CONFIG = require('../config');
} catch (_) {
  CONFIG = null;
}
const rel = (p) => (p ? String(p).replace(RAIZ, '~') : p);
const quando = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(String(v)) || 0;
  return n ? new Date(n) : null;
};
const hhmmss = (v) => {
  const d = quando(v);
  if (!d) return '--:--:--';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const dia = (v) => {
  const d = quando(v);
  if (!d) return '--/--';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};

/** Momento de uma linha de log: o pino grava em `time` (ms), não em `t`. */
const quandoLinha = (l) => quando(l && (l.t !== undefined ? l.t : l.time));

function lerJsonl(arquivo) {
  const out = [];
  try {
    for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
      const t = linha.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch (_) {
        out.push({ msg: t, _cru: true });
      }
    }
  } catch (_) {}
  return out;
}

/* ───────────────────────── 0) cabeçalho ───────────────────────── */

L('🩺 DIAGNÓSTICO — "o bot não funciona em chat nenhum"');
L(`pasta.......: ${RAIZ}`);
L(`node........: ${process.version}`);
L(`quando......: ${new Date().toLocaleString()}`);

/* ─────────────────── 1) o processo está no ar? ────────────────── */

H('1) O BOT ESTÁ NO AR? (e quantos?)');
let procs = [];
try {
  const saida = execFileSync('sh', ['-c', 'ps -A -o pid,ppid,etime,args 2>/dev/null || ps ax'], {
    encoding: 'utf8',
    timeout: 8000,
  });
  procs = String(saida)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /node.*(index\.js|scripts\/)/.test(l) && !/ps -A|diagnostico/.test(l));
} catch (e) {
  L(`⚠️  não consegui listar processos: ${(e && e.message) || e}`);
}
if (!procs.length) {
  L('🔴 NENHUM processo do bot rodando.');
  L('   ▸ O bot precisa estar rodando para responder em qualquer chat.');
  L('   ▸ Suba com `npm start` e deixe o terminal aberto.');
} else if (procs.length > 1) {
  L(`🔴 ${procs.length} PROCESSOS DO BOT AO MESMO TEMPO:`);
  for (const p of procs) L(`   ${p}`);
  L('   ▸ Dois processos com a MESMA sessão: o WhatsApp derruba um (440) e cada');
  L('     um fica tentando reconectar — resultado: "não funciona em chat nenhum".');
  L('   ▸ Mate todos e suba UM só: `pkill -f "node.*index.js"` e depois `npm start`).');
} else {
  L(`✅ 1 processo rodando:`);
  for (const p of procs) L(`   ${p}`);
}

/* ───────────── 2) código no ar × código no disco ──────────────── */

H('2) CÓDIGO NO AR × CÓDIGO NO DISCO');
let buildInfo = null;
try {
  buildInfo = require('../utils/buildInfo');
} catch (e) {
  L(`⚠️  utils/buildInfo não carregou: ${(e && e.message) || e}`);
}

const dirLogs = (CONFIG && CONFIG.paths && CONFIG.paths.logsDir) || path.join(RAIZ, 'logs');
let arquivos = [];
try {
  arquivos = fs
    .readdirSync(dirLogs)
    .filter((f) => f.startsWith('lua-') && f.endsWith('.log'))
    .sort()
    .slice(-2);
} catch (_) {}

const eventos = [];
for (const f of arquivos) for (const l of lerJsonl(path.join(dirLogs, f))) eventos.push(l);

const doBoot = eventos.filter((l) => /\[LUA\]\[BOOT\] código carregado/i.test(String(l.msg || '')));
const ultimoBoot = doBoot.length ? doBoot[doBoot.length - 1] : null;
const ultimoStart = eventos
  .filter((l) => /socket criado|conectado ao WhatsApp/i.test(String(l.msg || '')))
  .pop();

L(`Logs lidos..: ${arquivos.map(rel).join(', ') || '(nenhum)'}`);
if (ultimoBoot) {
  L(`Processo no ar: ${ultimoBoot.rev || 'sem git'} (subiu ${hhmmss(quandoLinha(ultimoBoot))})`);
} else {
  L(`Processo no ar: (sem registro de boot — versão anterior ou log limpo)`);
}
if (ultimoStart) L(`Último start..: ${hhmmss(quandoLinha(ultimoStart))} — ${String(ultimoStart.msg).slice(0, 60)}`);
if (buildInfo) {
  const agora = buildInfo.assinatura();
  const cmp = buildInfo.comparar(ultimoBoot ? { rev: ultimoBoot.rev, mtimeMs: ultimoBoot.mtimeMs } : null);
  L(`Disco agora...: ${agora.rev || 'sem git'}`);
  if (cmp.igual === true) L('✅ o processo no ar é o código atual');
  else if (cmp.igual === false) {
    L(`🚨 O PROCESSO NO AR É DE ANTES DO CÓDIGO ATUAL (${cmp.motivo})`);
    L('   ▸ Pare (Ctrl+C / `pkill -f "node.*index.js"`) e suba de novo (`npm start`).');
  }
}

/* ─────────── 3) o que o log diz (conexão + envio) ────────────── */

H('3) ÚLTIMAS HORAS NO LOG (conexão e envio)');
const ultimos = eventos.slice(-1200);
const perto = (re) =>
  ultimos.filter((l) => (typeof re === 'function' ? re(l) : re.test(`${String(l.msg || '')} ${String(l.err || '')}`)));

const abriu = perto(/conectado ao WhatsApp|connection = open/i).pop();
const fechou = perto(/connection\.update: close|conexão fechada|Connection Closed/i).pop();
const motivos = [...new Set(perto(/connection\.update: close/i).map((l) => String(l.reason || l.msg).slice(0, 60)))];
L(`Conectou por último: ${abriu ? hhmmss(quandoLinha(abriu)) : '❌ nenhuma vez neste log'}`);
if (fechou) L(`Fechou por último...: ${hhmmss(quandoLinha(fechou))}`);
if (motivos.length) L(`Motivos de queda.....: ${motivos.join(' | ')}`);

// restrição: olha SÓ o texto de ERRO (err/data/statusCode) e as linhas do freio
// que falam em restrição. Antes isto casava com nomes de comando (ex.:
// "antiemojispam" contém "spam") e dava alarme falso.
const RE_RESTRICAO = /not-authorized|forbidden|not authorized|rate-?overlimit|too many|spam|restricted|401|403|429/i;
const restricao = perto((l) => {
  const texto = `${(l && l.err) || ''} ${(l && l.data) || ''}`;
  const status = Number((l && l.statusCode) || (l && l.output && l.output.statusCode) || 0);
  const msg = String((l && l.msg) || '');
  if (/\[LUA\]\[COMMAND\]|Comando recebido|Executando:/i.test(msg)) return false; // nome de comando
  if (/sinal de restrição|\[FREIO\] envios pausados/i.test(msg)) return true;
  return RE_RESTRICAO.test(texto) || status === 429 || status === 401 || status === 403;
});
if (restricao.length) {
  L('');
  L(`⛔ SINAL DE RESTRIÇÃO NO LOG: ${restricao.length} linha(s)`);
  for (const r of restricao.slice(-3)) L(`   ${hhmmss(quandoLinha(r))}  ${String(r.err || r.msg).slice(0, 80)}`);
  L('   ▸ Isso é do lado do WhatsApp: o número está impedido de enviar (temporária');
  L('     ou definitivamente). Nenhuma correção no bot contorna isso.');
  L('   ▸ Pare de testar por algumas horas, use o bot só no privado e rode');
  L('     `npm run chat:doctor -- <chat>` depois para ver se voltou.');
} else {
  L('Restrição do WhatsApp: ✅ nenhum sinal no log');
}

// PAUSA DO FREIO: quando ativa, o bot fica MUDO em todos os chats (só o dono
// passa). É a explicação mais comum de "não funciona em chat nenhum" e não
// aparecia em lugar nenhum.
try {
  const dirEstado = (CONFIG && CONFIG.safety && CONFIG.safety.send && CONFIG.safety.send.stateDir) || path.join(RAIZ, 'data');
  const st = JSON.parse(fs.readFileSync(path.join(dirEstado, 'sendguard.json'), 'utf8'));
  if (st && st.pausedUntil) {
    const ate = quando(st.pausedUntil);
    const restante = ate ? Math.max(0, Math.round((ate.getTime() - Date.now()) / 60000)) : 0;
    if (restante > 0) {
      L('');
      L(`⏸️  ENVIOS PAUSADOS até ${hhmmss(st.pausedUntil)} (${restante} min) — o bot fica MUDO em todos os chats.`);
      L(`   motivo: ${st.pauseReason || '—'}`);
      L('   ▸ Durante a pausa só a SUA conversa é respondida: mande `!freio` no privado');
      L('     (mostra o motivo) e `!freio retomar` para liberar antes da hora.');
    } else {
      L(`Pausa do freio.....: expirada (${hhmmss(st.pausedUntil)})`);
    }
  } else {
    L('Pausa do freio.....: ✅ nenhuma pausa ativa');
  }
} catch (_) {
  L('Pausa do freio.....: (estado do freio ainda não existe)');
}
// se o bot está RODANDO neste aparelho, a pausa real está na memória dele —
// o `!freio` no privado mostra o resto (fila, bloqueios, travamentos)
L('▸ Estado ao vivo do freio: mande `!freio` no privado do dono.');

const falhas = perto((l) => {
  const msg = String((l && l.msg) || '');
  if (/reenvio sem citação funcionou/i.test(msg)) return false; // é SUCESSO
  return /sendMessage FALHOU|falha ao MONTAR|reenvio sem citação (também )?falhou|FREIO\] envio SEM RESPOSTA/i.test(msg);
});
L(`Falhas de envio.....: ${falhas.length}`);
for (const f of falhas.slice(-3)) L(`   ${hhmmss(quandoLinha(f))}  ${String(f.msg).slice(0, 78)}`);

const comandos = perto(/\[LUA\]\[COMMAND\]/i);
L(`Comandos recebidos..: ${comandos.length}`);
for (const c of comandos.slice(-3)) L(`   ${hhmmss(quandoLinha(c))}  ${String(c.msg).slice(0, 78)}`);

const fatais = ultimos.filter((l) => Number(l.level) >= 50 || /unhandled|uncaught|FATAL/i.test(String(l.msg || '')));
L('');
L(`Erros graves (nível 50+) nas últimas linhas: ${fatais.length}`);
for (const f of fatais.slice(-5)) L(`   ${hhmmss(quandoLinha(f))}  [${f.module || '?'}] ${String(f.err || f.msg).slice(0, 78)}`);

L('');
L('Últimas linhas do log (mais recentes por último):');
for (const l of ultimos.slice(-12)) {
  L(`   ${hhmmss(quandoLinha(l))}  ${String(l.module || '-').padEnd(11)} ${String(l.msg || '').slice(0, 74)}`);
}

/* ─────────── 4) o código carrega NESTE aparelho? ─────────────── */

H('4) O CÓDIGO CARREGA NESTE APARELHO? (módulos mexidos)');
const modulos = [
  'utils/sendGuard',
  'utils/safeNodeCache',
  'utils/groupMetadataCache',
  'utils/buildInfo',
  'utils/antiBan',
  'handlers/commandHandler',
  'connection/connect',
];
for (const m of modulos) {
  try {
    require(path.join(RAIZ, m));
    L(`✅ ${m}`);
  } catch (e) {
    L(`❌ ${m}`);
    L(`   ${(e && e.message) || e}`);
    if (e && e.stack) {
      const frame = String(e.stack)
        .split('\n')
        .map((x) => x.trim())
        .find((x) => x.startsWith('at ') && !x.includes('node:internal'));
      if (frame) L(`   ↳ ${frame}`);
    }
  }
}
// os scripts são programas (rodam e saem): aqui só a SINTAXE é verificada
for (const m of ['scripts/chat-doctor', 'scripts/jogos-doctor', 'index.js', 'config.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(RAIZ, m)], { stdio: 'pipe', timeout: 8000 });
    L(`✅ ${m} (sintaxe)`);
  } catch (e) {
    L(`❌ ${m} (sintaxe)`);
    L(`   ${String((e && e.stderr) || (e && e.message) || e).slice(0, 300)}`);
  }
}

/* ─────────── 5) interruptores e como isolar ──────────────────── */

H('5) INTERRUPTORES (para isolar em segundos — não precisa editar código)');
const sw = [
  ['SAFE_CACHE', '1 = caches protegidos (novo) · 0 = caches padrão da biblioteca'],
  ['GROUP_META_CACHE', '1 = metadados de grupo em cache (novo) · 0 = consulta ao vivo'],
  ['SEND_TIMEOUT_MS', 'prazo de um envio em ms (0 = sem prazo, comportamento antigo)'],
  ['SEND_RETRY_ON_HANG', '1 = reenvia envio travado · 0 = nunca reenvia'],
  ['SEND_MIN_INTERVAL_MS', 'intervalo entre envios'],
  ['SEND_CHAT_INTERVAL_MS', 'intervalo por conversa'],
  ['SAFE_MODE', '1 = modo seguro (bloqueia cards HTML/menu nativo)'],
  ['HUMAN_DELAYS', '1 = simula "digitando…" antes de responder'],
];
for (const [k, d] of sw) {
  const v = process.env[k];
  L(`▸ ${k.padEnd(22)} ${v === undefined ? '(padrão do .env)' : `= ${v}`} — ${d}`);
}

L('');
L('Se o bot parou depois de uma atualização, teste nesta ordem (uma por vez,');
L('reiniciando entre elas) — em cada passo o problema some ou continua:');
L('  a) `SAFE_CACHE=0`           → tira os caches novos (signal store + aparelhos)');
L('  b) `GROUP_META_CACHE=0`     → tira o cache de metadados de grupo');
L('  c) `SEND_TIMEOUT_MS=0`      → tira o prazo de envio');
L('  d) `SEND_RETRY_ON_HANG=0`   → tira o reenvio pós-travamento');
L('');
L('Voltar o CÓDIGO (mantém a correção da causa raiz e remove o resto):');
L('  `git reset --hard 485aee4`  → só a correção do TypeError do cache (19a1294/095345c fora)');
L('  `git reset --hard 9a9d711`  → sem o cache blindado e sem o patch da biblioteca');
L('  `git reset --hard f065151`  → sem prazo de envio / reenvio de travamento');
L('  (depois de qualquer um: reinicie o bot)');

/* ───────────────────────── saída ─────────────────────────────── */

const saida = linhas.join('\n');
console.log(saida);
try {
  fs.mkdirSync(path.join(RAIZ, 'tmp'), { recursive: true });
  const arquivo = path.join(RAIZ, 'tmp', 'diagnostico.txt');
  fs.writeFileSync(arquivo, saida + '\n');
  console.log(`\n📄 relatório salvo em: ${rel(arquivo)}`);
} catch (_) {}
