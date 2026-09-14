'use strict';

const groups = require('../../database/groups');

/** Fábrica de comando de filtro on/off. */
function makeFilter(name, description, key, aliases = []) {
  return {
    name,
    commands: [name, ...aliases],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description,
    usage: `!${name} on|off`,
    cooldown: 1500,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const cur = ((groups.getSettings(ctx.remoteJid).filters || {})[key]);
      if (arg === 'on' || arg === 'ligar' || arg === '1') {
        groups.updateFilter(ctx.remoteJid, key, true);
        const hint = ctx.isBotAdmin ? '' : '\n_⚠️ Para APAGAR as mensagens, o bot precisa ser admin do grupo (senão ele só avisa)._';
        return ctx.reply(`✅ Filtro *${key}* ligado.${hint}`);
      }
      if (arg === 'off' || arg === 'desligar' || arg === '0') {
        groups.updateFilter(ctx.remoteJid, key, false);
        return ctx.reply(`❌ Filtro *${key}* desligado.`);
      }
      return ctx.reply(`🔧 Filtro *${key}*: ${cur ? '✅ ligado' : '❌ desligado'}.\nUso: !${key} on|off`);
    },
  };
}

// [nome, descrição, aliases]
const FILTERS = [
  ['antispam', 'Detecta mensagens repetidas em sequência.'],
  ['antiflood', 'Limita a quantidade de mensagens por intervalo.'],
  ['antifake', 'Marca números estrangeiros que entrarem no grupo.'],
  ['antibot', 'Marca possíveis bots que entrarem no grupo.'],
  ['antiparentese', 'Apaga mensagens dominadas por símbolos.'],
  ['antiinvite', 'Apaga links de convite enviados por membros.'],
  ['antimedia', 'Apaga qualquer mídia de não-admins.'],
  ['antiimagem', 'Apaga imagens/fotos de não-admins.', ['antifoto']],
  ['antivideo', 'Apaga vídeos de não-admins.'],
  ['antiaudio', 'Apaga áudios de não-admins.'],
  ['antidocumento', 'Apaga documentos/arquivos de não-admins.', ['antidoc']],
  ['antisticker', 'Apaga figurinhas de não-admins.', ['antifig', 'antifigurinha']],
  ['antiviewonce', 'Apaga mídias de visualização única de não-admins.', ['antivv']],
  ['antilocalizacao', 'Apaga localizações enviadas por não-admins.', ['antiloc', 'antilocal']],
  ['antipix', 'Apaga links/chaves de pagamento (pix) de não-admins.', ['antipagamento', 'antipag']],
  ['anticontato', 'Apaga contatos enviados por não-admins.', ['antictt']],
];

module.exports = [
  // antilink com whitelist (comando especial)
  {
    name: 'antilink',
    commands: ['antilink'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Bloqueia links de não-admins (com whitelist).',
    usage: '!antilink on|off | whitelist add|remove|list [domínio]',
    cooldown: 1500,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();
      const s = groups.getSettings(ctx.remoteJid);
      const cur = (s.filters || {}).antilink;

      if (sub === 'whitelist' || sub === 'wl') {
        const op = (ctx.args[1] || '').toLowerCase();
        const domain = (ctx.args[2] || '').toLowerCase().replace(/^www\./, '');
        const wl = s.antilink_whitelist || [];
        if (op === 'add' && domain) {
          if (!wl.includes(domain)) wl.push(domain);
          groups.setWhitelist(ctx.remoteJid, wl);
          return ctx.reply(`✅ Domínio *${domain}* adicionado à whitelist.`);
        }
        if (op === 'remove' || op === 'rm') {
          groups.setWhitelist(ctx.remoteJid, wl.filter((d) => d !== domain));
          return ctx.reply(`🗑️ Domínio *${domain}* removido da whitelist.`);
        }
        if (op === 'list' || !op) {
          return ctx.reply(`📋 *Whitelist antilink:*\n${wl.length ? wl.map((d) => '▸ ' + d).join('\n') : '(vazia)'}`);
        }
      }

      if (sub === 'on' || sub === 'ligar') {
        groups.updateFilter(ctx.remoteJid, 'antilink', true);
        const hint = ctx.isBotAdmin ? '' : '\n_⚠️ Para APAGAR as mensagens, o bot precisa ser admin do grupo (senão ele só avisa)._';
        return ctx.reply('✅ Anti-link ligado.' + hint);
      }
      if (sub === 'off' || sub === 'desligar') {
        groups.updateFilter(ctx.remoteJid, 'antilink', false);
        return ctx.reply('❌ Anti-link desligado.');
      }
      return ctx.reply(
        `🔧 Anti-link: ${cur ? '✅ ligado' : '❌ desligado'}.\n` +
          `Uso: !antilink on|off\n!antilink whitelist add <domínio>\n!antilink whitelist remove <domínio>\n!antilink whitelist list`
      );
    },
  },
  ...FILTERS.map(([key, desc, aliases]) => makeFilter(key, desc, key, aliases || [])),
];
