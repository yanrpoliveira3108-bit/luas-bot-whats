#!/usr/bin/env node
/**
 * scripts/downloads-doctor.js — diagnóstico dos downloads (rode NO CELULAR/PC
 * onde o bot roda).
 *
 *   node scripts/downloads-doctor.js            # testa tudo
 *   node scripts/downloads-doctor.js youtube    # só uma plataforma
 *
 * Ele responde, em ordem:
 *   1. o ambiente deixa BAIXAR? (diretórios, espaço, motores externos)
 *   2. o ambiente deixa ENVIAR? (TMPDIR do Baileys — a pegadinha do Android)
 *   3. cada site responde? (metadata)
 *   4. o arquivo desce de verdade? (baixa e confere os bytes)
 *
 * Nada é instalado, nada é alterado: só lê e baixa em tmp/. Os arquivos de
 * teste são apagados no fim.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const C = {
  ok: '\x1b[32m',
  bad: '\x1b[31m',
  warn: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

const resultados = [];
function linha(status, titulo, detalhe) {
  const icone = status === 'ok' ? `${C.ok}✔${C.reset}` : status === 'bad' ? `${C.bad}✘${C.reset}` : `${C.warn}⚠${C.reset}`;
  console.log(`  ${icone} ${titulo}${detalhe ? `\n      ${C.dim}${detalhe}${C.reset}` : ''}`);
  resultados.push({ status, titulo, detalhe });
}

function titulo(txt) {
  console.log(`\n${C.bold}${txt}${C.reset}`);
}

function temBinario(nome, args = ['--version']) {
  try {
    const r = spawnSync(nome, args, { stdio: 'ignore', timeout: 8000 });
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

function versao(nome, args = ['--version']) {
  try {
    const r = spawnSync(nome, args, { timeout: 8000, encoding: 'utf8' });
    return String(r.stdout || r.stderr || '').split('\n')[0].trim();
  } catch (_) {
    return '';
  }
}

async function withTimeout(promise, ms, rotulo) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`timeout de ${ms / 1000}s (${rotulo})`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function humano(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

/* ══════════════════════════ 1. AMBIENTE ══════════════════════════ */

