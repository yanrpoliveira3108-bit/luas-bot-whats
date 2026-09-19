/**
 * handlers/autoHandler.js — automações do AutoBot.
 *
 * Aqui vive o "fazer acontecer" de cada recurso de automação. O liga/desliga
 * é do núcleo (utils/autobot.js) — este handler só PERGUNTA "está ligado?" e
 * executa. Todas as automações:
 *
 *   • respeitam limite de frequência por grupo (não viram spam);
 *   • nunca interrompem o pipeline em caso de erro (try/catch + log);
 *   • ignoram admins/dono/bot quando não faz sentido agir;
 *   • podem ser ligadas/desligadas em tempo real (leitura direta do cache).
 *
 * Recursos atendidos:
 *   autofigu        → converte mídia recebida em figurinha
 *   autoresposta    → responde gatilhos cadastrados
 *   simih           → responde tudo (chat automático)
 *   simih2          → responde só quando citado/respondido
 *   iaaleatory      → participa de vez em quando com IA
 *   autobaixar      → baixa mídia de links suportados
 *   x9visaounica    → revela mídia de visualização única
 *   modobrincadeira → reações/respostas de zoeira
 *   aniversario     → felicita aniversariantes (tarefa agendada)
 */

'use strict';

const fs = require('fs');
const CONFIG = require('../config');
const logger = require('../utils/logger').child('autobot');
const groups = require('../database/groups');
const autobot = require('../utils/autobot');
const antiDetect = require('../utils/antiDetect');
const janitor = require('../utils/janitor');
const media = require('../utils/media');
const { unwrapViewOnce, isViewOnce, detectMediaType } = require('../utils/messages');

/* --------------------------- rate limiting ----------------------------- */

const lastRun = new Map(); // "recurso|grupo" -> timestamp
const MAX_KEYS = 5000;

/**
 * Controle de frequência simples por chave.
 * @returns {boolean} true se pode executar agora
 */
function canRun(key, minIntervalMs) {
  const now = Date.now();
  const last = lastRun.get(key) || 0;
  if (now - last < minIntervalMs) return false;
  if (lastRun.size >= MAX_KEYS) lastRun.delete(lastRun.keys().next().value);
  lastRun.set(key, now);
  return true;
}

function sweepRates() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of lastRun) if (v < cutoff) lastRun.delete(k);
}

janitor.register('autobot-rates', sweepRates, 10 * 60 * 1000);

/* ------------------------------ helpers -------------------------------- */

/** Executa uma automação assíncrona sem bloquear o pipeline; rastreável em teste. */
const pending = new Set();

function defer(promise) {
  const p = Promise.resolve(promise)
    .catch((err) => logger.warn({ err: err && err.message }, 'automação falhou'))
    .finally(() => pending.delete(p));
  pending.add(p);
  return p;
}

/** Aguarda todas as automações em voo (usado pelos testes). */
async function flush() {
  while (pending.size) await Promise.all([...pending]);
}

function on(ctx, id) {
  try {
    return autobot.isEnabled(ctx.remoteJid, id);
  } catch (_) {
    return false;
  }
}

const RANDOM_LINES = [
  '👀 olha o papo',
  '😎 isso aí',
  '😂 kkkkk',
  '🤔 interessante...',
  '👏 mandou bem',
  '🍿 tô só assistindo',
  '💀 pesado',
  '🔥 brabo',
];
const RANDOM_REACTIONS = ['😂', '🔥', '👀', '👏', '😎', '💀', '🤔', '🍿'];

/* ------------------------------ autofigu ------------------------------- */

