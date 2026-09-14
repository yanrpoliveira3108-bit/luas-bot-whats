/**
 * commands/games/tigrinho.js — 🐯 LUA TIGRINHO.
 *
 * Minigame arcade de caça-níquel com FICHAS VIRTUAIS (economia interna de
 * jogo, sem valor monetário, sem compra/venda/saque/conversão).
 *
 * Arquitetura (segue o padrão do Lua, sem reescrever nada):
 *   - lógica pura  → utils/tigrinhoGame.js   (config, pesos, resultado)
 *   - storage      → database/tigrinho.js    (fichas, histórico, ranking)
 *   - interface    → este arquivo            (HTML visual + fallback textual)
 *   - envio HTML   → utils/richHtml.js       (relayMessage, mesmo padrão do
 *                                              cobrinha.js de referência)
 *
 * O resultado é SEMPRE calculado no backend (spinReels/computeReward) e salvo
 * atomicamente (applySpin). A interface HTML é apenas apresentação/animacão
 * (modo demonstração, pois o card não tem canal de volta ao bot).
 *
 * Comandos:
 *   {prefix}tigrinho                       → interface visual
 *   {prefix}tigrinho jogar [aposta|tudo]   → girar (backend)
 *   {prefix}tigrinho fichas                → saldo/estatísticas
 *   {prefix}tigrinho historico             → últimos giros
 *   {prefix}tigrinho ranking               → melhores jogadores
 *   {prefix}tigrinho ajuda                 → regras
 */

'use strict';

const CONFIG = require('../../config');
const {
  TIGRINHO_CONFIG,
  spinReels,
  computeReward,
  renderGridText,
  formatChips,
} = require('../../utils/tigrinhoGame');
const store = require('../../database/tigrinho');
const richHtml = require('../../utils/richHtml');
const logger = require('../../utils/logger').child('tigrinho');

logger.info('[LUA TIGRINHO] Plugin carregado');

const SUBCMD = {
  jogar: ['jogar', 'girar', 'spin', 'play', 'rodar'],
  fichas: ['fichas', 'saldo', 'balance', 'chips', 'creditos'],
  historico: ['historico', 'history', 'hist', 'giros'],
  ranking: ['ranking', 'rank', 'top'],
  ajuda: ['ajuda', 'help', 'regras', 'como'],
};

function subcommand(ctx) {
  const a = String(ctx.args[0] || '').toLowerCase().trim();
  for (const [key, aliases] of Object.entries(SUBCMD)) {
    if (aliases.includes(a)) return key;
  }
  return a; // '' ou desconhecido
}

/* ------------------------------------------------------------------ */
/*  Interface visual (HTML) — mesma base arcade da referência          */
/* ------------------------------------------------------------------ */

