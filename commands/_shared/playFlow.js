/**
 * commands/_shared/playFlow.js — Fluxo unificado, seguro e estável do comando Play.
 *
 * Etapas:
 * 1. Apresentação inicial padronizada:
 *    - Cabeçalho "LUA • PLAY", divisórias discretas, opções destacadas com Duração real.
 *    - Sem estatísticas falsas, sem links, sem comando de letra ou descrição longa no início.
 * 2. Seleção de resultado via botões interativos ou comando numérico / texto:
 *    - Validação de sessão: autor, conversa, expiração, duplo clique.
 *    - Opções para Áudio (🎵), Vídeo (🎬) e Link (🔗).
 * 3. Envio da mídia com confirmação da biblioteca Baileys:
 *    - Download sob demanda somente da música selecionada.
 *    - Verificação de tamanho durante o streaming e timeout.
 * 4. Mensagem complementar pós-envio:
 *    - Nome da música
 *    - Link: "<URL original>"
 *    - Letra: "{prefix}letra <URL original>"
 *    - Se o usuário pedir apenas o link, envia o bloco diretamente sem download.
 */

'use strict';

const youtube = require('../../downloaders/youtube');
const playPresentation = require('../../utils/playPresentation');
const playSession = require('../../utils/playSession');
const urlSecurity = require('../../utils/urlSecurity');
const downloadQueue = require('../../utils/downloadQueue');
const buttonHandler = require('../../handlers/buttonHandler');
const numberFallback = require('../../utils/numberFallback');
const { sendAudioResult, sendVideoResult } = require('./downloads');
const { dicaBuscaVazia } = require('./searchHint');
const interactive = require('../../utils/interactive');
const CONFIG = require('../../config');
const logger = require('../../utils/logger').child('play');

