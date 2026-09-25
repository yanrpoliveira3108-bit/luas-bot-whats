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
  outros: [],
};
for (const f of arquivos) {
  const caminho = path.join(CONFIG.paths.logsDir, f);
  for (const linha of lerJsonl(caminho)) {
    if (String(linha.chat || '') !== JID) continue;
    if (linha.t && quando(linha.t) < DESDE) continue;
    const msg = String(linha.msg || '');
    if (/sendMessage FALHOU|falha ao enviar/i.test(msg)) achados.falhaEnvio.push(linha);
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
  L(`Falhas de envio               : ${achados.falhaEnvio.length}`);
  for (const f of achados.falhaEnvio.slice(-5)) L(`   ${hhmmss(quandoLinha(f))}  ${String(f.err || f.msg).slice(0, 90)}`);
  L(`Linhas do freio               : ${achados.freio.length}`);
  for (const f of achados.freio.slice(-5)) L(`   ${hhmmss(quandoLinha(f))}  ${String(f.msg).slice(0, 90)}`);
  if (achados.comunidade.length) {
    L(`Linhas de comunidade/LID       : ${achados.comunidade.length}`);
    for (const c of achados.comunidade.slice(-3)) L(`   ${hhmmss(quandoLinha(c))}  ${String(c.msg).slice(0, 90)}`);
  }
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
  L('⚠️  O envio FALHOU (erro do WhatsApp/client). O motivo está nas linhas de');
  L('   "Falhas de envio" acima — "not-authorized"/"forbidden" indica que o');
  L('   número não pode postar neste grupo (ver checklist abaixo).');
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