async function autoSticker(sock, ctx) {
  const type = ctx.mediaType || detectMediaType(ctx.message);
  if (type !== 'image' && type !== 'video') return false;
  if (isViewOnce(ctx.message)) return false; // view-once tem fluxo próprio
  if (!canRun(`autofigu|${ctx.remoteJid}`, 4000)) return false;

  try {
    const engine = require('../utils/stickerEngine');
    const stickerMeta = require('../utils/stickerMeta');
    const buffer = await media.downloadMediaBuffer(sock, ctx.message);
    if (!buffer) return false;
    if (buffer.length / (1024 * 1024) > CONFIG.limits.stickerMaxMB) {
      logger.info({ grupo: ctx.remoteJid, mb: (buffer.length / 1048576).toFixed(1) }, '[AUTOFIGU] mídia grande demais — ignorada');
      return false;
    }
    const animated = type === 'video';
    let webp = animated
      ? await engine.videoToWebp(buffer, CONFIG.limits.stickerMaxSeconds)
      : await engine.imageToWebp(buffer);
    const metaInfo = stickerMeta.buildStickerMeta(ctx, {});
    webp = await engine.setStickerMetadata(webp, {
      packname: metaInfo.packname,
      author: metaInfo.author,
      emoji: metaInfo.emoji,
    });
    const check = await engine.validateSticker(webp);
    if (!check.ok) {
      logger.warn({ motivo: check.reason }, '[AUTOFIGU] figurinha inválida — não enviada');
      return false;
    }
    await ctx.sendSticker(webp);
    logger.info({ grupo: ctx.remoteJid, usuario: ctx.sender, animada: animated }, '[AUTOFIGU] figurinha enviada');
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, '[AUTOFIGU] falhou');
    return false;
  }
}

/* ---------------------------- autoresposta ----------------------------- */

function autorespostas(jid) {
  const s = groups.getSettings(jid);
  return Array.isArray(s.autorespostas) ? s.autorespostas : [];
}

function matchAutoresposta(list, text) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return [];
  const out = [];
  for (const item of list) {
    if (!item || !item.q || !item.a) continue;
    if (hay.includes(String(item.q).toLowerCase())) out.push(item.a);
    if (out.length >= 3) break;
  }
  return out;
}

async function autoResponder(ctx) {
  const list = autorespostas(ctx.remoteJid);
  if (!list.length) return false;
  const replies = matchAutoresposta(list, ctx.text);
  if (!replies.length) return false;
  if (!canRun(`autoresposta|${ctx.remoteJid}`, 1500)) return false;
  for (const r of replies) {
    await ctx.reply(String(r)).catch(() => {});
  }
  return true;
}

/* ------------------------- simih / simih2 / IA ------------------------- */

async function aiReply(ctx, prompt, tag) {
  try {
    const router = require('../ai/router');
    const r = await router.ask({
      chatId: ctx.remoteJid,
      userId: ctx.sender,
      text: prompt,
      mode: 'chat',
    });
    if (!r || !r.ok || !r.text) return false;
    await ctx.reply(String(r.text).slice(0, 900)).catch(() => {});
    logger.info({ grupo: ctx.remoteJid, provider: r.provider, tag }, '[AUTOBOT] resposta automática enviada');
    return true;
  } catch (err) {
    logger.warn({ err: err.message, tag }, 'IA automática falhou');
    return false;
  }
}

function looksLikeChat(text) {
  const t = String(text || '').trim();
  if (t.length < 3 || t.length > CONFIG.ai.maxInput) return false;
  if (/^[^\p{L}]+$/u.test(t)) return false; // só emoji/símbolos
  return true;
}

async function simih(ctx) {
  if (!looksLikeChat(ctx.text)) return false;
  if (!canRun(`simih|${ctx.remoteJid}`, 8000)) return false;
  defer(aiReply(ctx, ctx.text, 'simih'));
  return false; // não consome: o resto do pipeline segue
}

async function simih2(ctx) {
  if (!ctx.botAddressed) return false;
  if (!looksLikeChat(ctx.text)) return false;
  if (!canRun(`simih2|${ctx.remoteJid}`, 5000)) return false;
  defer(aiReply(ctx, ctx.text, 'simih2'));
  return false;
}

