/**
 * utils/reactionTopics.js — mapeamento CENTRAL de assunto → emoji de reação.
 *
 * Usado só pelas reações contextuais (utils/contextReact.js). Não decide se o
 * bot reage — só QUAL emoji combina com o assunto.
 *
 * Prioridade:
 *   1) comando reconhecido → tópico do comando (por nome) → tópico da categoria;
 *   2) resposta citando o bot, sem comando → regras leves por PALAVRA/EXPRESSÃO
 *      INTEIRA (tokens normalizados, sem acento), nunca por pedaço de palavra
 *      ("menu" não casa com "menudo"; "vida" não casa com "duvida");
 *   3) sem assunto identificado → 💬.
 *
 * Categorias (as reais do projeto: menus/index.js e commands/*).
 */

'use strict';

const TOPICOS = Object.freeze({
  tecnico: { emoji: '💻', rotulo: 'Prefixo e informações técnicas' },
  menu: { emoji: '🧭', rotulo: 'Menu e navegação' },
  ajuda: { emoji: '❓', rotulo: 'Ajuda' },
  admin: { emoji: '🛠️', rotulo: 'Administração' },
  horario: { emoji: '⏰', rotulo: 'Horários e agendamentos' },
  rpg: { emoji: '⚔️', rotulo: 'RPG/vida' },
  carteira: { emoji: '💰', rotulo: 'Carteira e saldo' },
  tesouro: { emoji: '🗺️', rotulo: 'Caça ao tesouro' },
  tigrinho: { emoji: '🎰', rotulo: 'Tigrinho' },
  musica: { emoji: '🎵', rotulo: 'Música e áudio' },
  agradecimento: { emoji: '🤝', rotulo: 'Agradecimento' },
  jogos: { emoji: '🎮', rotulo: 'Jogos' },
  downloads: { emoji: '📥', rotulo: 'Downloads' },
  figurinhas: { emoji: '🎨', rotulo: 'Figurinhas e visual' },
  ia: { emoji: '🤖', rotulo: 'Inteligência artificial' },
  anime: { emoji: '🍥', rotulo: 'Anime' },
  diversao: { emoji: '😂', rotulo: 'Diversão' },
  membros: { emoji: '👥', rotulo: 'Membros' },
  dono: { emoji: '👑', rotulo: 'Dono' },
  ranking: { emoji: '🏆', rotulo: 'Rankings' },
  utilidade: { emoji: '🧰', rotulo: 'Utilidades' },
  conversa: { emoji: '💬', rotulo: 'Resposta ao bot sem assunto identificado' },
});

/** Categoria do registro → tópico. */
const POR_CATEGORIA = Object.freeze({
  general: 'tecnico',
  admin: 'admin',
  rpg: 'rpg',
  life: 'rpg',
  games: 'jogos',
  downloads: 'downloads',
  stickers: 'figurinhas',
  ai: 'ia',
  anime: 'anime',
  fun: 'diversao',
  members: 'membros',
  owner: 'dono',
  rankings: 'ranking',
  utility: 'utilidade',
});

/** Nome do comando → tópico (vence a categoria). */
const POR_COMANDO = Object.freeze({
  prefix: 'tecnico',
  help: 'ajuda',
  horariogrupo: 'horario',
  tigrinho: 'tigrinho',
  cacatesouro: 'tesouro',
  saldo: 'carteira',
  banco: 'carteira',
  depositar: 'carteira',
  sacar: 'carteira',
  transferir: 'carteira',
  carteira: 'carteira',
  pix: 'carteira',
  play: 'musica',
  ytmp3: 'musica',
  audio: 'musica',
});

/**
 * Regras de texto (ordem = prioridade). Cada termo é uma palavra ou expressão
 * INTEIRA, já sem acento e em minúsculas.
 */
const REGRAS_TEXTO = [
  ['agradecimento', ['obrigado', 'obrigada', 'obg', 'brigado', 'brigada', 'valeu', 'vlw', 'agradeco', 'agradecido', 'agradecida', 'thanks', 'thank you']],
  ['tecnico', ['prefixo', 'prefix']],
  ['ajuda', ['ajuda', 'help', 'socorro', 'como usa', 'como funciona', 'como usar']],
  ['menu', ['menu', 'menus', 'comandos', 'lista de comandos']],
  ['horario', ['horario', 'horarios', 'agendamento', 'agendar', 'abrir o grupo', 'fechar o grupo']],
  ['tigrinho', ['tigrinho']],
  ['tesouro', ['tesouro', 'caca ao tesouro', 'cacatesouro']],
  ['carteira', ['saldo', 'carteira', 'dinheiro', 'moedas', 'pix']],
  ['rpg', ['rpg', 'missao', 'missoes', 'personagem', 'minha vida']],
  ['musica', ['musica', 'musicas', 'audio', 'cancao', 'mp3']],
  ['admin', ['admin', 'adm', 'banir', 'moderacao']],
];

/** Texto → lista de tokens (minúsculas, sem acento, só letras/dígitos). */
function tokens(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A sequência de tokens `frase` aparece INTEIRA em `toks`? */
function contemFrase(toks, frase) {
  const f = tokens(frase);
  if (!f.length || f.length > toks.length) return false;
  for (let i = 0; i + f.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < f.length; j++) {
      if (toks[i + j] !== f[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function emojiDe(topico) {
  return (TOPICOS[topico] || TOPICOS.conversa).emoji;
}

/** Tópico de um comando reconhecido. */
function topicoDoComando(cmd) {
  if (!cmd) return 'conversa';
  const nome = String(cmd.name || '');
  if (POR_COMANDO[nome]) return POR_COMANDO[nome];
  if (/^menu/.test(nome) || nome === 'menucompleto') return 'menu';
  return POR_CATEGORIA[cmd.category] || 'tecnico';
}

/** Tópico de um texto livre (resposta ao bot). Null se nada casar. */
function topicoDoTexto(texto) {
  const toks = tokens(texto);
  if (!toks.length) return null;
  for (const [topico, termos] of REGRAS_TEXTO) {
    if (termos.some((t) => contemFrase(toks, t))) return topico;
  }
  return null;
}

module.exports = {
  TOPICOS,
  POR_CATEGORIA,
  POR_COMANDO,
  REGRAS_TEXTO,
  tokens,
  contemFrase,
  emojiDe,
  topicoDoComando,
  topicoDoTexto,
};
