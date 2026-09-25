/**
 * database/treasure.js — armazenamento e regras de ESTADO do 🗺️ CAÇA AO TESOURO.
 *
 * Camadas separadas (padrão do projeto):
 *   lógica pura   → utils/treasureGame.js   (mapa, pistas, pagamento)
 *   financeiro    → utils/gameWallet.js     (carteira REAL + idempotência)
 *   storage/regra → este arquivo            (partida, escavações, fim)
 *   interface     → commands/games/cacatesouro.js
 *
 * O MAPA VERDADEIRO (posição dos tesouros e das armadilhas) fica AQUI, no banco
 * (coluna `secret`), e nunca sai daqui: o que vai para o HTML/texto é só o que
 * o jogador já escavou, a dica daquela casa e os contadores.
 *
 * Garantias:
 *   - a aposta é cobrada UMA vez, na criação (utils/gameWallet.cobrarAposta,
 *     com chave de idempotência = id da mensagem/partida);
 *   - cada casa só pode ser escavada uma vez; repetir a MESMA ação (mensagem
 *     retransmitida, clique duplo) devolve o mesmo estado sem cobrar/pagar de novo;
 *   - o prêmio é creditado UMA vez (gameWallet.pagarPremio, idempotente pelo id
 *     da aposta);
 *   - qualquer casa só é aceita do DONO da partida, na partida certa e dentro
 *     do mapa; partida encerrada/expirada recusa ação;
 *   - partidas e escavações são persistidas: reiniciar o bot NÃO apaga nada.
 *
 * Expiração: cada expedição tem `expires_at` (TTL de inatividade). Nada de
 * timer por partida: a limpeza roda sob demanda (`limparExpiradas()`, chamada
 * quando o jogador abre/cria uma expedição).
 */

'use strict';

const crypto = require('crypto');
const { prepare } = require('./database');
const { withLock } = require('../utils/keyedMutex');
const wallet = require('../utils/gameWallet');
const jogo = require('../utils/treasureGame');
const games = require('./games');
const logger = require('../utils/logger').child('treasure');

const EXEMPLO = '__exemplo__';
const TTL_INATIVA_MS = 30 * 60 * 1000; // 30 min sem mexer → expira

const STATUS = {
  ATIVA: 'active',
  VITORIA: 'won',
  DERROTA: 'lost',
  ENCERRADA: 'closed',
  EXPIRADA: 'expired',
};

const MOTIVO = {
  NAO_ENCONTRADA: 'Partida não encontrada. Use o comando do caça ao tesouro para abrir uma nova.',
  NAO_E_SUA: 'Esta partida é de outro jogador.',
  ENCERRADA: 'Esta expedição já foi encerrada.',
  EXPIRADA: 'Esta expedição expirou (ficou muito tempo sem escavação).',
  COORD_INVALIDA: 'Coordenada fora do mapa desta expedição.',
  JA_ESCAVADA: 'Esta casa já foi escavada — consultar de novo não gasta escavação nem paga prêmio.',
  SEM_ESCAVACOES: 'Suas escavações acabaram.',
};

const agora = () => new Date().toISOString();
const emMs = (ms) => new Date(Date.now() + ms).toISOString();

function idDeExpedicao(userId, ref) {
  if (!ref) return `tg_${crypto.randomUUID()}`;
  return `tg_${crypto.createHash('sha1').update(`${userId}|${ref}`).digest('hex').slice(0, 20)}`;
}

function parseJson(txt, padrao) {
  try {
    const v = JSON.parse(txt);
    return v === null || v === undefined ? padrao : v;
  } catch (_) {
    return padrao;
  }
}

/** Linha do banco → objeto de domínio (com o segredo separado). */
function hidratar(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    chatId: row.chat_id,
    size: row.size,
    status: row.status,
    bet: row.bet,
    reward: row.reward,
    digsTotal: row.digs_total,
    digsUsed: row.digs_used,
    treasuresTotal: row.treasures_total,
    treasuresFound: row.treasures_found,
    trapsTotal: row.traps_total,
    secret: parseJson(row.secret, {}),
    revealed: parseJson(row.revealed, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    finishedAt: row.finished_at,
  };
}

