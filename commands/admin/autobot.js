/**
 * commands/admin/autobot.js — TODOS os comandos do AutoBot.
 *
 * Este arquivo NÃO repete a implementação de cada recurso: ele lê o registro
 * único (utils/autobot.js) e gera um comando padronizado por recurso. Assim é
 * impossível existir "opção que salva no banco mas não faz nada": o comando, o
 * status e o motor de execução leem a MESMA fonte.
 *
 * Padrão de resposta (todos os comandos on/off):
 *
 *   ✅ Recurso ativado.
 *   🔒 Anti Link • !antilink
 *
 *   ❌ Recurso desativado.
 *   🔒 Anti Link • !antilink
 *
 * Também estão aqui os comandos auxiliares: !autobot (painel),
 * !registrar / !unregistrar (Modo Registro).
 */

'use strict';

const groups = require('../../database/groups');
const autobot = require('../../utils/autobot');
const { resolveTarget } = require('../_shared/admin');
const { toJid } = require('../../utils/messages');

const ON_WORDS = ['on', 'ligar', 'ativar', 'liga', '1', 'sim', 'true', 'enable'];
const OFF_WORDS = ['off', 'desligar', 'desativa', 'desativar', '0', 'nao', 'não', 'false', 'disable'];
const TOGGLE_WORDS = ['toggle', 'alternar', 'inverter'];

const OK_ON = '✅ Recurso ativado.';
const OK_OFF = '❌ Recurso desativado.';

function scopeJid(ctx, def) {
  return def.scope === 'global' ? null : ctx.remoteJid;
}

/** Normaliza menção/texto para JID válido ("@5522..." → "5522...@s.whatsapp.net"). */
function targetJid(ctx, raw) {
  const v = resolveTarget(ctx) || raw;
  if (!v) return null;
  const s = String(v).trim().replace(/^[<]?@+/, '').replace(/>$/, '');
  return toJid(s);
}

function statusOf(ctx, def) {
  return autobot.isEnabled(scopeJid(ctx, def), def.id);
}

function replyToggle(ctx, def, enabled) {
  // Requisito: a resposta de on/off é EXATAMENTE "✅ Recurso ativado." ou
  // "❌ Recurso desativado." — nada de mensagens genéricas.
  return ctx.reply(enabled ? OK_ON : OK_OFF);
}

/* ------------------------- handlers de argumento ----------------------- */

/** Add/remove/list genérico de listas do grupo (x9, gold). */
async function listCommand(ctx, key, label) {
  const sub = (ctx.args[0] || '').toLowerCase();
  if (sub === 'add' || sub === 'adicionar') {
    const target = targetJid(ctx, ctx.args[1]);
    if (!target) return ctx.reply(`⚠️ Marque o usuário: !${ctx.command} add @usuario`);
    groups.addToList(ctx.remoteJid, key, target);
    return ctx.reply(`✅ @${String(target).split('@')[0]} adicionado ao ${label}.`, { mentions: [target] });
  }
  if (sub === 'remove' || sub === 'remover' || sub === 'del') {
    const target = targetJid(ctx, ctx.args[1]);
    if (!target) return ctx.reply(`⚠️ Marque o usuário: !${ctx.command} remove @usuario`);
    groups.removeFromList(ctx.remoteJid, key, target);
    return ctx.reply(`🗑️ @${String(target).split('@')[0]} removido do ${label}.`, { mentions: [target] });
  }
  if (sub === 'list' || sub === 'lista' || !sub) {
    const list = groups.getList(ctx.remoteJid, key);
    return ctx.reply(
      `📋 *${label.toUpperCase()}* (${list.length})\n${list.length ? list.map((j) => `▸ @${String(j).split('@')[0]}`).join('\n') : '(vazio)'}`
    );
  }
  return ctx.reply(`⚠️ Uso: !${ctx.command} add|remove|list [@usuario]`);
}