async function iaAleatory(ctx) {
  const { chance } = autobot.options(ctx.remoteJid, 'iaaleatory');
  const pct = Math.min(50, Math.max(1, Number(chance) || 3));
  if (Math.random() * 100 >= pct) return false;
  if (!looksLikeChat(ctx.text)) return false;
  if (!canRun(`iaaleatory|${ctx.remoteJid}`, 120000)) return false;
  defer(aiReply(ctx, `Comente de forma curta e divertida: "${ctx.text}"`, 'iaaleatory'));
  return false;
}

/* ----------------------------- autobaixar ------------------------------ */

async function autoDownload(sock, ctx) {
  const text = String(ctx.text || '');
  if (!text) return false;
  const urls = antiDetect.findLinks(text);
  if (!urls.length) return false;

  const router = require('../downloaders/router');
  const url = urls.find((u) => router.platformOf(u));
  if (!url) return false;
  if (!canRun(`autobaixar|${ctx.remoteJid}`, 30000)) return false;

  let file = null;
  try {
    const out = await router.download(url);
    file = out && out.path;
    if (!file || !fs.existsSync(file)) return false;
    const size = fs.statSync(file).size;
    if (size / (1024 * 1024) > CONFIG.limits.maxUploadMB) {
      logger.info({ grupo: ctx.remoteJid, mb: (size / 1048576).toFixed(1) }, '[AUTOBAIXAR] arquivo grande demais');
      return false;
    }
    const buffer = await fs.promises.readFile(file);
    const caption = `📥 *${String(out.title || 'Mídia').slice(0, 120)}*\n▸ ${out.platform} • ${(size / 1048576).toFixed(2)} MB`;
    if (out.isVideo) await ctx.sendVideo(buffer, caption, { mimetype: out.mimetype || 'video/mp4' });
    else await ctx.sendAudio(buffer, { mimetype: out.mimetype || 'audio/mp4', ptt: false });
    logger.info({ grupo: ctx.remoteJid, plataforma: out.platform }, '[AUTOBAIXAR] mídia enviada');
    return true;
  } catch (err) {
    logger.warn({ err: err.message, url }, '[AUTOBAIXAR] falhou');
    return false;
  } finally {
    if (file) {
      try {
        require('../utils/download').deleteFile(file);
      } catch (_) {}
    }
  }
}

/* --------------------------- x9 visão única ---------------------------- */

async function revealViewOnce(ctx) {
  if (!canRun(`x9vu|${ctx.remoteJid}`, 3000)) return false;
  try {
    const inner = unwrapViewOnce(ctx.message.message);
    const type = detectMediaType({ message: inner });
    let buffer = null;
    if (type === 'image') buffer = await media.downloadMediaBuffer(ctx.socket, { message: inner }, 'image');
    else if (type === 'video') buffer = await media.downloadMediaBuffer(ctx.socket, { message: inner }, 'video');
    else if (type === 'audio') buffer = await media.downloadMediaBuffer(ctx.socket, { message: inner }, 'audio');
    else return false;
    if (!buffer) return false;

    const from = `@${String(ctx.sender).split('@')[0]}`;
    if (type === 'image') await ctx.sendImage(buffer, `👁️ Visualização única de ${from} revelada.`, { mentions: [ctx.sender] });
    else if (type === 'video') await ctx.sendVideo(buffer, `👁️ Visualização única de ${from} revelada.`, { mimetype: 'video/mp4', mentions: [ctx.sender] });
    else await ctx.sendAudio(buffer, { mimetype: 'audio/ogg; codecs=opus', ptt: true });
    logger.info({ grupo: ctx.remoteJid, usuario: ctx.sender }, '[X9-VU] visualização única revelada');
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, '[X9-VU] falhou ao revelar');
    return false;
  }
}

/* -------------------------- modo brincadeira --------------------------- */

async function funnyMode(ctx) {
  if (!canRun(`brincadeira|${ctx.remoteJid}`, 90000)) return false;
  if (Math.random() > 0.06) return false;
  try {
    if (Math.random() < 0.6) {
      const emoji = RANDOM_REACTIONS[Math.floor(Math.random() * RANDOM_REACTIONS.length)];
      await ctx.react(emoji);
    } else {
      const line = RANDOM_LINES[Math.floor(Math.random() * RANDOM_LINES.length)];
      await ctx.reply(line);
    }
    return true;
  } catch (_) {
    return false;
  }
}