function buildMachineHtml({ chips, jackpots, prefix }) {
  const c = Number(chips) || 0;
  const j = Number(jackpots) || 0;
  return `<style>
*{-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;box-sizing:border-box}
body{margin:0;background:transparent;font-family:Arial,sans-serif;color:#f5d06a;touch-action:manipulation}
.wrap{width:100%;max-width:560px;margin:auto;padding:12px}
.card{background:linear-gradient(160deg,#150a04,#1f0c06 45%,#120803);border:1px solid rgba(245,183,40,.35);border-radius:18px;overflow:hidden;box-shadow:0 0 34px rgba(245,150,20,.18),0 10px 34px rgba(0,0,0,.6)}
.head{padding:14px 18px;border-bottom:1px solid rgba(245,183,40,.25);display:flex;justify-content:space-between;align-items:center;gap:10px;background:linear-gradient(135deg,rgba(139,0,0,.4),rgba(245,183,40,.06))}
.brand{font-size:9px;letter-spacing:1.6px;color:rgba(245,183,40,.75);text-transform:uppercase;font-weight:bold}
.title{font-size:17px;font-weight:bold;color:#f5b728;text-shadow:0 0 10px rgba(245,183,40,.55)}
.stats{display:flex;gap:14px;text-align:right}
.value{font:700 17px monospace;color:#ffd54a;text-shadow:0 0 12px rgba(255,190,40,.45)}
.label{font-size:8px;color:rgba(245,183,40,.6);letter-spacing:1px;text-transform:uppercase}
.main{padding:16px}
.machine{position:relative;background:radial-gradient(120% 120% at 50% 0%,rgba(139,0,0,.3),rgba(0,0,0,.74));border:2px solid rgba(245,183,40,.45);border-radius:16px;padding:18px 10px 16px;margin-bottom:16px;box-shadow:inset 0 0 26px rgba(139,0,0,.35),0 0 24px rgba(245,150,20,.22)}
.badge{position:absolute;top:8px;right:10px;font-size:8px;letter-spacing:1px;color:rgba(245,183,40,.6);text-transform:uppercase;background:rgba(0,0,0,.45);padding:2px 6px;border-radius:6px;border:1px solid rgba(245,183,40,.3)}
.reels{display:flex;gap:8px;justify-content:center}
.reel{flex:1;max-width:104px;background:rgba(0,0,0,.55);border:1px solid rgba(245,183,40,.35);border-radius:12px;padding:6px 0;box-shadow:inset 0 0 14px rgba(0,0,0,.6)}
.cell{height:54px;display:flex;align-items:center;justify-content:center;font-size:34px;line-height:1}
.reel.stop .cell{animation:pop .18s ease}
@keyframes pop{0%{transform:scale(1.5)}100%{transform:scale(1)}}
.machine.win .reels{animation:glow .6s ease 2}
.machine.jackpot .reels{animation:jackglow .5s ease 4}
@keyframes glow{0%,100%{box-shadow:0 0 0 rgba(255,210,60,0)}50%{box-shadow:0 0 34px rgba(255,210,60,.65)}}
@keyframes jackglow{0%,100%{box-shadow:0 0 0 rgba(255,120,20,0)}50%{box-shadow:0 0 46px rgba(255,150,20,.9)}}
.spin{display:block;width:100%;min-height:46px;border:1px solid rgba(245,183,40,.7);border-radius:12px;color:#fff;font-weight:bold;font-size:15px;letter-spacing:1px;background:linear-gradient(135deg,rgba(245,183,40,.65),rgba(139,0,0,.55));box-shadow:0 0 18px rgba(245,150,20,.45);text-transform:uppercase;cursor:pointer}
.spin:active{transform:scale(.98)}
.status{text-align:center;font:10px monospace;color:rgba(245,183,40,.65);margin-top:12px;min-height:12px;text-transform:uppercase;letter-spacing:.6px}
.foot{padding:10px 16px;border-top:1px solid rgba(245,183,40,.18);font-size:10px;color:rgba(245,183,40,.55);text-align:center;background:rgba(0,0,0,.35)}
.foot b{color:#f5b728}
</style><body><div class="wrap"><div class="card">
<div class="head"><div><div class="brand">⚜ Lua Arcade</div><div class="title">🐯 LUA TIGRINHO</div></div><div class="stats"><div><div class="label">FICHAS</div><div class="value" id="chips">${c}</div></div><div><div class="label">JACKPOTS</div><div class="value" id="jackpots">${j}</div></div></div></div>
<div class="main"><div class="machine" id="machine"><div class="badge">Modo demonstração</div>
<div class="reels">
<div class="reel" id="reel0"><div class="cell">🍒</div><div class="cell">🔔</div><div class="cell">👑</div></div>
<div class="reel" id="reel1"><div class="cell">💎</div><div class="cell">🍋</div><div class="cell">🍊</div></div>
<div class="reel" id="reel2"><div class="cell">🐯</div><div class="cell">🍒</div><div class="cell">🔔</div></div>
</div></div>
<button class="spin" id="spin">🎰 GIRAR</button>
<div class="status" id="status">TOQUE EM GIRAR</div></div>
<div class="foot">🎟️ Valendo fichas reais: <b>${prefix}tigrinho jogar</b> · ${prefix}tigrinho fichas · ${prefix}tigrinho ranking</div>
</div></div><script>
(function(){
var SYM=['🍒','🍋','🍊','🔔','💎','👑','🐯'];
var chips=${c},jackpots=${j},spinning=false;
var machine=document.getElementById('machine');
var reels=[document.getElementById('reel0'),document.getElementById('reel1'),document.getElementById('reel2')];
var spinBtn=document.getElementById('spin');
var statusEl=document.getElementById('status');
var audioCtx=null;
function getAudio(){if(!audioCtx){try{audioCtx=new (window.AudioContext||window.webkitAudioContext)()}catch(e){audioCtx=null}}return audioCtx}
function beep(freq,dur,type,vol){var ac=getAudio();if(!ac)return;var o=ac.createOscillator();var g=ac.createGain();o.type=type||'square';o.frequency.value=freq;g.gain.value=vol||0.07;o.connect(g);g.connect(ac.destination);var t=ac.currentTime;g.gain.setValueAtTime(g.gain.value,t);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);o.start(t);o.stop(t+dur)}
function playClick(){beep(520,0.06,'square',0.07)}
function playSpin(){beep(240,0.5,'sawtooth',0.06)}
function playStop(){beep(660,0.07,'square',0.07)}
function playWin(){beep(660,0.09,'square',0.08);setTimeout(function(){beep(880,0.09,'square',0.08)},80);setTimeout(function(){beep(1320,0.14,'square',0.08)},160)}
function playJackpot(){var n=[523,659,784,1047,1319];n.forEach(function(f,i){setTimeout(function(){beep(f,0.16,'square',0.09)},i*110)})}
function randSym(){return SYM[Math.floor(Math.random()*SYM.length)]}
function setStatus(t){statusEl.textContent=t}
function rollReel(reel,cb){
  var cells=reel.querySelectorAll('.cell');
  var frames=10+Math.floor(Math.random()*8);
  var i=0;
  var iv=setInterval(function(){
    i++;
    cells[0].textContent=cells[1].textContent;
    cells[1].textContent=cells[2].textContent;
    cells[2].textContent=randSym();
    if(i>=frames){clearInterval(iv);cb()}
  },55);
}
function gridEmojis(){
  return reels.map(function(r){return [].slice.call(r.querySelectorAll('.cell')).map(function(c){return c.textContent})});
}
function afterSpin(){
  spinning=false;
  var g=gridEmojis();
  var win=false,jack=false;
  for(var r=0;r<3;r++){
    var a=g[0][r],b=g[1][r],c=g[2][r];
    if(a===b&&b===c){win=true;if(a==='🐯')jack=true}
    else if(a===b||b===c||a===c){win=true}
  }
  machine.classList.remove('win','jackpot');
  if(jack){machine.classList.add('jackpot');playJackpot();setStatus('🐯 JACKPOT (DEMO)')}
  else if(win){machine.classList.add('win');playWin();setStatus('✨ GANHOU (DEMO)')}
  else{setStatus('😿 TENTE DE NOVO (DEMO)')}
}
function spin(){
  if(spinning)return;
  spinning=true;playSpin();
  machine.classList.remove('win','jackpot');
  reels.forEach(function(r){r.classList.remove('stop')});
  setStatus('GIRANDO...');
  var done=0;
  reels.forEach(function(reel,idx){
    setTimeout(function(){
      rollReel(reel,function(){
        playStop();reel.classList.add('stop');done++;
        if(done===reels.length)afterSpin();
      });
    },idx*330);
  });
}
spinBtn.addEventListener('pointerdown',function(e){e.preventDefault();spin()});
machine.addEventListener('pointerdown',function(){playClick()});
document.addEventListener('keydown',function(e){if(e.key===' '||e.key==='Space'||e.key==='Enter'){e.preventDefault();spin()}});
setStatus('TOQUE EM GIRAR');
})();
</script></body>`;
}

