/**
 * utils/pingHtml.js — central de diagnóstico HTML do LUA (usada pelo !ping2).
 *
 * Baseado na arquitetura do ping.html.js fornecido (HTML interativo com
 * gráfico de latência), adaptado à identidade LUA (roxo neon + preto AMOLED
 * + detalhes lunares) e ao motor @lucasmod/boruto-vk7-baileys:
 *
 *   - usa socket.relayMessage com a MESMA estrutura comprovada do utils/richHtml.js
 *     (botForwardedMessage → richResponseMessage + contextInfo de bot IA), a
 *     mesma que o card do !tigrinho usa e que o WhatsApp renderiza;
 *   - tema vem do preset ativo (config/themes.js);
 *   - avatar/logo com fallback automático;
 *   - nunca lança para o chamador (sendHtmlPing retorna true/false);
 *   - o JS do HTML é autocontido e encerra sozinho (nenhum timer persistente).
 */

'use strict';

const os = require('os');

const theme = require('./theme');
const richHtml = require('./richHtml');

/* ------------------------- helpers do sistema ------------------------ */

async function getBase64FromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('data:image')) return url;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    if (!cpu || !cpu.times) continue;
    idle += Number(cpu.times.idle || 0);
    for (const type in cpu.times) total += Number(cpu.times[type] || 0);
  }
  return { idle, total };
}

async function getCpuUsage() {
  const before = cpuSnapshot();
  await new Promise((r) => setTimeout(r, 100));
  const after = cpuSnapshot();
  const idle = after.idle - before.idle;
  const total = after.total - before.total;
  if (total <= 0) return 0;
  const usage = 100 - (idle / total) * 100;
  return Math.max(0, Math.min(100, Number(usage.toFixed(1))));
}

function getRam() {
  const memory = process.memoryUsage();
  const used = memory.rss / 1024 / 1024;
  const total = os.totalmem() / 1024 / 1024;
  const percent = total > 0 ? (used / total) * 100 : 0;
  return {
    usedNum: used,
    used: `${used.toFixed(1)} MB`,
    total: `${(total / 1024).toFixed(1)} GB`,
    percent: `${percent.toFixed(1)}%`,
  };
}

function getUptimeSeconds() {
  return Math.floor(process.uptime());
}

