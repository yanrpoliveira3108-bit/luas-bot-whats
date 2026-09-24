/**
 * utils/gameWallet.js — camada financeira ÚNICA dos jogos com aposta.
 *
 * Usada pelo 🗺️ CAÇA AO TESOURO e pelo 🐯 TIGRINHO (nada de duas regras de
 * carteira). Todo o dinheiro vem da carteira REAL do projeto:
 *
 *   database/economy.js → tabela `economy`, coluna `wallet` (INTEGER, LuaCoins).
 *
 * Não existe carteira paralela, economia paralela nem "fichas": RPG
 * (database/rpg.js), Lua Life (database/life.js) e jogos compartilham a MESMA
 * carteira — `life.createCharacter` já chama `economy.addWallet`.
 *
 * ── Semântica do armazenamento (importa para não cobrar duas vezes) ─────────
 * `economy.wallet` é o saldo DISPONÍVEL. Não existe coluna de reserva: nos
 * jogos do projeto a aposta é DEBITADA no momento da confirmação (é o que
 * `database/tigrinho.applySpin` e `commands/rpg/cassino.js` já fazem). Logo:
 *   - disponível para apostar = wallet (já líquido de apostas cobradas);
 *   - "comprometido" (ver `comprometido()`) é INFORMATIVO: soma das apostas de
 *     partidas que já foram cobradas e ainda não terminaram. NÃO é descontado
 *     de novo do disponível — descontar seria cobrar duas vezes.
 *
 * ── Concorrência ───────────────────────────────────────────────────────────
 * Toda movimentação acontece dentro de `withLock(userId, ...)` (utils/keyedMutex)
 * e das transações do SQLite (better-sqlite3), na mesma ordem que o cassino e o
 * tigrinho já usam. Isso serializa apostas simultâneas entre jogos diferentes do
 * mesmo jogador (caça + tigrinho, por exemplo).
 *
 * ⚠️ `withLock` NÃO é reentrante (é uma fila por chave): travar de novo a mesma
 * chave dentro de uma seção travada trava para sempre. Por isso existem as
 * primitivas `*Interno` logo abaixo: quem já está DENTRO de um `withLock(userId)`
 * (é o caso de database/treasure.js) chama a versão Interno e mantém UMA única
 * trava por movimentação.
 *
 * ── Idempotência ───────────────────────────────────────────────────────────
 * `cobrarAposta` recebe uma `ref` (o id da mensagem do WhatsApp, o id da
 * partida, o que for). Se já existir uma cobrança com a mesma (user, game, ref),
 * ela é devolvida SEM cobrar de novo — é o que protege contra mensagem
 * repetida/retransmitida e contra clique duplo. O crédito do prêmio usa o id da
 * aposta, então também paga uma única vez.
 *
 * ── Valores ────────────────────────────────────────────────────────────────
 * A moeda do projeto é INTEIRA (LC). `parseValor` recusa vazio, negativo, zero
 * (quando não permitido), texto malformado, não finito e casas decimais — nada
 * de arredondar dinheiro do jogador.
 */

'use strict';

const economy = require('../database/economy');
const { prepare, get: getDb } = require('../database/database');
const { withLock } = require('./keyedMutex');
const logger = require('./logger').child('gameWallet');

const MIN_PADRAO = 1;

/** Motivos de recusa (o texto é apresentado ao jogador). */
const MOTIVO = {
  VAZIO: 'Informe um valor para apostar.',
  MALFORMADO: 'Valor inválido. Use apenas números inteiros (ex.: 100).',
  NAO_FINITO: 'Valor inválido.',
  NEGATIVO: 'O valor não pode ser negativo.',
  ZERO: 'O valor precisa ser maior que zero.',
  DECIMAL: 'A moeda é inteira: use um valor sem centavos.',
  ABAIXO_MINIMO: 'Valor abaixo da aposta mínima.',
  ACIMA_SALDO: 'Saldo insuficiente para esta aposta.',
  ACIMA_LIMITE: 'Valor acima do limite deste jogo.',
  SEM_CADASTRO: 'Você ainda não tem carteira (crie seu personagem com o comando de vida).',
  INDISPONIVEL: 'Não consegui consultar seu saldo agora. Tente novamente.',
};

