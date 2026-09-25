/**
 * utils/mediaPresentation.js — Montagem visual de informações e fichas técnicas
 * para comandos de reprodução e download (Play, Ytmp3, Ytmp4).
 *
 * Segue modelo:
 * 🎧 ÁUDIO • {titulo} (ou 🎬 VÍDEO • {titulo})
 * 🎤 Artista: {artista} / Canal: {canal}
 * 💿 Álbum: {album}
 * ⏱️ Duração: {duracao}
 * 📅 Lançamento: {data} / Publicação: {data}
 *
 * 👁️ Visualizações: {views}
 * 👍 Curtidas: {likes}
 *
 * 📝 SOBRE A MÚSICA
 * {contexto}
 *
 * 📄 DESCRIÇÃO DA FONTE
 * {descricao}
 *
 * 🔗 Fonte: {link}
 * 📖 Buscar letra: {prefix}letra {link}
 */

'use strict';

const { formatNumber } = require('./formatter');

/**
 * Sanitiza texto para evitar menções fantasmas (@12345...) ou injeção indevida
 */
function sanitizeContent(text) {
  if (!text) return '';
  return String(text)
    // insere caractere invisível ou espaço zero-width após o @ para não virar menção acidental
    .replace(/@([0-9]{5,})/g, '@\u200B$1')
    .trim();
}

/**
 * Resume descrições longas mantendo o sentido e legibilidade
 */
function summarizeDescription(desc, maxLen = 220) {
  if (!desc) return '';
  const clean = sanitizeContent(desc).replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n');
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen).trim() + '... (descrição completa no link)';
}

/**
 * Separa de forma inteligente artista e título se estiverem no padrão "Artista - Título"
 */
function parseArtistAndTitle(rawTitle, rawAuthor) {
  const cleanTitle = String(rawTitle || '').trim();
  // Se houver hífen separando (ex: "Queen - Bohemian Rhapsody")
  const dashMatch = cleanTitle.match(/^(.*?)\s*[-–—]\s*(.*)$/);
  if (dashMatch) {
    const candidateArtist = dashMatch[1].trim();
    let songTitle = dashMatch[2].trim();
    // remove tags comuns como (Official Video), [Clipe Oficial], etc
    songTitle = songTitle.replace(/\s*(\(|\[)(official|clipe|video|audio|lyric|legendado|hd|4k)[^)]*(\)|\])/gi, '').trim();
    return {
      artist: candidateArtist,
      title: songTitle || cleanTitle,
      isChannel: false,
    };
  }

  // Se não tem separador no título, o autor fornecido é o canal do YouTube
  return {
    artist: rawAuthor ? String(rawAuthor).trim() : '',
    title: cleanTitle,
    isChannel: true,
  };
}

/**
 * Formata a ficha técnica da mídia para envio no WhatsApp
 * @param {object} params
 * @param {'audio'|'video'} params.kind Tipo de mídia
 * @param {string} params.title Título da faixa ou vídeo
 * @param {string} [params.artist] Artista identificado
 * @param {string} [params.channel] Canal do YouTube
 * @param {string} [params.album] Álbum identificado
 * @param {string} [params.duration] Duração formatada (ex: 3:54)
 * @param {string} [params.releaseDate] Data de lançamento
 * @param {string} [params.publishDate] Data de publicação
 * @param {number|string} [params.views] Visualizações reais
 * @param {number|string} [params.likes] Curtidas reais
 * @param {number|string} [params.plays] Reproduções
 * @param {number|string} [params.listeners] Ouvintes
 * @param {string} [params.about] Contexto / sobre a música
 * @param {string} [params.description] Descrição da fonte
 * @param {string} [params.url] Link original
 * @param {string} [params.prefix] Prefixo ativo do bot
 * @returns {string} Ficha técnica formatada
 */
function formatPlayDetailCard(params) {
  const title = sanitizeContent(params.title) || 'Sem título';
  const lines = [`*${title}*`, '━━━━━━━━━━━━━━'];
  const channel = sanitizeContent(params.channel);
  const artist = sanitizeContent(params.artist);
  if (artist) lines.push(`🎙️ Artista: ${artist}`);
  if (channel) lines.push(`📺 Canal: ${channel}`);
  lines.push(`⏱️ Duração: ${params.duration || 'Não informado'}`);
  lines.push(`👁️ Visualizações: ${formatMetric(params.views)}`);
  lines.push(`👍 Curtidas: ${formatMetric(params.likes)}`);
  if (params.publishDate) lines.push(`📅 Publicado em: ${sanitizeContent(params.publishDate)}`);
  lines.push('━━━━━━━━━━━━━━');
  if (params.about) lines.push(`*Sobre a música*\n${sanitizeContent(params.about)}`);
  if (params.description) lines.push(`*Descrição*\n${summarizeDescription(params.description, 180)}`);
  lines.push('━━━━━━━━━━━━━━');
  lines.push(`🔗 ${params.url}`);
  lines.push(`📄 Consultar letra\n${params.prefix || '!'}letra ${params.url}`);
  return lines.join('\n');
}