function get(id) {
  return hidratar(prepare('get_treasure', `SELECT * FROM treasure_games WHERE id = ?`).get(String(id || '')));
}

/**
 * Expira UMA expedição parada. Sem trava própria: quem chama já está dentro de
 * um withLock(userId) (withLock NÃO é reentrante — ver utils/gameWallet.js).
 */
function expirarUma(id) {
  const g = get(id);
  if (!g || g.status !== STATUS.ATIVA) return false;
  const agoraIso = agora();
  prepare(
    'expira_treasure',
    `UPDATE treasure_games SET status = ?, updated_at = ?, finished_at = ? WHERE id = ?`
  ).run(STATUS.EXPIRADA, agoraIso, agoraIso, g.id);
  // a aposta já foi cobrada e NÃO é devolvida (regra mostrada antes de confirmar);
  // o livro-caixa é fechado para não ficar pendente para sempre.
  if (g.bet > 0) {
    try {
      wallet.liquidarInterno(`cacatesouro:${g.userId}:${g.id}`, 0);
    } catch (err) {
      logger.warn({ err: err && err.message, partida: g.id }, 'não consegui fechar a aposta da expedição expirada');
    }
  }
  logger.info({ partida: g.id, user: g.userId }, '[TESOURO] expedição expirada');
  return true;
}

/** Expedições paradas há muito tempo (TTL de inatividade). */
function idsExpiradas() {
  return prepare(
    'lista_expiradas',
    `SELECT id, user_id FROM treasure_games WHERE status = ? AND expires_at <> '' AND expires_at < ?`
  ).all(STATUS.ATIVA, agora());
}

/**
 * Expira as partidas paradas SEM pegar trava: só use quando JÁ estiver dentro de
 * um withLock(userId).
 */
function limparExpiradasInterno() {
  const alvo = idsExpiradas();
  let n = 0;
  for (const row of alvo) if (expirarUma(row.id)) n++;
  return n;
}

/**
 * Expira partidas paradas sob demanda (sem timer por partida): trava por
 * usuário, uma partida por vez, para não mexer em saldo sem trava.
 */
function limparExpiradas() {
  const alvo = idsExpiradas();
  for (const row of alvo) {
    const r = withLock(row.user_id, () => expirarUma(row.id));
    if (r && typeof r.catch === 'function') r.catch(() => {});
  }
  return alvo.length;
}

/**
 * Expedição ATIVA do jogador (se houver).
 * @param {object} [opts] { semTrava } — use semTrava quando JÁ estiver dentro de
 *        um withLock(userId).
 */
function ativaDo(userId, { semTrava = false } = {}) {
  if (semTrava) limparExpiradasInterno();
  else limparExpiradas();
  const row = prepare(
    'ativa_treasure',
    `SELECT * FROM treasure_games WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1`
  ).get(userId, STATUS.ATIVA);
  return hidratar(row);
}

/**
 * Cria a expedição e cobra a aposta UMA vez.
 *
 * `casual: true` (ou `bet` 0) cria a expedição SEM tocar na carteira: é o modo
 * de quem ainda não tem personagem/cadastro no RPG/vida — joga por pontuação.
 *
 * @returns {{game:object, cobranca:object}}
 */