/**
 * Parâmetros de aposta por jogo — TODOS num lugar só.
 *
 * `max` = null significa "sem teto próprio do jogo": o máximo é o saldo
 * disponível (comportamento que já existia no tigrinho, onde `jogar tudo` vale
 * o saldo inteiro). Nenhum limite novo é inventado: quando existir um teto
 * próprio, ele entra aqui e aparece no painel.
 */
const JOGOS = {
  tigrinho: { id: 'tigrinho', nome: '🐯 LUA TIGRINHO', min: MIN_PADRAO, max: null },
  cacatesouro: { id: 'cacatesouro', nome: '🗺️ CAÇA AO TESOURO', min: MIN_PADRAO, max: null },
};

function jogoOuPadrao(id) {
  return JOGOS[id] || { id: String(id || 'jogo'), nome: 'Jogo', min: MIN_PADRAO, max: null };
}

/** Saldo REAL do jogador (carteira do projeto). Nunca inventa zero. */
function saldo(userId) {
  const eco = economy.get(userId);
  const wallet = Math.max(0, Math.floor(Number(eco.wallet) || 0));
  return {
    wallet,
    banco: Math.max(0, Math.floor(Number(eco.bank) || 0)),
    // disponível = wallet: as apostas já cobradas saíram daqui (ver cabeçalho)
    disponivel: wallet,
  };
}

/**
 * Quanto está comprometido AGORA: apostas de partidas/rodadas em andamento
 * (status 'pending' no livro-caixa). É informativo — o valor já saiu da
 * carteira, então NÃO é descontado de novo do disponível.
 */
function comprometido(userId, game) {
  try {
    const row = game
      ? prepare('sum_bets_game', `SELECT COALESCE(SUM(bet),0) AS s FROM game_bets WHERE user_id = ? AND game = ? AND status = 'pending'`).get(userId, game)
      : prepare('sum_bets', `SELECT COALESCE(SUM(bet),0) AS s FROM game_bets WHERE user_id = ? AND status = 'pending'`).get(userId);
    return Math.max(0, Math.floor(Number(row && row.s) || 0));
  } catch (_) {
    return 0;
  }
}

/** Apostas cobradas e ainda em andamento (lista, para o painel explicar). */
function pendentes(userId) {
  try {
    return prepare(
      'pending_bets',
      `SELECT game, ref_id, bet, created_at FROM game_bets WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC`
    ).all(userId);
  } catch (_) {
    return [];
  }
}

/** Teto efetivo do jogo para ESTE jogador: menor entre teto do jogo e saldo. */
function maximoPermitido(userId, idJogo) {
  const cfg = jogoOuPadrao(idJogo);
  const s = saldo(userId);
  const tetoJogo = cfg.max == null ? s.disponivel : Math.min(cfg.max, s.disponivel);
  return {
    min: cfg.min,
    // máximo permitido NESTE momento: nunca maior que o saldo disponível
    max: Math.max(0, Math.floor(tetoJogo)),
    saldo: s.wallet,
    disponivel: s.disponivel,
    limiteDoJogo: cfg.max,
    comprometido: comprometido(userId, cfg.id),
  };
}

/**
 * Converte o texto digitado no valor da aposta.
 * @returns {{ok:boolean, valor?:number, motivo?:string, detalhe?:string}}
 */
function parseValor(entrada, { min = MIN_PADRAO, max = null } = {}) {
  if (entrada === undefined || entrada === null) return { ok: false, motivo: MOTIVO.VAZIO };
  let txt = String(entrada).trim();
  if (!txt) return { ok: false, motivo: MOTIVO.VAZIO };

  // aceita "1.000" / "1,000" (milhar) — mas NÃO "1,50" (centavos)
  const semMilhar = txt.replace(/[.\s](?=\d{3}\b)/g, '');
  if (/^-/.test(semMilhar)) return { ok: false, motivo: MOTIVO.NEGATIVO };
  if (!/^\d+$/.test(semMilhar)) {
    if (/^\d+[,.]\d+$/.test(txt)) return { ok: false, motivo: MOTIVO.DECIMAL };
    return { ok: false, motivo: MOTIVO.MALFORMADO };
  }
  const n = Number(semMilhar);
  if (!Number.isFinite(n)) return { ok: false, motivo: MOTIVO.NAO_FINITO };
  if (!Number.isSafeInteger(n)) return { ok: false, motivo: MOTIVO.MALFORMADO };
  if (n === 0) return { ok: false, motivo: MOTIVO.ZERO };
  if (n < min) return { ok: false, motivo: MOTIVO.ABAIXO_MINIMO, detalhe: `mínimo ${min}` };
  if (max !== null && max !== undefined && n > max) {
    // distingue limite do jogo de saldo insuficiente (são motivos diferentes)
    return { ok: false, motivo: MOTIVO.ACIMA_LIMITE, detalhe: `máximo ${max}` };
  }
  return { ok: true, valor: n };
}

