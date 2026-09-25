/**
 * scripts/restricao.js — AUDITORIA DE RESTRIÇÃO DE CONTA.
 *
 * Responde à pergunta: "o que estava acontecendo com a conta antes de cair em
 * restrição?" — com dados dos logs do próprio bot, em vez de suposição.
 *
 * O que ele lê:
 *   logs/lua-*.log        eventos do bot (conexão, pareamento, comandos, erros)
 *   logs/baileys-*.log    eventos do protocolo (stream, retries, 429…)
 *   data/sends.jsonl      auditoria de envios do freio (ritmo, conversas,
 *                         mensagens repetidas, bloqueios e restrições)
 *
 * O que ele mostra:
 *   • histórico de CONEXÃO: quantas vezes pareou, quantas reconexões, 429,
 *     loggedOut, connectionReplaced, quedas sem motivo
 *   • RITMO: pico de mensagens por minuto, conversas mais usadas
 *   • REPETIÇÃO: mesma mensagem mandada para vários chats (assinatura de spam)
 *   • COMANDOS: volume por hora e quais comandos rodaram
 *   • SINAIS DE RESTRIÇÃO já detectados pelo freio
 *   • CHECKLIST de causa provável, com o que cada padrão indica
 *
 * Uso:
 *   node scripts/restricao.js            (últimos 7 dias)
 *   node scripts/restricao.js --dias 30
 *   node scripts/restricao.js --arquivo logs/lua-2026-09-20.log
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG = require('../config');

/* ------------------------------- argumentos ----------------------------- */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DIAS = Math.max(1, parseInt(arg('dias', '7'), 10) || 7);
const ARQUIVO = arg('arquivo', null);
const LOGS_DIR = CONFIG.paths.logsDir;
const AUDIT_FILE = path.join(CONFIG.safety.send.stateDir, 'sends.jsonl');

/* --------------------------------- cores -------------------------------- */

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const title = (t) => console.log(`\n${C.bold}${C.magenta}${t}${C.reset}`);
const line = (s = '') => console.log(s);
const kv = (k, v, color = '') => console.log(`  ${k.padEnd(34)} ${color}${v}${C.reset}`);

function files() {
  if (ARQUIVO) return [path.resolve(ARQUIVO)].filter((f) => fs.existsSync(f));
  let list = [];
  try {
    list = fs
      .readdirSync(LOGS_DIR)
      .filter((f) => /^lua-.*\.log$/.test(f) || /^baileys-.*\.log$/.test(f))
      .map((f) => path.join(LOGS_DIR, f));
  } catch (_) {
    return [];
  }
  const cutoff = Date.now() - DIAS * 24 * 3600 * 1000;
  return list
    .filter((f) => {
      try {
        return fs.statSync(f).mtimeMs >= cutoff;
      } catch (_) {
        return false;
      }
    })
    .sort();
}

/* ------------------------------ coleta ---------------------------------- */

const data = {
  linhas: 0,
  periodo: { de: null, ate: null },
  conexoes: [], // { t, tipo, detalhe }
  pareamentos: [],
  comandos: [], // { t, cmd, chat, isGroup }
  envios: [], // { t, jid, kind, h }
  bloqueios: [], // { t, jid, blocked }
  restricoes: [], // { t, reason }
  errosEnvio: [],
  retriesBaileys: 0,
  streamsBaileys: 0,
};

function pushTime(t) {
  if (!Number.isFinite(t)) return;
  if (!data.periodo.de || t < data.periodo.de) data.periodo.de = t;
  if (!data.periodo.ate || t > data.periodo.ate) data.periodo.ate = t;
}