function formatUptime(seconds) {
  let sec = Math.floor(seconds);
  const days = Math.floor(sec / 86400); sec %= 86400;
  const hours = Math.floor(sec / 3600); sec %= 3600;
  const minutes = Math.floor(sec / 60); sec %= 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (sec || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(' ');
}

function getDateInfo() {
  const now = new Date();
  const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  return {
    data: now.toLocaleDateString('pt-BR'),
    dia: days[now.getDay()],
    hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

function getBaileys() {
  try {
    const pkg = require('@lucasmod/boruto-vk7-baileys/package.json');
    return pkg && pkg.version ? `v${pkg.version}` : 'Baileys';
  } catch (_) {
    return 'Baileys';
  }
}

function getPlatform() {
  const platforms = { linux: 'Linux', win32: 'Windows', darwin: 'macOS', android: 'Android' };
  return platforms[os.platform()] || os.platform();
}

/* ------------------------- HTML (tema LUA) --------------------------- */

function buildPingHtml(data = {}) {
  const c = theme.colors(data.theme);
  const usuario = escapeHtml(data.usuario || 'Usuário');
  const rawPingNum = parseInt(String(data.ping || data.latencia || '15').replace(/\D/g, '')) || 15;
  const rawCpuNum = parseFloat(String(data.cpuNum ?? data.cpu ?? '0')) || 0;
  const rawRamNum = parseFloat(String(data.ramNum ?? data.ram ?? '0')) || 0;
  const initialUptime = Number(data.uptimeSeconds ?? getUptimeSeconds()) || 0;

  const ping = escapeHtml(data.ping ?? `${rawPingNum}ms`);
  const comandos = escapeHtml(data.totalcmd ?? data.comandos ?? '0');
  const baileys = escapeHtml(data.baileys || getBaileys());
  const plataforma = escapeHtml(data.plataforma || getPlatform());
  const node = escapeHtml(data.node || process.version);
  const dataAtual = escapeHtml(data.data || '');
  const logo = escapeHtml(data.logo || '');
  const fotoUser = escapeHtml(data.fotoUser || '');
  const ramTotal = escapeHtml(data.ramTotal || '0 GB');

  const logoVisual = logo
    ? `<img src="${logo}" class="main-logo" alt="">`
    : `<div class="main-logo default-logo">🌙</div>`;

  const fotoVisual = fotoUser
    ? `<img src="${fotoUser}" class="avatar" alt="">`
    : `<div class="avatar avatar-fallback">👤</div>`;

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LUA · System Ping</title>
<style>
* { box-sizing: border-box; }
html, body {
margin: 0; padding: 0; width: 100%;
background: ${c.bgAmoled};
color: ${c.textPrimary};
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
body { display: flex; justify-content: center; padding: 4px; }
.panel {
width: 100%; max-width: 480px; padding: 8px 10px;
border-radius: 14px;
background: linear-gradient(145deg, ${c.card}, ${c.bg});
border: 1px solid ${c.primaryDark};
position: relative; overflow: hidden;
}
.progress-container {
width: 100%; height: 3px; background: rgba(255,255,255,.08);
border-radius: 2px; margin-bottom: 6px; overflow: hidden;
}
.progress-bar {
height: 100%; width: 100%;
background: linear-gradient(90deg, ${c.primaryLight}, ${c.neon});
box-shadow: 0 0 8px ${c.primaryLight};
transform-origin: left;
}
.header {
width: 100%; display: flex; align-items: center; justify-content: space-between;
padding: 6px 10px; border-radius: 10px;
background: ${c.bgSecondary}; border: 1px solid ${c.primaryDark};
}
.brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.small-logo {
width: 28px; height: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
border-radius: 8px; background: linear-gradient(145deg, ${c.primaryLight}, ${c.primaryDark});
color: #fff; font-size: 14px;
}
.title { font-size: 13px; font-weight: 800; color: ${c.accent}; line-height: 1.1; }
.subtitle { font-size: 8px; letter-spacing: 1.2px; color: ${c.primaryLight}; opacity: .85; }
.status { flex-shrink: 0; font-size: 8px; font-weight: 800; color: ${c.primaryLight}; display: flex; align-items: center; gap: 4px; }
.status-dot { width: 6px; height: 6px; background-color: ${c.neon}; border-radius: 50%; animation: pulseDot 1.2s infinite alternate; }
@keyframes pulseDot { 0% { opacity: .3; transform: scale(.8); } 100% { opacity: 1; transform: scale(1.2); box-shadow: 0 0 6px ${c.neon}; } }
.hero-compact { display: flex; align-items: center; justify-content: space-between; padding: 6px 4px; }
.hero-user { display: flex; align-items: center; gap: 8px; min-width: 0; }
.avatar { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; border: 1.5px solid ${c.primary}; background: ${c.card}; }
.avatar-fallback { display: flex; align-items: center; justify-content: center; color: ${c.accent}; font-size: 14px; }
.username { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 800; color: ${c.textPrimary}; }
.logo-box { width: 34px; height: 34px; padding: 2px; border-radius: 50%; background: linear-gradient(135deg, ${c.primaryLight}, ${c.primaryDark}); box-shadow: 0 0 10px ${c.glow}; flex-shrink: 0; }
.main-logo { width: 100%; height: 100%; display: block; border-radius: 50%; object-fit: cover; }
.default-logo { display: flex; align-items: center; justify-content: center; background: ${c.card}; color: ${c.accent}; font-size: 16px; }
.date-text { font-size: 8px; color: ${c.textSecondary}; opacity: .85; }
.graph-card { width: 100%; height: 36px; background: ${c.bgSecondary}; border-radius: 8px; border: 1px solid ${c.primaryDark}; margin-bottom: 6px; padding: 2px; position: relative; overflow: hidden; }
canvas#pingChart { width: 100%; height: 100%; display: block; }
.grid { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.card { min-width: 0; padding: 5px 8px; border-radius: 8px; background: ${c.bgSecondary}; border: 1px solid ${c.primaryDark}; }
.card-title { font-size: 7px; font-weight: 800; letter-spacing: 1px; color: ${c.primaryLight}; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-top: 3px; }
.label { flex-shrink: 0; font-size: 8px; color: ${c.textSecondary}; }
.value { min-width: 0; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-size: 10px; font-weight: 800; color: ${c.textPrimary}; }
.value-highlight { color: ${c.neon}; text-shadow: 0 0 5px ${c.glow}; }
.footer { padding-top: 5px; text-align: center; font-size: 7px; letter-spacing: 1px; color: ${c.textSecondary}; opacity: .55; }
@media (max-width: 360px) { .panel { padding: 6px 8px; } .value { font-size: 9px; } }
</style>
</head>
<body>
<div class="panel">
<div class="progress-container"><div class="progress-bar" id="progressBar"></div></div>
<div class="header">
<div class="brand">
<div class="small-logo">🌙</div>
<div>
<div class="title">🌙 LUA • SYSTEM PING</div>
<div class="subtitle">☾ ${c.tagline}</div>
</div>
</div>
<div class="status" id="statusText"><div class="status-dot"></div><span></span></div>
</div>
<div class="hero-compact">
<div class="hero-user">${fotoVisual}<div><div class="username">${usuario}</div><div class="date-text" id="liveDateTime">${dataAtual} • --:--:--</div></div></div>
<div class="logo-box">${logoVisual}</div>
</div>
<div class="graph-card"><canvas id="pingChart"></canvas></div>
<div class="grid">
<div class="card"><div class="card-title">LATÊNCIA (AO VIVO)</div>
<div class="row"><span class="label">Ping</span><span class="value value-highlight" id="pingValue">${ping}</span></div>
<div class="row"><span class="label">Latência</span><span class="value value-highlight" id="latenciaValue">${ping}</span></div></div>
<div class="card"><div class="card-title">SISTEMA</div>
<div class="row"><span class="label">CPU</span><span class="value" id="cpuValue">${rawCpuNum.toFixed(1)}%</span></div>
<div class="row"><span class="label">RAM</span><span class="value" id="ramValue">${rawRamNum.toFixed(1)} MB</span></div></div>
<div class="card"><div class="card-title">SERVIDOR</div>
<div class="row"><span class="label">Sistema</span><span class="value">${plataforma}</span></div>
<div class="row"><span class="label">Node</span><span class="value">${node}</span></div></div>
<div class="card"><div class="card-title">STATUS</div>
<div class="row"><span class="label">Comandos</span><span class="value">${comandos}</span></div>
<div class="row"><span class="label">Uptime</span><span class="value" id="uptimeValue">...</span></div></div>
<div class="card"><div class="card-title">CONEXÃO</div>
<div class="row"><span class="label">Baileys</span><span class="value">${baileys}</span></div>
<div class="row"><span class="label">Status</span><span class="value" id="connStatus">Testando...</span></div></div>
<div class="card"><div class="card-title">MEMÓRIA</div>
<div class="row"><span class="label">Uso</span><span class="value" id="ramUsage2">${rawRamNum.toFixed(1)} MB</span></div>
<div class="row"><span class="label">Total</span><span class="value">${ramTotal}</span></div></div>
</div>
<div class="footer">☾ LUA • Beyond the ordinary.</div>
</div>
<script>
(function() {
const basePing = ${rawPingNum};
const baseCpu = ${rawCpuNum};
const baseRam = ${rawRamNum};
let currentUptime = ${initialUptime};
const dataAtual = "${dataAtual}";
const duration = 10000;
const startTime = Date.now();

const pingValEl = document.getElementById("pingValue");
const latenciaValEl = document.getElementById("latenciaValue");
const cpuValEl = document.getElementById("cpuValue");
const ramValEl = document.getElementById("ramValue");
const ramValEl2 = document.getElementById("ramUsage2");
const uptimeValEl = document.getElementById("uptimeValue");
const liveDateTimeEl = document.getElementById("liveDateTime");
const statusTextEl = document.getElementById("statusText");
const connStatusEl = document.getElementById("connStatus");
const progressBar = document.getElementById("progressBar");
const canvas = document.getElementById("pingChart");
const ctx = canvas ? canvas.getContext("2d") : null;

let points = Array(30).fill(basePing);

function formatTime(d) { return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function formatUptime(sec) {
let s = Math.floor(sec); const d = Math.floor(s / 86400); s %= 86400;
const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); s %= 60;
const p = []; if (d) p.push(d + "d"); if (h) p.push(h + "h"); if (m) p.push(m + "m");
if (s || p.length === 0) p.push(s + "s"); return p.join(" ");
}

function resizeCanvas() { if (!canvas) return; canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
resizeCanvas();

function drawChart() {
if (!ctx || !canvas) return;
ctx.clearRect(0, 0, canvas.width, canvas.height);
const w = canvas.width, h = canvas.height;
const step = w / (points.length - 1);
const min = Math.min.apply(null, points) - 5, max = Math.max.apply(null, points) + 5;
ctx.beginPath();
ctx.strokeStyle = '${c.chart}';
ctx.lineWidth = 1.5;
points.forEach((pt, i) => {
const x = i * step;
const y = h - ((pt - min) / (max - min || 1)) * (h - 8) - 4;
if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
});
ctx.stroke();
ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
const grad = ctx.createLinearGradient(0, 0, 0, h);
grad.addColorStop(0, '${c.glow}');
grad.addColorStop(1, 'rgba(139,92,246,0)');
ctx.fillStyle = grad; ctx.fill();
}

const timer = setInterval(() => {
const elapsed = Date.now() - startTime;
const remaining = Math.max(0, Math.ceil((duration - elapsed) / 1000));
const progressRatio = Math.max(0, 1 - (elapsed / duration));
const now = new Date();
if (liveDateTimeEl) liveDateTimeEl.textContent = dataAtual + " • " + formatTime(now);
if (uptimeValEl) uptimeValEl.textContent = formatUptime(currentUptime + (elapsed / 1000));
if (progressBar) progressBar.style.transform = "scaleX(" + progressRatio + ")";
if (elapsed < duration) {
const jitterPing = Math.floor(Math.random() * 9) - 4;
const currentPing = Math.max(1, basePing + jitterPing);
const currentCpu = Math.max(0, Math.min(100, Number((baseCpu + (Math.random() * 3 - 1.5)).toFixed(1))));
const jitterRam = Number((baseRam + (Math.random() * 1.2 - 0.6)).toFixed(1));
if (pingValEl) pingValEl.textContent = currentPing + "ms";
if (latenciaValEl) latenciaValEl.textContent = currentPing + "ms";
if (cpuValEl) cpuValEl.textContent = currentCpu + "%";
if (ramValEl) ramValEl.textContent = jitterRam + " MB";
if (ramValEl2) ramValEl2.textContent = jitterRam + " MB";
if (statusTextEl) statusTextEl.querySelector("span").textContent = "(" + remaining + "s)";
if (connStatusEl) connStatusEl.textContent = "Estável";
points.shift(); points.push(currentPing); drawChart();
} else {
clearInterval(timer);
if (progressBar) progressBar.style.transform = "scaleX(0)";
if (pingValEl) pingValEl.textContent = basePing + "ms";
if (latenciaValEl) latenciaValEl.textContent = basePing + "ms";
if (cpuValEl) cpuValEl.textContent = baseCpu + "%";
if (ramValEl) ramValEl.textContent = baseRam + " MB";
if (ramValEl2) ramValEl2.textContent = baseRam + " MB";
if (statusTextEl) statusTextEl.innerHTML = '<div class="status-dot" style="animation:none;background:${c.neon}"></div><span>● FINALIZADO</span>';
if (connStatusEl) connStatusEl.textContent = "Online";
}
}, 150);
})();
</script>
</body>
</html>
`;
}

/* ------------------------- payload do motor -------------------------- */

/**
 * Monta a mensagem `richResponseMessage` do motor atual
 * (AIRichResponseMessage no proto) com o unifiedResponse do HTML primitivo.
 */
/**
 * Monta a mensagem de ping reutilizando a estrutura comprovada do
 * utils/richHtml.js (botForwardedMessage → richResponseMessage +
 * contextInfo.forwardedAiBotMessageInfo). Enviar o `richResponseMessage`
 * "cru" (sem o wrapper botForwardedMessage e sem o contextInfo) NÃO renderiza
 * no WhatsApp — por isso o !tigrinho funcionava e o !ping2 não.
 */
function buildRichMessage(html) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new TypeError('HTML do ping inválido.');
  }
  return richHtml.buildHtmlMessage(html, {
    title: '🌙 LUA • SYSTEM PING',
    trustedSources: ['nixel.dev'],
  });
}

/**
/**
 * Envia o HTML de ping. Nunca lança — retorna true se enviou, false se não.
 */
async function sendHtmlPing(socket, jid, data = {}) {
  try {
    if (!socket || typeof socket.relayMessage !== 'function') return false;
    const cpuNum = await getCpuUsage();
    const ram = getRam();
    const date = getDateInfo();
    const uptimeSeconds = getUptimeSeconds();

    let fotoUser = data.fotoUser || data.foto || null;
    if (!fotoUser && data.sender && typeof socket.profilePictureUrl === 'function') {
      try {
        fotoUser = await socket.profilePictureUrl(data.sender, 'image');
      } catch (_) {
        fotoUser = null;
      }
    }
    if (fotoUser && fotoUser.startsWith('http')) fotoUser = await getBase64FromUrl(fotoUser);

    let logo = data.logo || null;
    if (logo && logo.startsWith('http')) logo = await getBase64FromUrl(logo);

    const finalData = {
      ...data,
      cpuNum,
      ramNum: ram.usedNum,
      ramTotal: data.ramTotal || ram.total,
      uptimeSeconds,
      baileys: data.baileys || getBaileys(),
      plataforma: data.plataforma || getPlatform(),
      node: data.node || process.version,
      fotoUser,
      logo,
      data: data.data || date.data,
    };

    const html = buildPingHtml(finalData);
    const message = buildRichMessage(html);
    // padrão comprovado (cobrinha.js / ping.html.js): botForwardedMessage + {}
    await socket.relayMessage(jid, message, {});
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  buildPingHtml,
  buildRichMessage,
  sendHtmlPing,
  getBaileys,
  getPlatform,
  getRam,
  getCpuUsage,
  getUptimeSeconds,
  formatUptime,
  getDateInfo,
};
