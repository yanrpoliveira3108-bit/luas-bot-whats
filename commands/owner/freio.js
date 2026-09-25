/**
 * commands/owner/freio.js — painel do FREIO DE ENVIO (anti-restrição).
 *
 *   !freio                  → estado completo (modo seguro, fila, limites, warmup)
 *   !freio pausar [min]     → para TODOS os envios agora (emergência)
 *   !freio retomar          → retoma os envios
 *   !freio seguro on|off    → liga/desliga o modo seguro (payloads de risco)
 *   !freio bloqueios [jid] → o que o freio barrou, por conversa e por motivo
 *   !freio warmup reset     → REINICIA o aquecimento (limites duros de novo)
 *   !freio warmup off       → ENCERRA o aquecimento (número já é antigo)
 *
 * Existe para você ter controle na hora do problema: se aparecer aviso de
 * restrição no celular, `!freio pausar 60` deixa o bot em silêncio sem
 * precisar derrubar o processo.
 */

'use strict';

const CONFIG = require('../../config');
const sendGuard = require('../../utils/sendGuard');
const safety = require('../../utils/safety');
const logger = require('../../utils/logger').child('freio');

function bar(current, max, size = 10) {
  const ratio = max > 0 ? Math.min(1, current / max) : 0;
  const filled = Math.round(ratio * size);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, size - filled));
}

/**
 * "Por que o bot não falou NESTE chat?" — o freio anota cada envio barrado por
 * conversa (motivo + quando). É o que transforma "o comando foi feito e a
 * mensagem não apareceu" em causa escrita. Ver `!freio bloqueios <jid>`.
 */
const NOME_MOTIVO = {
  broadcast_identico: 'mesma mensagem já enviada a outro chat',
  fila_cheia: 'fila da conversa cheia',
  pv_frio: 'conversa fria no privado (quem nunca falou com o bot)',
  interativo_safe_mode: 'modo seguro bloqueia botões/listas',
};

function motivoTexto(m) {
  if (String(m).startsWith('relay:')) return `modo seguro bloqueou o payload ${String(m).slice(6)}`;
  return NOME_MOTIVO[m] || m;
}

function bloqueiosText() {
  const s = sendGuard.stats();
  const lista = (s.bloqueios && s.bloqueios.porConversa) || [];
  if (!lista.length) return [];
  const linhas = ['', '*Envios barrados pelo freio (por conversa)*'];
  for (const c of lista.slice(0, 5)) {
    const motivos = Object.entries(c.motivos)
      .map(([m, n]) => `${motivoTexto(m)} ×${n}`)
      .join(' · ');
    linhas.push(`▸ ${c.jid} — ${c.total}× (${motivos})`);
  }
  linhas.push('_Detalhe de uma conversa: `!freio bloqueios <jid>`_');
  return linhas;
}

function bloqueiosDetalhe(jid) {
  const j = String(jid || '').trim();
  if (!j) {
    const s = sendGuard.stats();
    const lista = (s.bloqueios && s.bloqueios.porConversa) || [];
    if (!lista.length) return '✅ Nenhum envio barrado pelo freio até agora.';
    return [
      '🚧 *ENVIOS BARRADOS PELO FREIO*',
      ...lista.map(
        (c) => `▸ ${c.jid} — ${c.total}×: ` + Object.entries(c.motivos).map(([m, n]) => `${motivoTexto(m)} ×${n}`).join(' · ')
      ),
      '',
      '_Motivo mais comum: a MESMA mensagem já tinha ido para outro chat (trava anti-broadcast)._',
    ].join('\n');
  }
  const r = sendGuard.bloqueiosDaConversa(j);
  if (!r) return `✅ Nenhum envio barrado para *${j}*.\n_Para ver as conversas com bloqueio: \`!freio bloqueios\`_`;
  return [
    `🚧 *Envio barrado em ${j}*`,
    `▸ Total: ${r.total}× · último: ${r.ultimo || '—'}`,
    ...Object.entries(r.motivos).map(([m, n]) => `▸ ${motivoTexto(m)} ×${n}`),
    '',
    '_Barrado pelo freio = a mensagem NÃO saiu. Se o bot executou a ação e a mensagem não apareceu, é isto que aconteceu._',
  ].join('\n');
}