/** Lê uma linha de log (pino JSON) e classifica. Também aceita texto solto. */
function parseLinha(raw, origem) {
  const s = raw.trim();
  if (!s) return;
  data.linhas++;

  let o = null;
  if (s.startsWith('{')) {
    try {
      o = JSON.parse(s);
    } catch (_) {
      o = null;
    }
  }
  if (!o) {
    // log do Baileys em texto ou linha do terminal: só conta padrões conhecidos
    if (/stream:error|stream error/i.test(s)) data.streamsBaileys++;
    if (/retry/i.test(s)) data.retriesBaileys++;
    return;
  }

  const t = Date.parse(o.time || '') || null;
  pushTime(t);
  const mod = o.module || '';
  const msg = String(o.msg || '');

  // ---- conexão / sessão
  if (mod === 'connection') {
    if (/conectado ao WhatsApp/.test(msg)) data.conexoes.push({ t, tipo: 'online', detalhe: '' });
    else if (/conexão fechada/.test(msg)) {
      data.conexoes.push({ t, tipo: 'fechou', detalhe: `${o.reason || '?'} (${o.statusCode || '?'})` });
    } else if (/sessão encerrada \(loggedOut\)/.test(msg)) data.conexoes.push({ t, tipo: 'LOGOUT', detalhe: '' });
    else if (/rate-limit \(429\)/.test(msg)) data.conexoes.push({ t, tipo: '429', detalhe: 'rate-limit' });
    else if (/falha ao iniciar conexão/.test(msg)) data.conexoes.push({ t, tipo: 'falha', detalhe: String(o.err || '') });
    else if (/pairing code gerado/.test(msg)) data.pareamentos.push({ t, tipo: 'codigo-gerado' });
    else if (/servidor pediu reinício|restartRequired/.test(msg)) data.conexoes.push({ t, tipo: 'restart', detalhe: '' });
    else if (/auth state carregado/.test(msg)) {
      data.conexoes.push({ t, tipo: o.registered ? 'sessao-restaurada' : 'sem-sessao', detalhe: '' });
    }
    return;
  }

  if (mod === 'pairing' && /solicitando pairing code/.test(msg)) {
    data.pareamentos.push({ t, tipo: 'solicitado' });
    return;
  }

  // ---- comandos
  if (o.tag === 'COMMAND') {
    data.comandos.push({ t, cmd: o.cmd || String(msg).replace(/.*: /, ''), chat: o.chat || null, isGroup: false });
    return;
  }

  // ---- freio de envio
  if (mod === 'sendguard') {
    if (/SINAL DE RESTRIÇÃO/.test(msg)) {
      data.restricoes.push({ t, reason: o.err || 'sinal de restrição' });
    } else if (/envio bloqueado|payload interativo bloqueado|fila cheia/.test(msg)) {
      data.bloqueios.push({ t, jid: o.chat || '', blocked: msg });
    }
    return;
  }

  // ---- falhas de envio
  if (/\[SEND\] sendMessage FALHOU/.test(msg)) {
    data.errosEnvio.push({ t, detalhe: String(o.err || '') });
    return;
  }

  if (mod === 'session' && /credenciais removidas após logout/.test(msg)) {
    data.conexoes.push({ t, tipo: 'credenciais-removidas', detalhe: '' });
  }
}

function lerLogs() {
  for (const f of files()) {
    let content = '';
    try {
      content = fs.readFileSync(f, 'utf8');
    } catch (_) {
      continue;
    }
    for (const l of content.split('\n')) parseLinha(l, f);
  }
}

function lerAuditoria() {
  try {
    const content = fs.readFileSync(AUDIT_FILE, 'utf8');
    for (const l of content.split('\n')) {
      const s = l.trim();
      if (!s) continue;
      try {
        const e = JSON.parse(s);
        if (!Number.isFinite(e.t)) continue;
        pushTime(e.t);
        if (e.restriction) data.restricoes.push({ t: e.t, reason: e.restriction });
        else if (e.blocked) data.bloqueios.push({ t: e.t, jid: e.jid, blocked: e.blocked });
        else data.envios.push({ t: e.t, jid: e.jid, kind: e.kind, h: e.h });
      } catch (_) {}
    }
  } catch (_) {
    /* ainda não existe: o bot grava a partir de agora */
  }
}

/* ------------------------------ análises -------------------------------- */

