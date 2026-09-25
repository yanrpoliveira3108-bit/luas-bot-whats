/**
 * commands/_shared/apagarMsg.js — REGRAS DE APAGAR MENSAGEM (uma fonte só).
 *
 * Regras (pedido do dono, 25/09/2026):
 *   • quem é DONO      → apaga qualquer mensagem, em qualquer conversa;
 *   • quem é ADMIN     → apaga qualquer mensagem do grupo;
 *   • quem NÃO é admin → apaga somente a PRÓPRIA mensagem (a marcada, ou a
 *                        última que ele mandou);
 *   • em conversa privada → só faz sentido apagar mensagem DO BOT (o WhatsApp
 *     não permite revogar mensagem de outra pessoa fora de grupo).
 *
 * Detalhe do WhatsApp (não é limitação nossa, é da plataforma): quem executa a
 * revogação é o BOT. Ele pode revogar:
 *   – as mensagens DELE mesmo, sempre;
 *   – mensagens de OUTRAS pessoas apenas se for admin do grupo.
 * Por isso a checagem de `ctx.isBotAdmin` aparece nas mensagens de erro — sem
 * ela o pedido falha no servidor e parece "comando que não funciona".
 *
 * Este módulo é usado pelo `!apagar` e pelo `!d` (nada de duas implementações
 * com regras diferentes).
 */

'use strict';

const antiManager = require('../../utils/antiManager');
const logger = require('../../utils/logger').child('apagar');