/* ------------------------------------------------------------------ */
/*  Handlers dos subcomandos                                           */
/* ------------------------------------------------------------------ */

async function handleSpin(ctx, prefix) {
  const player = store.getPlayer(ctx.sender);

  // cooldown individual (timestamp)
  const cd = store.canSpin(ctx.sender);
  if (!cd.allowed) {
    const s = Math.max(1, Math.ceil(cd.remaining / 100) / 10);
    return ctx.reply(`⏳ Calma, tigre! Aguarde ${s}s para girar de novo.`);
  }

  // aposta
  const arg = String(ctx.args[1] || '').toLowerCase().trim();
  let bet = TIGRINHO_CONFIG.betCost;
  if (arg === 'tudo' || arg === 'all') {
    bet = player.balance;
  } else if (arg) {
    const n = parseInt(ctx.args[1], 10);
    if (!Number.isFinite(n) || n <= 0) {
      return ctx.reply(`⚠️ Use: ${prefix}tigrinho jogar [aposta]  (ex.: ${prefix}tigrinho jogar 50)`);
    }
    bet = n;
  }
  if (bet < 1) bet = 1;
  if (bet > player.balance) {
    return ctx.reply(`❌ Fichas insuficientes. Você tem ${formatChips(player.balance)} fichas.`);
  }

  logger.info({ user: ctx.sender, bet }, '[LUA TIGRINHO] Giro solicitado');

  const grid = spinReels();
  const { reward, jackpot, mult } = computeReward(bet, grid);
  const won = reward > 0;
  const res = store.applySpin(ctx.sender, {
    bet,
    reward,
    reels: grid.map((col) => col.map((s) => s.emoji)),
    jackpot,
    won,
  });

  logger.info({ user: ctx.sender, bet, reward, jackpot, balance: res.balance }, '[LUA TIGRINHO] Resultado gerado');

  const lines = ['🐯 *LUA TIGRINHO*', renderGridText(grid), '', `▸ Aposta: ${formatChips(bet)} fichas`];
  if (jackpot) lines.push(`🎉🐯 *JACKPOT!* Você ganhou ${formatChips(reward)} fichas!`);
  else if (won) lines.push(`✨ Você ganhou ${formatChips(reward)} fichas! (x${mult})`);
  else lines.push('😿 Não foi dessa vez. Tente de novo!');
  lines.push(`💰 Fichas: ${formatChips(res.balance)}`);
  lines.push(`_${prefix}tigrinho para a interface visual._`);
  await ctx.reply(lines.join('\n'));
}

