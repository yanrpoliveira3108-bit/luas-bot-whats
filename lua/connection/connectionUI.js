/**
 * connection/connectionUI.js — interface interativa de terminal do Lua.
 *
 * Fluxo profissional de inicialização com foco em PAIRING CODE (sem QR):
 *  splash → boot ✓ → (sessão? restaura) → menu [Conectar|Config|Sistema|Sair]
 *  → número inteligente → confirmação → pairing code → aguardar → online.
 *
 * Também oferece: trocar sessão, restaurar sessão, status e sair.
 */

'use strict';

const readline = require('readline');
const os = require('os');

const CONFIG = require('../config');
const settings = require('../database/settings');
const { registry } = require('../engine/plugins');
const phoneParser = require('./phoneParser');
const phone = require('./phone');
const sessionRecovery = require('./sessionRecovery');
const terminal = require('../utils/terminal');
const logger = require('../utils/logger').child('ui');

// conexão é carregada sob demanda (Baileys é pesado; mantém o splash rápido)
let _conn = null;
function conn() {
  if (!_conn) _conn = require('./connect');
  return _conn;
}

let rl = null;
// calculado já no load: permite que ui.ok() imprima os passos do boot
// (tty.isatty() em vez de process.stdin.isTTY — este é undefined no Termux)
let interactive = terminal.isInteractive() && !process.env.LUA_NO_UI;
const waiters = [];

/* ------------------------------ helpers ------------------------------ */

function getRl() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: terminal.isInteractive(),
    });
  }
  return rl;
}

function ask(question) {
  return new Promise((resolve) => getRl().question(question, resolve));
}

function defaultCountry() {
  return settings.get('default_country', CONFIG.owner.defaultCountry || 'BR');
}

function waitEvent(predicate, timeoutMs) {
  return new Promise((resolve) => {
    const w = {
      pred: predicate,
      timer: setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i !== -1) waiters.splice(i, 1);
        resolve({ type: 'timeout' });
      }, timeoutMs),
    };
    w.resolve = (ev) => {
      const i = waiters.indexOf(w);
      if (i !== -1) waiters.splice(i, 1);
      clearTimeout(w.timer);
      resolve(ev);
    };
    waiters.push(w);
  });
}

/* ------------------------------ splash ------------------------------- */

function splash() {
  terminal.clearTerminal();
  const inner = 40;
  const S = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' };
  console.log(S.tl + S.h.repeat(inner) + S.tr);
  console.log(S.v + terminal.center('🌙 LUA BOT', inner) + S.v);
  console.log(S.v + terminal.center('WhatsApp Assistant', inner) + S.v);
  console.log(S.bl + S.h.repeat(inner) + S.br);
  console.log('\nInicializando sistema...\n');
}

function ok(label) {
  if (interactive) console.log(`✓ ${label}`);
}

/* ------------------------- renderização de status -------------------- */

function onStatusEvent(ev) {
  if (!interactive) return;
  switch (ev.type) {
    case 'connecting':
      break; // estado inicial silencioso
    case 'restoring':
      console.log('✓ Restaurando sessão...');
      break;
    case 'awaiting-pairing':
      console.log('↻ O WhatsApp pediu reinício — o código continua válido. Aguarde...');
      break;
    case 'pairing-code':
      printPairingBox(ev.code);
      break;
    case 'open':
      break; // tratado pelo waiter (imprime o box ONLINE)
    case 'close':
      console.log('\n⚠ Conexão perdida.');
      break;
    case 'reconnecting':
      console.log('↻ Restaurando conexão...');
      break;
    case 'logged-out':
      console.log('\n⚠ Sessão encerrada. Será necessário autenticar novamente.');
      break;
    case 'failed':
      console.log(`\n❌ Falha na conexão: ${ev.reason}`);
      break;
    default:
      break;
  }
  // despacha para os waiters
  for (const w of [...waiters]) {
    if (w.pred(ev)) w.resolve(ev);
  }
}

/* ------------------------------- caixas ------------------------------ */