/** Quem é o autor de uma chave de mensagem, comparando com as formas conhecidas. */
function mesmaPessoa(a, b) {
  const soDigitos = (j) => String(j || '').replace(/[^0-9]/g, '');
  const da = soDigitos(a);
  const db = soDigitos(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // mesma pessoa mesmo com DDI/9 extra: compara finais
  return da.length >= 10 && db.length >= 10 && (da.endsWith(db) || db.endsWith(da));
}

/** Uma identidade do remetente corresponde ao autor da mensagem marcada? */
function ehAutor(autor, identidades) {
  return (identidades || []).some((i) => mesmaPessoa(i, autor));
}

/**
 * Tenta revogar UMA mensagem. Devolve { ok, motivo }.
 * `motivo`: 'sem-chave' | 'sem-permissao' | 'bot-nao-admin' | 'falhou' | 'ok'
 */
async function revogar(ctx, chave) {
  if (!chave || !chave.id) return { ok: false, motivo: 'sem-chave' };
  const autor = String(chave.participant || '');
  const identidades = ctx.identidades || [ctx.sender];
  const doBot = chave.fromMe === true || mesmaPessoa(autor, ctx.socket && ctx.socket.user && ctx.socket.user.id);
  const autorEhRemetente = ehAutor(autor, identidades);

  // permissão
  if (ctx.isOwner) {
    // dono: qualquer mensagem — mas revogar mensagem de terceiro em grupo exige
    // que o BOT seja admin; e mensagem de terceiro em PV o WhatsApp não permite.
    if (!doBot && !autorEhRemetente) {
      if (!ctx.isGroup) return { ok: false, motivo: 'pv-terceiro' };
      if (!ctx.isBotAdmin) return { ok: false, motivo: 'bot-nao-admin' };
    }
  } else if (ctx.isGroup && ctx.isAdmin) {
    if (!doBot && !ctx.isBotAdmin) return { ok: false, motivo: 'bot-nao-admin' };
  } else if (autorEhRemetente) {
    // membro comum apagando a PRÓPRIA mensagem: quem executa é o bot, então ele
    // precisa ser admin para revogar uma mensagem que não é dele
    if (!doBot && ctx.isGroup && !ctx.isBotAdmin) return { ok: false, motivo: 'bot-nao-admin' };
    if (!ctx.isGroup && !doBot) return { ok: false, motivo: 'pv-propria' };
  } else {
    return { ok: false, motivo: 'sem-permissao' };
  }

  try {
    await ctx.socket.sendMessage(ctx.remoteJid, { delete: chave });
    // some do histórico do anti: evita o purge tentar apagar de novo
    try {
      antiManager.removeFromHistory(ctx.remoteJid, autor || ctx.sender, chave.id);
    } catch (_) {}
    logger.info({ chat: ctx.remoteJid, autor: autor || '(bot)', por: ctx.sender }, 'mensagem apagada');
    return { ok: true, motivo: 'ok' };
  } catch (err) {
    logger.warn({ err: err && err.message, chat: ctx.remoteJid }, 'falha ao apagar mensagem');
    return { ok: false, motivo: 'falhou', erro: (err && err.message) || String(err) };
  }
}

/** Texto amigável para cada motivo de recusa (nunca genérico: diz o porquê). */
function explicar(motivo) {
  switch (motivo) {
    case 'sem-chave':
      return '⚠️ Não encontrei a mensagem. Responda (citando) a mensagem que quer apagar.';
    case 'sem-permissao':
      return (
        '🚫 Você só pode apagar *suas próprias* mensagens.\n' +
        '▸ Para apagar qualquer mensagem no grupo é preciso ser *admin*.'
      );
    case 'bot-nao-admin':
      return (
        '⚠️ Preciso ser *admin do grupo* para apagar mensagem de outra pessoa.\n' +
        '▸ A sua própria mensagem também depende disso (quem revoga é o bot).'
      );
    case 'pv-terceiro':
      return '🚫 No privado o WhatsApp não permite apagar mensagem de outra pessoa.';
    case 'pv-propria':
      return (
        '⚠️ No privado, apagar uma mensagem sua só funciona se quem pedir for o *dono do bot* ' +
        'e o bot tiver enviado ela.'
      );
    case 'falhou':
      return '❌ Não consegui apagar. Veja os logs (a mensagem pode ser muito antiga).';
    default:
      return '❌ Não consegui apagar.';
  }
}

/**
 * Apaga a mensagem marcada (citada) respeitando as regras.
 * Devolve { ok, motivo, resposta } — `resposta` é o texto pronto para enviar.
 */
async function apagarMarcada(ctx) {
  const chave = ctx.quotedKey;
  if (!chave) {
    return {
      ok: false,
      motivo: 'sem-chave',
      resposta:
        '⚠️ *Responda* (cite) a mensagem que quer apagar.\n' +
        `▸ Ex.: responda a mensagem e mande ${ctx.prefix || '!'}d`,
    };
  }
  const r = await revogar(ctx, chave);
  if (r.ok) return { ok: true, motivo: 'ok', resposta: '🗑️ Mensagem apagada.' };
  return { ok: false, motivo: r.motivo, resposta: explicar(r.motivo) };
}

/**
 * Apaga a ÚLTIMA mensagem rastreada de alguém (do próprio remetente, ou do alvo
 * quando quem pede é admin/dono). O histórico é o mesmo usado pelos antis.
 */
async function apagarUltima(ctx, alvo) {
  const quem = alvo || ctx.sender;
  const identidades = ctx.identidades || [ctx.sender];
  const proprio = ehAutor(quem, identidades) || mesmaPessoa(quem, ctx.sender);
  if (!proprio && !(ctx.isOwner || (ctx.isGroup && ctx.isAdmin))) {
    return { ok: false, motivo: 'sem-permissao', resposta: explicar('sem-permissao') };
  }
  const historico = antiManager.getUserHistory(ctx.remoteJid, quem);
  if (!historico.length) {
    return {
      ok: false,
      motivo: 'sem-historico',
      resposta:
        '⚠️ Não tenho nenhuma mensagem dessa pessoa no histórico.\n' +
        '▸ O bot guarda as últimas 50 mensagens de cada um (por 30 min) desde que subiu.',
    };
  }
  const ultima = historico[historico.length - 1];
  const r = await revogar(ctx, ultima.key);
  if (r.ok) return { ok: true, motivo: 'ok', resposta: '🗑️ Última mensagem apagada.' };
  return { ok: false, motivo: r.motivo, resposta: explicar(r.motivo) };
}

/**
 * Sem mensagem marcada:
 *   • MEMBRO comum → apaga a última mensagem DELE (é a "enviada anteriormente"
 *     do pedido do dono);
 *   • ADMIN/DONO   → NÃO apaga nada e explica como marcar. É de propósito: quem
 *     pode apagar QUALQUER mensagem não deveria perder a sua por engano só
 *     porque tocou no botão do menu sem marcar nada.
 */
async function apagarUltimaOuAviso(ctx) {
  const podeQualquer = ctx.isOwner || (ctx.isGroup && ctx.isAdmin);
  if (podeQualquer) {
    return {
      ok: false,
      motivo: 'sem-alvo',
      resposta:
        '⚠️ *Marque a mensagem* que quer apagar (responda a ela) e mande de novo.\n' +
        `▸ Ex.: responda a mensagem e mande ${ctx.prefix || '!'}d\n` +
        `▸ Para apagar em lote de alguém: ${ctx.prefix || '!'}apagar @usuario 10\n` +
        '_(como você é admin, nada foi apagado por engano)_',
    };
  }
  return apagarUltima(ctx, ctx.sender);
}

module.exports = { apagarMarcada, apagarUltima, apagarUltimaOuAviso, revogar, explicar, mesmaPessoa, ehAutor };