async function handleChips(ctx) {
  const p = store.getPlayer(ctx.sender);
  await ctx.reply(
    [
      '🐯 *LUA TIGRINHO — FICHAS*',
      `💰 Fichas: ${formatChips(p.balance)}`,
      `🎰 Giros: ${p.spins}`,
      `🏆 Vitórias: ${p.wins}  ·  💔 Derrotas: ${p.losses}`,
      `🐯 Jackpots: ${p.jackpots}`,
      `📈 Maior prêmio: ${formatChips(p.best_win)} fichas`,
    ].join('\n')
  );
}

async function handleHistory(ctx) {
  const hist = store.getHistory(ctx.sender);
  if (!hist.length) return ctx.reply('📜 Você ainda não girou. Use !tigrinho jogar.');
  const lines = hist.map((h, i) => {
    let grid;
    try {
      grid = JSON.parse(h.reels); // [col][row] de emojis
    } catch (_) {
      grid = [];
    }
    const rowText = grid.length
      ? grid[0].map((_, r) => grid.map((c) => c[r]).join(' ')).join(' │ ')
      : '?';
    const prize = h.reward > 0 ? `+${formatChips(h.reward)}` : '0';
    return `${i + 1}. ${rowText}  →  ${prize}${h.jackpot ? ' 🐯' : ''}`;
  });
  await ctx.reply('🐯 *TIGRINHO — HISTÓRICO*\n' + lines.join('\n'));
}