const ARG_HANDLERS = {
  /* 🔒 limite de caracteres: !limitecaracteres 800 */
  limitecaracteres: async (ctx) => {
    const n = parseInt((ctx.args[0] || '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(n)) return false;
    const limite = Math.min(20000, Math.max(20, n));
    autobot.setOptions(ctx.remoteJid, 'limitecaracteres', { limite });
    autobot.setEnabled(ctx.remoteJid, 'limitecaracteres', true);
    await ctx.reply(`${OK_ON}\n📏 Limite: *${limite}* caracteres • !limitecaracteres`);
    return true;
  },
  antitextogigante: async (ctx) => {
    const n = parseInt((ctx.args[0] || '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(n)) return false;
    const limite = Math.min(60000, Math.max(100, n));
    autobot.setOptions(ctx.remoteJid, 'antitextogigante', { limite });
    autobot.setEnabled(ctx.remoteJid, 'antitextogigante', true);
    await ctx.reply(`${OK_ON}\n📏 Texto gigante: *${limite}* caracteres • !antitextogigante`);
    return true;
  },
  antiemojispam: async (ctx) => {
    const n = parseInt((ctx.args[0] || '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(n)) return false;
    const limite = Math.min(100, Math.max(3, n));
    autobot.setOptions(ctx.remoteJid, 'antiemojispam', { limite });
    autobot.setEnabled(ctx.remoteJid, 'antiemojispam', true);
    await ctx.reply(`${OK_ON}\n😵 Emojis: *${limite}* • !antiemojispam`);
    return true;
  },
  antimencaomassa: async (ctx) => {
    const n = parseInt((ctx.args[0] || '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(n)) return false;
    const limite = Math.min(50, Math.max(2, n));
    autobot.setOptions(ctx.remoteJid, 'antimencaomassa', { limite });
    autobot.setEnabled(ctx.remoteJid, 'antimencaomassa', true);
    await ctx.reply(`${OK_ON}\n📣 Menções: *${limite}* • !antimencaomassa`);
    return true;
  },
  iaaleatory: async (ctx) => {
    const n = parseInt((ctx.args[0] || '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(n)) return false;
    const chance = Math.min(50, Math.max(1, n));
    autobot.setOptions(ctx.remoteJid, 'iaaleatory', { chance });
    autobot.setEnabled(ctx.remoteJid, 'iaaleatory', true);
    await ctx.reply(`${OK_ON}\n🎲 Chance: *${chance}%* • !iaaleatory`);
    return true;
  },
  limitarcomandos: async (ctx) => {
    const n = parseInt((ctx.args[0] || '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(n)) return false;
    const limite = Math.min(100, Math.max(1, n));
    autobot.setOptions(ctx.remoteJid, 'limitarcomandos', { limite, janela: 60 });
    autobot.setEnabled(ctx.remoteJid, 'limitarcomandos', true);
    await ctx.reply(`${OK_ON}\n⏳ Limite: *${limite}* comandos por minuto • !limitarcomandos`);
    return true;
  },
  cargox9: async (ctx) => listCommand(ctx, 'x9', 'cargo X9'),
  modogold: async (ctx) => listCommand(ctx, 'gold', 'modo gold'),

  /* 🤖 autoresposta: add/list/del/clear */
  autoresposta: async (ctx) => {
    const sub = (ctx.args[0] || '').toLowerCase();
    const list = require('../../handlers/autoHandler').autorespostas(ctx.remoteJid);
    const MAX = 50;

    if (sub === 'add' || sub === 'adicionar') {
      const rest = ctx.args.slice(1).join(' ');
      const m = rest.split(/\s*[=|]\s*/);
      const q = (m[0] || '').trim();
      const a = (m[1] || '').trim();
      if (!q || !a) return ctx.reply('⚠️ Uso: !autoresposta add <gatilho> = <resposta>\nEx: !autoresposta add bom dia = Bom dia, {user}!');
      if (list.length >= MAX) return ctx.reply(`⚠️ Limite de ${MAX} respostas atingido. Remova alguma antes.`);
      list.push({ q: q.slice(0, 60), a: a.slice(0, 400) });
      groups.patchSettings(ctx.remoteJid, (s) => {
        s.autorespostas = list;
      });
      return ctx.reply(`✅ Gatilho adicionado: *${q}*`);
    }
    if (sub === 'del' || sub === 'remover' || sub === 'remove') {
      const alvo = ctx.args.slice(1).join(' ').trim();
      if (!alvo) return ctx.reply('⚠️ Uso: !autoresposta del <nº|gatilho>');
      let idx = parseInt(alvo, 10) - 1;
      if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) {
        idx = list.findIndex((it) => String(it.q).toLowerCase() === alvo.toLowerCase());
      }
      if (idx < 0 || idx >= list.length) return ctx.reply('⚠️ Gatilho não encontrado.');
      const [removed] = list.splice(idx, 1);
      groups.patchSettings(ctx.remoteJid, (s) => {
        s.autorespostas = list;
      });
      return ctx.reply(`🗑️ Removido: *${removed.q}*`);
    }
    if (sub === 'clear' || sub === 'limpar') {
      groups.patchSettings(ctx.remoteJid, (s) => {
        s.autorespostas = [];
      });
      return ctx.reply('🗑️ Todas as respostas automáticas foram removidas.');
    }
    if (sub === 'list' || sub === 'lista' || sub === '') {
      if (!list.length) return ctx.reply('📋 Nenhuma resposta cadastrada.\n▸ Use: !autoresposta add <gatilho> = <resposta>');
      return ctx.reply(
        `📋 *RESPOSTAS AUTOMÁTICAS* (${list.length})\n${list
          .map((it, i) => `${i + 1}. *${it.q}* → ${String(it.a).slice(0, 40)}`)
          .join('\n')}`
      );
    }
    return false;
  },

  /* 🎂 aniversário: registro pessoal (qualquer usuário) */
  aniversario: async (ctx) => {
    const birthday = require('../../utils/birthday');
    const arg = ctx.args.join(' ').trim();
    if (!arg) return false;
    const lower = arg.toLowerCase();
    if (lower === 'remover' || lower === 'del') {
      birthday.remove(ctx.sender);
      return ctx.reply('🗑️ Seu aniversário foi removido.');
    }
    if (lower === 'list' || lower === 'lista') {
      if (!ctx.isOwner) return ctx.reply('🚫 Apenas o dono pode listar os aniversários.');
      return ctx.reply(`🎂 Aniversários cadastrados: *${birthday.count()}*`);
    }
    const parsed = birthday.parseDate(arg.replace(/^eu\s+/i, ''));
    if (!parsed) return ctx.reply('⚠️ Formato inválido. Use: *!aniversario 25/12*');
    birthday.set(ctx.sender, arg);
    return ctx.reply(
      `🎂 Aniversário salvo: *${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}*\n▸ Você será parabenizado no grupo nesse dia.`
    );
  },
};

/* ------------------------ geração dos comandos ------------------------- */

/** Subcomandos aceitos por cada recurso (ajuda). */
const SUBCOMMAND_HELP = {
  autoresposta: 'add <gatilho> = <resposta> | list | del <nº|gatilho> | clear',
  cargox9: 'add|remove|list [@usuario]',
  modogold: 'add|remove|list [@usuario]',
  aniversario: '<dd/mm> | remover',
  limitecaracteres: '<n>',
  antitextogigante: '<n>',
  antiemojispam: '<n>',
  antimencaomassa: '<n>',
  iaaleatory: '<porcentagem>',
  limitarcomandos: '<n>',
};

function makeToggleCommand(def) {
  const isGlobal = def.scope === 'global';
  return {
    name: def.id,
    commands: [def.cmd, ...def.aliases],
    category: isGlobal ? 'owner' : 'admin',
    adminOnly: !isGlobal,
    ownerOnly: !!def.ownerOnly,
    groupOnly: !isGlobal,
    description: `${def.label} — ${def.desc}`,
    usage: def.usage || `!${def.cmd} on|off`,
    // toggles são idempotentes e baratos: sem cooldown para ligar/desligar
    // vários recursos seguidos (o efeito precisa ser imediato).
    cooldown: 0,
    execute: async (ctx) => {
      const args = ctx.args || [];
      const sub = (args[0] || '').toLowerCase();

      // Subcomandos (add/list/valor) só agem quando NÃO é on/off/toggle:
      // "!cargox9 on" liga o recurso, "!cargox9 add @x" usa o subcomando.
      const isToggleWord = ON_WORDS.includes(sub) || OFF_WORDS.includes(sub) || TOGGLE_WORDS.includes(sub);
      if (!isToggleWord && args.length && ARG_HANDLERS[def.id]) {
        const handled = await ARG_HANDLERS[def.id](ctx, def, args);
        if (handled) return;
      }

      if (def.toggleOwnerOnly && !ctx.isOwner && (ON_WORDS.includes(sub) || OFF_WORDS.includes(sub) || TOGGLE_WORDS.includes(sub))) {
        return ctx.reply('🚫 Apenas o dono do bot pode ligar/desligar este recurso.');
      }
      if (ON_WORDS.includes(sub)) {
        autobot.setEnabled(scopeJid(ctx, def), def.id, true);
        return replyToggle(ctx, def, true);
      }
      if (OFF_WORDS.includes(sub)) {
        autobot.setEnabled(scopeJid(ctx, def), def.id, false);
        return replyToggle(ctx, def, false);
      }
      if (TOGGLE_WORDS.includes(sub)) {
        const { enabled } = autobot.toggle(scopeJid(ctx, def), def.id);
        return replyToggle(ctx, def, enabled);
      }

      // Sem argumento (ou argumento desconhecido): mostra o estado real
      const on = statusOf(ctx, def);
      const extra = SUBCOMMAND_HELP[def.id] ? `\n▸ Subcomandos: ${SUBCOMMAND_HELP[def.id]}` : '';
      const opts = def.options
        ? `\n▸ Ajustes: ${Object.entries(autobot.options(scopeJid(ctx, def), def.id))
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')}`
        : '';
      return ctx.reply(
        `${on ? '✅ Recurso ativado.' : '❌ Recurso desativado.'}\n` +
          `${def.label} • !${def.cmd}\n` +
          `📝 ${def.desc}${opts}${extra}\n` +
          `💡 Uso: ${def.usage || `!${def.cmd} on|off`}`
      );
    },
  };
}

const generated = autobot
  .all()
  .filter((def) => def.generated && def.cmd)
  .map(makeToggleCommand);

/* ----------------------------- extras ---------------------------------- */

const extr = [
  {
    name: 'autobot',
    commands: ['autobot', 'autobots'],
    category: 'admin',
    description: 'Painel do AutoBot: lista todos os recursos e o estado real de cada um.',
    usage: '!autobot | !autobot all on|off',
    cooldown: 2000,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();
      const all = (ctx.args[1] || '').toLowerCase();
      if (sub === 'all' && (ON_WORDS.includes(all) || OFF_WORDS.includes(all))) {
        if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply('🚫 Apenas administradores podem alterar todos os recursos.');
        const enable = ON_WORDS.includes(all);
        let n = 0;
        for (const def of autobot.all()) {
          if (def.scope === 'global' && !ctx.isOwner) continue;
          if (def.scope === 'group' && !ctx.isGroup) continue;
          autobot.setEnabled(scopeJid(ctx, def), def.id, enable);
          n++;
        }
        return ctx.reply(`${enable ? OK_ON : OK_OFF}\n🤖 ${n} recursos do AutoBot atualizados.`);
      }
      const jid = ctx.isGroup ? ctx.remoteJid : null;
      return ctx.reply(autobot.buildStatus(jid));
    },
  },
  {
    name: 'registrar',
    commands: ['registrar'],
    category: 'admin',
    adminOnly: true,
    description: 'Registra um usuário (Modo Registro).',
    usage: '!registrar @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = targetJid(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !registrar @usuario');
      require('../../database/users').register(target);
      return ctx.reply(`✅ @${String(target).split('@')[0]} registrado.`, { mentions: [target] });
    },
  },
  {
    name: 'unregistrar',
    commands: ['unregistrar', 'desregistrar'],
    category: 'admin',
    adminOnly: true,
    description: 'Remove o registro de um usuário (Modo Registro).',
    usage: '!unregistrar @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = targetJid(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !unregistrar @usuario');
      require('../../database/users').setRegistered(target, false);
      return ctx.reply(`🗑️ @${String(target).split('@')[0]} não está mais registrado.`, { mentions: [target] });
    },
  },
];

module.exports = [...generated, ...extr];
