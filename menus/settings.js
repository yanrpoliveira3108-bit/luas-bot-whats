/**
 * menus/settings.js — menu de configurações do grupo/bot.
 *
 * Mostra o estado REAL dos recursos (mesma fonte do !statusgrupo) e permite
 * ligar/desligar com um toque. O toggle passa pelo núcleo do AutoBot, então o
 * menu, os comandos e o motor de execução nunca ficam dessincronizados.
 */

'use strict';

const settings = require('../database/settings');
const groups = require('../database/groups');
const autobot = require('../utils/autobot');
const { sendMenu } = require('../utils/menu');

// Recursos exibidos no menu (os demais ficam no !autobot / !statusgrupo)
const FEATURES = [
  'antilink',
  'antilink2',
  'antilinkgp',
  'antipalavrao',
  'antipix',
  'antispam',
  'antiflood',
  'antifake',
  'antibot',
  'antistatus',
  'antienquete',
  'antimedia',
  'antiimagem',
  'antivideo',
  'antiaudio',
  'antidocumento',
  'antisticker',
  'antiviewonce',
  'antilocalizacao',
  'anticontato',
  'antieditarmensagem',
  'antiapagarmensagem',
  'antireacao',
  'antichamada',
];

module.exports = async (ctx) => {
  const g = groups.get(ctx.remoteJid);
  const st = (id) => (autobot.isEnabled(ctx.remoteJid, id) ? '✅' : '❌');

  let summary = `*⚙️ Configurações*\n▸ Prefixo: ${settings.effectivePrefix()}\n`;
  if (ctx.isGroup) {
    summary +=
      `▸ Boas-vindas: ${g && g.welcome_enabled ? '✅' : '❌'}\n` +
      `▸ Despedida: ${g && g.goodbye_enabled ? '✅' : '❌'}\n` +
      `▸ Anti-link: ${autobot.isEnabled(ctx.remoteJid, 'antilink') ? '✅' : '❌'}  ` +
      `Anti-spam: ${st('antispam')}  Anti-flood: ${st('antiflood')}\n` +
      `▸ Anti-pagamento: ${st('antipix')}  Anti-mídia: ${st('antimedia')}\n` +
      `▸ Automações: autofigu ${st('autofigu')}  simih ${st('simih')}  auto-baixar ${st('autobaixar')}\n`;
  } else {
    summary += `_As opções de grupo aparecem dentro de um grupo._\n`;
  }

  const rows = FEATURES.map((id) => {
    const def = autobot.resolve(id);
    return {
      id,
      title: `${def.label} — ${st(id)}`,
      description: (def.desc || 'Toque para alternar (requer admin do grupo).').slice(0, 72),
      run: (c) => toggle(c, id),
    };
  });

  // atalhos
  rows.push({
    id: 'statusgrupo',
    title: '📊 Status completo',
    description: 'Ver TODOS os recursos do grupo (!statusgrupo)',
    run: (c) => require('../handlers/commandHandler').runByName(c, 'statusgrupo', []),
  });
  rows.push({
    id: 'autobot',
    title: '🤖 Painel AutoBot',
    description: 'Todos os recursos e comandos (!autobot)',
    run: (c) => require('../handlers/commandHandler').runByName(c, 'autobot', []),
  });

  await sendMenu(ctx, { id: 'settings', title: '⚙️ Configurações', text: summary, rows });
};

async function toggle(ctx, id) {
  if (ctx.isGroup && !ctx.isAdmin && !ctx.isOwner) {
    await ctx.reply('🛡️ Apenas administradores podem alterar os recursos do grupo.');
    return;
  }
  const def = autobot.resolve(id);
  if (!def) return ctx.reply('⚠️ Recurso desconhecido.');
  const { enabled } = autobot.toggle(ctx.remoteJid, id);
  await ctx.reply(`${enabled ? '✅ Recurso ativado.' : '❌ Recurso desativado.'}\n${def.label} • !${def.cmd}`);
}