/* ------------------------------ pipeline ------------------------------- */

/**
 * Roda as automações do AutoBot para a mensagem.
 * @param {object} sock socket
 * @param {object} ctx contexto
 * @param {object} [opts] { isCommand:boolean }
 * @returns {Promise<boolean>} true se a mensagem foi consumida
 */
async function process(sock, ctx, opts = {}) {
  if (!ctx || !ctx.isGroup) return false;
  if (ctx.isBot) return false;
  const isCommand = !!opts.isCommand;

  try {
    // visão única: revela mesmo se for comando citando a mídia
    if (on(ctx, 'x9visaounica') && isViewOnce(ctx.message)) {
      if (await revealViewOnce(ctx)) return true;
    }
    if (isCommand) return false; // abaixo só faz sentido para mensagens comuns

    if (on(ctx, 'autofigu') && (ctx.mediaType || detectMediaType(ctx.message))) {
      if (await autoSticker(sock, ctx)) return true;
    }
    if (on(ctx, 'autobaixar') && (await autoDownload(sock, ctx))) return true;
    if (on(ctx, 'autoresposta') && (await autoResponder(ctx))) return true;
    if (on(ctx, 'simih')) await simih(ctx);
    if (on(ctx, 'simih2')) await simih2(ctx);
    if (on(ctx, 'iaaleatory')) await iaAleatory(ctx);
    if (on(ctx, 'modobrincadeira')) await funnyMode(ctx);
  } catch (err) {
    logger.warn({ err: err.message }, 'falha no autoHandler');
  }
  return false;
}

/* ---------------------------- aniversários ----------------------------- */

/**
 * Felicita os aniversariantes do dia nos grupos em que eles estão.
 * Roda como tarefa agendada (janitor) — 1 vez por dia por pessoa.
 */
async function tickBirthdays(sock) {
  if (!sock || !autobot.isEnabled(null, 'aniversario')) return 0;
  const birthday = require('../utils/birthday');
  const isoDay = new Date().toISOString().slice(0, 10);
  let sent = 0;
  for (const row of birthday.today()) {
    if (!birthday.canAnnounce(row, isoDay)) continue;
    const jid = row.user_id;
    const where = groups.groupsOfMember(jid);
    if (!where.length) {
      birthday.markAnnounced(jid, isoDay);
      continue;
    }
    const u = require('../database/users').get(jid);
    const name = (u && u.name) || String(jid).split('@')[0];
    for (const gid of where) {
      try {
        await sock.sendMessage(
          gid,
          {
            text: `🎂🎉 *FELIZ ANIVERSÁRIO!* 🎉🎂\n\nHoje é o dia de @${String(jid).split('@')[0]} (*${name}*)!\n▸ Parabéns, muitas felicidades e saúde! 🥳🎈`,
            mentions: [jid],
          }
        );
        sent++;
      } catch (err) {
        logger.warn({ err: err.message, grupo: gid }, '[ANIVERSARIO] falha ao avisar');
      }
    }
    birthday.markAnnounced(jid, isoDay);
  }
  if (sent) logger.info({ enviados: sent }, '[ANIVERSARIO] felicitações enviadas');
  return sent;
}

janitor.register(
  'aniversario',
  () => {
    try {
      const connection = require('../connection/connect');
      const sock = connection.getSocket();
      if (sock) tickBirthdays(sock);
    } catch (_) {}
  },
  30 * 60 * 1000
);

module.exports = {
  process,
  flush,
  tickBirthdays,
  autoSticker,
  autoResponder,
  autoDownload,
  revealViewOnce,
  funnyMode,
  simih,
  simih2,
  iaAleatory,
  autorespostas,
  matchAutoresposta,
  canRun,
  sweepRates,
};