function statusText() {
  const s = sendGuard.stats();
  const limits = s.limits;
  const used = s.counters.lastMinute;

  return [
    '🛡️ *FREIO DE ENVIO*',
    '━━━━━━━━━━━━━━━━━━━━',
    s.safeMode
      ? 'Modo seguro: 🛡️ LIGADO (sem cards HTML / menu nativo / pagamento)'
      : 'Modo seguro: ⚪ desligado (padrão — cards HTML e menu normais)',
    `Envios: ${s.paused ? `⏸️ PAUSADO (${s.pauseRemainingMin} min)` : '▶️ ativos'}`,
    s.paused && s.pauseReason ? `Motivo: ${s.pauseReason}` : null,
    '',
    '*Limites em vigor*',
    `▸ ${limits.maxPerMinute} msg/min no total  ${bar(used, limits.maxPerMinute)} ${used}/${limits.maxPerMinute}`,
    `▸ ${limits.chatMaxPerMinute} msg/min por conversa`,
    `▸ Intervalo: ${limits.minIntervalMs}ms global · ${limits.chatIntervalMs}ms por conversa`,
    `▸ Mídia espera ${limits.mediaMultiplier}× mais`,
    limits.dupMaxChats > 0
      ? `▸ Mesma mensagem: máx. ${limits.dupMaxChats} conversas/${limits.dupWindowMin} min`
      : `▸ Mesma mensagem em vários chats: 🚫 desligado (SEND_DUP_MAX_CHATS=0)`,
    `▸ PV frio (bot iniciar conversa): ${limits.blockColdPv ? '🚫 bloqueado' : '⚠️ liberado'}`,
    `▸ Sinal de restrição → pausa automática de ${limits.pauseMinutes} min`,
    '',
    '*Warmup (número novo)*',
    s.warmup.active
      ? `▸ 🔥 ATIVO — teto por minuto ÷${s.warmup.factor} por mais ${s.warmup.remainingHours}h` +
        (s.warmup.intervalFactor > 1 ? ` (espaçamento ×${s.warmup.intervalFactor})` : '')
      : '▸ ✅ concluído (limites normais)',
    `▸ Início: ${s.warmup.since}`,
    '',
    '*Contadores*',
    `▸ Enviadas: ${s.counters.sent} · Bloqueadas pelo freio: ${s.counters.blocked}`,
    `▸ Na fila agora: ${s.counters.queuedNow}`,
    `▸ Conversas conhecidas (PV): ${s.chatsConhecidos}`,
    s.lastRestriction ? `▸ Última restrição detectada: ${s.lastRestriction.at}` : '▸ Nenhuma restrição detectada 🎉',
    ...bloqueiosText(),
    '━━━━━━━━━━━━━━━━━━━━',
    '▸ `!freio pausar 60` — silêncio total',
    '▸ `!freio retomar`',
    '▸ `!freio seguro on|off`',
    '▸ `!freio warmup reset` — reinicia o aquecimento',
    '▸ `!freio warmup off` — encerra (número já aquecido)',
    '',
    '📖 `!antiban` — status das proteções + dicas (GUIA_ANTI_BAN.md)',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

module.exports = [
  {
    name: 'freio',
    commands: ['freio', 'anti-ban', 'seguranca', 'risco'],
    category: 'owner',
    ownerOnly: true,
    description: 'Painel do freio de envio: pausa, limites, warmup e modo seguro.',
    usage: '!freio [bloqueios [jid]|pausar|retomar|seguro on/off|warmup reset]',
    cooldown: 2000,
    execute: async (ctx) => {
      const sub = String(ctx.args[0] || 'status').toLowerCase();

      if (sub === 'pausar' || sub === 'parar' || sub === 'pause') {
        const min = parseInt(ctx.args[1], 10);
        sendGuard.setPaused(true, Number.isFinite(min) ? min : undefined, 'pausa manual (!freio)');
        const s = sendGuard.stats();
        await ctx.reply(
          `⏸️ *Envios pausados* por ${s.pauseRemainingMin} min.\n` +
            '_Use `!freio retomar` quando o WhatsApp liberar o número._'
        );
        return;
      }

      if (sub === 'retomar' || sub === 'voltar' || sub === 'resume') {
        sendGuard.setPaused(false);
        await ctx.reply('▶️ *Envios retomados.* O freio continua aplicando os limites normais.');
        return;
      }

      if (sub === 'seguro' || sub === 'safemode') {
        const arg = String(ctx.args[1] || '').toLowerCase();
        if (!['on', 'off', '1', '0', 'true', 'false'].includes(arg)) {
          await ctx.reply('⚠️ Use: `!freio seguro on` ou `!freio seguro off`');
          return;
        }
        const on = ['on', '1', 'true'].includes(arg);
        safety.setSafeMode(on);
        logger.warn({ safeMode: on, por: ctx.sender }, 'modo seguro alterado');
        await ctx.reply(
          on
            ? '🛡️ *Modo seguro LIGADO.*\n_Menu textual, sem botões/listas nativas, sem cards HTML e sem PV frio._'
            : '🔴 *Modo seguro DESLIGADO.*\n⚠️ Botões/listas nativas e cards HTML voltam a ser enviados — foi esse payload que derrubou as contas em restrição.'
        );
        return;
      }

      if (sub === 'warmup') {
        const arg = String(ctx.args[1] || '').toLowerCase();
        if (['off', '0', 'pular', 'encerrar', 'fim'].includes(arg)) {
          sendGuard.skipWarmup('!freio warmup off');
          const st = sendGuard.stats();
          await ctx.reply(
            '✅ *Warmup encerrado* — limites normais aplicados.\n' +
              `_${st.limits.maxPerMinute} msg/min no total, ${st.limits.chatMaxPerMinute} por conversa._\n` +
              '▸ Use só quando o número já é antigo e aquecido.'
          );
          return;
        }
        if (arg !== 'reset' && arg !== 'reiniciar') {
          await ctx.reply(
            '⚠️ Use:\n▸ `!freio warmup reset` — reinicia (limites duros de novo)\n▸ `!freio warmup off` — encerra (número já aquecido)'
          );
          return;
        }
        const since = sendGuard.resetWarmup('!freio warmup reset');
        await ctx.reply(
          `🔥 *Warmup reiniciado* (${since}).\n` +
            `_Teto por minuto ÷${CONFIG.safety.send.warmupFactor} pelas próximas ${CONFIG.safety.send.warmupHours}h (o espaçamento entre mensagens não muda)._`
        );
        return;
      }

      if (sub === 'bloqueios' || sub === 'bloqueadas' || sub === 'barrados') {
        await ctx.reply(bloqueiosDetalhe(ctx.args[1]));
        return;
      }

      if (sub === 'status' || sub === 'info' || sub === 'painel') {
        await ctx.reply(statusText());
        return;
      }

      await ctx.reply(
        '⚠️ Subcomando inválido.\n▸ `!freio` — estado\n▸ `!freio bloqueios [jid]` — o que o freio barrou e por quê\n▸ `!freio pausar [min]`\n▸ `!freio retomar`\n▸ `!freio seguro on|off`\n▸ `!freio warmup reset`'
      );
    },
  },
];