const fmt = (t) => (t ? new Date(t).toLocaleString('pt-BR') : '—');
const horaKey = (t) => {
  const d = new Date(t);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}h`;
};

function picoPorMinuto(envios) {
  const m = new Map();
  for (const e of envios) {
    const k = Math.floor(e.t / 60000);
    m.set(k, (m.get(k) || 0) + 1);
  }
  let max = 0;
  let quando = null;
  for (const [k, n] of m) {
    if (n > max) {
      max = n;
      quando = k * 60000;
    }
  }
  return { max, quando, minutosAtivos: m.size };
}

function porConversa(envios) {
  const m = new Map();
  for (const e of envios) m.set(e.jid, (m.get(e.jid) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Mesma mensagem (hash) em quantas conversas diferentes? */
function repetidas(envios) {
  const m = new Map();
  for (const e of envios) {
    if (!e.h) continue;
    if (!m.has(e.h)) m.set(e.h, new Set());
    m.get(e.h).add(e.jid);
  }
  return [...m.values()].filter((s) => s.size > 1).map((s) => s.size).sort((a, b) => b - a);
}

function comandosPorHora(comandos) {
  const m = new Map();
  for (const c of comandos) m.set(horaKey(c.t), (m.get(horaKey(c.t)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function contar(list, tipo) {
  return list.filter((e) => e.tipo === tipo).length;
}

/* ------------------------------- relatório ------------------------------ */

function relatorio() {
  line(`${C.bold}${C.cyan}╭──────────────────────────────────────────────────────────╮${C.reset}`);
  line(`${C.bold}${C.cyan}│  🔍 AUDITORIA DE RESTRIÇÃO — ${CONFIG.bot.name.padEnd(28)}│${C.reset}`);
  line(`${C.bold}${C.cyan}╰──────────────────────────────────────────────────────────╯${C.reset}`);

  const arquivos = files();
  kv('Logs analisados', arquivos.length ? `${arquivos.length} arquivo(s)` : `${C.yellow}nenhum${C.reset}`);
  kv('Linhas lidas', String(data.linhas));
  kv('Período', `${fmt(data.periodo.de)} → ${fmt(data.periodo.ate)}`);
  kv('Auditoria de envios', fs.existsSync(AUDIT_FILE) ? AUDIT_FILE : `${C.yellow}não existe ainda (passa a existir no próximo boot)${C.reset}`);

  if (!arquivos.length && !data.linhas) {
    title('⚠️ Nada para analisar');
    line('  Não encontrei logs. Eles ficam em: ' + LOGS_DIR);
    line('  Se você roda o bot em outra máquina/pasta, copie a pasta logs/ para cá e rode de novo.');
    line('  Dica: `node scripts/restricao.js --arquivo /caminho/lua-2026-09-20.log`');
    return;
  }

  /* ---------------------------- conexão ---------------------------- */
  title('1. Histórico da conta (o que o WhatsApp viu)');
  const online = contar(data.conexoes, 'online');
  const fechou = contar(data.conexoes, 'fechou');
  const falhas = contar(data.conexoes, 'falha');
  const r429 = contar(data.conexoes, '429');
  const logout = contar(data.conexoes, 'LOGOUT');
  const restart = contar(data.conexoes, 'restart');
  const semSessao = contar(data.conexoes, 'sem-sessao');
  const restaurada = contar(data.conexoes, 'sessao-restaurada');
  const pedidos = data.pareamentos.filter((p) => p.tipo === 'solicitado').length;
  const codigos = data.pareamentos.filter((p) => p.tipo === 'codigo-gerado').length;

  kv('Pareamentos solicitados', String(pedidos), pedidos > 3 ? C.red : '');
  kv('Códigos gerados', String(codigos));
  kv('Subiu sem sessão (novo login)', String(semSessao));
  kv('Restaurou sessão existente', String(restaurada));
  kv('Conectou (online)', String(online), online ? C.green : C.red);
  kv('Conexões fechadas', String(fechou), fechou > 10 ? C.yellow : '');
  kv('Rate-limit 429', String(r429), r429 ? C.red : C.green);
  kv('Logout (credenciais invalidadas)', String(logout), logout ? C.red : C.green);
  kv('Falhas ao iniciar conexão', String(falhas), falhas > 5 ? C.yellow : '');

  const motivos = new Map();
  for (const e of data.conexoes.filter((x) => x.tipo === 'fechou')) {
    const k = String(e.detalhe).split(' ')[0];
    motivos.set(k, (motivos.get(k) || 0) + 1);
  }
  if (motivos.size) {
    line(`  ${C.dim}Motivos de fechamento:${C.reset}`);
    for (const [k, n] of [...motivos.entries()].sort((a, b) => b[1] - a[1])) {
      line(`     ${String(n).padStart(4)}×  ${k}`);
    }
  }

  /* ----------------------------- ritmo ----------------------------- */
  title('2. Ritmo de envio (o que o bot mandou)');
  if (data.envios.length) {
    const pico = picoPorMinuto(data.envios);
    kv('Mensagens auditadas', String(data.envios.length));
    kv('Pico em 1 minuto', `${pico.max} msg  ${pico.quando ? '(' + fmt(pico.quando) + ')' : ''}`, pico.max > 20 ? C.red : C.green);
    const porHora = comandosPorHora(data.comandos);
    if (porHora.length) {
      kv('Comandos no total', String(data.comandos.length));
      const top = porHora[0];
      kv('Hora mais movimentada', `${top[1]} comandos em ${top[0]}`, top[1] > 60 ? C.yellow : '');
    }
    const conv = porConversa(data.envios);
    line(`  ${C.dim}Conversas mais usadas:${C.reset}`);
    for (const [jid, n] of conv.slice(0, 5)) {
      line(`     ${String(n).padStart(4)} msg  ${jid}`);
    }
  } else {
    line(`  ${C.yellow}Sem auditoria de envios ainda.${C.reset}`);
    line(`  ${C.dim}O bot passou a gravar data/sends.jsonl nesta versão — a partir de agora`);
    line(`  cada envio fica registrado (sem conteúdo) e esta seção passa a valer.${C.reset}`);
  }

  /* --------------------------- repetição --------------------------- */
  title('3. Mensagens repetidas em vários chats (assinatura de spam)');
  const rep = repetidas(data.envios);
  if (!data.envios.length) {
    line(`  ${C.dim}Sem dados (ver seção 2).${C.reset}`);
  } else if (!rep.length) {
    kv('Mensagem idêntica em N chats', 'nenhuma', C.green);
  } else {
    kv('Casos detectados', `${rep.length}`, rep[0] >= 5 ? C.red : C.yellow);
    kv('Maior alcance de uma mensagem', `${rep[0]} chats`, rep[0] >= 5 ? C.red : C.yellow);
  }

  /* -------------------------- comandos ---------------------------- */
  title('4. Comandos executados');
  if (data.comandos.length) {
    const porCmd = new Map();
    for (const c of data.comandos) porCmd.set(c.cmd, (porCmd.get(c.cmd) || 0) + 1);
    for (const [cmd, n] of [...porCmd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      line(`     ${String(n).padStart(4)}×  !${cmd}`);
    }
  } else {
    line(`  ${C.dim}Nenhum comando registrado no período.${C.reset}`);
  }

  /* ------------------------ freio / restrição --------------------- */
  title('5. Restrições e bloqueios do freio');
  kv('Sinais de restrição detectados', String(data.restricoes.length), data.restricoes.length ? C.red : C.green);
  for (const r of data.restricoes.slice(-5)) {
    line(`     ${C.red}${fmt(r.t)}  ${String(r.reason).slice(0, 70)}${C.reset}`);
  }
  kv('Envios bloqueados pelo freio', String(data.bloqueios.length));
  const motivosBloqueio = new Map();
  for (const b of data.bloqueios) {
    const k = String(b.blocked).replace(/^\[FREIO\]\s*/, '').slice(0, 48);
    motivosBloqueio.set(k, (motivosBloqueio.get(k) || 0) + 1);
  }
  for (const [k, n] of motivosBloqueio) line(`     ${String(n).padStart(4)}×  ${k}`);
  kv('Falhas de envio ([SEND] FALHOU)', String(data.errosEnvio.length), data.errosEnvio.length ? C.yellow : '');
  for (const e of data.errosEnvio.slice(-3)) line(`     ${C.dim}${fmt(e.t)}  ${e.detalhe.slice(0, 70)}${C.reset}`);

  /* --------------------------- veredito --------------------------- */
  title('6. Leitura do resultado');

  const sinais = [];
  if (logout) sinais.push(['LOGOUT registrado', 'a sessão foi invalidada pelo WhatsApp — isso é ação da plataforma sobre a CONTA, não sobre uma mensagem específica']);
  if (r429) sinais.push(['Rate-limit 429', 'o WhatsApp limitou tentativas (muitos pareamentos/consultas seguidas)']);
  if (pedidos > 3) sinais.push(['Muitos pareamentos', `${pedidos} pedidos de código no período — cada pareamento reinicia a confiança da conta e acumula risco`]);
  if (semSessao > 1) sinais.push(['Vários logins novos', 'a conta foi registrada como dispositivo novo mais de uma vez no período']);
  if (fechou > 10) sinais.push(['Muitas quedas', 'reconexões em sequência também são sinalizadas pelo WhatsApp']);
  if (rep.length && rep[0] >= 5) sinais.push(['Mensagem idêntica em vários chats', 'padrão clássico de spam (broadcast)']);
  if (data.restricoes.length) sinais.push(['Restrição detectada em log', 'o próprio bot viu o sinal (429/spam) e pausou o envio']);
  const pico = data.envios.length ? picoPorMinuto(data.envios).max : 0;
  if (pico > 20) sinais.push(['Rajada de envios', `pico de ${pico} mensagens em 1 minuto`]);

  if (!sinais.length) {
    line(`  ${C.green}Nenhum sinal de comportamento abusivo foi encontrado nos logs.${C.reset}`);
    line('  Isso é informação útil: quando não há rajada, repetição, excesso de pareamento nem 429,');
    line('  o gatilho NÃO está no comportamento do bot — ele está na CONTA/NÚMERO em si.');
    line('  Nesse caso o caminho é o checklist da seção 7 (origem do número, idade, uso humano).');
  } else {
    for (const [t, d] of sinais) line(`  ${C.yellow}•${C.reset} ${C.bold}${t}${C.reset} — ${d}`);
  }

  /* -------------------------- checklist --------------------------- */
  title('7. Checklist da conta (o que costuma decidir isso)');
  line('  Responda com sinceridade — cada "sim" é um fator de risco real:');
  line('');
  line(`  [ ] O número veio de serviço de SMS virtual / recarga / chip de outra pessoa?`);
  line(`      ${C.red}Isso, sozinho, explica restrição em qualquer bot — inclusive sem bot.${C.reset}`);
  line(`  [ ] A conta do WhatsApp foi criada há menos de 7 dias?`);
  line(`      ${C.dim}Conta nova é o alvo principal: o bot precisa aquecer (0–24h de uso humano).${C.reset}`);
  line(`  [ ] O bot foi pareado mais de uma vez nesse número?`);
  line(`      ${C.dim}Cada re-pareamento zera a confiança acumulada e soma risco.${C.reset}`);
  line(`  [ ] Você usa o WhatsApp no celular nesse mesmo número, com uso humano normal?`);
  line(`      ${C.dim}Se só o bot usa o número, ele fica com "perfil de robô" (0 conversas, 0 contatos).${C.reset}`);
  line(`  [ ] Outros números/bots rodam do MESMO aparelho/IP?`);
  line(`      ${C.dim}Vários números automatizados no mesmo IP é um sinal forte para o WhatsApp.${C.reset}`);
  line(`  [ ] Entrou em grupos em massa (ou recebeu convite) logo após parear?`);
  line(`      ${C.dim}Entrar em muitos grupos em pouco tempo é um dos gatilhos mais rápidos.${C.reset}`);
  line('');
  line(`  ${C.bold}Teste controlado (o jeito de provar a causa):${C.reset}`);
  line(`  pegue UM número antigo, com uso humano (seu número principal, com conversas reais),`);
  line(`  rode o bot com HTML/cards ligados (padrão agora) em UM grupo de poucas pessoas`);
  line(`  conhecidas, mande !menu e !ping2. Se não cair nada em 24h, o gatilho é a conta/`);
  line(`  número novo — não o payload. Se cair, aí sim o formato entra como suspeito.`);
  line('');
  line(`  ${C.dim}O freio de envio continua ligado e limita o ritmo; use !freio no WhatsApp para ver o estado.${C.reset}`);
  line('');
}

function main() {
  console.log(`\n${C.dim}Lua — auditoria de restrição de conta${C.reset}`);
  lerLogs();
  lerAuditoria();
  relatorio();
}

main();