function printPairingBox(code) {
  terminal.clearTerminal();
  terminal.drawBox(
    ['', `    ${code}`, ''],
    { style: 'round', width: 40, borderTitle: '🔐 PAIRING CODE' }
  );
  console.log('\nNo WhatsApp:');
  console.log('  Configurações');
  console.log('  → Aparelhos conectados');
  console.log('  → Conectar aparelho');
  console.log('  → Conectar com número de telefone');
  console.log('\nDigite o código mostrado acima.');
  console.log('\n○ Aguardando autenticação...');
}

function printOnlineBox() {
  const st = conn().getStatus();
  const num = st.phoneDigits ? phoneParser.maskPhoneNumber('+' + st.phoneDigits) : '—';
  const inner = 40;
  const S = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', ml: '╠', mr: '╣' };
  const row = (label, value) => {
    const text = ` ${label}${value}`;
    return S.v + text + ' '.repeat(Math.max(0, inner - terminal.width(text) - 1)) + S.v;
  };
  console.log(S.tl + S.h.repeat(inner) + S.tr);
  console.log(S.v + terminal.center('🌙 LUA ONLINE', inner) + S.v);
  console.log(S.ml + S.h.repeat(inner) + S.mr);
  console.log(row('Status: ', 'ONLINE'));
  console.log(row('Número: ', num));
  console.log(row('Comandos: ', String(registry.count())));
  console.log(row('Plugins: ', String(registry.plugins.size)));
  console.log(S.bl + S.h.repeat(inner) + S.br);
}

/* -------------------------- fluxo de conexão ------------------------- */

/** Conecta e espera um evento terminal (open/logged-out/failed/timeout).
 *  Um 'close' durante o pareamento é tratado internamente pelo connect.js
 *  (restartRequired → reconexão automática; demais fechamentos viram 'failed'),
 *  então NÃO é evento terminal. Na restauração, o timeout é maior porque o
 *  bot pode reconectar sozinho algumas vezes antes de desistir. */
async function connectAndWait(phoneDigits, timeoutMs = 180000) {
  if (phoneDigits) console.log('\n✓ Número validado');
  console.log('○ Preparando conexão');
  const terminalEvent = waitEvent(
    (e) => ['open', 'logged-out', 'failed', 'timeout'].includes(e.type),
    timeoutMs
  );
  conn()
    .connect({ phone: phoneDigits || undefined })
    .catch(() => {});
  return terminalEvent;
}

/** Checklist de causas comuns de falha de pareamento. */
function printPairingHelp() {
  console.log('');
  console.log('Verifique:');
  console.log('  • o número é o MESMO do celular onde o WhatsApp está instalado');
  console.log('  • o número NÃO está em uso em outro aparelho ao mesmo tempo');
  console.log('  • a internet do Termux está estável (prefira Wi-Fi)');
  console.log('  • se você já tentou várias vezes, AGUARDE alguns minutos');
  console.log('    (o WhatsApp limita tentativas de pareamento seguidas)');
  console.log('');
  console.log('  📋 Detalhes do erro:');
  console.log('    logs/lua-' + new Date().toISOString().slice(0, 10) + '.log');
  console.log('    logs/baileys-' + new Date().toISOString().slice(0, 10) + '.log');
}

async function connectFlow() {
  const phoneObj = await phoneFlow();
  if (!phoneObj) return mainMenu();
  const ev = await connectAndWait(phoneObj.digits);
  if (ev.type === 'open') {
    await connectedMenu();
    return;
  }
  console.log('\n❌ Não foi possível conectar.');
  printPairingHelp();
  await ask('\nPressione Enter para voltar...');
  await mainMenu();
}

/* --------------------------- entrada de número ----------------------- */

async function phoneFlow() {
  terminal.clearTerminal();
  terminal.drawBox([], { style: 'round', width: 40, borderTitle: '📱 NÚMERO DO WHATSAPP' });
  console.log('Digite o número completo do WhatsApp.');
  console.log('\nExemplos:');
  console.log('  +55 19 99999-9999');
  console.log('  +1 (742) 369-1883');
  console.log('  +351 912 345 678');
  console.log('\n[1] Digitar número completo');
  console.log('[2] Escolher país manualmente');
  console.log('[0] Voltar');
  while (true) {
    const opt = (await ask('Opção: ')).trim();
    if (opt === '1') return autoNumberFlow();
    if (opt === '2') return manualCountryFlow();
    if (opt === '0') return null;
    console.log('⚠ Opção inválida.');
  }
}

