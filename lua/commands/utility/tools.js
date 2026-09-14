/**
 * commands/utility/tools.js — ferramentas utilitárias (sem API externa).
 *
 * botinfo, data, hora, fuso, qr, base64, uuid, senha, porcentagem.
 */

'use strict';

const crypto = require('crypto');
const os = require('os');
const CONFIG = require('../../config');
const { registry } = require('../../engine/plugins');
const { formatUptime } = require('../../utils/formatter');
const { maybeReadMore } = require('../../utils/readmore');

function qrText(text) {
  try {
    const qrcode = require('qrcode-terminal');
    let out = '';
    qrcode.generate(String(text).slice(0, 500), { small: true }, (code) => {
      out = code;
    });
    return out || null;
  } catch (_) {
    return null;
  }
}

module.exports = [
  {
    name: 'botinfo',
    commands: ['botinfo'],
    category: 'utility',
    description: 'Informações técnicas do bot.',
    usage: '!botinfo',
    cooldown: 3000,
    execute: async (ctx) => {
      const mem = process.memoryUsage();
      const lines = [
        `🤖 *${CONFIG.bot.name}* v${CONFIG.bot.version}`,
        `▸ Node: ${process.version}`,
        `▸ Plataforma: ${os.platform()} ${os.arch()}`,
        `▸ Comandos: ${registry.count()} em ${registry.categories().length} categorias`,
        `▸ Online há: ${formatUptime(CONFIG.bot.startedAt)}`,
        `▸ Memória: ${Math.round(mem.rss / 1024 / 1024)} MB`,
        `▸ Prefixo: ${ctx.prefix}`,
        `▸ Dono: ${CONFIG.owner.name}`,
      ];
      await ctx.reply(maybeReadMore(lines.join('\n')));
    },
  },
  {
    name: 'data',
    commands: ['data'],
    category: 'utility',
    description: 'Data de hoje.',
    usage: '!data',
    cooldown: 2000,
    execute: async (ctx) => {
      const now = new Date();
      await ctx.reply(`📅 *Hoje:* ${now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
    },
  },
  {
    name: 'hora',
    commands: ['hora'],
    category: 'utility',
    description: 'Hora atual.',
    usage: '!hora',
    cooldown: 2000,
    execute: async (ctx) => {
      const now = new Date();
      await ctx.reply(`🕐 *Agora:* ${now.toLocaleTimeString('pt-BR')}`);
    },
  },
  {
    name: 'fuso',
    commands: ['fuso', 'timezone'],
    category: 'utility',
    description: 'Fuso horário do servidor.',
    usage: '!fuso',
    cooldown: 2000,
    execute: async (ctx) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const offset = -new Date().getTimezoneOffset() / 60;
      await ctx.reply(`🌍 *Fuso:* ${tz}\n▸ UTC${offset >= 0 ? '+' : ''}${offset}`);
    },
  },
  {
    name: 'qr',
    commands: ['qr', 'gerarqr', 'qrcode'],
    category: 'utility',
    description: 'Gera um QR Code (texto escaneável).',
    usage: '!qr <texto ou link>',
    cooldown: 5000,
    execute: async (ctx) => {
      const text = ctx.args.join(' ').trim();
      if (!text) return ctx.reply('🔳 Envie o conteúdo: !qr <texto ou link>');
      const code = qrText(text);
      if (!code) return ctx.reply('❌ Não consegui gerar o QR Code.');
      await ctx.reply(`🔳 QR Code:\n\`\`\`${code}\`\`\``);
    },
  },
  {
    name: 'base64',
    commands: ['base64'],
    category: 'utility',
    description: 'Codifica/decodifica em Base64.',
    usage: '!base64 <texto> | !base64 -d <texto>',
    cooldown: 2000,
    execute: async (ctx) => {
      const decodificar = String(ctx.args[0] || '') === '-d';
      const data = ctx.args.slice(decodificar ? 1 : 0).join(' ');
      if (!data) return ctx.reply('🔐 Use: !base64 <texto> (codificar) ou !base64 -d <texto> (decodificar).');
      try {
        const out = decodificar ? Buffer.from(data, 'base64').toString('utf8') : Buffer.from(data, 'utf8').toString('base64');
        if (!out) return ctx.reply('❌ Entrada inválida para decodificação.');
        await ctx.reply(`🔐 ${decodificar ? 'Decodificado' : 'Base64'}:\n\`${out.slice(0, 800)}\``);
      } catch (_) {
        await ctx.reply('❌ Não consegui processar (Base64 inválido?).');
      }
    },
  },
  {
    name: 'uuid',
    commands: ['uuid'],
    category: 'utility',
    description: 'Gera um UUID v4.',
    usage: '!uuid',
    cooldown: 2000,
    execute: async (ctx) => ctx.reply(`🆔 \`${crypto.randomUUID()}\``),
  },
  {
    name: 'senha',
    commands: ['senha', 'password', 'gerarsenha'],
    category: 'utility',
    description: 'Gera uma senha segura.',
    usage: '!senha [tamanho]',
    cooldown: 2000,
    execute: async (ctx) => {
      const len = Math.min(64, Math.max(8, parseInt(ctx.args[0], 10) || 16));
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
      const buf = crypto.randomBytes(len);
      let pass = '';
      for (let i = 0; i < len; i++) pass += chars[buf[i] % chars.length];
      await ctx.reply(`🔑 Senha (${len} caracteres):\n\`${pass}\``);
    },
  },
  {
    name: 'porcentagem',
    commands: ['porcentagem', 'pct'],
    category: 'utility',
    description: 'Calcula X% de um valor.',
    usage: '!porcentagem <percentual> <valor>',
    cooldown: 2000,
    execute: async (ctx) => {
      const pct = parseFloat(String(ctx.args[0] || '').replace(',', '.'));
      const valor = parseFloat(String(ctx.args[1] || '').replace(',', '.'));
      if (!Number.isFinite(pct) || !Number.isFinite(valor)) return ctx.reply('🧮 Use: !porcentagem <percentual> <valor>\nEx.: !porcentagem 15 80');
      const resultado = Math.round(pct / 100 * valor * 100) / 100;
      await ctx.reply(`🧮 ${pct}% de ${valor} = *${resultado}*`);
    },
  },
];
