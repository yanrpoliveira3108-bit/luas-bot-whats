/**
 * engine/pipeline.js — cadeia de processamento de mensagens.
 *
 * Extraída de handlers/commandHandler.handleMessage (Fase 3) SEM mudar ordem nem
 * semântica. A sequência abaixo é a que o bot já executava:
 *
 *   accept       → a mensagem deve ser processada? (echo do bot, status)
 *   normalize    → monta o ctx, conta a mensagem, loga comunidade/LID
 *   gateUser     → bloqueado? flood? silenciado no grupo?
 *   register     → view-once, usuários/grupos, contadores, XP, AFK
 *   interactive  → botões/listas respondidos
 *   moderation   → histórico do automod + filtros (apaga e encerra)
 *   dispatch     → é comando? executa (ou sugere) e encerra
 *   shortcuts    → "prefixo", "menu", "0"/"voltar"
 *   confirmation → !call / !poll / !pollresult aguardando resposta
 *   sessionFlow  → sessão de jogo e menu numerado
 *
 * Regras da cadeia:
 *   • cada etapa tem responsabilidade única e recebe (state, deps);
 *   • `state.stop = true` encerra a cadeia (equivalente ao `return` antigo);
 *   • erro lançado por qualquer etapa cai no ÚNICO catch central, que usa o
 *     logger existente — não há segundo sistema de erro aqui;
 *   • as dependências vêm injetadas (createPipeline) para não criar ciclo de
 *     require com handlers/commandHandler.js.
 *
 * Métricas: reaproveita utils/perf.js. Nada foi duplicado — `messages`,
 * `commands`, `command` e `errors` continuam sendo registrados nos mesmos
 * lugares de antes; aqui só entra `pipeline` (duração total da cadeia).
 */

'use strict';

/**
 * @param {object} deps dependências injetadas pelo commandHandler
 * @returns {{run:Function, steps:string[]}}
 */