function criarExpedicao({ userId, chatId, size, bet, ref, casual = false }) {
  const cfg = jogo.configDoTabuleiro(size);
  return withLock(userId, () => {
    limparExpiradasInterno();
    const id = idDeExpedicao(userId, ref);
    const existente = get(id);
    if (existente) return { game: existente, cobranca: { duplicado: true, bet: existente.bet, saldo: wallet.saldo(userId).wallet } };

    // uma expedição por vez: a MESMA aposta não paga duas mesas abertas ao mesmo
    // tempo (mensagem repetida cai no `existente` acima; aqui é jogador abrindo
    // outra partida com o jogo em andamento)
    const emAndamento = ativaDo(userId, { semTrava: true });
    if (emAndamento) {
      return {
        game: emAndamento,
        cobranca: { duplicado: true, jaAtiva: true, bet: emAndamento.bet, saldo: wallet.saldo(userId).wallet },
      };
    }

    const semCarteira = casual === true || !(Number(bet) > 0);
    // 1) cobra a aposta pela camada financeira comum (idempotente pela ref)
    //    no modo casual NÃO existe cobrança: nenhuma linha no livro-caixa
    const cobranca = semCarteira
      ? { id: null, bet: 0, saldo: wallet.saldo(userId).wallet, duplicado: false, casual: true }
      : wallet.cobrarApostaInterno({ userId, game: 'cacatesouro', valor: bet, ref: id, status: 'pending' });

    // 2) sorteia o mapa verdadeiro (segredo do backend) e grava a partida
    const mapa = jogo.gerarMapa(cfg.size);
    const agoraIso = agora();
    prepare(
      'ins_treasure',
      `INSERT INTO treasure_games
         (id, user_id, chat_id, size, status, bet, reward, digs_total, digs_used,
          treasures_total, treasures_found, traps_total, secret, revealed,
          created_at, updated_at, expires_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, 0, ?, ?, '[]', ?, ?, ?, '')`
    ).run(
      id,
      userId,
      String(chatId || ''),
      cfg.size,
      STATUS.ATIVA,
      cobranca.bet,
      cfg.escavacoes,
      cfg.tesouros,
      cfg.armadilhas,
      JSON.stringify(mapa),
      agoraIso,
      agoraIso,
      emMs(TTL_INATIVA_MS)
    );
    logger.info({ partida: id, user: userId, size: cfg.size, bet: cobranca.bet }, '[TESOURO] expedição criada');
    return { game: get(id), cobranca };
  });
}

/** Recusa educada para uma ação inválida. */
function recusa(motivo, extra = {}) {
  return Object.assign({ ok: false, motivo }, extra);
}

/**
 * Escava uma casa. Toda validação é refeita aqui (o HTML não é autoridade).
 * @returns {{ok:boolean, motivo?:string, game?:object, casa?:object, premiado?:object}}
 */
