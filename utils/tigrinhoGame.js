/**
 * utils/tigrinhoGame.js — lógica PURA do 🐯 LUA TIGRINHO.
 *
 * Sem I/O, sem banco, sem WhatsApp. Aqui ficam TODOS os valores configuráveis
 * (símbolos, pesos, recompensas, aposta padrão, cooldown, limites) e a
 * geração/avaliação do resultado. O resultado é SEMPRE gerado aqui (backend) —
 * a interface HTML apenas apresenta.
 *
 * A máquina usa 5 ROLOS × 3 LINHAS. As fichas são os MESMOS LuaCoins (LC) da
 * carteira RPG (database/economy.js) — não existe economia paralela.
 *
 * Fichas = economia interna de jogo, sem valor monetário e sem conversão.
 */

'use strict';

const TIGRINHO_CONFIG = {
  name: '🐯 LUA TIGRINHO',

  // aposta padrão (LuaCoins) quando o jogador não informa valor
  betCost: 100,

  // proteção
  cooldownMs: 2500,      // cooldown individual entre giros (por usuário)

  // histórico / ranking
  historyLimit: 20,      // últimos giros guardados por jogador
  rankingLimit: 10,      // tamanho do ranking

  // máquina
  reelCount: 5,          // 5 rolos
  rowCount: 3,           // 3 linhas visíveis por rolo (grade 5×3)

  // bônus de 2 iguais na linha (multiplicador sobre a aposta)
  pairMult: 0.2,

  // símbolos + pesos + prêmios por "sequência da esquerda" (3/4/5 iguais).
  // Probabilidades centralizadas aqui — nada espalhado pelo código.
  // RTP total ≈ 90% (calculado e documentado em test/platform.test.js).
  symbols: [
    { id: 'cherry',  emoji: '🍒', weight: 30, p3: 4,   p4: 8,   p5: 16,  label: 'Cereja' },
    { id: 'lemon',   emoji: '🍋', weight: 22, p3: 3,   p4: 6,   p5: 12,  label: 'Limão' },
    { id: 'orange',  emoji: '🍊', weight: 20, p3: 4,   p4: 8,   p5: 16,  label: 'Laranja' },
    { id: 'bell',    emoji: '🔔', weight: 12, p3: 7,   p4: 15,  p5: 32,  label: 'Sino' },
    { id: 'diamond', emoji: '💎', weight: 8,  p3: 13,  p4: 30,  p5: 65,  label: 'Diamante' },
    { id: 'crown',   emoji: '👑', weight: 6,  p3: 26,  p4: 60,  p5: 130, label: 'Coroa' },
    { id: 'tiger',   emoji: '🐯', weight: 2,  p3: 50,  p4: 175, p5: 425, label: 'Tigre', jackpot: true },
  ],

  // resumo legível dos prêmios (exibido no !tigrinho ajuda)
  rewards: {
    jackpot: '🐯🐯🐯🐯🐯 → JACKPOT (425x)',
    crown: '👑👑👑👑👑 → 130x',
    diamond: '💎💎💎💎💎 → 65x',
    bell: '🔔🔔🔔🔔🔔 → 32x',
    cherry: '🍒🍒🍒🍒🍒 → 16x',
    lemon: '🍋🍋🍋🍋🍋 → 12x',
    orange: '🍊🍊🍊🍊🍊 → 16x',
    note: '3 ou 4 iguais → prêmios menores · 2 iguais → 0,2x',
  },
};

function byId(id) {
  return TIGRINHO_CONFIG.symbols.find((s) => s.id === id) || null;
}

function totalWeight() {
  return TIGRINHO_CONFIG.symbols.reduce((acc, s) => acc + s.weight, 0);
}

/** Sorteia 1 símbolo respeitando os pesos configurados. */
function weightedSymbol(rng = Math.random) {
  const total = totalWeight();
  let r = rng() * total;
  for (const s of TIGRINHO_CONFIG.symbols) {
    r -= s.weight;
    if (r < 0) return s;
  }
  return TIGRINHO_CONFIG.symbols[0];
}

/**
 * Gira a máquina: retorna grade 5×3 de símbolos.
 * Representação: grid[col][row].
 */
function spinReels(rng = Math.random) {
  const { reelCount, rowCount } = TIGRINHO_CONFIG;
  const grid = [];
  for (let c = 0; c < reelCount; c++) {
    const col = [];
    for (let r = 0; r < rowCount; r++) col.push(weightedSymbol(rng));
    grid.push(col);
  }
  return grid;
}

/**
 * Avalia a grade: para cada linha, conta a sequência de símbolos IGUAIS a
 * partir da esquerda (payline padrão de slots de 5 rolos):
 *   - 5 iguais → p5 (jackpot se for o tigre)
 *   - 4 iguais → p4
 *   - 3 iguais → p3
 *   - 2 iguais → pairMult (bônus pequeno)
 * @returns {{mult:number, jackpot:boolean, wins:Array}}
 */
function evaluate(grid) {
  const { reelCount, rowCount, pairMult } = TIGRINHO_CONFIG;
  let mult = 0;
  let jackpot = false;
  const wins = [];
  for (let r = 0; r < rowCount; r++) {
    const first = grid[0][r];
    let run = 1;
    while (run < reelCount && grid[run][r].id === first.id) run++;
    if (run >= 5) {
      mult += first.p5;
      if (first.jackpot) jackpot = true;
      wins.push({ row: r, run, symbol: first });
    } else if (run === 4) {
      mult += first.p4;
      wins.push({ row: r, run, symbol: first });
    } else if (run === 3) {
      mult += first.p3;
      wins.push({ row: r, run, symbol: first });
    } else if (run === 2) {
      mult += pairMult;
      wins.push({ row: r, run, symbol: first });
    }
  }
  return { mult, jackpot, wins };
}

/** Recompensa (LuaCoins) para uma aposta e uma grade. */
function computeReward(bet, grid) {
  const { mult, jackpot, wins } = evaluate(grid);
  const reward = Math.floor(bet * mult);
  return { reward, jackpot, wins, mult };
}

/** Grade → texto empilhado (para o fallback textual). */
function renderGridText(grid) {
  const rows = [];
  for (let r = 0; r < grid[0].length; r++) {
    rows.push(grid.map((c) => c[r].emoji).join(' '));
  }
  return rows.join('\n');
}

/** Formata fichas (1.000). */
function formatChips(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('pt-BR');
}

module.exports = {
  TIGRINHO_CONFIG,
  spinReels,
  evaluate,
  computeReward,
  renderGridText,
  formatChips,
};
