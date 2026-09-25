/**
 * database/expeditions.js — Expedições Solo do RPG com etapas, escolhas e persistência.
 *
 * Características:
 * - Rotas pré-definidas com requisitos, custos de energia, etapas e riscos
 * - Sessões persistentes no SQLite (sobrevivem a reinicializações)
 * - Escolhas com consequências balanceadas (sem IA externa, determinístico)
 * - Validação estrita de etapa atual e idempotência de decisões
 * - Concessão de recompensas e registro no extrato (economy_ledger)
 * - Integração com missões de exploração
 */

'use strict';

const db = require('./database');
const economy = require('./economy');
const rpg = require('./rpg');
const { withLock } = require('../utils/keyedMutex');

const EXPEDITION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 horas para concluir

const ROUTES = [
  {
    id: 'floresta',
    name: 'Floresta dos Ecos Silenciosos',
    emoji: '🌲',
    difficulty: 'Fácil',
    minLevel: 1,
    energyCost: 15,
    stagesCount: 3,
    description: 'Trilhas verdejantes repletas de animais silvestres e plantas medicinais.',
    baseRewardCoins: 150,
    baseRewardXp: 40,
    possibleItems: ['comida', 'fertilizante', 'isca'],
    stages: [
      {
        text: 'Você adentra a floresta densa e avista uma bifurcação entre uma clareira ensolarada e uma trilha sombria de arbustos espinhosos.',
        choices: [
          {
            id: 'clareira',
            label: 'Seguir pela clareira ensolarada',
            risk: 'Baixo',
            outcomeText: 'Você encontra um riacho calmo e colhe algumas frutas revigorantes.',
            damage: 0,
            rewardBonus: 20,
          },
          {
            id: 'arbustos',
            label: 'Atravessar os arbustos espinhosos',
            risk: 'Médio',
            outcomeText: 'Você se arranha nos espinhos, mas descobre um ninho de ervas raras.',
            damage: 5,
            rewardBonus: 50,
          },
        ],
      },
      {
        text: 'Ao avançar, um javali selvagem bloqueia o caminho, farejando o solo irritado.',
        choices: [
          {
            id: 'enfrentar',
            label: 'Enfrentar o javali com sua arma',
            risk: 'Médio',
            outcomeText: 'Você vence o javali após um combate ágil e recolhe seus despojos.',
            damage: 10,
            rewardBonus: 60,
          },
          {
            id: 'desviar',
            label: 'Escalar uma árvore e contornar em silêncio',
            risk: 'Baixo',
            outcomeText: 'Você passa despercebido sem gastar forças adicionais.',
            damage: 0,
            rewardBonus: 10,
          },
        ],
      },
      {
        text: 'No coração da floresta, você encontra um santuário vegetal com uma estátua coberta de hera.',
        choices: [
          {
            id: 'oferenda',
            label: 'Fazer uma oração de respeito ao santuário',
            risk: 'Nenhum',
            outcomeText: 'Uma suave luz verde abençoa sua jornada final com serenidade.',
            damage: 0,
            rewardBonus: 40,
          },
          {
            id: 'investigar',
            label: 'Investigar a base oca da estátua',
            risk: 'Baixo',
            outcomeText: 'Você descobre um compartimento secreto com suprimentos antigos.',
            damage: 0,
            rewardBonus: 70,
          },
        ],
      },
    ],
  },
  {
    id: 'caverna',
    name: 'Caverna dos Cristais Cintilantes',
    emoji: '🪨',
    difficulty: 'Média',
    minLevel: 3,
    energyCost: 25,
    stagesCount: 3,
    description: 'Túneis subterrâneos úmidos ricos em jazidas minerais e perigos ocultos.',
    baseRewardCoins: 350,
    baseRewardXp: 80,
    possibleItems: ['carvao', 'cobre', 'pedra'],
    stages: [
      {
        text: 'A entrada da caverna é fria e estreita. O som de gotas d\'água ecoa nas paredes rochosas.',
        choices: [
          {
            id: 'tocha',
            label: 'Acender uma tocha e caminhar devagar',
            risk: 'Baixo',
            outcomeText: 'A luz revela estalactites pontiagudas e você desvia com facilidade.',
            damage: 0,
            rewardBonus: 30,
          },
          {
            id: 'pressa',
            label: 'Apressar o passo pela escuridão guiando-se pelo eco',
            risk: 'Alto',
            outcomeText: 'Você tropeça numa fenda de cascalho, mas acha uma veia de carvão exposta.',
            damage: 15,
            rewardBonus: 80,
          },
        ],
      },
      {
        text: 'Você chega a um lago subterrâneo com reflexos azulados. Uma ponte de pedra natural parece frágil.',
        choices: [
          {
            id: 'nadar',
            label: 'Nadar pelas águas geladas do lago',
            risk: 'Médio',
            outcomeText: 'A água é congelante, mas você recolhe pequenas pedras brilhantes do fundo.',
            damage: 10,
            rewardBonus: 70,
          },
          {
            id: 'ponte',
            label: 'Cruzar a ponte de pedra com cautela',
            risk: 'Médio',
            outcomeText: 'A ponte range mas aguenta seu peso sem maiores incidentes.',
            damage: 0,
            rewardBonus: 40,
          },
        ],
      },
      {
        text: 'No fundo da caverna, uma câmara com cristais gigantes emite um zumbido pulsante.',
        choices: [
          {
            id: 'minerar',
            label: 'Extrair fragmentos dos cristais mais altos',
            risk: 'Médio',
            outcomeText: 'Você extrai minerais raros antes que a vibração balance as pedras!',
            damage: 5,
            rewardBonus: 100,
          },
          {
            id: 'descansar',
            label: 'Absorver a energia pura emanada pela gruta',
            risk: 'Baixo',
            outcomeText: 'A energia cristalina revigora sua mente e você recolhe os minérios soltos.',
            damage: 0,
            rewardBonus: 60,
          },
        ],
      },
    ],
  },
  {
    id: 'ruinas',
    name: 'Ruínas Antigas do Templo Abandonado',
    emoji: '🏛️',
    difficulty: 'Difícil',
    minLevel: 5,
    energyCost: 35,
    stagesCount: 3,
    description: 'Vestígios de uma civilização esquecida guardados por armadilhas e enigmas.',
    baseRewardCoins: 650,
    baseRewardXp: 150,
    possibleItems: ['prata', 'ouro', 'pocao_energia'],
    stages: [
      {
        text: 'Os portões de pedra do templo possuem três inscrições rúnicas quase apagadas pelo tempo.',
        choices: [
          {
            id: 'decifrar',
            label: 'Tentar decifrar os glifos e desativar o mecanismo',
            risk: 'Médio',
            outcomeText: 'Você resolve o quebra-cabeça e o portão se abre sem acionar dardos!',
            damage: 0,
            rewardBonus: 80,
          },
          {
            id: 'forcar',
            label: 'Forçar a passagem arrombando as dobradiças de bronze',
            risk: 'Alto',
            outcomeText: 'O portão cede, mas o impacto derruba alvenaria sobre seu ombro.',
            damage: 20,
            rewardBonus: 50,
          },
        ],
      },
      {
        text: 'O corredor principal é ladeado por estátuas de guerreiros segurando espadas enferrujadas.',
        choices: [
          {
            id: 'corredor',
            label: 'Avançar pisando apenas nos ladrilhos sem entalhe',
            risk: 'Médio',
            outcomeText: 'Você evita pisos falsos de pressão com maestria.',
            damage: 0,
            rewardBonus: 60,
          },
          {
            id: 'altares',
            label: 'Examinar os altares laterais em busca de relíquias',
            risk: 'Alto',
            outcomeText: 'Um dardo oculto dispara e te acerta de raspão, mas você recolhe um ornamento de prata!',
            damage: 15,
            rewardBonus: 120,
          },
        ],
      },
      {
        text: 'Na antecâmara final, repousa o sarcófago do sumo-sacerdote com um baú de ferro lacrado.',
        choices: [
          {
            id: 'abrir_bau',
            label: 'Desarmar cuidadosamente a fechadura do baú',
            risk: 'Médio',
            outcomeText: 'A tranca cede revelando o tesouro do templo intacto!',
            damage: 0,
            rewardBonus: 150,
          },
          {
            id: 'pegar_tudo',
            label: 'Quebrar o cadeado e recolher tudo que puder carregar',
            risk: 'Alto',
            outcomeText: 'Gás sonífero escapa do cofre, mas você escapa a tempo com as riquezas!',
            damage: 10,
            rewardBonus: 130,
          },
        ],
      },
    ],
  },
];

