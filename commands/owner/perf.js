'use strict';
const perf = require('../../utils/perf');
const chatSerial = require('../../utils/chatSerial');
module.exports = [{
  name: 'perf', commands: ['perf'], category: 'owner', ownerOnly: true, cooldown: 2000,
  description: 'Diagnóstico de latência e benchmark controlado.', usage: '!perf status|sendtest',
  execute: async (ctx) => {
    if (!ctx.isOwner) return ctx.reply('🚫 Apenas o dono pode usar o diagnóstico de performance.');
    const sub = String(ctx.args[0] || 'status').toLowerCase();
    if (sub === 'status') {
      const s = perf.snapshot(); const q = chatSerial.stats();
      return ctx.reply([
        '⚡ LUA PERF', `Respostas recentes: ${s.response.count}`,
        `p50=${s.response.p50}ms · p95=${s.response.p95}ms · max=${s.response.max}ms`,
        `Média histórica: ${s.avgResponseMs}ms`, `Chats com processamento ativo: ${q.activeChats}`,
      ].join('\n'));
    }
    if (sub === 'sendtest') {
      const out = [];
      const run = async (name, fn) => { const t = Date.now(); try { await fn(); out.push(`${name}: total=${Date.now() - t}ms`); } catch (err) { out.push(`${name}: erro=${err.code || err.message}`); } };
      await run('TEXT', () => ctx.reply('LUA PERF TEST • texto', { quoted: false }));
      await run('TEXT NORMAL', () => ctx.reply('LUA PERF TEST • normal', { quoted: false }));
      await run('BUTTON', () => ctx.sendButtons({ text: 'LUA PERF TEST', buttons: [{ id: 'perf_noop', label: 'OK' }] }));
      await run('HTML MIN', async () => require('../../utils/richHtml').sendHtml(ctx.socket, ctx.remoteJid, '<div>LUA PERF TEST</div>', { title: 'LUA PERF TEST' }));
      return ctx.reply(['⚠️ Tempo até o helper concluir; não é confirmação de entrega.', ...out].join('\n'), { quoted: false });
    }
    return ctx.reply('Use: .perf status ou .perf sendtest');
  },
}];
