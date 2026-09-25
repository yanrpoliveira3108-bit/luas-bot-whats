'use strict';

const alvoUtil = require('../../utils/alvo');
const users = require('../../database/users');
const groups = require('../../database/groups');
const rpg = require('../../database/rpg');
const economy = require('../../database/economy');
const collections = require('../../database/collections');
const profileStats = require('../../database/profileStats');
const settings = require('../../database/settings');
const { formatDate, formatMoney } = require('../../utils/formatter');
const { displayName } = require('../../engine/interactionEngine');
const permissions = require('../../utils/permissions');
const db = require('../../database/database');

const VALID_TABS = ['geral', 'atividade', 'rpg', 'figurinhas', 'colecoes'];

module.exports = [
  {
    name: 'perfil',
    commands: ['perfil', 'me', 'meuperfil'],
    category: 'members',
    description: 'Mostra seu perfil completo em abas ou texto.',
    usage: '!perfil [geral|atividade|rpg|figurinhas|colecoes] [@usuario]',
    cooldown: 3000,
    execute: async (ctx) => {
      // 1. Identificar alvo (menção, citação, número ou o próprio autor)
      const target = alvoUtil.alvo(ctx, { numero: true }) || ctx.sender;
      const u = users.get(target);
      if (!u) return ctx.reply('ℹ️ Este usuário ainda não interagiu com o bot.');

      // 2. Extrair argumento de aba inicial se fornecido
      const cleanArgs = alvoUtil.resto(ctx, { numero: true });
      let initialTab = 'geral';
      for (const arg of cleanArgs) {
        const norm = String(arg).toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (norm === 'colecoes' || norm === 'colecao') {
          initialTab = 'colecoes';
          break;
        } else if (norm === 'figurinhas' || norm === 'figurinha' || norm === 'fig' || norm === 'stickers') {
          initialTab = 'figurinhas';
          break;
        } else if (norm === 'rpg' || norm === 'vida') {
          initialTab = 'rpg';
          break;
        } else if (norm === 'atividade' || norm === 'stats') {
          initialTab = 'atividade';
          break;
        } else if (norm === 'geral') {
          initialTab = 'geral';
          break;
        }
      }

      // 3. Coleta de dados compartilhada (sem duplicar banco de dados)
      const nextXp = users.xpForNextLevel(u.level);
      const isRegisteredRpg = !!db.get().prepare(`SELECT 1 FROM rpg_players WHERE user_id = ?`).get(target);
      const rp = isRegisteredRpg ? rpg.getPlayer(target) : { level: 1, xp: 0, energy: 100, profession: '' };
      const eco = economy.get(target);
      const member = ctx.isGroup ? groups.memberStats(ctx.remoteJid, target) : null;
      const showcaseItems = collections.getShowcase(target);
      const userCols = collections.getUserCollections(target);
      const stickerStats = profileStats.getStickerStats(target);

      // Escopo de atividade estrito (privacidade absoluta)
      const currentScope = ctx.isGroup ? ctx.remoteJid : 'private';
      const actStats = profileStats.getActivityStats(target, currentScope);
      const topCmds = profileStats.getTopCommands(target, currentScope, 5);
      const estimatedDev = actStats.lastDevice !== 'Desconhecido'
        ? actStats.lastDevice
        : profileStats.estimatePlatform(ctx.message && ctx.message.key && ctx.message.key.id);

      // Dados de vida / RPG
      const life = require('../../database/life');
      const achs = life.listAchievements(target);
      const userInv = economy.inventory(target);
      const topItems = userInv.slice(0, 4);

      // Chefes cooperativos (dano)
      let coopDamage = 0;
      try {
        const rowPart = db.get().prepare(`SELECT SUM(damage) as d FROM coop_participants WHERE user_id = ?`).get(target);
        if (rowPart && rowPart.d) coopDamage = rowPart.d;
      } catch (_) {}

      // Feira / mercado ativo
      let marketListingsCount = 0;
      try {
        const rowMarket = db.get().prepare(`SELECT COUNT(*) as c FROM rpg_market_listings WHERE seller_id = ? AND status = 'active'`).get(target);
        if (rowMarket && rowMarket.c) marketListingsCount = rowMarket.c;
      } catch (_) {}

      // Expedições completadas
      let completedExpeditions = 0;
      try {
        const rowExp = db.get().prepare(`SELECT COUNT(*) as c FROM rpg_expeditions WHERE user_id = ? AND status = 'completed'`).get(target);
        if (rowExp && rowExp.c) completedExpeditions = rowExp.c;
      } catch (_) {}

      // Missões de vida concluídas
      let completedMissions = 0;
      try {
        const mList = life.listMissions(target);
        completedMissions = mList.filter((m) => m.claimed).length;
      } catch (_) {}

      const isBotOwner = permissions.isOwner(target);
      const isTargetBot = alvoUtil.ehBot(ctx, target);
      const isRequesterSelf = target === ctx.sender;

      // 4. Se MODO HTML estiver ativo, gerar e tentar enviar o card tabulado rico
      if (settings.menuHtmlEnabled()) {
        try {
          // Buscar foto de perfil segura como Base64 Data URI
          let avatarDataUri = null;
          try {
            const profilePlugin = require('../../plugins/welcome/profile');
            const photoBuf = await profilePlugin.getPhoto(ctx.socket, target);
            if (photoBuf && photoBuf.length > 0) {
              avatarDataUri = `data:image/png;base64,${photoBuf.toString('base64')}`;
            }
          } catch (_) {}

          const perfilHtmlView = require('../../utils/perfilHtmlView');
          const richHtml = require('../../utils/richHtml');

          let contextName = 'Mensagem Privada';
          if (ctx.isGroup) {
            try {
              const gMeta = await ctx.socket.groupMetadata(ctx.remoteJid);
              contextName = (gMeta && gMeta.subject) || 'Grupo';
            } catch (_) {
              contextName = 'Grupo';
            }
          }

          const html = perfilHtmlView.renderPerfilHtml({
            userId: target,
            name: displayName(target),
            level: u.level,
            xp: u.xp,
            nextXp,
            reputation: u.reputation,
            firstSeen: u.first_seen,
            estimatedPlatform: estimatedDev,
            contextName,
            isGroup: ctx.isGroup,
            isRequesterSelf,
            isBotOwner,
            isTargetBot,
            prefix: ctx.prefix || '!',
            about: u.about,
            groupJoinedAt: member && member.joined_at,
            initialTab,
            avatarDataUri,
            activity: {
              messages: actStats.messages,
              commands: actStats.commands,
              commandCounts: actStats.commandCounts,
              topCommands: topCmds,
              lastInteraction: actStats.lastInteraction,
            },
            hasCharacter: isRegisteredRpg,
            rpg: {
              profession: rp.profession,
              level: rp.level,
              energy: rp.energy,
              inventoryTotal: userInv.length,
              topItems,
              completedExpeditions,
              coopDamage,
              activeMarketListings: marketListingsCount,
              completedMissions,
            },
            economy: {
              wallet: eco.wallet,
              bank: eco.bank,
            },
            stickers: stickerStats,
            collections: userCols,
            showcase: showcaseItems,
            achievementsCount: achs.length,
          });

          await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, {
            title: `PERFIL DE ${displayName(target)}`,
          });
          return;
        } catch (_) {
          // Segue para fallback em texto se não puder enviar HTML
        }
      }

      // 5. MODO TEXTO (Fallback estruturado e completo com todas as seções)
      const lines = [
        `👤 *PERFIL • ${displayName(target)}*`,
        `▸ ID: \`${target}\``,
        `▸ Nível Geral: ${u.level} (XP: ${u.xp}/${nextXp})`,
        `▸ Reputação: ⭐ ${u.reputation}`,
        `▸ Primeira interação: ${formatDate(new Date(u.first_seen).getTime())}`,
        `▸ Plataforma estimada: ${estimatedDev}`,
      ];

      if (ctx.isGroup) {
        lines.push(`▸ Entrou no grupo: ${member && member.joined_at ? formatDate(new Date(member.joined_at).getTime()) : '-'}`);
      }

      if (u.about) {
        lines.push(`▸ Sobre: _${u.about}_`);
      }

      lines.push('');
      lines.push(`📊 *Atividade (${ctx.isGroup ? 'Neste Grupo' : 'Privado'})*`);
      lines.push(`▸ Mensagens: ${actStats.messages} | Comandos: ${actStats.commands}`);
      if (topCmds.length) {
        lines.push(`▸ Top comandos: ${topCmds.map((c) => `${ctx.prefix || '!'}${c.cmd} (${c.count}x)`).join(', ')}`);
      }

      lines.push('');
      lines.push(`⚔️ *RPG & Economia*`);
      if (isRegisteredRpg) {
        lines.push(`▸ Profissão: ${rp.profession || 'Aventureiro'} | Nível RPG: ${rp.level}`);
        lines.push(`▸ Energia: ${rp.energy}/200 | Expedições: ${completedExpeditions}`);
      } else {
        lines.push(`▸ Personagem RPG não iniciado (use ${ctx.prefix || '!'}rpg para criar)`);
      }
      lines.push(`▸ Carteira: ${formatMoney(eco.wallet)} | Banco: ${formatMoney(eco.bank)}`);
      lines.push(`▸ Mochila: ${userInv.length} tipos de itens`);

      lines.push('');
      lines.push(`🎨 *Figurinhas*`);
      lines.push(`▸ Criadas: ${stickerStats.created} | Roubadas: ${stickerStats.stolen}`);
      lines.push(`▸ De Imagem: ${stickerStats.fromImage} | Vídeo/GIF: ${stickerStats.fromVideoGif}`);

      lines.push('');
      lines.push(`🏆 *Coleções & Conquistas*`);
      const completedCols = userCols.filter((c) => c.isComplete).length;
      lines.push(`▸ Coleções concluídas: ${completedCols}/${userCols.length}`);
      lines.push(`▸ Conquistas desbloqueadas: ${achs.length}`);
      if (showcaseItems.length) {
        lines.push(`▸ ✨ Vitrine: ${showcaseItems.map((s) => `${s.emoji} ${s.name}`).join(' • ')}`);
      }

      await ctx.reply(lines.join('\n'));
    },
  },
];
