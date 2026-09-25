/**
 * commands/rpg/expedicao.js — Expedições solo com etapas, decisões e recompensas.
 */

'use strict';

const expeditions = require('../../database/expeditions');
const { formatMoney } = require('../../utils/formatter');

function renderRouteCard(r) {
  return (
    `🗺️ *${r.emoji} ${r.name.toUpperCase()}* (\`${r.id}\`)\n` +
    `▸ Dificuldade: *${r.difficulty}* | Nível Mínimo: *${r.minLevel}*\n` +
    `▸ Custo: ⚡ *${r.energyCost} Energia* | Etapas: *${r.stagesCount}*\n` +
    `▸ Recompensa Base: *${formatMoney(r.baseRewardCoins)}* + *${r.baseRewardXp} XP*\n` +
    `▸ Descrição: _${r.description}_`
  );
}

module.exports = [
  {
    name: 'expedicao',
    commands: ['expedicao', 'expedicoes', 'aventura', 'explore'],
    category: 'rpg',
    description: 'Participe de expedições solo no RPG com escolhas táticas.',
    usage: '!expedicao [iniciar <rota> | escolher <opcao> | continuar | sair]',
    cooldown: 2500,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();

      // Subcomando: INICIAR EXPEDIÇÃO
      if (sub === 'iniciar' || sub === 'start' || sub === 'comecar') {
        const routeId = ctx.args[1];
        if (!routeId) {
          return ctx.reply(
            `⚠️ Informe qual rota deseja iniciar.\n` +
            `Rotas disponíveis: *floresta*, *caverna* ou *ruinas*.\n` +
            `Exemplo: *${ctx.prefix}expedicao iniciar floresta*`
          );
        }

        try {
          const res = await expeditions.startExpedition(ctx.sender, routeId);
          const choicesLines = res.stageData.choices.map((c) => `👉 *${ctx.prefix}expedicao escolher ${c.id}*\n   └ ${c.label} (Risco: ${c.risk})`).join('\n\n');

          return ctx.reply(
            `🧭 *EXPEDIÇÃO INICIADA: ${res.route.emoji} ${res.route.name.toUpperCase()}*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📍 *Etapa 1 de ${res.route.stagesCount}:*\n` +
            `${res.stageData.text}\n\n` +
            `⚖️ *Suas Opções de Escolha:*\n` +
            `${choicesLines}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `⏳ Responda com *${ctx.prefix}expedicao escolher <opcao>*`
          );
        } catch (err) {
          return ctx.reply(`❌ ${err.message}`);
        }
      }

      // Subcomando: ESCOLHER OPÇÃO NA ETAPA
      if (sub === 'escolher' || sub === 'opcao' || sub === 'decidir' || sub === 'choose') {
        // Pode ser "!expedicao escolher <partida> <opcao>" ou "!expedicao escolher <opcao>"
        let choiceId = ctx.args[1];
        let expId = null;

        if (ctx.args.length >= 3) {
          expId = ctx.args[1];
          choiceId = ctx.args[2];
        }

        if (!choiceId) {
          return ctx.reply(`⚠️ Informe a opção que deseja escolher. Ex: *${ctx.prefix}expedicao escolher clareira*`);
        }

        try {
          const res = await expeditions.chooseOption(ctx.sender, expId, choiceId);

          if (res.isCompleted) {
            const itemRewardText = res.finalReward.item
              ? `\n▸ Item encontrado: ${res.finalReward.item.emoji || '📦'} *${res.finalReward.item.name}* (adicionado à mochila e coleções)`
              : '';

            return ctx.reply(
              `🎉 *EXPEDIÇÃO CONCLUÍDA COM SUCESSO!*\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `📖 *Desfecho Final:*\n${res.outcomeText}\n\n` +
              `🏆 *Recompensas Totais Creditadas:*\n` +
              `▸ Ouro ganho: *+${formatMoney(res.finalReward.coins)}* (registrado no extrato)\n` +
              `▸ Experiência ganha: *+${res.finalReward.xp} XP*${itemRewardText}\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `Parabéns aventureiro! Pronto para a próxima jornada?`
            );
          }

          // Próxima etapa
          const choicesLines = res.nextStageData.choices.map((c) => `👉 *${ctx.prefix}expedicao escolher ${c.id}*\n   └ ${c.label} (Risco: ${c.risk})`).join('\n\n');

          return ctx.reply(
            `⚔️ *RESULTADO DA ETAPA ${res.stageNumber}:*\n` +
            `${res.outcomeText}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📍 *Próxima Etapa (${res.nextStage} de ${res.route.stagesCount}):*\n` +
            `${res.nextStageData.text}\n\n` +
            `⚖️ *Suas Opções:*\n` +
            `${choicesLines}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👉 Para prosseguir: *${ctx.prefix}expedicao escolher <opcao>*`
          );
        } catch (err) {
          return ctx.reply(`❌ ${err.message}`);
        }
      }

      // Subcomando: CONTINUAR EXPEDIÇÃO ATIVA
      if (sub === 'continuar' || sub === 'status' || sub === 'resume') {
        const active = expeditions.getActiveExpedition(ctx.sender);
        if (!active) {
          return ctx.reply(`🧭 Você não possui nenhuma expedição ativa. Inicie uma com *${ctx.prefix}expedicao iniciar <rota>*`);
        }

        const route = expeditions.getRoute(active.routeId);
        const stageDef = route.stages[active.stage - 1];
        const choicesLines = stageDef.choices.map((c) => `👉 *${ctx.prefix}expedicao escolher ${c.id}*\n   └ ${c.label} (Risco: ${c.risk})`).join('\n\n');

        return ctx.reply(
          `🧭 *EXPEDIÇÃO EM ANDAMENTO: ${route.emoji} ${route.name.toUpperCase()}*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📍 *Etapa Atual: ${active.stage} de ${route.stagesCount}*\n` +
          `${stageDef.text}\n\n` +
          `⚖️ *Suas Opções:*\n` +
          `${choicesLines}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💡 Desistir: *${ctx.prefix}expedicao sair*`
        );
      }

      // Subcomando: SAIR / DESISTIR
      if (sub === 'sair' || sub === 'cancelar' || sub === 'abandonar') {
        try {
          const abandoned = await expeditions.abandonExpedition(ctx.sender);
          return ctx.reply(`🏳️ Você abandonou a expedição na rota "${abandoned.routeId}". A energia gasta não foi devolvida.`);
        } catch (err) {
          return ctx.reply(`❌ ${err.message}`);
        }
      }

      // Exibir rotas disponíveis
      const routesList = expeditions.ROUTES.map(renderRouteCard).join('\n\n');
      const active = expeditions.getActiveExpedition(ctx.sender);
      const activeWarning = active
        ? `\n⚠️ *Você tem uma expedição ativa em andamento!* Use *${ctx.prefix}expedicao continuar*\n`
        : '';

      return ctx.reply(
        `🗺️ *EXPEDIÇÕES SOLO DO RPG*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Embarque em aventuras individuais, tome decisões estratégicas e conquiste tesouros raros!\n\n` +
        `${routesList}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${activeWarning}` +
        `👉 Para iniciar: *${ctx.prefix}expedicao iniciar <rota>*\n` +
        `👉 Exemplo: *${ctx.prefix}expedicao iniciar floresta*`
      );
    },
  },
];
