'use strict';
const perf = require('../../utils/perf');
const sendGuard = require('../../utils/sendGuard');
const freio = require('../../utils/freioConfig');
const chatQueue = require('../../utils/chatQueue');

module.exports = [{
  name: 'perf', commands: ['perf'], category: 'owner', ownerOnly: true, cooldown: 2000,
  description: 'Diagnóstico de latência e benchmark controlado.',
  usage: '!perf status|sendtest',
  execute: async (ctx) => {
    if (!ctx.isOwner) return ctx.reply('🚫 Apenas o dono pode usar o diagnóstico de performance.');
    const sub = String(ctx.args[0] || 'status').toLowerCase();
    if (sub === 'status') {
      const s = perf.snapshot(); const g = sendGuard.stats(); const sp = sendGuard.perfStats(); const q = chatQueue.stats(); const c = freio.get();
      return ctx.reply([
        '⚡ LUA PERF', `Respostas recentes: ${s.response.count}`, `p50=${s.response.p50}ms · p95=${s.response.p95}ms · max=${s.response.max}ms`,
        `Send queue: depth=${g.counters.queuedNow} · wait p50/p95/max=${sp.queueWaitMs.p50}/${sp.queueWaitMs.p95}/${sp.queueWaitMs.max}ms`,
        `Send real p50/p95/max=${sp.sendMs.p50}/${sp.sendMs.p95}/${sp.sendMs.max}ms`, `Total envio p50/p95/max=${sp.totalMs.p50}/${sp.totalMs.p95}/${sp.totalMs.max}ms`,
        `Média histórica: ${s.avgResponseMs}ms`,
        `Chats ativos: ${q.activeChats} · queuedChats=${q.queuedChats}`, `Freio: delay=${c.delayEnabled ? 'ON' : 'OFF'} · multichat=${c.multichatEnabled ? 'ON' : 'OFF'}`,
        `Envios travados: ${g.travados.total}`,
      ].join('\n'));
    }
    if (sub === 'sendtest') {
      const out = [];
      const run = async (name, fn) => { const t = Date.now(); await fn(); out.push(`${name}: total=${Date.now() - t}ms`); };
      await run('TEXT', () => ctx.reply('LUA PERF TEST • texto', { quoted: false }));
      await run('TEXT NORMAL', () => ctx.reply('LUA PERF TEST • normal', { quoted: false }));
      await run('BUTTON', async () => { if (!ctx.sendButtons) return; await ctx.sendButtons({ text: 'LUA PERF TEST', buttons: [{ id: 'perf_noop', label: 'OK' }] }); });
      await run('HTML MIN', async () => {
        const richHtml = require('../../utils/richHtml');
        try { await richHtml.sendHtml(ctx.socket, ctx.remoteJid, '<div>LUA PERF TEST</div>', { title: 'LUA PERF TEST' }); }
        catch (err) { out.push(`HTML MIN: indisponível (${err.code || 'bloqueado'})`); }
      });
      return ctx.reply(['⚠️ Os tempos medem término do helper, não confirmação de entrega.', ...out].join('\n'), { quoted: false });
    }
    return ctx.reply('Use: .perf status ou .perf sendtest');
  },
}];
