/**
 * commands/admin/welcome.js — sistema de boas-vindas e despedida.
 *
 * - setwelcome / setgoodbye: mensagem TEXTUAL personalizada (legado, intacta).
 * - welcome / bemvindo: controla o sistema VISUAL de cards (on/off, random,
 *   template, mention, preview).
 * - goodbye / despedida: idem para a despedida visual.
 *
 * Apenas administradores/dono podem alterar (adminOnly + groupOnly).
 */

'use strict';

const groups = require('../../database/groups');
const CONFIG = require('../../config');

const WELCOME_TEMPLATES = ['welcome-01', 'welcome-02', 'welcome-03', 'welcome-04'];
const GOODBYE_TEMPLATES = ['goodbye-01', 'goodbye-02', 'goodbye-03', 'goodbye-04'];

function welcomeStore() {
  return require('../../database/welcome');
}

function onOff(v) {
  return v ? '✅ ligado' : '❌ desligado';
}

async function renderPreview(ctx, kind) {
  const system = require('../../plugins/welcome');
  try {
    await ctx.reply('⏳ Gerando prévia...');
    await system.preview(ctx.socket, ctx.remoteJid, ctx.sender, kind);
  } catch (err) {
    await ctx.reply('⚠️ Não consegui gerar a prévia agora. Tente de novo.');
  }
}