async function autoNumberFlow() {
  while (true) {
    const raw = (await ask('\nNúmero: ')).trim();
    if (!raw) {
      console.log('⚠ Número vazio. Tente novamente.');
      continue;
    }
    if (/^(0|sair|cancelar)$/i.test(raw)) return null;

    const res = phone.resolveNumberInput(raw, { defaultCountry: defaultCountry() });

    if (res.status === 'ok') {
      const c = await confirmNumber(res.phone);
      if (c === 'ok') return res.phone;
      if (c === 'retry') continue;
      return null;
    }

    if (res.status === 'ambiguous') {
      const choice = await resolveAmbiguity(res.candidates);
      if (!choice) return null;
      if (choice === 'retry') continue;
      const res2 = phone.resolveWithCountry(choice, raw);
      if (res2.status === 'ok') {
        const c = await confirmNumber(res2.phone);
        if (c === 'ok') return res2.phone;
        if (c === 'retry') continue;
        return null;
      }
      console.log('❌ Número inválido para o país escolhido.');
      continue;
    }

    console.log('❌ Não foi possível identificar um número telefônico válido.');
    console.log('Digite novamente:');
  }
}

async function resolveAmbiguity(candidates) {
  console.log('\n⚠ Não foi possível determinar o país automaticamente.');
  console.log('Escolha uma das interpretações abaixo:');
  const list = candidates.slice(0, 6);
  list.forEach((c, i) => console.log(`[${i + 1}] ${c.flag} ${c.name} (+${c.ddi})`));
  console.log('[7] Digitar novamente');
  console.log('[0] Cancelar');
  const opt = (await ask('Opção: ')).trim();
  const n = parseInt(opt, 10);
  if (Number.isFinite(n) && n >= 1 && n <= list.length) return list[n - 1].country;
  if (n === 7) return 'retry';
  return null;
}

async function manualCountryFlow() {
  terminal.clearTerminal();
  const countries = phoneParser.popularCountries();
  console.log('🌎 País');
  countries.forEach((c, i) => console.log(`[${i + 1}] ${c.flag} ${c.name} (+${c.ddi})`));
  console.log(`[${countries.length + 1}] Outro`);
  console.log('[0] Voltar');
  while (true) {
    const opt = (await ask('Opção: ')).trim();
    const n = parseInt(opt, 10);
    let country = null;
    if (Number.isFinite(n) && n >= 1 && n <= countries.length) {
      country = countries[n - 1].country;
    } else if (n === countries.length + 1) {
      const code = (await ask('Código ISO do país (2 letras, ex.: BR): ')).trim().toUpperCase();
      if (!phoneParser.isSupportedCountry(code)) {
        console.log('❌ País não suportado.');
        continue;
      }
      country = code;
    } else if (n === 0) {
      return null;
    } else {
      console.log('⚠ Opção inválida.');
      continue;
    }

    const nat = (await ask('Número nacional (sem DDI): ')).trim();
    const res = phone.resolveNational(country, nat);
    if (res.status !== 'ok') {
      console.log('❌ Número inválido para este país.');
      continue;
    }
    const c = await confirmNumber(res.phone);
    if (c === 'ok') return res.phone;
    if (c === 'retry') continue;
    return null;
  }
}

async function confirmNumber(phoneObj) {
  terminal.clearTerminal();
  terminal.drawBox(
    [
      `País: ${phoneObj.flag} ${phoneObj.countryName}`,
      `DDI: +${phoneObj.ddi}`,
      `Número: ${phoneParser.maskPhoneNumber(phoneObj.e164)}`,
    ],
    { style: 'round', width: 40, borderTitle: '🔐 CONFIRMAR NÚMERO' }
  );
  console.log('\n[1] Confirmar');
  console.log('[2] Digitar novamente');
  console.log('[0] Cancelar');
  const opt = (await ask('Opção: ')).trim();
  if (opt === '1') return 'ok';
  if (opt === '2') return 'retry';
  return null;
}

