/**
 * utils/treasureGame.js — lógica PURA do 🗺️ CAÇA AO TESOURO.
 *
 * Sem I/O, sem banco, sem WhatsApp: aqui ficam o TABULEIRO, as PISTAS e as
 * REGRAS DE PAGAMENTO (todos os números num lugar só). O mapa verdadeiro é
 * gerado aqui, no backend, e vive no banco (database/treasure.js) — NUNCA no
 * HTML: o card recebe só as casas já escavadas, o resultado delas e as dicas
 * que o jogador já conquistou.
 *
 * Tabuleiros de 3×3 até 13×13. Colunas A..M (A=coluna 1) e linhas 1..13,
 * sempre conforme o tamanho escolhido — 3×3 usa A–C / 1–3, 13×13 usa A–M / 1–13.
 *
 * Dinheiro: tudo em LuaCoins INTEIROS (a carteira do projeto é INTEGER). Este
 * módulo só CALCULA; cobrar/creditar é com utils/gameWallet.js.
 */

'use strict';

/* ----------------------------- tabuleiro ----------------------------- */

const TAM_MIN = 3;
const TAM_MAX = 13;
const TAMANHOS = Array.from({ length: TAM_MAX - TAM_MIN + 1 }, (_, i) => TAM_MIN + i);

const LETRAS = 'ABCDEFGHIJKLM'.split('');

/** Coluna (0-based) → letra. */
function letraDeColuna(x) {
  return LETRAS[x] || '?';
}

/** Coordenada legível: (0,0) → 'A1'. */
function coordDe(x, y) {
  return `${letraDeColuna(x)}${y + 1}`;
}