function createPipeline(deps) {
  const {
    CONFIG,
    logger,
    perf,
    settings,
    users,
    groups,
    session,
    numberFallback,
    interactive,
    registry,
    buttonHandler,
    groupHandler,
    errorHandler,
    isStatusJid,
    splitCommand,
    shouldProcessMessage,
    buildContext,
    executeCommand,
    runByName,
    grantXp,
    notifyAfk,
  } = deps;

  /* ---------------------------------------------------------- 1. accept */
  async function accept(state) {
    if (!shouldProcessMessage(state.msg)) {
      state.stop = true;
      state.result = 'ignored';
      return;
    }
    if (isStatusJid(state.msg.key.remoteJid)) {
      state.stop = true;
      state.result = 'status';
    }
  }

  /* -------------------------------------------------------- 2. normalize */
  async function normalize(state) {
    const ctx = await buildContext(state.sock, state.msg);
    if (!ctx.sender) {
      state.stop = true;
      state.result = 'no-sender';
      return;
    }
    state.ctx = ctx;
    perf.add('messages');

    const msg = state.msg;
    const lidAddressed =
      ctx.isGroup &&
      (String(msg.key.participant || '').endsWith('@lid') ||
        String(msg.key.participantAlt || '').endsWith('@lid'));
    if (ctx.isCommunity || lidAddressed) {
      logger.info(
        {
          chat: ctx.remoteJid,
          sender: ctx.sender,
          participant: msg.key.participant,
          participantAlt: msg.key.participantAlt,
          community: !!ctx.isCommunity,
          lid: !!lidAddressed,
        },
        '[COMMUNITY] mensagem recebida de comunidade/grupo LID'
      );
    }
  }

  /* --------------------------------------------------------- 3. gateUser */
  async function gateUser(state) {
    const ctx = state.ctx;

    // require tardio: mantém exatamente o comportamento anterior
    const blocked = require('../database/blocked');
    if (blocked.isBlocked(ctx.sender)) {
      state.stop = true;
      state.result = 'blocked';
      return;
    }

    if (CONFIG.ui.antiFlood && !ctx.isOwner && !ctx.isAdmin) {
      const flood = require('../utils/flood');
      if (flood.hit(ctx.sender)) {
        state.stop = true;
        state.result = 'flood';
        return;
      }
    }

    if (ctx.isGroup) {
      const muted = await groupHandler.enforceMute(state.sock, ctx);
      if (muted.blocked) {
        state.stop = true;
        state.result = 'muted';
      }
    }
  }

  /* --------------------------------------------------------- 4. register */
  async function register(state) {
    const ctx = state.ctx;
    const msg = state.msg;

    require('../utils/viewonce').capture(msg);

    users.upsert(ctx.sender, msg.pushName || '');
    if (ctx.isGroup) {
      groups.ensure(ctx.remoteJid, '');
      groups.incMemberMessages(ctx.remoteJid, ctx.sender);
    }
    users.incMessages(ctx.sender);
    grantXp(ctx.sender);

    const u = users.get(ctx.sender);
    if (u && u.afk) {
      users.clearAfk(ctx.sender);
    }

    await notifyAfk(state.sock, ctx);
  }

  /* ----------------------------------------------------- 5. interactive */
  async function interactiveStep(state) {
    if (await buttonHandler.process(state.ctx)) {
      state.stop = true;
      state.result = 'interactive';
    }
  }

  /* ------------------------------------------------------- 6. moderation */
  async function moderation(state) {
    const ctx = state.ctx;
    if (!ctx.isGroup) return;

    // catch vazio INTENCIONAL: o histórico do automod é melhor-esforço e nunca
    // pode impedir o processamento da mensagem (comportamento pré-Fase 3).
    try {
      const antiManager = require('../utils/antiManager');
      antiManager.addToHistory(ctx.remoteJid, ctx.sender, ctx.message.key);
    } catch (_) {}

    const filtered = await groupHandler.applyFilters(state.sock, ctx);
    if (filtered.deleted) {
      state.stop = true;
      state.result = 'filtered';
    }
  }

  /* -------------------------------------------------------- 7. dispatch */
  async function dispatch(state) {
    const ctx = state.ctx;
    const sock = state.sock;
    const prefix = settings.effectivePrefix();
    state.prefix = prefix;

    const parsed = splitCommand(ctx.text, prefix);
    state.parsed = parsed;
    if (!parsed) return; // não é comando: segue para shortcuts/confirmation/session

    const cmd = registry.resolveTrigger(parsed.command);
    if (!cmd) {
      await suggestCommand(state, parsed, prefix);
      state.stop = true;
      state.result = 'unknown-command';
      return;
    }

    logger.info(
      { tag: 'COMMAND', sender: ctx.sender, fromMe: !!(state.msg.key && state.msg.key.fromMe) },
      `[LUA][COMMAND] Comando recebido: ${parsed.raw.split('\n')[0].slice(0, 80)}`
    );
    state.execution = await executeCommand(ctx, cmd, parsed.args);
    state.stop = true;
    state.result = `command:${cmd.name}`;
  }

  /** Sugestão fuzzy + botões quando o comando não existe (idêntico ao anterior). */
  async function suggestCommand(state, parsed, prefix) {
    const ctx = state.ctx;
    const sock = state.sock;
    try {
      const fuzzy = require('../utils/fuzzySearch');
      const allCmds = registry.all();
      const similar = fuzzy.findSimilarCommands(parsed.command, allCmds, 3);

      if (similar.length > 0) {
        const best = similar[0];
        const others = similar.slice(1);

        let msgTxt = `❌ *Comando não existe:* ${prefix}${parsed.command}\n\n`;
        msgTxt += `💡 *Você quis dizer:*\n`;
        msgTxt += `▸ *${prefix}${best.trigger}* — ${best.cmd.description || ''}\n`;
        for (const o of others) {
          msgTxt += `▸ *${prefix}${o.trigger}* — ${o.cmd.description || ''}\n`;
        }
        msgTxt += `\n📌 Use *${prefix}help ${best.cmd.name}* para ver como usar`;

        try {
          // WhatsApp aceita no máximo 3 botões: reservamos o último para a
          // ajuda do melhor candidato (antes o botão de ajuda era cortado).
          const clickable = similar.slice(0, 2).map((s) => ({
            id: `suggest_${s.cmd.name}`,
            text: `${prefix}${s.trigger}`,
            run: (cc) => runByName(cc, s.cmd.name, parsed.args),
          }));
          const buttons = [
            ...clickable,
            {
              id: `help_${best.cmd.name}`,
              text: `❓ Ajuda ${best.cmd.name}`,
              run: (cc) => runByName(cc, 'help', [best.cmd.name]),
            },
          ];

          for (const b of buttons) {
            // registra só uma vez; cliques posteriores (e pós-restart)
            // caem no dispatch dinâmico do buttonHandler
            buttonHandler.registerOnce(`lua:${b.id}`, b.run);
          }

          const sent = await interactive.sendButtons(sock, ctx.remoteJid, {
            text: msgTxt,
            footer: `${CONFIG.bot.name} • ${prefix}menu para todos os comandos`,
            buttons: buttons.map((b) => ({ id: `lua:${b.id}`, text: b.text })),
            quoted: ctx.message,
          });

          if (!sent) {
            await ctx.reply(msgTxt);
          }
        } catch (_) {
          // sem botões disponíveis no cliente: o texto puro já resolve
          await ctx.reply(msgTxt);
        }

        logger.info({ query: parsed.command, suggestion: best.trigger }, 'comando não encontrado — sugestão enviada');
        return;
      }

      try {
        buttonHandler.registerOnce('lua:open_menu', (cc) => require('../utils/buttons').sendMainMenu(cc));
        // id próprio: "lua:help_<comando>" é reservado ao dispatch dinâmico
        buttonHandler.registerOnce('lua:help_usage', (cc) =>
          cc.reply(
            `💡 Use *${prefix}help <comando>* para ver detalhes de qualquer comando.\nEx: ${prefix}help play, ${prefix}help sticker, ${prefix}help anti`
          )
        );
        await interactive.sendButtons(sock, ctx.remoteJid, {
          text: `❌ Comando *${prefix}${parsed.command}* não existe.\n\n💡 Digite *${prefix}menu* para ver todos os comandos ou *${prefix}menu <termo>* para buscar.\nEx: ${prefix}menu sticker, ${prefix}menu download`,
          footer: `${CONFIG.bot.name} • ${registry.count()} comandos disponíveis`,
          buttons: [
            { id: 'lua:open_menu', text: '📋 Abrir menu' },
            { id: 'lua:help_usage', text: '❓ Ajuda' },
          ],
          quoted: ctx.message,
        });
      } catch (_) {
        await ctx.reply(`❌ Comando *${prefix}${parsed.command}* não existe. Digite *${prefix}menu* para ver os comandos.`);
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'falha ao sugerir comando similar');
    }
  }

  /* ------------------------------------------------------- 8. shortcuts */
  async function shortcuts(state) {
    const ctx = state.ctx;
    const bare = (ctx.text || '').trim().toLowerCase();
    const prefix = state.prefix || settings.effectivePrefix();

    if (bare === 'prefixo' || bare === 'prefix') {
      await ctx.reply(`🔤 Prefixo atual: *${prefix}*\n\n💡 Use *${prefix}menu* para ver os comandos.`);
      state.stop = true;
      state.result = 'shortcut:prefixo';
      return;
    }

    if (bare === 'menu' || bare === 'menuprincipal') {
      await require('../utils/buttons').sendMainMenu(ctx);
      state.stop = true;
      state.result = 'shortcut:menu';
      return;
    }

    if ((bare === '0' || bare === 'voltar') && numberFallback.getNumberMenu(ctx.remoteJid)) {
      await require('../utils/buttons').sendMainMenu(ctx);
      state.stop = true;
      state.result = 'shortcut:voltar';
    }
  }

  /* ---------------------------------------------------- 9. confirmation */
  async function confirmation(state) {
    // um único ponto de interceptação por fluxo, sem listener por execução —
    // consome a próxima mensagem do próprio autor
    if (await require('../utils/pendingCall').handleMessage(state.ctx)) {
      state.stop = true;
      state.result = 'confirmation:call';
      return;
    }
    if (await require('../utils/pendingPoll').handleMessage(state.ctx)) {
      state.stop = true;
      state.result = 'confirmation:poll';
    }
  }

  /* ----------------------------------------------------- 10. sessionFlow */
  async function sessionFlow(state) {
    const ctx = state.ctx;

    const gameSession = session.get(ctx.remoteJid, ctx.sender);
    if (gameSession && gameSession.onMessage) {
      try {
        await gameSession.onMessage(ctx);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: `session:${gameSession.type}` });
      }
      state.stop = true;
      state.result = 'session';
      return;
    }

    const item = numberFallback.match(ctx.remoteJid, ctx.text);
    if (item && typeof item.run === 'function') {
      try {
        await item.run(ctx);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'menu-fallback' });
      }
      state.stop = true;
      state.result = 'menu-fallback';
    }
  }

  const steps = [
    ['accept', accept],
    ['normalize', normalize],
    ['gateUser', gateUser],
    ['register', register],
    ['interactive', interactiveStep],
    ['moderation', moderation],
    ['dispatch', dispatch],
    ['shortcuts', shortcuts],
    ['confirmation', confirmation],
    ['sessionFlow', sessionFlow],
  ];

  /**
   * Executa a cadeia. Nunca lança: o catch central é o mesmo de antes.
   * @returns {Promise<object>} state (útil em testes)
   */
  async function run(sock, msg) {
    const state = {
      sock,
      msg,
      ctx: null,
      parsed: null,
      prefix: null,
      execution: null,
      stop: false,
      result: 'noop',
      step: null,
      startedAt: Date.now(),
    };

    try {
      for (const [name, step] of steps) {
        state.step = name;
        if (state.stop) break;
        await step(state);
      }
    } catch (err) {
      logger.error(
        { err: err.message, stack: err.stack, step: state.step },
        'erro no processamento de mensagem'
      );
      state.result = `error:${state.step}`;
    } finally {
      perf.timing('pipeline', Date.now() - state.startedAt);
    }

    return state;
  }

  return { run, steps: steps.map(([name]) => name) };
}

module.exports = { createPipeline };