/* ------------------------------ menus -------------------------------- */

async function mainMenu() {
  terminal.clearTerminal();
  terminal.drawBox([], { style: 'round', width: 40, borderTitle: 'CONEXÃO DO LUA' });
  console.log('\n[1] Conectar WhatsApp');
  console.log('[2] Configurações');
  console.log('[3] Verificar sistema');
  console.log('[0] Sair');
  while (true) {
    const opt = (await ask('Opção: ')).trim();
    if (opt === '1') {
      await connectFlow();
      return;
    }
    if (opt === '2') {
      await configMenu();
      return;
    }
    if (opt === '3') {
      await verifySystem();
      return;
    }
    if (opt === '0') {
      await gracefulExit();
      return;
    }
    console.log('⚠ Opção inválida.');
  }
}

async function connectedMenu() {
  terminal.clearTerminal();
  printOnlineBox();
  console.log('\n[1] Conectar');
  console.log('[2] Trocar sessão');
  console.log('[3] Restaurar sessão');
  console.log('[4] Status');
  console.log('[0] Sair');
  while (true) {
    const opt = (await ask('Opção: ')).trim();
    if (opt === '1') {
      if (conn().isConnected()) {
        console.log('ℹ Já está conectado.');
      } else {
        const ev = await connectAndWait(null);
        if (ev.type !== 'open') console.log('❌ Falha ao conectar.');
      }
      await connectedMenu();
      return;
    }
    if (opt === '2') {
      await changeSessionFlow();
      return;
    }
    if (opt === '3') {
      await restoreFlow();
      return;
    }
    if (opt === '4') {
      await showStatus();
      await connectedMenu();
      return;
    }
    if (opt === '0') {
      await gracefulExit();
      return;
    }
    console.log('⚠ Opção inválida.');
  }
}

async function changeSessionFlow() {
  const ans = (await ask('⚠ Isso encerrará a sessão atual e apagará as credenciais. Confirmar? [s/N]: '))
    .trim()
    .toLowerCase();
  if (!['s', 'sim', 'y', 'yes'].includes(ans)) {
    await connectedMenu();
    return;
  }
  console.log('⏳ Encerrando sessão...');
  await conn().changeSession();
  console.log('✅ Sessão encerrada.');
  await mainMenu();
}

async function restoreFlow() {
  if (!sessionRecovery.hasRegisteredSession()) {
    console.log('❌ Nenhuma sessão salva para restaurar.');
    await mainMenu();
    return;
  }
  console.log('✓ Restaurando sessão...');
  const ev = await connectAndWait(null, 330000);
  if (ev.type === 'open') {
    await connectedMenu();
    return;
  }
  console.log('❌ Não foi possível restaurar a sessão.');
  console.log('   A sessão pode estar inválida — use "Trocar sessão" ou apague a pasta session/.');
  await ask('\nPressione Enter para voltar...');
  await mainMenu();
}

/* ------------------------ config / status / sair --------------------- */

async function configMenu() {
  terminal.clearTerminal();
  const ownerNum = CONFIG.owner.numbers[0] || '';
  terminal.drawBox(
    [
      `Nome do bot: ${CONFIG.bot.name}`,
      `Prefixo: ${settings.effectivePrefix()}`,
      `Dono: ${ownerNum ? phoneParser.maskPhoneNumber('+' + ownerNum) : 'não definido'}`,
      `País padrão: ${defaultCountry()}`,
      `Modo privado: ${CONFIG.mode.private ? 'sim' : 'não'}`,
      `Sessão salva: ${sessionRecovery.hasRegisteredSession() ? 'sim' : 'não'}`,
    ],
    { style: 'round', width: 42, borderTitle: '⚙️ CONFIGURAÇÕES' }
  );
  console.log('\n[1] Alterar país padrão');
  console.log('[0] Voltar');
  while (true) {
    const opt = (await ask('Opção: ')).trim();
    if (opt === '1') {
      await changeDefaultCountry();
      await configMenu();
      return;
    }
    if (opt === '0') {
      await mainMenu();
      return;
    }
    console.log('⚠ Opção inválida.');
  }
}