function formatMetric(value) {
  if (value === undefined || value === null || value === '') return 'Não informado';
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? formatNumber(n) : sanitizeContent(value);
}

function formatMediaCard(params) {
  const isAudio = params.kind === 'audio';
  const headerIcon = isAudio ? '🎧 ÁUDIO' : '🎬 VÍDEO';
  const title = sanitizeContent(params.title) || 'Sem título';

  const sections = [];

  // Cabeçalho
  sections.push(`${headerIcon} • *${title}*`);

  // Bloco 1: Identificação
  const idLines = [];
  if (params.artist) {
    idLines.push(`🎤 Artista: ${sanitizeContent(params.artist)}`);
  } else if (params.channel) {
    idLines.push(`📺 Canal: ${sanitizeContent(params.channel)}`);
  }

  if (params.album) {
    idLines.push(`💿 Álbum: ${sanitizeContent(params.album)}`);
  }

  if (params.duration) {
    idLines.push(`⏱️ Duração: ${params.duration}`);
  }

  if (params.releaseDate) {
    idLines.push(`📅 Lançamento: ${params.releaseDate}`);
  } else if (params.publishDate) {
    idLines.push(`📅 Publicação: ${params.publishDate}`);
  }

  if (idLines.length > 0) {
    sections.push(idLines.join('\n'));
  }

  // Bloco 2: Estatísticas (Somente métricas reais fornecidas e maiores que zero ou definidas)
  const statLines = [];
  if (params.views !== undefined && params.views !== null && params.views !== '') {
    const nViews = Number(params.views);
    if (!isNaN(nViews)) {
      statLines.push(`👁️ Visualizações: ${nViews > 0 ? formatNumber(nViews) : '0'}`);
    } else {
      statLines.push(`👁️ Visualizações: ${params.views}`);
    }
  }

  if (params.plays !== undefined && params.plays !== null && params.plays !== '') {
    const nPlays = Number(params.plays);
    statLines.push(`▶️ Reproduções: ${!isNaN(nPlays) ? formatNumber(nPlays) : params.plays}`);
  }

  if (params.listeners !== undefined && params.listeners !== null && params.listeners !== '') {
    const nListeners = Number(params.listeners);
    statLines.push(`👥 Ouvintes: ${!isNaN(nListeners) ? formatNumber(nListeners) : params.listeners}`);
  }

  if (params.likes !== undefined && params.likes !== null && params.likes !== '') {
    const nLikes = Number(params.likes);
    if (!isNaN(nLikes) && nLikes > 0) {
      statLines.push(`👍 Curtidas: ${formatNumber(nLikes)}`);
    } else if (typeof params.likes === 'string' && params.likes.trim()) {
      statLines.push(`👍 Curtidas: ${params.likes}`);
    }
  }

  if (statLines.length > 0) {
    sections.push(statLines.join('\n'));
  }

  // Bloco 3: Contexto / Sobre a música (se houver e não for idêntico à descrição)
  if (params.about && sanitizeContent(params.about) !== sanitizeContent(params.description)) {
    sections.push(`📝 *SOBRE A MÚSICA*\n${sanitizeContent(params.about)}`);
  }

  // Bloco 4: Descrição da fonte (resumida)
  if (params.description) {
    const summ = summarizeDescription(params.description, 200);
    if (summ) {
      sections.push(`📄 *DESCRIÇÃO DA FONTE*\n${summ}`);
    }
  }

  // Bloco 5: Rodapé com links e busca de letra
  const footerLines = [];
  const pfx = params.prefix || '!';

  if (params.url) {
    footerLines.push(`🔗 Fonte: ${params.url}`);
    footerLines.push(`📖 Buscar letra: \`${pfx}letra ${params.url}\``);
  } else if (params.title) {
    const queryTerm = params.artist ? `${params.artist} - ${params.title}` : params.title;
    footerLines.push(`📖 Buscar letra: \`${pfx}letra ${queryTerm}\``);
  }

  if (footerLines.length > 0) {
    sections.push(footerLines.join('\n'));
  }

  return sections.join('\n\n');
}

module.exports = {
  sanitizeContent,
  summarizeDescription,
  parseArtistAndTitle,
  formatMediaCard,
  formatPlayDetailCard,
  formatMetric,
};