function getRoute(routeId) {
  return ROUTES.find((r) => r.id.toLowerCase() === String(routeId).toLowerCase()) || null;
}

/** Obtém a expedição ativa do jogador (se houver e não expirada). */
function getActiveExpedition(userId) {
  const row = db.prepare(
    'get_active_expedition',
    `SELECT * FROM rpg_expeditions WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`
  ).get(userId);

  if (!row) return null;

  if (Date.now() > row.expires_at) {
    db.prepare('expire_expedition', `UPDATE rpg_expeditions SET status = 'expired' WHERE id = ?`).run(row.id);
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    routeId: row.route_id,
    stage: row.stage,
    maxStages: row.max_stages,
    status: row.status,
    data: JSON.parse(row.data || '{}'),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Inicia uma nova expedição. */
async function startExpedition(userId, routeId) {
  const route = getRoute(routeId);
  if (!route) throw new Error(`Rota "${routeId}" não encontrada. Escolha: floresta, caverna ou ruinas.`);

  return withLock(userId, async () => {
    const existing = getActiveExpedition(userId);
    if (existing) {
      throw new Error(`Você já possui uma expedição ativa na rota "${existing.routeId}". Use !expedicao continuar.`);
    }

    const player = rpg.getPlayer(userId);
    if (player.level < route.minLevel) {
      throw new Error(`Nível insuficiente. Você precisa ser pelo menos nível ${route.minLevel} para explorar ${route.name}.`);
    }

    if (player.energy < route.energyCost) {
      throw new Error(`Energia insuficiente. Necessário: ⚡ ${route.energyCost} (Você tem: ⚡ ${player.energy}).`);
    }

    const expId = `exp-${Date.now()}-${userId.split('@')[0]}`;
    const nowIso = new Date().toISOString();
    const expiresAt = Date.now() + EXPEDITION_TIMEOUT_MS;

    const initialData = {
      choices: [],
      damageTaken: 0,
      rewardBonus: 0,
      eventsLog: [],
    };

    const tx = db.get().transaction(() => {
      // Consumir energia do jogador
      db.prepare('dec_rpg_energy', `UPDATE rpg_players SET energy = MAX(0, energy - ?) WHERE user_id = ?`).run(
        route.energyCost,
        userId
      );

      db.prepare(
        'insert_expedition',
        `INSERT INTO rpg_expeditions (id, user_id, route_id, stage, max_stages, status, data, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, 1, ?, 'active', ?, ?, ?, ?)`
      ).run(expId, userId, route.id, route.stagesCount, JSON.stringify(initialData), nowIso, nowIso, expiresAt);
    });

    tx();

    return {
      expeditionId: expId,
      route,
      currentStage: 1,
      stageData: route.stages[0],
    };
  });
}

/** Executa uma escolha na etapa atual da expedição. */
async function chooseOption(userId, expeditionId, choiceId) {
  return withLock(userId, async () => {
    const exp = getActiveExpedition(userId);
    if (!exp) throw new Error('Nenhuma expedição ativa encontrada.');
    if (expeditionId && exp.id !== expeditionId) {
      throw new Error('Identificador de expedição divergente da sua partida ativa.');
    }

    const route = getRoute(exp.routeId);
    if (!route) throw new Error('Rota corrompida.');

    const currentStageIndex = exp.stage - 1;
    const stageDef = route.stages[currentStageIndex];
    if (!stageDef) throw new Error('Etapa inválida.');

    const selectedChoice = stageDef.choices.find((c) => c.id.toLowerCase() === String(choiceId).toLowerCase());
    if (!selectedChoice) {
      const validLabels = stageDef.choices.map((c) => c.id).join(' ou ');
      throw new Error(`Escolha inválida. Opções disponíveis: ${validLabels}`);
    }

    // Atualiza estado da expedição
    const nextStage = exp.stage + 1;
    const isCompleted = nextStage > route.stagesCount;

    exp.data.choices.push({
      stage: exp.stage,
      choiceId: selectedChoice.id,
      damage: selectedChoice.damage,
      rewardBonus: selectedChoice.rewardBonus,
    });
    exp.data.damageTaken += selectedChoice.damage;
    exp.data.rewardBonus += selectedChoice.rewardBonus;
    exp.data.eventsLog.push(selectedChoice.outcomeText);

    const nowIso = new Date().toISOString();
    let finalReward = null;

    const tx = db.get().transaction(() => {
      if (isCompleted) {
        // Conclusão com sucesso!
        const totalCoins = route.baseRewardCoins + exp.data.rewardBonus;
        const totalXp = route.baseRewardXp;

        // Selecionar um item aleatório possível da rota
        let droppedItem = null;
        if (route.possibleItems && route.possibleItems.length > 0) {
          const randItem = route.possibleItems[Math.floor(Math.random() * route.possibleItems.length)];
          droppedItem = rpg.getShopItem(randItem);
          if (droppedItem) {
            economy.addItem(userId, droppedItem.id, 1);
            const collections = require('./collections');
            collections.recordDiscovery(userId, droppedItem.id);
          }
        }

        // Registrar moeda no extrato (economy_ledger)
        const opKey = `expedition-complete-${exp.id}`;
        economy.applyIdempotentOperation(
          opKey,
          userId,
          totalCoins,
          'recompensa_expedicao',
          `Conclusão da expedição "${route.name}"`
        );

        rpg.addRpgXp(userId, totalXp);

        // Integrar com missões do Lua Life (se aplicável)
        try {
          const life = require('./life');
          life.addMissionProgress(userId, 'explore', 1);
        } catch (_) {}

        finalReward = {
          coins: totalCoins,
          xp: totalXp,
          item: droppedItem,
        };

        db.prepare(
          'complete_expedition',
          `UPDATE rpg_expeditions SET stage = ?, status = 'completed', data = ?, updated_at = ? WHERE id = ?`
        ).run(exp.stage, JSON.stringify(exp.data), nowIso, exp.id);
      } else {
        // Avançar para próxima etapa
        db.prepare(
          'advance_expedition',
          `UPDATE rpg_expeditions SET stage = ?, data = ?, updated_at = ? WHERE id = ?`
        ).run(nextStage, JSON.stringify(exp.data), nowIso, exp.id);
      }
    });

    tx();

    return {
      expeditionId: exp.id,
      route,
      stageNumber: exp.stage,
      outcomeText: selectedChoice.outcomeText,
      damageTaken: selectedChoice.damage,
      isCompleted,
      nextStage: isCompleted ? null : nextStage,
      nextStageData: isCompleted ? null : route.stages[nextStage - 1],
      finalReward,
    };
  });
}

/** Desiste da expedição ativa. */
async function abandonExpedition(userId) {
  return withLock(userId, async () => {
    const exp = getActiveExpedition(userId);
    if (!exp) throw new Error('Você não possui nenhuma expedição em andamento.');

    db.prepare('abandon_expedition', `UPDATE rpg_expeditions SET status = 'abandoned', updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      exp.id
    );

    return exp;
  });
}

module.exports = {
  ROUTES,
  getRoute,
  getActiveExpedition,
  startExpedition,
  chooseOption,
  abandonExpedition,
};