/**
 * Validação completa (usada tanto pela interface quanto, de novo, na hora de
 * cobrar — a interface nunca é a autoridade).
 * @returns {{ok:boolean, motivo?:string, valor?:number, saldo:number, min:number, max:number, disponivel:number, comprometido:number}}
 */
function validarAposta(userId, entrada, jogo) {
  const lim = maximoPermitido(userId, jogo);
  const base = { saldo: lim.saldo, disponivel: lim.disponivel, min: lim.min, max: lim.max, comprometido: lim.comprometido, limiteDoJogo: lim.limiteDoJogo };
  const p = parseValor(entrada, { min: lim.min, max: lim.effectiveMax === undefined ? lim.max : lim.effectiveMax });
  if (!p.ok) {
    // "acima do limite" só existe quando o valor passa o TETO DO JOGO
    // (não confundir com saldo insuficiente)
    let motivo = p.motivo;
    if (p.motivo === MOTIVO.ACIMA_LIMITE && lim.limiteDoJogo != null && Number(entrada) > lim.limiteDoJogo) {
      motivo = MOTIVO.ACIMA_LIMITE;
    } else if (p.motivo === MOTIVO.ACIMA_LIMITE) {
      motivo = MOTIVO.ACIMA_SALDO;
    }
    const sobra = (() => {
      const n = Number(String(entrada).replace(/[.\s](?=\d{3}\b)/g, ''));
      return Number.isFinite(n) ? Math.max(0, n - lim.max) : null;
    })();
    return Object.assign({ ok: false, motivo, detalhe: p.detalhe, falta: sobra }, base);
  }
  if (p.valor > lim.max) return Object.assign({ ok: false, motivo: MOTIVO.ACIMA_SALDO, falta: p.valor - lim.max }, base);
  return Object.assign({ ok: true, valor: p.valor }, base);
}

/** Chave de idempotência de uma cobrança. */
function chaveAposta(userId, game, ref) {
  return `${game}:${userId}:${ref}`;
}

/**
 * Cobra a aposta UMA vez de forma atômica.
 *
 * Ordem (igual à do cassino/tigrinho): trava por usuário → relê o saldo →
 * debita na carteira real → grava a linha no livro-caixa. Se a mesma
 * (user, game, ref) já tiver sido cobrada, devolve a cobrança existente sem
 * mexer no saldo.
 *
 * @param {object} p { userId, game, valor, ref, status }
 * @returns {{id:string, bet:number, saldo:number, duplicado:boolean}}
 */
function cobrarAposta(p) {
  return withLock(p.userId, () => cobrarApostaInterno(p));
}

/**
 * Igual a `cobrarAposta`, mas SEM pegar a trava do usuário.
 * Use apenas quando já estiver dentro de um withLock(userId).
 */