async function changeDefaultCountry() {
  const code = (await ask('Novo país padrão (ISO 2 letras, ex.: BR): ')).trim().toUpperCase();
  if (!phoneParser.isSupportedCountry(code)) {
    console.log('❌ País não suportado.');
    return;
  }
  settings.set('default_country', code);
  console.log(`✅ País padrão alterado para ${code} (${phoneParser.countryName(code)}).`);
}

async function verifySystem() {
  terminal.clearTerminal();
  const st = conn().getStatus();
  terminal.drawBox(
    [
      `Node: ${process.version}`,
      `SO: ${os.type()} ${os.release()}`,
      `Plataforma: ${process.platform}`,
      `Terminal: ${terminal.isInteractive() ? 'interativo' : 'não interativo'}`,
      `Comandos: ${registry.count()}`,
      `Plugins: ${registry.plugins.size}`,
      `Sessão: ${sessionRecovery.hasRegisteredSession() ? 'salva' : 'nenhuma'}`,
      `Status: ${st.connected ? 'conectado' : 'desconectado'}`,
      `ffmpeg: ${require('../utils/stickerEngine').hasFfmpeg() ? 'presente' : 'ausente'}`,
    ],
    { style: 'round', width: 42, borderTitle: '🩺 VERIFICAR SISTEMA' }
  );
  await ask('\nPressione Enter para voltar...');
  await mainMenu();
}

async function showStatus() {
  terminal.clearTerminal();
  const st = conn().getStatus();
  terminal.drawBox(
    [
      `Status: ${st.connected ? 'ONLINE' : 'offline'}`,
      `Número: ${st.phoneDigits ? phoneParser.maskPhoneNumber('+' + st.phoneDigits) : '—'}`,
      `Sessão: ${sessionRecovery.hasRegisteredSession() ? 'salva' : 'nenhuma'}`,
      `Último evento: ${st.lastReason || '—'}`,
    ],
    { style: 'round', width: 42, borderTitle: '📡 STATUS' }
  );
  await ask('\nPressione Enter para voltar...');
}

async function gracefulExit() {
  console.log('\n👋 Até logo!');
  try {
    getRl().close();
  } catch (_) {
    /* ignora */
  }
  await conn().shutdown();
  try {
    require('../database/database').close();
  } catch (_) {
    /* ignora */
  }
  process.exit(0);
}

/* ------------------------------- entry ------------------------------- */

/** Inicia a interface (ou o modo não interativo). */
async function run() {
  interactive = terminal.isInteractive() && !process.env.LUA_NO_UI;
  if (!interactive) {
    await nonInteractive();
    return;
  }

  conn().setStatusListener(onStatusEvent);

  if (sessionRecovery.hasRegisteredSession()) {
    console.log('✓ Sessão encontrada');
    console.log('✓ Restaurando sessão...');
    const ev = await connectAndWait(null, 330000);
    if (ev.type === 'open') {
      await connectedMenu();
      return;
    }
    console.log('\n⚠ Não foi possível restaurar a sessão.');
    console.log('   A sessão pode estar inválida. Apague-a e refaça o pareamento:');
    console.log('   (no terminal)  rm -rf session');
    await ask('\nPressione Enter para voltar...');
    await mainMenu();
    return;
  }

  await mainMenu();
}

/** Modo não interativo (sem TTY): usa .env / restaura sessão. */
async function nonInteractive() {
  console.log('⚠ Terminal não interativo. Usando configuração do .env.');
  if (sessionRecovery.hasRegisteredSession()) {
    await conn().connect({});
    return;
  }
  const num = CONFIG.owner.pairingNumber;
  if (num) {
    const res = phoneParser.parsePhoneNumber(num, defaultCountry());
    if (res.valid) {
      await conn().connect({ phone: res.digits });
      return;
    }
    console.log('❌ PAIRING_NUMBER inválido no .env.');
    return;
  }
  console.log('❌ Sem sessão salva e sem PAIRING_NUMBER. Configure o .env e reinicie.');
}

module.exports = { splash, ok, run };