function ambiente() {
  titulo('1) AMBIENTE (onde o bot roda)');
  linha('ok', `Node ${process.version} • ${os.platform()} ${os.arch()}`);

  const tmpProjeto = path.join(ROOT, 'tmp');
  let ok1 = true;
  try {
    fs.mkdirSync(tmpProjeto, { recursive: true });
    fs.writeFileSync(path.join(tmpProjeto, '.probe'), 'x');
    fs.unlinkSync(path.join(tmpProjeto, '.probe'));
  } catch (e) {
    ok1 = false;
    linha('bad', 'A pasta tmp/ do projeto não é gravável', `${e.code || ''} ${e.message}`);
  }
  if (ok1) linha('ok', `tmp/ do projeto gravável (${tmpProjeto})`);

  // TMPDIR do Baileys: se não gravar, NENHUM envio de mídia funciona
  const tmpSistema = os.tmpdir();
  let okTmp = true;
  let errTmp = '';
  try {
    const probe = path.join(tmpSistema, `.probe-${Date.now()}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
  } catch (e) {
    okTmp = false;
    errTmp = `${e.code || ''} ${e.message}`;
  }
  if (okTmp) {
    linha('ok', `TMPDIR do sistema gravável (${tmpSistema})`, 'é aqui que o Baileys grava o arquivo antes de subir');
  } else {
    linha(
      'bad',
      `TMPDIR do sistema NÃO é gravável (${tmpSistema})`,
      `${errTmp}\n      Isso quebra TODO envio de mídia (e todo download) — texto continua funcionando.\n      Correção: iniciar o bot pelo index.js (ele ajusta sozinho) ou exportar TMPDIR="$PWD/tmp"`
    );
  }

  try {
    const { ensureTmpDir } = require('../utils/tmpdir');
    const r = ensureTmpDir(tmpProjeto);
    if (r.dir && r.dir !== tmpSistema) {
      linha('warn', `O bot vai usar ${r.dir} como temporário`, r.motivo);
    } else if (okTmp) {
      linha('ok', 'O bot (index.js) consegue resolver o temporário sozinho');
    }
  } catch (e) {
    linha('warn', 'Não consegui carregar utils/tmpdir', e.message);
  }

  // espaço livre
  try {
    const st = fs.statfsSync ? fs.statfsSync(tmpProjeto) : null;
    if (st) {
      const livre = st.bsize * st.bavail;
      const total = st.bsize * st.blocks;
      if (livre < 200 * 1024 * 1024) {
        linha('bad', `Pouco espaço livre: ${humano(livre)}`, 'downloads de vídeo precisam de espaço em tmp/');
      } else {
        linha('ok', `Espaço livre: ${humano(livre)} de ${humano(total)}`);
      }
    }
  } catch (_) {
    linha('warn', 'Não consegui medir o espaço livre (fs.statfsSync indisponível)');
  }

  // motores externos
  const ytdlp = temBinario('yt-dlp');
  const ffmpeg = temBinario('ffmpeg');
  const aria2c = temBinario('aria2c');
  if (ytdlp) {
    linha('ok', `yt-dlp: ${versao('yt-dlp')}`, 'motor principal do YouTube');
  } else {
    linha(
      'bad',
      'yt-dlp AUSENTE',
      'Sem ele o YouTube depende do motor reserva (ytdl-core), que hoje costuma falhar\n' +
        '      com "Sign in to confirm you are not a bot".\n' +
        '      Termux: pkg install python && pip install -U yt-dlp\n' +
        '      Depois: yt-dlp --version  (tem que mostrar a versão)'
    );
  }
  if (ffmpeg) {
    linha('ok', `ffmpeg: ${versao('ffmpeg')}`, 'mescla vídeo+áudio e converte formato');
  } else {
    linha('warn', 'ffmpeg ausente', 'só o áudio/vídeo em formato já pronto vai funcionar — pkg install ffmpeg');
  }
  linha(aria2c ? 'ok' : 'warn', `aria2c: ${aria2c ? 'disponível' : 'ausente (opcional)'}`);
}

/* ══════════════════════════ 2. REDE ══════════════════════════ */

async function rede() {
  titulo('2) REDE (o celular alcança os serviços?)');
  const alvos = [
    ['YouTube (busca)', 'https://www.youtube.com'],
    ['YouTube (API interna)', 'https://www.youtube.com/youtubei/v1/player'],
    ['TikTok — tikwm.com', 'https://www.tikwm.com/api/'],
    ['X/Twitter — fxtwitter', 'https://api.fxtwitter.com/twitter/status/1'],
    ['Reddit', 'https://www.reddit.com'],
    ['Instagram', 'https://www.instagram.com'],
    ['Pinterest', 'https://www.pinterest.com'],
  ];
  for (const [nome, url] of alvos) {
    const t0 = Date.now();
    try {
      const res = await withTimeout(fetch(url, { method: 'GET', redirect: 'follow' }), 15000, nome);
      linha('ok', `${nome} — HTTP ${res.status} em ${Date.now() - t0}ms`);
    } catch (e) {
      const msg = String(e.message || e);
      const extra = /EAI_AGAIN|ENOTFOUND|getaddrinfo/i.test(msg)
        ? 'DNS falhou (sem internet ou bloqueio de operadora/VPN)'
        : /ECONNREFUSED|ETIMEDOUT|socket hang up|SSL|TLS/i.test(msg)
          ? 'conexão recusada/bloqueada (operadora, VPN, firewall ou rede Wi-Fi)'
          : msg;
      linha('bad', `${nome} — não respondeu`, `${extra} (${Date.now() - t0}ms)`);
    }
  }
}

/* ══════════════════════════ 3. DOWNLOAD REAL ══════════════════════════ */

async function testarPlataforma(nome, fn) {
  const t0 = Date.now();
  try {
    const r = await withTimeout(fn(), 180000, nome);
    const bytes = r && r.path && fs.existsSync(r.path) ? fs.statSync(r.path).size : 0;
    if (!bytes) {
      linha('bad', `${nome} — baixou arquivo vazio`);
      return;
    }
    let assinatura = '';
    try {
      const fd = fs.openSync(r.path, 'r');
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);
      assinatura = buf.toString('hex').match(/^..../) ? buf.toString('ascii', 0, 4).replace(/[^\x20-\x7e]/g, '.') : '';
    } catch (_) {}
    linha(
      'ok',
      `${nome} — OK em ${((Date.now() - t0) / 1000).toFixed(1)}s • ${humano(bytes)} • ${(r.title || '').slice(0, 50)}`,
      `${path.basename(r.path)} [${assinatura}]${r.engine ? ' • motor: ' + r.engine : ''}`
    );
    try {
      fs.unlinkSync(r.path);
    } catch (_) {}
  } catch (e) {
    const msg = String(e.message || e).split('\n')[0];
    const dicas = [];
    if (/yt-dlp/i.test(msg) || /not a bot|Sign in|decipher|player/i.test(msg)) {
      dicas.push('instale/atualize o yt-dlp: pkg install python && pip install -U yt-dlp');
      dicas.push('se continuar, exporte cookies: YT_COOKIES=/caminho/cookies.txt (veja DOWNLOAD-TROUBLESHOOTING.md)');
    }
    if (/ffmpeg/i.test(msg)) dicas.push('pkg install ffmpeg');
    if (/ENOENT|no such file/i.test(msg)) dicas.push('diretório temporário inválido — rode o bot por index.js');
    if (/ETIMEDOUT|timeout|abort/i.test(msg)) dicas.push('rede lenta/bloqueada — teste em outra rede ou sem VPN');
    if (/403|429|Forbidden|blocked|rate/i.test(msg)) dicas.push('o site bloqueou este IP — tente outra rede/VPN ou mais tarde');
    if (/NO_RESULT|indispon|privad/i.test(msg)) dicas.push('o link de teste pode ter saído do ar — não é falha do bot');
    linha('bad', `${nome} — FALHOU (${e.code || 'sem código'}): ${msg}`, dicas.join('\n      '));
  }
}

async function downloads(alvo) {
  titulo('3) DOWNLOAD REAL (é isso que o bot faz por baixo)');
  const youtube = require('../downloaders/youtube');
  const tiktok = require('../downloaders/tiktok');
  const social = require('../downloaders/social');
  const twitter = require('../downloaders/twitter');

  const so = alvo ? String(alvo).toLowerCase() : null;

  // links públicos e estáveis
  const YT = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
  const TT = 'https://www.tiktok.com/@nasa/video/7314980458643918093';
  const TW = 'https://x.com/nasa/status/1735289352063901729';
  const PIN = 'https://www.pinterest.com/pin/1116123883329609/';

  const testes = [
    ['youtube', 'YouTube (busca)', () => youtube.search('lofi hip hop', 1)],
    ['youtube', 'YouTube — áudio (!ytmp3)', () => youtube.downloadAudio(YT)],
    ['youtube', 'YouTube — vídeo (!ytmp4)', () => youtube.downloadVideo(YT)],
    ['tiktok', 'TikTok (!tiktok)', () => tiktok.download(TT)],
    ['twitter', 'X/Twitter (!download)', () => twitter.download(TW)],
    ['pinterest', 'Pinterest (!download)', () => social.downloadMedia(PIN, 'pinterest')],
  ];

  let rodou = 0;
  for (const [plat, nome, fn] of testes) {
    if (so && so !== plat) continue;
    rodou++;
    await testarPlataforma(nome, fn);
  }
  if (!rodou) {
    linha('warn', `Nenhum teste para "${alvo}"`, 'use: youtube | tiktok | twitter | pinterest');
  }
}

/* ══════════════════════════ 4. FREIO/ENVIO ══════════════════════════ */

async function envio() {
  titulo('4) SAÍDA (o freio de envio deixa o arquivo sair?)');
  try {
    const guard = require('../utils/sendGuard');
    guard.init();
    const st = guard.stats();
    linha('ok', `Freio ativo — fila: ${st.queue || 0} • enviadas: ${st.totalSent ?? st.sent ?? 0}`);
    const lim = st.limits || {};
    linha(
      'ok',
      `Limites: ${lim.maxPerMinute}/min total • ${lim.chatMaxPerMinute}/min por conversa • intervalo ${lim.chatIntervalMs}ms`,
      st.warmup && st.warmup.active
        ? `warmup ATIVO (número recém-pareado): teto reduzido, faltam ${st.warmup.remainingHours}h. ` +
          'Use `!freio warmup off` se o número já é antigo.'
        : 'número aquecido (sem redução de teto)'
    );
    if (st.paused) {
      linha('bad', `Envio PAUSADO por ${st.pauseRemainingMin} min`, 'o freio pausou por sinal de restrição — `!freio retomar`');
    }
    // sequência real de um download (aviso + título + arquivo)
    const jid = '120363000000000000@g.us';
    const t0 = Date.now();
    const tempos = [];
    const fake = (kind) => guard.enqueue(kind, jid, async () => {
      tempos.push(Date.now() - t0);
      return { ok: true };
    });
    await Promise.all([fake('text'), fake('text'), fake('media')]);
    const total = ((Date.now() - t0) / 1000).toFixed(1);
    if (tempos.length === 3 && Date.now() - t0 < 30000) {
      linha('ok', `Sequência de download (aviso + título + arquivo) levou ${total}s`);
    } else {
      linha('bad', `Sequência de download levou ${total}s (o normal é menos de 30s)`, 'o arquivo vai chegar muito atrasado no WhatsApp');
    }
  } catch (e) {
    linha('warn', 'Não consegui testar o freio', e.message);
  }
}

/* ══════════════════════════ VEREDITO ══════════════════════════ */

function veredito() {
  titulo('VEREDITO');
  const ruins = resultados.filter((r) => r.status === 'bad');
  const avisos = resultados.filter((r) => r.status === 'warn');
  if (!ruins.length) {
    console.log(`  ${C.ok}Tudo que dá para testar aqui passou.${C.reset}`);
    console.log('  Se no WhatsApp ainda não chega, o problema é no ENVIO — veja a seção 4.');
    return;
  }
  console.log(`  ${C.bad}${ruins.length} item(ns) com problema:${C.reset}`);
  for (const r of ruins) console.log(`   ${C.bad}✘${C.reset} ${r.titulo}`);
  if (avisos.length) {
    console.log(`  ${C.warn}${avisos.length} aviso(s)${C.reset} (não impedem, mas atrapalham)`);
  }
  console.log(`\n  Guia completo: ${C.bold}DOWNLOAD-TROUBLESHOOTING.md${C.reset}`);
  console.log(`  Manda a saída inteira deste script para o suporte — ela diz exatamente o que falhou.`);
}

/* ══════════════════════════ MAIN ══════════════════════════ */

(async () => {
  console.log(`${C.bold}🌙 LUA — DIAGNÓSTICO DE DOWNLOADS${C.reset}`);
  console.log(`${C.dim}${new Date().toLocaleString('pt-BR')} • ${ROOT}${C.reset}`);
  const alvo = process.argv[2];

  ambiente();
  await rede();
  await downloads(alvo);
  await envio();
  veredito();

  // limpa o que sobrou dos testes
  try {
    require('../utils/download').cleanupTmp(0);
  } catch (_) {}
  process.exit(0);
})().catch((e) => {
  console.error(`\n${C.bad}Erro inesperado no diagnóstico:${C.reset}`, e);
  process.exit(1);
});