function cavar({ id, userId, coord, ref }) {
  return withLock(userId, () => {
    const g = get(id);
    if (!g) return recusa(MOTIVO.NAO_ENCONTRADA);
    if (g.userId !== userId) return recusa(MOTIVO.NAO_E_SUA, { dono: g.userId });

    // mensagem repetida/retransmitida: devolve o MESMO resultado, sem efeito
    const repetida = ref ? g.revealed.find((c) => c.ref && c.ref === ref) : null;
    if (repetida) return { ok: true, game: g, casa: repetida, repetida: true };

    if (g.status === STATUS.EXPIRADA || (g.expiresAt && g.expiresAt < agora() && g.status === STATUS.ATIVA)) {
      if (g.status === STATUS.ATIVA) {
        prepare('expira_treasure', `UPDATE treasure_games SET status = ?, updated_at = ?, finished_at = ? WHERE id = ?`).run(
          STATUS.EXPIRADA,
          agora(),
          agora(),
          g.id
        );
      }
      return recusa(MOTIVO.EXPIRADA, { game: get(g.id) });
    }
    if (g.status !== STATUS.ATIVA) return recusa(MOTIVO.ENCERRADA, { game: g });

    const pos = jogo.parseCoord(coord, g.size);
    if (!pos) return recusa(MOTIVO.COORD_INVALIDA, { game: g });

    const idx = jogo.idxDe(pos.x, pos.y, g.size);
    if (g.revealed.some((c) => c.idx === idx)) return recusa(MOTIVO.JA_ESCAVADA, { game: g, casa: g.revealed.find((c) => c.idx === idx) });
    if (g.digsUsed >= g.digsTotal) return recusa(MOTIVO.SEM_ESCAVACOES, { game: g });

    const conteudo = jogo.conteudoDaCasa(g.secret, idx);
    const dica = jogo.dicaDoMapa(g.secret, g.size, idx);
    const casa = {
      idx,
      c: pos.coord,
      k: conteudo, // 't' tesouro · 'a' armadilha · 'v' vazio
      d: dica, // quantos tesouros nas 8 casas vizinhas
      at: agora(),
      ref: ref || '',
    };

    const reveladas = g.revealed.concat([casa]);
    const achou = conteudo === 't';
    const tesourosEncontrados = g.treasuresFound + (achou ? 1 : 0);
    // armadilha: além de gastar a escavação, queima mais uma (regra anunciada)
    const gastas = g.digsUsed + (conteudo === 'a' ? 2 : 1);
    const digsUsadas = Math.min(g.digsTotal, gastas);

    const completo = tesourosEncontrados >= g.treasuresTotal;
    const semEscavacoes = digsUsadas >= g.digsTotal;
    const terminou = completo || semEscavacoes;

    let premiado = null;
    let premio = 0;
    if (terminou) {
      const calc = jogo.calcularRecompensa({
        bet: g.bet,
        size: g.size,
        encontrados: tesourosEncontrados,
        total: g.treasuresTotal,
      });
      premio = calc.total;
      premiado = calc;
    }

    const statusNovo = !terminou
      ? STATUS.ATIVA
      : completo
        ? STATUS.VITORIA
        : STATUS.DERROTA;

    const tx = require('./database').get().transaction(() => {
      prepare(
        'upd_treasure_dig',
        `UPDATE treasure_games
            SET revealed = ?, digs_used = ?, treasures_found = ?, status = ?,
                reward = ?, updated_at = ?, expires_at = ?, finished_at = ?
          WHERE id = ?`
      ).run(
        JSON.stringify(reveladas),
        digsUsadas,
        tesourosEncontrados,
        statusNovo,
        terminou ? premio : g.reward,
        agora(),
        terminou ? '' : emMs(TTL_INATIVA_MS),
        terminou ? agora() : '',
        g.id
      );
    });
    tx();

    let xpGanho = null;
    if (terminou) {
      if (g.bet > 0) {
        // prêmio creditado UMA vez (idempotente pelo id da aposta)
        try {
          wallet.pagarPremioInterno(`cacatesouro:${g.userId}:${g.id}`, premio);
        } catch (err) {
          logger.error({ err: err && err.message, partida: g.id }, '[TESOURO] falha ao creditar prêmio — recuperável pelo id da aposta');
        }
      }
      try {
        games.recordGame(g.userId, 'cacatesouro', completo ? 'win' : 'loss');
      } catch (_) {
        /* estatística é secundária: nunca derruba a partida */
      }
      // XP vale para TODA expedição que termina (o casual entra aqui também:
      // "vale XP e estatística" — só não movimenta moeda)
      xpGanho = premiarXp(g, tesourosEncontrados, completo);
    }

    const atual = get(g.id);
    return {
      ok: true,
      game: atual,
      casa,
      premiado,
      terminou,
      venceu: completo,
      xp: xpGanho,
    };
  });
}

/** XP da expedição (não é moeda). Fonte única dos números: aqui e no texto das regras. */
const XP_POR_TESOURO = 5;
const XP_VITORIA = 20;

/** XP como recompensa de expedição — usa os serviços do RPG/vida existentes. */
function premiarXp(g, encontrados, completo) {
  const ganho = (Number(encontrados) || 0) * XP_POR_TESOURO + (completo ? XP_VITORIA : 0);
  if (ganho <= 0) return null;
  try {
    const life = require('./life');
    const rpg = require('./rpg');
    const p = life.getPlayer(g.userId);
    if (p && p.name) {
      life.addLifeXp(g.userId, ganho);
      return { tipo: 'life', ganho };
    }
    rpg.addRpgXp(g.userId, Math.max(1, Math.round(ganho / 2)));
    return { tipo: 'rpg', ganho: Math.max(1, Math.round(ganho / 2)) };
  } catch (err) {
    logger.warn({ err: err && err.message }, 'xp da expedição não registrado');
    return null;
  }
}

