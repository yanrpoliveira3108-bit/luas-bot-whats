'use strict';

const CONFIG = require('../../config');
const antiBan = require('../../utils/antiBan');

module.exports = [
  {
    name: 'antiban',
    commands: ['antiban', 'safemode', 'protecao'],
    category: 'general',
    description: 'Exibe o status do sistema de proteção anti-ban e dicas de segurança.',
    usage: '!antiban',
    cooldown: 5000,
    execute: async (ctx) => {
      const status = antiBan.getStatus();
      const prefix = ctx.prefix;

      const lines = [
        '🛡️ *SISTEMA ANTI-BAN & PROTEÇÃO DE CONTA*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        `🔒 *Modo Seguro:* ${status.safeMode ? '✅ Ativado' : '❌ Desativado'}`,
        `✍️ *Presença Humana (Digitando):* ${status.humanDelays ? '✅ Sim' : '❌ Não'}`,
        `⏱️ *Tempo de Digitação:* ${status.typingDelayRange}`,
        `🚦 *Fila Anti-Rajada (Throttle):* ${status.outboundInterval}`,
        `🤫 *Privado Silencioso (Silent PV):* ${status.silentPv ? '✅ Sim (protegido contra denúncias)' : '❌ Não'}`,
        `💻 *Assinatura do Navegador:* ${status.browser.toUpperCase()} (Chrome)`,
        `🟢 *Online 24h Forçado:* ${status.markOnline ? '⚠️ Sim (alto risco)' : '✅ Não (comportamento natural)'}`,
        `🔘 *Botões Interativos:* ${CONFIG.interactive?.buttonsEnabled ? '⚠️ Ativado' : '✅ Desativado (recomendado)'}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        '💡 *DICAS DE OURO PARA NÃO PERDER NÚMEROS:*',
        '1. *Nunca use chip novo/virgem direto em bot.* Aqueça o chip por pelo menos 14 dias com conversas normais.',
        '2. *Cuidado com o Privado (PV).* Denúncias de desconhecidos são a causa #1 de banimento.',
        '3. *Evite botões interativos.* No WhatsApp Web, botões forçados chamam a atenção dos filtros da Meta. Use menus em texto.',
        '4. *Não dispare broadcasts rápidos.* O intervalo seguro entre grupos é de vários segundos.',
        '5. *Se a conta entrar em análise*, solicite revisão pelo app oficial imediatamente com uma mensagem educada.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        `📖 Guia completo: *GUIA_ANTI_BAN.md*`,
        `🎛️ Controle e limites em tempo real: *!freio*`,
      ];

      await ctx.reply(lines.join('\n'));
    },
  },
];