function cobrarApostaInterno({ userId, game, valor, ref, status = 'settled' }) {
  const cfg = jogoOuPadrao(game);
  const id = chaveAposta(userId, cfg.id, String(ref || ''));
  {
    const jaTem = prepare('get_bet', `SELECT * FROM game_bets WHERE id = ?`).get(id);
    if (jaTem) {
      return { id, bet: jaTem.bet, saldo: saldo(userId).wallet, duplicado: true, status: jaTem.status };
    }

    const v = validarAposta(userId, valor, cfg.id);
    if (!v.ok) {
      const err = new Error(v.motivo);
      err.code = 'APOSTA_INVALIDA';
      err.motivo = v.motivo;
      err.saldo = v.saldo;
      err.max = v.max;
      err.min = v.min;
      throw err;
    }

    const tx = getDb().transaction(() => {
      // relê dentro da transação: entre a validação e aqui, outra operação
      // (outro jogo, outro comando) pode ter mexido no saldo
      const antes = saldo(userId).wallet;
      if (antes < v.valor) {
        const err = new Error(MOTIVO.ACIMA_SALDO);
        err.code = 'APOSTA_INVALIDA';
        err.motivo = MOTIVO.ACIMA_SALDO;
        err.saldo = antes;
        throw err;
      }
      economy.addWallet(userId, -v.valor);
      prepare(
        'ins_bet',
        `INSERT INTO game_bets (id, user_id, game, bet, status, reward, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(id, userId, cfg.id, v.valor, status, String(ref || ''), new Date().toISOString());
      return saldo(userId).wallet;
    });
    const depois = tx();
    logger.info({ user: userId, game: cfg.id, bet: v.valor }, '[JOGOS] aposta cobrada');
    return { id, bet: v.valor, saldo: depois, duplicado: false, status };
  }
}

/**
 * Credita o prêmio UMA vez (idempotente pelo id da aposta).
 * Se a aposta já estiver liquidada, devolve o saldo atual sem pagar de novo.
 */
function pagarPremio(betId, reward, opts = {}) {
  const linha = prepare('get_bet', `SELECT * FROM game_bets WHERE id = ?`).get(betId);
  if (!linha) {
    const err = new Error('APOSTA_NAO_ENCONTRADA');
    err.code = 'APOSTA_NAO_ENCONTRADA';
    throw err;
  }
  return withLock(linha.user_id, () => pagarPremioInterno(betId, reward, opts));
}

/**
 * Igual a `pagarPremio`, mas SEM pegar a trava do usuário (idempotente pelo id
 * da aposta). Use apenas quando já estiver dentro de um withLock(userId).
 */
function pagarPremioInterno(betId, reward, { status = 'settled' } = {}) {
  {
    const atual = prepare('get_bet', `SELECT * FROM game_bets WHERE id = ?`).get(betId);
    if (atual.status === 'settled' && atual.reward > 0) {
      // já pago: devolve sem creditar de novo
      return { saldo: saldo(atual.user_id).wallet, reward: atual.reward, duplicado: true };
    }
    const premio = Math.max(0, Math.floor(Number(reward) || 0));
    const tx = getDb().transaction(() => {
      if (premio > 0) economy.addWallet(atual.user_id, premio);
      prepare('set_bet_done', `UPDATE game_bets SET status = ?, reward = ?, settled_at = ? WHERE id = ?`).run(
        status,
        atual.reward + premio,
        new Date().toISOString(),
        betId
      );
      return saldo(atual.user_id).wallet;
    });
    const depois = tx();
    if (premio > 0) logger.info({ user: atual.user_id, bet: betId, reward: premio }, '[JOGOS] prêmio creditado');
    return { saldo: depois, reward: premio, duplicado: false };
  }
}

/** Marca a aposta como usada (partida/rodada concluída) sem pagar nada. */
function liquidar(betId, reward = 0) {
  const atual = prepare('get_bet', `SELECT * FROM game_bets WHERE id = ?`).get(betId);
  if (!atual) return { saldo: null };
  return pagarPremio(betId, reward, { status: 'settled' });
}

/** Igual a `liquidar`, sem pegar trava (para uso dentro de withLock(userId)). */
function liquidarInterno(betId, reward = 0) {
  const atual = prepare('get_bet', `SELECT * FROM game_bets WHERE id = ?`).get(betId);
  if (!atual) return { saldo: null };
  return pagarPremioInterno(betId, reward, { status: 'settled' });
}

/** Histórico de apostas do jogador (auditoria/limite). */
function historico(userId, limit = 10) {
  const n = Math.min(50, Math.max(1, Math.floor(Number(limit) || 10)));
  return prepare(
    'hist_bets',
    `SELECT * FROM game_bets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(userId, n);
}

module.exports = {
  MOTIVO,
  JOGOS,
  saldo,
  comprometido,
  pendentes,
  maximoPermitido,
  parseValor,
  validarAposta,
  chaveAposta,
  cobrarAposta,
  cobrarApostaInterno,
  pagarPremio,
  pagarPremioInterno,
  liquidar,
  liquidarInterno,
  historico,
};