/** Encerra a expedição a pedido do jogador (a aposta NÃO volta). */
function sair({ id, userId, ref }) {
  return withLock(userId, () => {
    let g = get(id);
    if (!g) {
      // permite `sair` sem id: pega a ativa
      g = ativaDo(userId, { semTrava: true });
      if (!g) return recusa(MOTIVO.NAO_ENCONTRADA);
    }
    if (g.userId !== userId) return recusa(MOTIVO.NAO_E_SUA);
    if (ref && g.revealed.some((c) => c.ref === ref && c.k === EXEMPLO)) return { ok: true, game: g, repetida: true };
    if (g.status !== STATUS.ATIVA) return recusa(MOTIVO.ENCERRADA, { game: g });

    const calc = jogo.calcularRecompensa({
      bet: g.bet,
      size: g.size,
      encontrados: g.treasuresFound,
      total: g.treasuresTotal,
    });
    // sem bônus de vitória: encerrar não é completar
    const premio = calc.porTesouro * g.treasuresFound;

    prepare(
      'fim_treasure',
      `UPDATE treasure_games SET status = ?, reward = ?, updated_at = ?, finished_at = ?, expires_at = '' WHERE id = ?`
    ).run(STATUS.ENCERRADA, premio, agora(), agora(), g.id);

    if (g.bet > 0) {
      try {
        wallet.pagarPremioInterno(`cacatesouro:${g.userId}:${g.id}`, premio);
      } catch (err) {
        logger.error({ err: err && err.message, partida: g.id }, '[TESOURO] falha ao creditar no encerramento');
      }
    }
    // XP pelo que já foi achado (sem bônus de vitória: encerrar não é completar)
    const xpGanho = premiarXp(g, g.treasuresFound, false);
    logger.info({ partida: g.id, user: userId, premio, xp: xpGanho && xpGanho.ganho }, '[TESOURO] expedição encerrada pelo jogador');
    return {
      ok: true,
      game: get(g.id),
      premiado: { total: premio, porTesouro: calc.porTesouro, bonus: 0, completo: false },
      xp: xpGanho,
    };
  });
}

/** Histórico do jogador (últimas expedições). */
function historico(userId, limit = 5) {
  const n = Math.min(20, Math.max(1, Math.floor(Number(limit) || 5)));
  return prepare(
    'hist_treasure',
    `SELECT * FROM treasure_games WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(userId, n).map(hidratar);
}

/** Estatísticas do jogador (para o painel). */
function estatisticas(userId) {
  const row = prepare(
    'stats_treasure',
    `SELECT
       COUNT(*) AS jogos,
       SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS vitorias,
       SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS derrotas,
       COALESCE(SUM(treasures_found), 0) AS tesouros,
       COALESCE(SUM(bet), 0) AS apostado,
       COALESCE(SUM(reward), 0) AS recebido
     FROM treasure_games WHERE user_id = ?`
  ).get(STATUS.VITORIA, STATUS.DERROTA, userId);
  return {
    jogos: Number(row.jogos) || 0,
    vitorias: Number(row.vitorias) || 0,
    derrotas: Number(row.derrotas) || 0,
    tesouros: Number(row.tesouros) || 0,
    apostado: Number(row.apostado) || 0,
    recebido: Number(row.recebido) || 0,
  };
}

module.exports = {
  XP_POR_TESOURO,
  XP_VITORIA,
  STATUS,
  MOTIVO,
  TTL_INATIVA_MS,
  EXEMPLO,
  get,
  ativaDo,
  criarExpedicao,
  cavar,
  sair,
  limparExpiradas,
  limparExpiradasInterno,
  historico,
  estatisticas,
  idDeExpedicao,
};
