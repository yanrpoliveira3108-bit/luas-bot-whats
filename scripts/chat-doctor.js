/**
 * scripts/chat-doctor.js — "POR QUE O BOT NÃO FALOU NESTE CHAT?"
 *
 * Relato que este script responde (dono, 25/09): "nesse chat o bot não
 * responde: comandos que fazem coisas (add número, fechar, abrir) ele faz, mas
 * não manda mensagem — hidetag, menu, comandos visuais como tigrinho, qualquer
 * outro comando não aparece no chat, só é feito".
 *
 * SINTOMA = AÇÃO ACONTECE, MENSAGEM NÃO APARECE. Isso tem três origens
 * possíveis, e este script separa as três com dado real do SEU aparelho:
 *
 *   (1) O FREIO DE ENVIO BARROU a mensagem → aparece em `data/sends.jsonl` com
 *       `blocked: <motivo>` e no contador por conversa (`!freio bloqueios`).
 *       A ação do comando acontece antes da resposta; a resposta é descartada.
 *   (2) O ENVIO DEU ERRO → `logs/lua-*.log` registra `[SEND] sendMessage FALHOU`
 *       / `[FREIO] falha ao enviar`, com o motivo (ex.: not-authorized).
 *   (3) O WHATSAPP ACEITOU (o bot entregou, sem erro nem bloqueio) → a mensagem
 *       saiu do bot; o que acontece depois é do lado do aplicativo/grupo
 *       (membro restrito, grupo só de admins, mensagem apagada por outro bot).
 *
 * Uso:
 *   node scripts/chat-doctor.js 120363046296961148@g.us
 *   node scripts/chat-doctor.js 120363046296961148@g.us --dias 3
 *   npm run chat:doctor -- 120363046296961148@g.us
 *
 * Somente leitura: não envia nada, não altera estado, pode rodar com o bot
 * ligado (ele só lê arquivos).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG = require('../config');

/* ------------------------------ argumentos ------------------------------ */

const JID = String(process.argv.slice(2).find((a) => !a.startsWith('--')) || '').trim();
const iDias = process.argv.indexOf('--dias');
const DIAS = iDias >= 0 && Number(process.argv[iDias + 1]) > 0 ? Number(process.argv[iDias + 1]) : 7;

if (!JID) {
  console.log('Uso: node scripts/chat-doctor.js <jid-do-chat> [--dias N]');
  console.log('Ex.: node scripts/chat-doctor.js 120363046296961148@g.us');
  process.exit(1);
}

const DESDE = Date.now() - DIAS * 24 * 3600 * 1000;

/* -------------------------------- saída --------------------------------- */

const linhas = [];
const L = (...t) => linhas.push(t.join(''));
const H = (t) => {
  L('');
  L('─'.repeat(60));
  L(t);
  L('─'.repeat(60));
};