/** 'A1' (qualquer caixa/maiúscula) → { x, y, coord } ou null se inválida. */
function parseCoord(entrada, size) {
  const txt = String(entrada || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = txt.match(/^([A-M])(\d{1,2})$/);
  if (!m) return null;
  const x = LETRAS.indexOf(m[1]);
  const y = parseInt(m[2], 10) - 1;
  const n = Number(size);
  if (x < 0 || y < 0 || x >= n || y >= n) return null;
  return { x, y, coord: coordDe(x, y) };
}

/** Índice linear (y*n + x) → coordenada, e vice-versa. */
function idxDe(x, y, size) {
  return y * Number(size) + x;
}
function coordDeIdx(idx, size) {
  const n = Number(size);
  return coordDe(idx % n, Math.floor(idx / n));
}

/* ------------------------------- regras ------------------------------ */

/**
 * REGRAS CENTRALIZADAS — a distribuição de cada tabuleiro e o pagamento.
 *
 * Fórmulas (n = lado do tabuleiro, N = n²):
 *   tesouros  T = max(2, round(n × 0,6))      → 3×3:2   13×13:8
 *   armadilhas R = max(1, round(n × 0,35))    → 3×3:1   13×13:5
 *   escavações D = max(T + 2, round(N × 0,2)) → 3×3:4   13×13:34
 *
 * Pagamento por tesouro encontrado:
 *   valor = bet × (N / D) × (RTP_BASE / T)
 * Escolhido assim de propósito: quem escava ao acaso recebe, em média,
 * `RTP_BASE` × aposta (o (N/D) compensa a chance de achar cada tesouro e o
 * (1/T) divide entre os tesouros). Quem usa as dicas ganha mais — é a
 * habilidade do jogo. `BONUS_VITORIA` paga a expedição completa.
 *
 * A aposta vale pela EXPEDIÇÃO INTEIRA: é cobrada uma vez na confirmação e
 * não há nova cobrança por escavação. Não há reembolso (nem ao sair, nem ao
 * expirar) — isso aparece nas regras ANTES de confirmar.
 */
const RTP_BASE = 0.85;
const BONUS_VITORIA = 0.25;

function configDoTabuleiro(size) {
  const n = Math.max(TAM_MIN, Math.min(TAM_MAX, Math.floor(Number(size) || TAM_MIN)));
  const N = n * n;
  const tesouros = Math.max(2, Math.round(n * 0.6));
  const armadilhas = Math.min(N - tesouros - 1, Math.max(1, Math.round(n * 0.35)));
  const escavacoes = Math.min(N - 1, Math.max(tesouros + 2, Math.round(N * 0.2)));
  return {
    size: n,
    casas: N,
    tesouros,
    armadilhas,
    escavacoes,
    rtpBase: RTP_BASE,
    bonusVitoria: BONUS_VITORIA,
    letras: LETRAS.slice(0, n),
  };
}

/** Valor (inteiro) que CADA tesouro vale nesta aposta/tabuleiro. */
function valorPorTesouro(bet, size) {
  const cfg = configDoTabuleiro(size);
  const bruto = (Number(bet) || 0) * (cfg.casas / cfg.escavacoes) * (RTP_BASE / cfg.tesouros);
  return Math.max(0, Math.floor(bruto));
}

/**
 * Recompensa da expedição, em LC inteiros.
 * @param {object} p { bet, size, encontrados, total } (total = tesouros do mapa)
 * @returns {{total:number, porTesouro:number, bonus:number, completo:boolean}}
 */
function calcularRecompensa({ bet, size, encontrados, total }) {
  const achados = Math.max(0, Math.min(Math.floor(Number(encontrados) || 0), Math.floor(Number(total) || 0)));
  const porTesouro = valorPorTesouro(bet, size);
  const completo = achados >= total && total > 0;
  const bonus = completo ? Math.floor((Number(bet) || 0) * BONUS_VITORIA) : 0;
  return { total: porTesouro * achados + bonus, porTesouro, bonus, completo };
}

/* --------------------------- geração do mapa -------------------------- */

/** PRNG determinístico (mulberry32) — o mesmo seed dá o mesmo mapa. */
function criarRng(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sorteio sem repetição (Fisher-Yates) usando o rng. */
function embaralhar(lista, rng) {
  const arr = lista.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * Gera o MAPA VERDADEIRO (segredo do backend).
 * @returns {{seed:number, tesouros:number[], armadilhas:number[]}}
 */
function gerarMapa(size, seed = Math.floor(Math.random() * 2147483647) + 1) {
  const cfg = configDoTabuleiro(size);
  const rng = criarRng(seed);
  const indices = embaralhar(Array.from({ length: cfg.casas }, (_, i) => i), rng);
  const tesouros = indices.slice(0, cfg.tesouros).sort((a, b) => a - b);
  const armadilhas = indices.slice(cfg.tesouros, cfg.tesouros + cfg.armadilhas).sort((a, b) => a - b);
  return { seed, tesouros, armadilhas };
}

/**
 * PISTA objetiva: quantos tesouros existem nas 8 casas VIZINHAS da casa
 * informada (contadas no mapa verdadeiro). Casa sem vizinho nenhum devolve 0.
 */
function dicaDoMapa(mapa, size, idx) {
  const n = configDoTabuleiro(size).size;
  const x = idx % n;
  const y = Math.floor(idx / n);
  const tes = new Set(mapa.tesouros);
  let achados = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      if (tes.has(idxDe(nx, ny, n))) achados++;
    }
  }
  return achados;
}

/** O que existe na casa: 't' tesouro · 'a' armadilha · 'v' vazio. */
function conteudoDaCasa(mapa, idx) {
  if (mapa.tesouros.includes(idx)) return 't';
  if (mapa.armadilhas.includes(idx)) return 'a';
  return 'v';
}

/** Texto curto de uma casa escavada (para o tabuleiro em texto). */
const EMOJI_CASA = { t: '💎', a: '💥', v: '·', '?': '▫️' };

/* ------------------------------ visão --------------------------------- */

/**
 * Janela visível do tabuleiro grande (a navegação é por setas FORA da área
 * que rola). Devolve os limites e o rótulo "Colunas D–H · Linhas 4–8".
 */
function janelaVisivel(size, { x = 0, y = 0, cols = 5, linhas = 5 } = {}) {
  const n = configDoTabuleiro(size).size;
  const largura = Math.max(1, Math.min(cols, n));
  const altura = Math.max(1, Math.min(linhas, n));
  const cx = Math.max(0, Math.min(x, n - largura));
  const cy = Math.max(0, Math.min(y, n - altura));
  const x2 = cx + largura - 1;
  const y2 = cy + altura - 1;
  return {
    x: cx,
    y: cy,
    cols: largura,
    linhas: altura,
    x2,
    y2,
    rotulo: `Colunas ${letraDeColuna(cx)}–${letraDeColuna(x2)} · Linhas ${cy + 1}–${y2 + 1}`,
  };
}

/** Regras da expedição em texto (mostradas ANTES de confirmar a aposta). */
function regrasTexto(size) {
  const c = configDoTabuleiro(size);
  return [
    `🗺️ Expedição ${c.size}×${c.size} (${c.casas} casas)`,
    `▸ 💎 Tesouros escondidos: ${c.tesouros}`,
    `▸ 💥 Armadilhas: ${c.armadilhas} (a armadilha queima 1 escavação extra)`,
    `▸ ⛏️ Escavações: ${c.escavacoes} (cada casa só pode ser escavada uma vez)`,
    `▸ 🏆 Vitória: achar TODOS os tesouros antes de acabar as escavações`,
    `▸ 💀 Derrota: acabar as escavações com tesouro no chão`,
    `▸ 💰 Pagamento: ${RTP_BASE * 100}% da aposta por tesouro esperado ao acaso ` +
      `(${c.casas}/${c.escavacoes} ÷ ${c.tesouros}), +${BONUS_VITORIA * 100}% da aposta se completar a expedição`,
    `▸ 🔎 Dica: cada casa escavada mostra quantos tesouros existem nas 8 casas vizinhas`,
    '▸ ⚠️ A aposta vale pela expedição inteira: é cobrada UMA vez na confirmação e NÃO é devolvida (nem ao sair, nem ao expirar)',
  ].join('\n');
}

module.exports = {
  TAM_MIN,
  TAM_MAX,
  TAMANHOS,
  LETRAS,
  RTP_BASE,
  BONUS_VITORIA,
  EMOJI_CASA,
  letraDeColuna,
  coordDe,
  parseCoord,
  idxDe,
  coordDeIdx,
  configDoTabuleiro,
  valorPorTesouro,
  calcularRecompensa,
  criarRng,
  gerarMapa,
  dicaDoMapa,
  conteudoDaCasa,
  janelaVisivel,
  regrasTexto,
};