function canonicalTrackKey(rawUrl) {
  try {
    const u = new URL(String(rawUrl));
    if (u.hostname === 'youtu.be') return `yt:${u.pathname.slice(1).split('/')[0]}`;
    if (u.hostname === 'youtube.com' || u.hostname.endsWith('.youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `yt:${id}`;
    }
    u.hash = '';
    u.search = '';
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch (_) {
    return String(rawUrl || '').trim().toLowerCase();
  }
}

function safeProviderTrack(track) {
  if (!track || !track.url) return null;
  const checked = urlSecurity.validateSafeUrl(track.url);
  if (!checked.valid) return null;
  return { ...track, url: checked.url };
}

/**
 * Envia mensagem complementar pós-envio com link e comando de letra
 */
async function sendComplementaryMessage(ctx, track, prefix) {
  try {
    // Nunca ecoe uma URL que não tenha passado pelo mesmo allowlist do
    // download. A mensagem posterior usa apenas a URL pública original.
    const safe = urlSecurity.validateSafeUrl(track && track.url);
    if (!safe.valid) throw new Error('URL complementar inválida');
    const text = playPresentation.formatComplementaryMessage(track.title, safe.url, prefix || ctx.prefix || '!');
    await ctx.reply(text);
  } catch (err) {
    // A mídia já foi entregue: não tente reenviá-la. O log não inclui URL,
    // tokens ou metadados externos desnecessários.
    logger.warn({ err: err.message }, 'falha ao enviar mensagem complementar do play (mídia já entregue)');
  }
}

/**
 * Executa o download e envio da ação escolhida (áudio ou vídeo)
 */
async function executeMediaAction(ctx, session, trackIndex, action) {
  // Validação de segurança: autor e chat
  if (ctx.sender !== session.sender || ctx.remoteJid !== session.chatId) {
    await ctx.reply('⚠️ Esta busca pertence a outro usuário. Inicie a sua com !play <nome>.');
    return;
  }

  // Trava anti-duplo clique por sessão
  const lock = playSession.lockSession(session.id);
  if (!lock.ok) {
    if (lock.reason === 'ALREADY_PROCESSING') {
      await ctx.reply('⏳ Uma ação para esta música já está em processamento. Aguarde um instante.');
    } else {
      await ctx.reply('⏳ Os resultados expiraram. Faça a busca novamente.');
    }
    return;
  }

  const track = session.results[trackIndex];
  if (!track || !track.url) {
    playSession.unlockSession(session.id);
    await ctx.reply('❌ Opção selecionada inválida ou indisponível.');
    return;
  }

  // Se a ação solicitada for somente o Link
  if (action === 'link') {
    try {
      await sendComplementaryMessage(ctx, track, session.prefix);
    } finally {
      // Keep the lock through the send so a repeated click cannot emit the
      // same link block twice concurrently.
      playSession.unlockSession(session.id);
    }
    return;
  }

  // Validação SSRF do destino da URL antes de iniciar qualquer download
  const safeCheck = urlSecurity.validateSafeUrl(track.url);
  if (!safeCheck.valid) {
    playSession.unlockSession(session.id);
    await ctx.reply(`❌ Link da música não permitido: ${safeCheck.reason}`);
    return;
  }

  const actionLabel = action === 'video' ? '🎬 Vídeo' : '🎵 Áudio';
  await ctx.reply(`⏳ Baixando ${actionLabel} de "*${playPresentation.sanitizeTitle(track.title)}*"...`);

  try {
    await downloadQueue.enqueue(ctx.remoteJid, `play_${action}_${session.id}`, async ({ isCancelled }) => {
      if (isCancelled()) throw new Error('Download cancelado');

      if (action === 'video') {
        const video = await youtube.downloadVideo(track.url, track.title);
        if (isCancelled()) {
          youtube.deleteFile(video.path);
          throw new Error('Download cancelado');
        }
        const sendRes = await sendVideoResult(ctx, video, `🎬 *${playPresentation.sanitizeTitle(track.title)}*`);
        if (sendRes && sendRes.entregue) {
          await sendComplementaryMessage(ctx, track, session.prefix);
        }
      } else {
        const audio = await youtube.downloadAudio(track.url, track.title);
        if (isCancelled()) {
          youtube.deleteFile(audio.path);
          throw new Error('Download cancelado');
        }
        const sendRes = await sendAudioResult(ctx, audio);
        if (sendRes && sendRes.entregue) {
          await sendComplementaryMessage(ctx, track, session.prefix);
        }
      }
    });
  } catch (err) {
    logger.error({ err: err.message, action, url: track.url }, 'falha no download do play');
    const msg = (err && err.message) || '';
    if (msg.includes('FILE_TOO_BIG')) {
      await ctx.reply('📦 O arquivo excedeu o limite máximo de download.');
    } else if (msg.includes('TIMEOUT')) {
      await ctx.reply('⏰ O download demorou demais e foi interrompido.');
    } else {
      await ctx.reply(`❌ Falha ao baixar o ${actionLabel.toLowerCase()}.\n▸ Você pode tentar novamente ou solicitar apenas o link.`);
    }
  } finally {
    playSession.unlockSession(session.id);
  }
}

/**
 * Renderiza o submenu de ações (Áudio, Vídeo, Link) para a música escolhida
 */
async function showTrackActionMenu(ctx, session, trackIndex) {
  if (ctx.sender !== session.sender || ctx.remoteJid !== session.chatId) {
    await ctx.reply('⚠️ Esta busca pertence a outro usuário. Inicie a sua com !play <nome>.');
    return;
  }

  const track = session.results[trackIndex];
  if (!track) {
    await ctx.reply('❌ Opção indisponível.');
    return;
  }

  const sId = session.id;
  const aid = `lua_pl_${sId}_a${trackIndex}`;
  const vid = `lua_pl_${sId}_v${trackIndex}`;
  const lid = `lua_pl_${sId}_l${trackIndex}`;

  buttonHandler.register(aid, (c) => executeMediaAction(c, session, trackIndex, 'audio'));
  buttonHandler.register(vid, (c) => executeMediaAction(c, session, trackIndex, 'video'));
  buttonHandler.register(lid, (c) => executeMediaAction(c, session, trackIndex, 'link'));

  const menuTitle = `🎵 ${playPresentation.sanitizeTitle(track.title).slice(0, 24)}`;
  const textBody = `Música: *${playPresentation.sanitizeTitle(track.title)}*\nDuração: ${playPresentation.formatPlayDuration(track.duration)}\n\n_Escolha como deseja receber:_`;

  const sections = [
    {
      title: 'Ações Disponíveis',
      rows: [
        { id: aid, title: '🎵 Baixar Áudio', description: 'Receber áudio em MP4/M4A' },
        { id: vid, title: '🎬 Baixar Vídeo', description: 'Receber vídeo MP4' },
        { id: lid, title: '🔗 Apenas Link e Letra', description: 'Link oficial e comando de letra' },
      ],
    },
  ];

  const ok = await interactive.sendList(ctx.socket, ctx.remoteJid, {
    title: menuTitle,
    text: textBody,
    buttonText: '🌙 Escolher Ação',
    sections,
    quoted: ctx.message,
  });

  if (!ok) {
    // Fallback numérico estruturado
    numberFallback.setNumberMenu(ctx.remoteJid, [
      { num: 1, label: 'Baixar Áudio', run: (c) => executeMediaAction(c, session, trackIndex, 'audio') },
      { num: 2, label: 'Baixar Vídeo', run: (c) => executeMediaAction(c, session, trackIndex, 'video') },
      { num: 3, label: 'Apenas Link e Letra', run: (c) => executeMediaAction(c, session, trackIndex, 'link') },
    ]);

    await ctx.reply(
      `*MÚSICA SELECIONADA*\n\n` +
      `*${playPresentation.sanitizeTitle(track.title)}*\n` +
      `Duração · ${playPresentation.formatPlayDuration(track.duration)}\n\n` +
      `1. 🎵 Baixar Áudio\n` +
      `2. 🎬 Baixar Vídeo\n` +
      `3. 🔗 Apenas Link e Letra\n\n` +
      `_Responda com o número (1, 2 ou 3)._`
    );
  }
}

/**
 * Ponto de entrada do comando Play
 */
async function handlePlay(ctx) {
  const query = ctx.args.join(' ').trim();
  if (!query) {
    return ctx.reply(`⚠️ Envie o nome da música ou o link:\n▸ Exemplo: \`${ctx.prefix}play Bohemian Rhapsody\` ou \`${ctx.prefix}play https://...\``);
  }

  // 1. Link direto
  if (/^https?:\/\//i.test(query)) {
    const safeCheck = urlSecurity.validateSafeUrl(query);
    if (!safeCheck.valid) {
      return ctx.reply(`❌ Link não suportado ou bloqueado por segurança: ${safeCheck.reason}`);
    }

    await ctx.reply('🔎 Obtendo informações da música...');
    try {
      let info;
      try {
        info = await youtube.getInfo(query);
      } catch (err) {
        // Tenta busca pelo ID se getInfo direto falhar
        const parsed = safeCheck.parsed;
        let vidId = '';
        if (parsed.hostname.includes('youtu.be')) {
          vidId = parsed.pathname.replace(/^\//, '');
        } else {
          vidId = parsed.searchParams.get('v') || '';
        }
        if (vidId) {
          const s = await youtube.search(vidId, 1);
          if (s && s.length) {
            info = {
              videoDetails: {
                title: s[0].title,
                lengthSeconds: s[0].duration,
                author: { name: s[0].author },
              },
            };
          }
        }
        if (!info) throw err;
      }

      const singleTrack = {
        title: (info.videoDetails && info.videoDetails.title) || 'Música do YouTube',
        // Preserve a canonical public URL, never an internal provider URL.
        url: safeCheck.url,
        duration: (info.videoDetails && info.videoDetails.lengthSeconds) || '',
        author: (info.videoDetails && info.videoDetails.author && info.videoDetails.author.name) || '',
      };

      const session = playSession.createSession({
        sender: ctx.sender,
        chatId: ctx.remoteJid,
        results: [singleTrack],
        query,
        prefix: ctx.prefix,
      });

      const initialText = playPresentation.formatInitialPlayMessage([singleTrack]);
      await ctx.reply(initialText);

      // Exibe menu com as opções de download para este link
      await showTrackActionMenu(ctx, session, 0);
      return;
    } catch (err) {
      logger.error({ err: err.message, query }, 'falha ao obter link direto no play');
      return ctx.reply('❌ Não foi possível carregar as informações deste link. Verifique se o vídeo é público e está disponível.');
    }
  }

  // 2. Pesquisa por nome (busca 3 melhores resultados únicos)
  await ctx.reply('🔎 Pesquisando...');
  try {
    const rawResults = await youtube.search(query, 10);
    if (!rawResults || !rawResults.length) {
      return ctx.reply(dicaBuscaVazia());
    }

    // O provedor já devolve relevância; mantenha essa ordem (e, quando a
    // relevância empata, ela normalmente já considera views). Não rotule isso
    // como ranking mundial nem converta views em "ouvintes".
    const seenTracks = new Set();
    const cleanResults = [];

    for (const raw of rawResults) {
      const r = safeProviderTrack(raw);
      if (!r) continue;
      const canonical = canonicalTrackKey(r.url);
      if (seenTracks.has(canonical)) continue;
      seenTracks.add(canonical);
      cleanResults.push(r);
      if (cleanResults.length >= 3) break;
    }

    if (!cleanResults.length) {
      return ctx.reply(dicaBuscaVazia());
    }

    const session = playSession.createSession({
      sender: ctx.sender,
      chatId: ctx.remoteJid,
      results: cleanResults,
      query,
      prefix: ctx.prefix,
    });

    const initialText = playPresentation.formatInitialPlayMessage(cleanResults);

    // Registra botões para escolha da faixa
    const sId = session.id;
    const rows = cleanResults.map((r, i) => {
      const btnId = `lua_pl_${sId}_sel${i}`;
      buttonHandler.register(btnId, (c) => showTrackActionMenu(c, session, i));
      return {
        id: btnId,
        title: `${String(i + 1).padStart(2, '0')}. ${playPresentation.sanitizeTitle(r.title).slice(0, 20)}`,
        description: `Duração: ${playPresentation.formatPlayDuration(r.duration)}`,
      };
    });

    const ok = await interactive.sendList(ctx.socket, ctx.remoteJid, {
      title: 'LUA • PLAY',
      text: initialText,
      footer: `${cleanResults.length} opção(ões) encontrada(s)`,
      buttonText: '🌙 Escolher Música',
      sections: [{ title: 'Resultados da Busca', rows }],
      quoted: ctx.message,
    });

    if (!ok) {
      // Fallback numérico em texto
      numberFallback.setNumberMenu(
        ctx.remoteJid,
        cleanResults.map((r, i) => ({
          num: i + 1,
          label: playPresentation.sanitizeTitle(r.title),
          run: (c) => showTrackActionMenu(c, session, i),
        }))
      );

      await ctx.reply(`${initialText}\n\n_Responda com o número da opção (1 a ${cleanResults.length})._`);
    }
  } catch (err) {
    logger.error({ err: err.message, query }, 'falha na pesquisa do play');
    await ctx.reply('❌ Ocorreu um erro ao pesquisar as músicas. Tente novamente em instantes.');
  }
}

module.exports = {
  handlePlay,
  executeMediaAction,
  showTrackActionMenu,
  sendComplementaryMessage,
};