async function handleRanking(ctx) {
  const rank = store.getRanking();
  if (!rank.length) return ctx.reply('🏆 Ranking vazio. Seja o primeiro a jogar!');
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rank.map((r, i) => {
    const name = String(r.name || '').split('@')[0].slice(0, 20) || 'jogador';
    const pos = medals[i] || `${i + 1}º`;
    return `${pos} ${name} — ${formatChips(r.balance)} fichas${r.jackpots ? ' 🐯' : ''}`;
  });
  await ctx.reply('🏆 *LUA TIGRINHO — RANKING*\n' + lines.join('\n'));
}

async function handleHelp(ctx, prefix) {
  const R = TIGRINHO_CONFIG.rewards;
  await ctx.reply(
    [
      '🐯 *LUA TIGRINHO — AJUDA*',
      'Caça-níquel de _fichas virtuais_ (sem valor real).',
      '',
      '🎰 *Prêmios (x aposta)*',
      R.jackpot,
      R.crown,
      R.diamond,
      R.bell,
      R.cherry,
      R.lemon,
      R.orange,
      R.pair,
      '',
      `▸ ${prefix}tigrinho  → interface visual`,
      `▸ ${prefix}tigrinho jogar [aposta|tudo]  → girar`,
      `▸ ${prefix}tigrinho fichas  → saldo/estatísticas`,
      `▸ ${prefix}tigrinho historico  → últimos giros`,
      `▸ ${prefix}tigrinho ranking  → melhores`,
    ].join('\n')
  );
}

async function handleOpen(ctx, prefix) {
  const p = store.getPlayer(ctx.sender);
  logger.info({ user: ctx.sender }, '[LUA TIGRINHO] Interface aberta');
  try {
    await richHtml.sendHtml(ctx.socket, ctx.remoteJid, buildMachineHtml({
      chips: p.balance,
      jackpots: p.jackpots,
      prefix,
    }));
  } catch (err) {
    // fallback textual (cliente sem suporte ao card HTML)
    logger.warn({ err: (err && err.message) || String(err) }, '[LUA TIGRINHO] HTML falhou — usando fallback textual');
    await ctx.reply(
      [
        '🐯 *LUA TIGRINHO*',
        `💰 Fichas: ${formatChips(p.balance)}`,
        '',
        `▸ ${prefix}tigrinho jogar [aposta]  → girar`,
        `▸ ${prefix}tigrinho fichas  → saldo`,
        `▸ ${prefix}tigrinho historico  → últimos giros`,
        `▸ ${prefix}tigrinho ranking  → melhores`,
        `▸ ${prefix}tigrinho ajuda  → regras`,
      ].join('\n')
    );
  }
}

/* ------------------------------------------------------------------ */

module.exports = [
  {
    name: 'tigrinho',
    commands: ['tigrinho'],
    category: 'games',
    description: '🐯 Caça-níquel arcade de fichas virtuais.',
    usage: '!tigrinho [jogar|fichas|historico|ranking|ajuda]',
    cooldown: 2000,
    execute: async (ctx) => {
      const prefix = ctx.prefix || CONFIG.bot.prefix || '!';
      const sub = subcommand(ctx);
      try {
        if (!sub) return await handleOpen(ctx, prefix);
        switch (sub) {
          case 'jogar':
            return await handleSpin(ctx, prefix);
          case 'fichas':
            return await handleChips(ctx);
          case 'historico':
            return await handleHistory(ctx);
          case 'ranking':
            return await handleRanking(ctx);
          case 'ajuda':
            return await handleHelp(ctx, prefix);
          default:
            return await handleHelp(ctx, prefix);
        }
      } catch (err) {
        logger.error({ err: (err && err.message) || String(err), sub }, '[LUA TIGRINHO] Erro');
        await ctx.reply('⚠️ Algo deu errado no tigrinho. Tente de novo em instantes.');
      }
    },
  },
];