function hhmmss(ms) {
  // o log do bot grava `time` como epoch em ms; a auditoria do freio grava `t`
  // também em ms — mas aceitamos string ISO por segurança
  const d = new Date(typeof ms === 'number' ? ms : Date.parse(String(ms)) || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Primeiro frame do stack (arquivo:linha) — é o que aponta a causa real. */
function frameDoStack(stack) {
  for (const l of String(stack || '').split('\n')) {
    const t = l.trim();
    if (t.startsWith('at ') && !t.includes('node:internal') && !t.includes('internal/process')) return t;
  }
  return '';
}

/** Assinatura do erro: módulo + mensagem + primeiro frame (agrupa repetições). */
/** Frames do stack guardado no log (o 1º aponta a linha exata da falha). */
function framesDoLog(l, quantos = 3) {
  const stack = String((l && (l.stack || l.errStack)) || '');
  if (!stack) return [];
  const out = [];
  for (const linha of stack.split('\n')) {
    const t = linha.trim();
    if (!t.startsWith('at ')) continue;
    if (t.includes('node:internal') || t.includes('internal/process')) continue;
    out.push(t);
    if (out.length >= quantos) break;
  }
  return out;
}

function assinatura(l) {
  const msg = String(l.err || l.msg || '').replace(/\s+/g, ' ').slice(0, 80);
  return `${l.module || '?'} | ${msg} | ${frameDoStack(l.stack || l.frame)}`;
}

/** Data (ms) de uma linha de log (campo `time` do pino) ou do freio (`t`). */
function quandoLinha(o) {
  return quando((o && (o.t !== undefined ? o.t : o.time)) || 0);
}

/** Data (ms) de um valor de tempo, seja epoch ou ISO. */
function quando(v) {
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

function base(p) {
  return path.isAbsolute(p) ? p : path.join(path.resolve(__dirname, '..'), p);
}

/** Lê um jsonl tolerando linha quebrada (o arquivo é escrito em tempo real). */
function lerJsonl(arquivo) {
  const out = [];
  try {
    for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
      const t = linha.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch (_) {
        /* linha parcial (o processo está escrevendo agora) */
      }
    }
  } catch (_) {
    /* arquivo ainda não existe */
  }
  return out;
}

/* ------------------------------- 1) estado ------------------------------ */

const STATE_DIR = base(CONFIG.safety.send.stateDir);
const AUDIT = path.join(STATE_DIR, 'sends.jsonl');
const STATE_FILE = path.join(STATE_DIR, 'sendguard.json');

L('🩺 CHAT DOCTOR — por que o bot não fala neste chat');
L(`chat........: ${JID}`);
L(`janela......: últimos ${DIAS} dia(s)`);
L(`auditoria...: ${AUDIT}${fs.existsSync(AUDIT) ? '' : '  (ainda não existe)'}`);
L(`estado......: ${STATE_FILE}${fs.existsSync(STATE_FILE) ? '' : '  (ainda não existe)'}`);
L(`logs........: ${CONFIG.paths.logsDir}`);

let estado = null;
try {
  estado = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch (_) {
  estado = null;
}

/* --------------------------- 2) auditoria do freio ---------------------- */

const eventos = lerJsonl(AUDIT).filter((e) => quando(e.t) >= DESDE);
const doChat = eventos.filter((e) => String(e.jid) === JID);
const aceitos = doChat.filter((e) => !e.blocked && !e.restriction);
const barrados = doChat.filter((e) => e.blocked);
const restricoes = doChat.filter((e) => e.restriction);
// concluídos = envio que TERMINOU (ok/erro/travou). Sem esta coluna, "aceito"
// parecia entregue — e um envio PENDURADO passava batido (foi o caso de 25/09).
const concluidos = doChat.filter((e) => e.fim);
const travaram = doChat.filter((e) => e.travou || e.resultado === 'travou');

H('1) O QUE O FREIO FEZ COM ESTE CHAT (auditoria de envios)');
if (!eventos.length) {
  L('⚠️  A auditoria ainda está vazia.');
  L('    Ela é gravada quando o bot envia com o freio instalado. Se o bot');
  L('    subiu agora, mande um comando neste chat e rode este script de novo.');
} else {
  L(`Envios ACEITOS pelo WhatsApp (o bot entregou) : ${aceitos.length}`);
  if (aceitos.length) L(`   último: ${hhmmss(aceitos[aceitos.length - 1].t)}`);
  L(`Envios BARRADOS pelo freio (não saíram)       : ${barrados.length}`);
  if (barrados.length) {
    const porMotivo = {};
    for (const b of barrados) porMotivo[b.blocked] = (porMotivo[b.blocked] || 0) + 1;
    for (const [m, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) {
      const explica = {
        broadcast_identico:
          'a MESMA mensagem já tinha sido enviada a outro chat dentro da janela (trava anti-broadcast)',
        fila_cheia: 'a fila deste chat estava cheia (envios anteriores não terminaram)',
        pv_frio: 'conversa fria no privado (quem nunca falou com o bot)',
        interativo_safe_mode: 'modo seguro bloqueia botões/listas nativas',
      }[m];
      L(`   ▸ ${m} ×${n}${explica ? ` — ${explica}` : ''}`);
    }
    L(`   último barrado: ${hhmmss(barrados[barrados.length - 1].t)}`);
    L('');
    L('   Correção: a trava de mensagem idêntica NÃO vem ligada por padrão');
    L('   (SEND_DUP_MAX_CHATS=0 = desligado). Se aparecer "broadcast_identico"');
    L('   com o valor 0 no .env, é o defeito corrigido em utils/sendGuard.js —');
    L('   atualize (git pull) e reinicie o bot.');
  }
  if (restricoes.length) {
    L(`⛔ Restrição detectada ${restricoes.length}× neste chat (o freio pausou os envios).`);
  }
  const ultimos = doChat.slice(-8);
  if (ultimos.length) {
    L('');
    L('   Últimos eventos deste chat:');
    for (const e of ultimos) {
      L(`   ${hhmmss(e.t)}  ${e.blocked ? `BARRADO (${e.blocked})` : e.restriction ? `RESTRIÇÃO (${e.restriction})` : `enviado (${e.kind || '?'})`}`);
    }
  }
}

/* -------------------------- 3) contadores por chat ---------------------- */

H('2) CONTADOR POR CONVERSA (o que o `!freio bloqueios` mostra)');
const porChat = (estado && estado.blockedByChat && estado.blockedByChat[JID]) || null;
if (!porChat) {
  L('✅ Nenhum envio barrado registrado para este chat no estado do freio.');
} else {
  const { _ultimo, ...motivos } = porChat;
  const total = Object.values(motivos).reduce((a, b) => a + b, 0);
  L(`🚧 ${total}× barrado · último em ${_ultimo || '—'}`);
  for (const [m, n] of Object.entries(motivos)) L(`   ▸ ${m} ×${n}`);
}
const top = estado && estado.blockedByChat
  ? Object.entries(estado.blockedByChat)
      .map(([jid, m]) => {
        const { _ultimo, ...resto } = m;
        return { jid, total: Object.values(resto).reduce((a, b) => a + b, 0), motivos: resto };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  : [];
if (top.length) {
  L('');
  L('   Conversas com mais bloqueios (todas):');
  for (const c of top) {
    L(`   ▸ ${c.jid} — ${c.total}×: ` + Object.entries(c.motivos).map(([m, n]) => `${m} ×${n}`).join(' · '));
  }
}

/* ------------------------------- 4) logs -------------------------------- */

H('3) LOGS DO BOT PARA ESTE CHAT (últimos dias)');
let arquivos = [];
try {
  arquivos = fs
    .readdirSync(CONFIG.paths.logsDir)
    .filter((f) => f.startsWith('lua-') && f.endsWith('.log'))
    .sort()
    .slice(-DIAS);
} catch (_) {
  arquivos = [];
}

const achados = {
  comandos: [],
  falhaEnvio: [],
  freio: [],
  comunidade: [],
  lidNaoResolvido: [],
  outros: [],
};
// QUANDO O BOT SUBIU (o processo que está rodando agora). É a informação que
// evita o erro de ler falhas de ANTES da correção e concluir que "continua
// quebrado": só o que aconteceu DEPOIS do último start vale como teste.
let ultimoStart = 0;
for (const f of arquivos) {
  const caminho = path.join(CONFIG.paths.logsDir, f);
  const linhas = lerJsonl(caminho);
  for (const l of linhas) {
    if (/socket criado|conectado ao WhatsApp/i.test(String(l.msg || ''))) {
      ultimoStart = Math.max(ultimoStart, quandoLinha(l));
    }
  }
  for (const linha of linhas) {
    if (String(linha.chat || '') !== JID) continue;
    if (linha.t && quando(linha.t) < DESDE) continue;
    const msg = String(linha.msg || '');
    if (/não consegui resolver LID/i.test(msg)) achados.lidNaoResolvido.push(linha);
    else if (/sendMessage FALHOU|falha ao enviar/i.test(msg)) achados.falhaEnvio.push(linha);
    else if (/FREIO/i.test(msg)) achados.freio.push(linha);
    else if (/COMMAND|Comando recebido/i.test(msg)) achados.comandos.push(linha);
    else if (/COMMUNITY|comunidade|LID/i.test(msg)) achados.comunidade.push(linha);
    else achados.outros.push(linha);
  }
}

if (!arquivos.length) {
  L('⚠️  Nenhum arquivo de log encontrado em ' + CONFIG.paths.logsDir);
} else {
  L(`Arquivos lidos: ${arquivos.join(', ')}`);
  L(`Comandos recebidos neste chat : ${achados.comandos.length}`);
  for (const c of achados.comandos.slice(-5)) L(`   ${hhmmss(quandoLinha(c))}  ${String(c.msg).slice(0, 70)}`);
  if (achados.lidNaoResolvido.length) {
    L(`LID do remetente sem telefone  : ${achados.lidNaoResolvido.length}`);
    for (const c of achados.lidNaoResolvido.slice(-3)) L(`   ${hhmmss(quandoLinha(c))}  ${String(c.msg).slice(0, 70)}`);
    L('   ▸ O remetente veio como LID e o telefone não foi encontrado. Sem o telefone');
    L('     o bot não reconhece o DONO: comandos de dono respondem "Apenas o dono do');
    L('     bot pode usar este comando" mesmo vindo do seu número.');
    L('   ▸ Corrigido nesta versão: quando a lista de participantes não traz o');
    L('     telefone, o bot consulta o mapa LID↔PN da própria biblioteca.');
    L('     `git pull`, reinicie e mande o comando de novo.');
  }
  if (ultimoStart) {
    const depois = achados.falhaEnvio.filter((l) => quandoLinha(l) >= ultimoStart);
    L(`Bot no ar desde                : ${hhmmss(ultimoStart)}${depois.length ? '' : '  (nenhuma falha desde então ✅)'}`);
    if (depois.length) L(`Falhas DEPOIS do último start : ${depois.length}  ← são as que valem (o resto é histórico)`);
  } else {
    L('Bot no ar desde                : (não achei o start do bot nos logs)');
  }
  L(`Falhas de envio               : ${achados.falhaEnvio.length}`);
  for (const f of achados.falhaEnvio.slice(-5)) {
    L(`   ${hhmmss(quandoLinha(f))}  [${f.module || '?'}] ${String(f.err || f.msg).slice(0, 80)}`);
    const fr = frameDoStack(f.stack);
    if (fr) L(`      ↳ ${fr}`);
  }
  L(`Linhas do freio               : ${achados.freio.length}`);
  for (const f of achados.freio.slice(-5)) L(`   ${hhmmss(quandoLinha(f))}  ${String(f.msg).slice(0, 90)}`);
  if (achados.comunidade.length) {
    L(`Linhas de comunidade/LID       : ${achados.comunidade.length}`);
    for (const c of achados.comunidade.slice(-3)) L(`   ${hhmmss(quandoLinha(c))}  ${String(c.msg).slice(0, 90)}`);
  }
}

/* ------------------------- 3.1 assinaturas de erro ---------------------- */

const comErro = achados.falhaEnvio.concat(achados.outros.filter((l) => l.err || l.stack));
if (comErro.length) {
  const contagem = new Map();
  for (const l of comErro) {
    const a = assinatura(l);
    const atual = contagem.get(a) || { n: 0, ultimo: 0, exemplo: l };
    atual.n++;
    atual.ultimo = Math.max(atual.ultimo, quandoLinha(l));
    contagem.set(a, atual);
  }
  const ordenado = [...contagem.entries()].sort((a, b) => b[1].n - a[1].n);
  H('3.1 ASSINATURAS DE ERRO NESTE CHAT (a causa está no primeiro frame)');
  for (const [a, info] of ordenado.slice(0, 8)) {
    const [mod, msg, frame] = a.split(' | ');
    L(`${info.n}×  ${hhmmss(info.ultimo)}  [${mod}] ${msg}`);
    if (frame) L(`      ↳ ${frame}`);
    // stack completo (versões novas do log): os frames seguintes dizem QUEM
    // chamou o trecho que estourou — foi assim que a causa raiz apareceu
    const pilha = framesDoLog(info.exemplo, 4);
    for (const f of pilha) if (!frame || !frame.includes(f.replace(/^at /, ''))) L(`      ·${f}`);
  }
  if (ordenado.some(([a]) => /Cannot read propert|is not a function/.test(a))) {
    L('');
    L('Leitura: erro de MONTAGEM da mensagem (TypeError). O bot executa o comando e');
    L('a resposta não sai. A partir desta versão o envio é repetido SEM a citação');
    L('quando isso acontece — se ainda falhar, o primeiro frame acima diz o arquivo.');
  }

  // CAUSA RAIZ JÁ IDENTIFICADA (25/09/2026): o primeiro frame é o cache da
  // biblioteca recebendo chave inválida. Explicar aqui evita nova caçada.
  const doCache = comErro.find((l) => /NodeCache\.formatKey/.test(String(l.stack || l.frame || '')));
  if (doCache) {
    L('');
    L('🎯 CAUSA CONHECIDA (confirmada pelo frame acima): um participante do grupo');
    L('   em modo LID vem SEM id (`id: undefined`), o envio tenta decodificar o jid');
    L('   desse participante, e o cache de dispositivos da biblioteca recebe');
    L('   `undefined` → `key.toString()` → TypeError. TODO envio neste grupo falha');
    L('   (mesmo sem citação — por isso o reenvio sem citação também falha).');
    L('   ▸ Corrigido nesta versão em 3 camadas: (a) patch na biblioteca para');
    L('     ignorar destinatário sem jid decodificável; (b) cache blindado');
    L('     (utils/safeNodeCache.js) — chave inválida vira "miss", nunca derruba;');
    L('     (c) `userDevicesCache`/signal store passam a usar esse cache.');
    L('   ▸ `git pull` e REINICIE (é mudança de código carregado na conexão).');
  }
} else {
  H('3.1 ASSINATURAS DE ERRO NESTE CHAT');
  L('✅ Nenhum erro registrado para este chat no período.');
}

/* ------------------- 3.2 envios que TRAVARAM (pendurados) --------------- */

const travadosEstado = (estado && Number(estado.travados)) || 0;
const ultimoTravado = estado && estado.lastTravado;
if (travaram.length || travadosEstado) {
  H('3.2 ENVIOS QUE NÃO CONCLUÍRAM (o "fica digitando…" e nada aparece)');
  if (travaram.length) {
    L(`Neste chat: ${travaram.length} envio(s) NÃO concluíram dentro do prazo.`);
    const ult = travaram[travaram.length - 1];
    L(`   último: ${hhmmss(quandoLinha(ult))} · tipo ${ult.kind || '?'} · prazo ${Math.round((ult.prazoMs || 0) / 1000)}s · reenvio: ${ult.tentativa2 || '-'}`);
  }
  if (travadosEstado) {
    L(`No estado do freio: ${travadosEstado} travamento(s) no total.`);
    if (ultimoTravado) {
      L(`   último: ${ultimoTravado.at} · ${ultimoTravado.jid} (${ultimoTravado.kind}) · reenvio: ${ultimoTravado.tentativa2}`);
    }
  }
  if (aceitos.length && concluidos.length < aceitos.length) {
    L(`Aceitos SEM conclusão registrada: ${aceitos.length - concluidos.length} de ${aceitos.length}`);
    L('   (linhas antigas da auditoria não têm o registro de conclusão — o que');
    L('    importa é o contador de travamentos acima, que é desta versão.)');
  }
  L('');
  L('Leitura: o comando RODOU, mas o envio ficou PENDURADO — a biblioteca espera a');
  L('consulta de participantes do grupo e ela não tem prazo. Nada sai e o');
  L('"digitando…" nunca é desfeito (é o "escrevendo infinitamente").');
  L('▸ Correção desta versão: metadados de grupo em CACHE (o envio não faz a');
  L('  consulta), PRAZO de envio (SEND_TIMEOUT_MS) com reenvio sem citação,');
  L('  presença sempre encerrada e travamento contado no `!freio`.');
  L('▸ `git pull`, reinicie e repita o comando. Se travar de novo, este relatório');
  L('  mostra a hora, o tipo e se o reenvio passou.');
}

/* ------------------------------ 5) veredito ----------------------------- */

H('4) VEREDITO');
const bloqueado = barrados.length + (porChat ? Object.values(porChat).reduce((a, b) => a + (Number(b) || 0), 0) : 0);
if (barrados.length) {
  L('🚧 O FREIO BARROU envios para este chat — a ação do comando aconteceu, a');
  L('   MENSAGEM foi descartada antes de sair. É exatamente o sintoma');
  L('   "ele faz, mas não aparece nada".');
  L('   ▸ Atualize o bot (`git pull`) e reinicie: a trava de mensagem idêntica');
  L('     estava ligada por engano no padrão (corrigido em utils/sendGuard.js).');
  L('   ▸ Depois de reiniciar: `!freio bloqueios` deve ficar zerado.');
} else if (achados.falhaEnvio.length) {
  const causaCache = achados.falhaEnvio.some((l) => /NodeCache\.formatKey/.test(String(l.stack || l.frame || '')));
  if (causaCache) {
    const atuais = achados.falhaEnvio.filter((l) => quandoLinha(l) >= ultimoStart);
    L('🎯 CAUSA CONFIRMADA: cache de dispositivos da biblioteca recebendo chave');
    L('   inválida (participante de grupo LID sem id). TODO envio neste grupo falhava.');
    if (ultimoStart && !atuais.length) {
      L('');
      L(`   ⚠️ ATENÇÃO: TODAS as falhas acima são de ANTES do último start (${hhmmss(ultimoStart)}).`);
      L('   Isso é histórico. Se o bot foi reiniciado depois do `git pull`, mande um');
      L('   comando no grupo AGORA e rode o doctor de novo: o que importa é o que');
      L('   acontece depois do start.');
    }
    L('   ▸ Corrigido no código (patch na biblioteca + cache blindado). Atualize');
    L('     (`git pull`) e REINICIE o bot — é código carregado na conexão.');
    L('   ▸ Depois de reiniciar, mande o comando de novo: se voltar a falhar, o');
    L('     primeiro frame deste relatório será outro (aí é outro caminho).');
  } else {
  const tipo = achados.falhaEnvio.some((l) => /Cannot read propert|is not a function/i.test(String(l.err || l.msg)));
  if (tipo) {
    L('🧩 O envio FALHOU por ERRO DE MONTAGEM da mensagem (TypeError). O comando');
    L('   roda, mas a resposta não é enviada — é exatamente "ele faz e não fala".');
    L('   ▸ A partir desta versão o bot REENVIA sem a citação quando isso ocorre.');
    L('   ▸ Atualize (`git pull`), reinicie e mande os comandos de novo.');
    L('   ▸ Se voltar a acontecer, a assinatura acima traz o arquivo:linha exato.');
  } else {
    L('⚠️  O envio FALHOU (erro do WhatsApp/client). O motivo está nas linhas de');
    L('   "Falhas de envio" acima — "not-authorized"/"forbidden" indica que o');
    L('   número não pode postar neste grupo (ver checklist abaixo).');
  }
  }
} else if (travaram.length || travadosEstado) {
  L('⏳ Os ENVIOS ESTÃO TRAVANDO (não é bloqueio do freio nem erro de conteúdo).');
  L('   O comando roda, a resposta é montada e o envio NUNCA conclui: nada');
  L('   aparece e o "digitando…" fica eterno — a fila inteira trava atrás.');
  L('   ▸ Atualize (`git pull`) e reinicie: o envio em grupo passou a usar');
  L('     metadados em CACHE (sem a consulta que travava), ganhou PRAZO com');
  L('     reenvio sem citação e a presença passou a ser sempre encerrada.');
  L('   ▸ Depois de reiniciar, `!freio` mostra "Envios travados (sem resposta)".');
} else if (aceitos.length || achados.comandos.length) {
  L('✅ O bot RECEBEU o comando e o WhatsApp ACEITOU a mensagem (sem bloqueio do');
  L('   freio e sem erro). Ou seja: a mensagem saiu daqui — se ela não aparece');
  L('   na conversa, a barreira está no aplicativo/grupo, não no bot.');
  L('');
  L('   Checklist (em ordem de frequência):');
  L('   1. O bot é ADMIN neste grupo? Grupo de anúncio / comunidade só aceita');
  L('      mensagem de admin. (Ele pode fechar/abrir grupo e ainda assim não postar');
  L('      se os direitos de mensagem do grupo estiverem restritos.)');
  L('   2. O bot foi RESTRINGIDO/silenciado nesse grupo por um admin? Em');
  L('      comunidades, membro restrito tem mensagem visível só para admins.');
  L('   3. Você está vendo a conversa com o DISPOSITIVO conectado (o mesmo que');
  L('      está com o bot)? Mensagem enviada por aparelho vinculado aparece');
  L('      como enviada por você.');
  L('   4. Algum outro bot/admin com "antibot"/"antimídia" está apagando as');
  L('      mensagens do bot (ele apaga e o remetente nem vê).');
  L('   5. Última checagem: `!freio` no privado mostra fila/pausa; se estiver');
  L('      PAUSADO, nada sai em chat nenhum (não é só neste).');
} else {
  L('❓ Nenhum evento deste chat foi encontrado.');
  L('   ▸ Se o bot acabou de subir: mande um comando aqui e rode de novo.');
  L('   ▸ Se o log não tem NEM o "Comando recebido" deste chat, a mensagem não');
  L('     chegou ao bot (grupo/LID novo, bot sem permissão de leitura, ou o');
  L('     comando não foi acionado pelo prefixo).');
}

H('');
L('Detalhes completos: `!freio` (status) · `!freio bloqueios <jid>` (barrados)');
L('Contadores do freio no estado:');
if (estado) {
  L(`   enviados: ${estado.totalSent || 0} · bloqueados: ${estado.totalBlocked || 0} · pausas: ${estado.pauses || 0}`);
  L(`   envios travados: ${Number(estado.travados) || 0}`);
  if (estado.lastRestriction) L(`   última restrição: ${estado.lastRestriction.at} (${estado.lastRestriction.reason})`);
}

const saida = linhas.join('\n');
console.log(saida);

/* relatório em arquivo (mesma convenção dos outros doctors) */
try {
  const dir = base('tmp');
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, 'chat-doctor.txt');
  fs.writeFileSync(arquivo, saida + '\n');
  console.log(`\n📄 relatório salvo em: ${arquivo}`);
} catch (_) {
  /* sem tmp gravável: o terminal já mostrou tudo */
}