/** Comando de controle do sistema visual (welcome ou goodbye). */
function makeVisualCommand(kind) {
  const store = require('../../database/welcome');
  const isWelcome = kind === 'welcome';
  const templates = isWelcome ? WELCOME_TEMPLATES : GOODBYE_TEMPLATES;
  const emoji = isWelcome ? '🌙' : '🌑';
  const setter = isWelcome ? store.setWelcome : store.setGoodbye;
  const randSetter = (gid, v) => store.setRandom(gid, kind, v);

  return {
    name: kind,
    commands: isWelcome ? ['welcome', 'bemvindo'] : ['goodbye', 'despedida'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: isWelcome
      ? '🌙 Card visual de boas-vindas (on/off, template, random, preview).'
      : '🌑 Card visual de despedida (on/off, template, random, preview).',
    usage: isWelcome ? '!welcome on|off|status|template|random|mention|preview' : '!goodbye on|off|status|template|random|preview',
    cooldown: 2500,
    execute: async (ctx) => {
      const gid = ctx.remoteJid;
      const sub = (ctx.args[0] || '').toLowerCase();
      const st = store.getState(gid);
      const enabled = isWelcome ? st.welcome_enabled : st.goodbye_enabled;
      const random = isWelcome ? st.welcome_random : st.goodbye_random;

      if (sub === 'on' || sub === 'ligar' || sub === 'ativar') {
        setter(gid, true);
        return ctx.reply(`${emoji} Card de ${isWelcome ? 'boas-vindas' : 'despedida'} *ativado*.`);
      }
      if (sub === 'off' || sub === 'desligar' || sub === 'desativar') {
        setter(gid, false);
        return ctx.reply(`${emoji} Card de ${isWelcome ? 'boas-vindas' : 'despedida'} *desativado*.`);
      }
      if (sub === 'random' || sub === 'aleatorio') {
        const v = (ctx.args[1] || '').toLowerCase();
        let next;
        if (v === 'on' || v === 'ligar' || v === '1') next = true;
        else if (v === 'off' || v === 'desligar' || v === '0') next = false;
        else next = !random;
        randSetter(gid, next);
        return ctx.reply(`${emoji} Templates aleatórios: ${onOff(next)}.`);
      }
      if (sub === 'mention' || sub === 'mencao') {
        let next = !st.welcome_mention;
        store.setMention(gid, next);
        return ctx.reply(`👤 Menção ao usuário: ${onOff(next)}.`);
      }
      if (sub === 'template' || sub === 'templates' || sub === 'modelo') {
        const last = isWelcome ? st.last_welcome_template : st.last_goodbye_template;
        return ctx.reply(
          [
            `🎨 *Templates de ${isWelcome ? 'boas-vindas' : 'despedida'}*`,
            templates.map((t) => (t === last ? `▸ *${t}* (último usado)` : `▸ ${t}`)).join('\n'),
            '',
            `Aleatório: ${onOff(random)}  ·  ${isWelcome ? '!welcome random' : '!goodbye random'} para alternar.`,
          ].join('\n')
        );
      }
      if (sub === 'preview' || sub === 'teste' || sub === 'testar') {
        return renderPreview(ctx, kind);
      }

      // status (padrão)
      const last = isWelcome ? st.last_welcome_template : st.last_goodbye_template;
      return ctx.reply(
        [
          `${emoji} *${isWelcome ? 'LUA WELCOME' : 'LUA GOODBYE'}*`,
          `Card visual: ${onOff(enabled)}`,
          `Templates aleatórios: ${onOff(random)}`,
          `Menção ao usuário: ${onOff(st.welcome_mention)}`,
          `Último template: ${last || '—'}`,
          '',
          `▸ ${isWelcome ? '!welcome' : '!goodbye'} on|off`,
          `▸ ${isWelcome ? '!welcome' : '!goodbye'} template  → lista`,
          `▸ ${isWelcome ? '!welcome' : '!goodbye'} random   → alterna aleatório`,
          `▸ ${isWelcome ? '!welcome' : '!goodbye'} mention  → alterna menção`,
          `▸ ${isWelcome ? '!welcome' : '!goodbye'} preview  → prévia da card`,
        ].join('\n')
      );
    },
  };
}

module.exports = [
  {
    name: 'setwelcome',
    commands: ['setwelcome'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Configura a mensagem de boas-vindas.',
    usage: '!setwelcome on|off | !setwelcome <mensagem>',
    cooldown: 2000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const g = groups.get(ctx.remoteJid);
      if (arg === 'on' || arg === 'ligar') {
        groups.setWelcome(ctx.remoteJid, true, g.welcome_msg);
        return ctx.reply('✅ Boas-vindas ativadas.');
      }
      if (arg === 'off' || arg === 'desligar') {
        groups.setWelcome(ctx.remoteJid, false, g.welcome_msg);
        return ctx.reply('❌ Boas-vindas desativadas.');
      }
      const msg = ctx.args.join(' ');
      if (!msg) {
        return ctx.reply(
          `👋 *Boas-vindas*: ${g.welcome_enabled ? '✅ ativas' : '❌ desativadas'}\n` +
            `Mensagem: ${g.welcome_msg || '(padrão)'}\n\nUso: !setwelcome on|off ou !setwelcome <texto> (use {user})`
        );
      }
      groups.setWelcome(ctx.remoteJid, true, msg);
      await ctx.reply(`✅ Mensagem de boas-vindas definida:\n${msg}`);
    },
  },
  {
    name: 'setgoodbye',
    commands: ['setgoodbye'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Configura a mensagem de despedida.',
    usage: '!setgoodbye on|off | !setgoodbye <mensagem>',
    cooldown: 2000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const g = groups.get(ctx.remoteJid);
      if (arg === 'on' || arg === 'ligar') {
        groups.setGoodbye(ctx.remoteJid, true, g.goodbye_msg);
        return ctx.reply('✅ Despedidas ativadas.');
      }
      if (arg === 'off' || arg === 'desligar') {
        groups.setGoodbye(ctx.remoteJid, false, g.goodbye_msg);
        return ctx.reply('❌ Despedidas desativadas.');
      }
      const msg = ctx.args.join(' ');
      if (!msg) {
        return ctx.reply(
          `👋 *Despedida*: ${g.goodbye_enabled ? '✅ ativa' : '❌ desativada'}\n` +
            `Mensagem: ${g.goodbye_msg || '(padrão)'}\n\nUso: !setgoodbye on|off ou !setgoodbye <texto> (use {user})`
        );
      }
      groups.setGoodbye(ctx.remoteJid, true, msg);
      await ctx.reply(`✅ Mensagem de despedida definida:\n${msg}`);
    },
  },
  makeVisualCommand('welcome'),
  makeVisualCommand('goodbye'),
];
