/**
 * commands/_shared/ranking.js — renderização de rankings por tipo.
 */

'use strict';

const users = require('../../database/users');
const games = require('../../database/games');
const rpg = require('../../database/rpg');
const life = require('../../database/life');
const economy = require('../../database/economy');
const networth = require('../../plugins/life/networth');
const { formatMoney } = require('../../utils/formatter');

function display(jid) {
  const u = users.get(jid);
  return u && u.name ? u.name : '@' + String(jid).split('@')[0];
}

const TYPES = {
  xp: { label: '🏆 XP', fetch: () => users.top('xp') },
  mensagens: { label: '💬 Mensagens', fetch: () => users.top('messages') },
  reputacao: { label: '⭐ Reputação', fetch: () => users.top('reputation') },
  karma: { label: '⚖️ Karma', fetch: () => users.top('karma') },
  rpg: { label: '⚔️ RPG', fetch: () => rpg.rankRpg('level') },
  zueira: { label: '😂 Zueira', fetch: () => games.getGameRank('zueira') },
  quiz: { label: '🧠 Quiz', fetch: () => games.quizRank(null) },
  /* -------- Lua Life -------- */
  dinheiro: { label: '💰 Mais ricos', fetch: () => economy.rankWallet(10) },
  patrimonio: { label: '🏠 Maior patrimônio', fetch: () => life.rankNetworth(10) },
  level: { label: '⭐ Maior level', fetch: () => life.rankLevel(10) },
  fazenda: { label: '🌾 Maior fazenda', fetch: () => life.rankAnimals(10) },
  conquistas: { label: '🏆 Mais conquistas', fetch: () => life.rankAchievements(10) },
};

async function renderRanking(ctx, type, limit = 10) {
  const meta = TYPES[type] || TYPES.xp;
  const rows = meta.fetch();
  const list = rows.slice(0, limit);

  if (!list.length) {
    return `📊 *Ranking — ${meta.label}*\nAinda não há dados suficientes.`;
  }

  const medalhas = ['🥇', '🥈', '🥉'];
  const lines = list.map((r, i) => {
    const medal = medalhas[i] || `${i + 1}º`;
    const jid = r.id || r.user_id;
    const name = display(jid);
    if (type === 'xp' || type === 'mensagens' || type === 'reputacao' || type === 'karma') {
      const field = type === 'mensagens' ? r.messages : type === 'reputacao' ? r.reputation : type === 'karma' ? r.karma : r.xp;
      return `${medal} ${name} — *${field}* ${type === 'xp' ? 'XP (nível ' + r.level + ')' : ''}`;
    }
    if (type === 'rpg') {
      return `${medal} ${name} — nível *${r.level}* (${r.profession || 'sem profissão'})`;
    }
    if (type === 'quiz') {
      return `${medal} ${name} — *${r.correct}* acertos`;
    }
    if (type === 'dinheiro') {
      return `${medal} ${name} — ${formatMoney(r.v || r.total || 0)}`;
    }
    if (type === 'patrimonio' || type === 'level' || type === 'fazenda' || type === 'conquistas') {
      const val = r.value != null ? r.value : r.count != null ? r.count : r.level != null ? r.level : 0;
      return `${medal} ${name} — *${type === 'patrimonio' || type === 'fazenda' ? formatMoney(val) : val}*`;
    }
    return `${medal} ${name} — *${r.wins}* interações`;
  });

  return `📊 *Ranking — ${meta.label}*\n${lines.join('\n')}`;
}

module.exports = { renderRanking, TYPES };
