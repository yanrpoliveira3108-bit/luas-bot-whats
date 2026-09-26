/**
 * commands/admin/horariogrupo.js — abertura/fechamento automático diário do grupo.
 *
 *   !horariogrupo                 → status (qualquer membro pode consultar)
 *   !horariogrupo status          → idem
 *   !horariogrupo 06:00 00:00     → abre 06:00, fecha 00:00, salva e ATIVA
 *   !horariogrupo abrir 07:30     → altera só a abertura (não ativa sozinho)
 *   !horariogrupo fechar 23:00    → altera só o fechamento (não ativa sozinho)
 *   !horariogrupo on              → ativa os horários salvos
 *   !horariogrupo off             → desativa (horários e estado atual mantidos)
 *
 * Permissão para ALTERAR: a mesma regra dos comandos `adminOnly` do projeto
 * (dono, admin do grupo ou Cargo X9 quando ligado) — mas conferida com os
 * participantes CONSULTADOS AGORA, não só com o cache do contexto.
 *
 * Toda a lógica de agenda/estado vive em utils/groupSchedule.js; aqui só há
 * validação, permissão e as respostas.
 */

'use strict';

const CONFIG = require('../../config');
const schedule = require('../../utils/groupSchedule');
const tzTime = require('../../utils/tzTime');
const permissions = require('../../utils/permissions');
const { EMOJI, LINHA, titulo } = require('../../config/textStyles');

const ON = ['on', 'ativar', 'ligar'];
const OFF = ['off', 'desativar', 'desligar'];
const ABRIR = ['abrir', 'abertura', 'abre'];
const FECHAR = ['fechar', 'fechamento', 'fecha'];
const STATUS = ['status', 'estado', 'ver'];

function uso(p) {
  return [
    `▸ \`${p}horariogrupo 06:00 00:00\` — abre 06:00, fecha 00:00 e ativa`,
    `▸ \`${p}horariogrupo abrir 07:30\` — altera só a abertura`,
    `▸ \`${p}horariogrupo fechar 23:00\` — altera só o fechamento`,
    `▸ \`${p}horariogrupo on\` / \`${p}horariogrupo off\` — ativa / desativa`,
    `▸ \`${p}horariogrupo status\` — mostra a programação`,
  ].join('\n');
}

/** Valida um horário; devolve { ok, valor } ou { ok:false, erro }. */
function validarHorario(txt) {
  const s = String(txt || '').trim();
  if (tzTime.parseHHMM(s)) return { ok: true, valor: s };
  if (/^24[:h]?00$/i.test(s)) {
    return { ok: false, erro: `*${s}* não existe: meia-noite deve ser informada como *00:00*.` };
  }
  if (/^\d{1}:\d{2}$/.test(s)) {
    return { ok: false, erro: `Use dois dígitos na hora: *0${s}* em vez de *${s}*.` };
  }
  return { ok: false, erro: `*${s}* não é um horário válido. Use HH:MM entre 00:00 e 23:59 (ex.: 06:00, 23:30).` };
}

function nomeEstado(e) {
  return e === 'closed' ? `${EMOJI.grupo.fechado} fechado (só admins enviam)` : `${EMOJI.grupo.aberto} aberto (todos enviam)`;
}

function quando(ms, tz) {
  return `${tzTime.formatLocal(ms, tz)} (${tz}, ${tzTime.offsetLabel(ms, tz)})`;
}

function proximas(cfg, agora) {
  const evs = schedule.proximosEventos(cfg, agora, 1);
  const o = evs.find((e) => e.kind === 'open');
  const c = evs.find((e) => e.kind === 'close');
  return [
    `▸ Próxima abertura: ${o ? quando(o.at, cfg.tz) : '—'}`,
    `▸ Próximo fechamento: ${c ? quando(c.at, cfg.tz) : '—'}`,
  ];
}

function faltando(cfg) {
  const f = [];
  if (!cfg.open) f.push('abertura');
  if (!cfg.close) f.push('fechamento');
  return f;
}

/** Linha com o resultado REAL da verificação do estado do grupo. */
function linhaResultado(res, p) {
  if (!res) return '';
  if (res.ok && res.code === 'already-done') return `▸ Estado do grupo: evento já executado.`;
  if (res.ok) {
    return res.changed
      ? `▸ Estado do grupo: ${EMOJI.status.ok} alterado agora para ${nomeEstado(res.expected)}.`
      : `▸ Estado do grupo: ${EMOJI.status.ok} já estava ${nomeEstado(res.expected)} — nada foi alterado.`;
  }
  const linhas = [`▸ Estado do grupo: ${EMOJI.status.erro} NÃO alterado — ${schedule.motivo(res.code)}.`];
  if (res.expected) linhas.push(`▸ Deveria estar: ${nomeEstado(res.expected)}.`);
  if (res.retryInMs) linhas.push(`▸ Nova tentativa automática em ${Math.round(res.retryInMs / 1000)}s.`);
  if (res.code === 'bot-not-admin') linhas.push('▸ Torne o bot administrador do grupo.');
  if (res.code === 'disconnected') linhas.push('▸ Vou reconciliar assim que a conexão voltar.');
  if (res.code === 'bot-removed') linhas.push(`▸ Desative com \`${p}horariogrupo off\` se o bot não voltar ao grupo.`);
  return linhas.join('\n');
}

function statusTexto(ctx, cfg) {
  const p = ctx.prefix;
  const agora = schedule.agora();
  const tz = cfg.tz;
  const linhas = [`${EMOJI.tempo.relogio} *${titulo('HORÁRIO DO GRUPO')}*`, LINHA];
  if (!cfg.exists) {
    linhas.push('▸ Nenhuma programação salva neste grupo.', '', '*Como usar*', uso(p));
    return linhas.join('\n');
  }
  const estado = cfg.enabled
    ? `${EMOJI.status.ok} *ATIVA*`
    : schedule.completa(cfg)
      ? `${EMOJI.status.inativo} *DESATIVADA*`
      : `${EMOJI.status.inativo} *INCOMPLETA* (desativada)`;
  linhas.push(
    `▸ Programação: ${estado}`,
    `▸ Abertura: ${cfg.open || '— não definida'}`,
    `▸ Fechamento: ${cfg.close || '— não definido'}`,
    `▸ Fuso: ${tz} (${tzTime.offsetLabel(agora, tz)})`
  );
  if (schedule.completa(cfg)) {
    linhas.push(`▸ Pela programação, agora: ${nomeEstado(schedule.estadoEsperado(cfg, agora))}`);
    if (cfg.enabled) linhas.push(...proximas(cfg, agora));
    else linhas.push(`▸ Nada será executado enquanto estiver desativada (\`${p}horariogrupo on\`).`);
  } else {
    const f = faltando(cfg);
    linhas.push(`▸ Falta definir: ${f.join(' e ')}.`);
    if (!cfg.open) linhas.push(`▸ \`${p}horariogrupo abrir 06:00\``);
    if (!cfg.close) linhas.push(`▸ \`${p}horariogrupo fechar 00:00\``);
  }
  if (cfg.last && cfg.last.at) {
    const at = Date.parse(cfg.last.at);
    const quandoFoi = Number.isFinite(at) ? tzTime.formatLocal(at, tz) : cfg.last.at;
    linhas.push(
      cfg.last.ok
        ? `▸ Última verificação: ${EMOJI.status.ok} ${quandoFoi} — ${cfg.last.changed ? 'grupo ajustado' : 'já estava certo'}`
        : `▸ Última verificação: ${EMOJI.status.erro} ${quandoFoi} — ${schedule.motivo(cfg.last.code)}`
    );
  }
  linhas.push(
    LINHA,
    `_${EMOJI.status.info} \`${p}abrirgrupo\`/\`${p}fechargrupo\` continuam valendo e não apagam a programação; ` +
      'o próximo horário automático (ou uma reconciliação ao reiniciar) volta a aplicar o estado programado._',
    '_O bot precisa estar ligado, conectado e ser admin do grupo nos horários._'
  );
  return linhas.join('\n');
}

/**
 * Confere AGORA quem pode alterar (participantes consultados na hora) e se o
 * bot é admin. Dono dispensa a checagem do remetente, mas o bot ainda é
 * consultado.
 */
async function conferirPermissoes(ctx) {
  const insp = await schedule.inspecionar(ctx.remoteJid);
  let autorizado = !!ctx.isOwner;
  if (!autorizado && insp.meta) {
    const ids = ctx.identidades && ctx.identidades.length ? ctx.identidades : [ctx.sender];
    autorizado = permissions.isAdmin(insp.meta.participants, ids) || !!ctx.isX9;
  }
  return { insp, autorizado, verificado: !!insp.meta || !!ctx.isOwner };
}

function erroSalvar(err) {
  return (
    `${EMOJI.status.erro} *A configuração NÃO foi salva* (${(err && err.code) === 'save-failed' ? 'o banco não confirmou a gravação' : 'erro no banco'}).\n` +
    '▸ A programação anterior foi mantida. Tente novamente.'
  );
}

module.exports = [
  {
    name: 'horariogrupo',
    commands: ['horariogrupo'],
    category: 'admin',
    groupOnly: true,
    description: 'Abre e fecha o grupo automaticamente todos os dias (ex.: 06:00 e 00:00).',
    usage: '!horariogrupo <abertura> <fechamento> | abrir HH:MM | fechar HH:MM | on | off | status',
    cooldown: 3000,
    execute: async (ctx) => {
      const p = ctx.prefix;
      if (typeof schedule.socketDiagnostic === 'function') {
        const d = schedule.socketDiagnostic(ctx.socket);
        // Mantém o diagnóstico focado apenas em presença/identidade de instância.
        require('../../utils/logger').child('horarioGrupo').info({
          ctxSocketPresent: d.hasContextSocket,
          currentSocketPresent: d.hasCurrentSocket,
          sameSocket: d.sameSocket,
        }, '[GROUP_SCHEDULE_RUNTIME] command-socket');
      }
      const args = (ctx.args || []).map((a) => String(a).trim()).filter(Boolean);
      const a0 = (args[0] || '').toLowerCase();

      /* ---------------- status (qualquer membro) ---------------- */
      if (!args.length || (STATUS.includes(a0) && args.length === 1)) {
        await ctx.reply(statusTexto(ctx, schedule.getConfig(ctx.remoteJid)));
        return;
      }

      /* ---------------- interpretar sem tocar no banco ---------------- */
      let acao = null;
      const patch = {};
      const invalido = (msg) =>
        ctx.reply(`${EMOJI.status.aviso} ${msg}\n\n*Exemplos corretos*\n${uso(p)}\n\n_Nada foi alterado._`);

      if (args.length === 2 && (tzTime.parseHHMM(args[0]) || /^\d{1,2}[:h]\d{2}$/i.test(args[0]))) {
        const o = validarHorario(args[0]);
        const c = validarHorario(args[1]);
        if (!o.ok) return invalido(`Abertura: ${o.erro}`);
        if (!c.ok) return invalido(`Fechamento: ${c.erro}`);
        acao = 'ambos';
        patch.open = o.valor;
        patch.close = c.valor;
      } else if (ABRIR.includes(a0) || FECHAR.includes(a0)) {
        if (args.length !== 2) return invalido(`Informe um único horário: \`${p}horariogrupo ${a0} 07:30\`.`);
        const v = validarHorario(args[1]);
        if (!v.ok) return invalido(v.erro);
        acao = ABRIR.includes(a0) ? 'abrir' : 'fechar';
        if (acao === 'abrir') patch.open = v.valor;
        else patch.close = v.valor;
      } else if ((ON.includes(a0) || OFF.includes(a0)) && args.length === 1) {
        acao = ON.includes(a0) ? 'on' : 'off';
      } else {
        return invalido(`Argumento não reconhecido: *${args.join(' ').slice(0, 40)}*.`);
      }

      const atual = schedule.getConfig(ctx.remoteJid);
      const open = patch.open !== undefined ? patch.open : atual.open;
      const close = patch.close !== undefined ? patch.close : atual.close;
      if (open && close && open === close) {
        return invalido(
          `Abertura e fechamento no mesmo horário (*${open}*) são ambíguos: o grupo ficaria aberto ou fechado? ` +
            'Escolha horários diferentes.'
        );
      }

      /* ---------------- permissões atuais ---------------- */
      const perm = await conferirPermissoes(ctx);
      if (!perm.verificado) {
        await ctx.reply(
          `${EMOJI.status.erro} Não consegui confirmar suas permissões agora (${schedule.motivo(perm.insp.code)}).\n▸ Nada foi alterado. Tente novamente em instantes.`
        );
        return;
      }
      if (!perm.autorizado) {
        await ctx.reply(CONFIG.messages.deniedAdmin);
        return;
      }

      const querAtivar = acao === 'ambos' || acao === 'on';
      if (acao === 'on' && !schedule.completa({ open, close })) {
        const f = faltando({ open, close });
        await ctx.reply(
          `${EMOJI.status.aviso} Não dá para ativar: falta o horário de *${f.join('* e de *')}*.\n` +
            (!open ? `▸ \`${p}horariogrupo abrir 06:00\`\n` : '') +
            (!close ? `▸ \`${p}horariogrupo fechar 00:00\`\n` : '') +
            '_Nada foi alterado._'
        );
        return;
      }

      // o bot precisa ser admin para ATIVAR (e para executar mudanças)
      let bloqueioBot = null;
      if (querAtivar && !perm.insp.ok) bloqueioBot = perm.insp.code;

      /* ---------------- salvar ---------------- */
      let salvo;
      try {
        if (acao === 'off') salvo = schedule.saveConfig(ctx.remoteJid, { enabled: false });
        else if (acao === 'on') {
          if (bloqueioBot) {
            await ctx.reply(
              `${EMOJI.status.erro} Não ativei: ${schedule.motivo(bloqueioBot)}.\n` +
                (bloqueioBot === 'bot-not-admin' ? '▸ Torne o bot administrador e tente de novo.\n' : '') +
                '▸ Os horários salvos continuam como estavam.'
            );
            return;
          }
          salvo = schedule.saveConfig(ctx.remoteJid, { enabled: true });
        } else if (acao === 'ambos') {
          salvo = schedule.saveConfig(ctx.remoteJid, { ...patch, enabled: bloqueioBot ? false : true });
        } else {
          salvo = schedule.saveConfig(ctx.remoteJid, patch); // mantém enabled como estava
        }
      } catch (err) {
        await ctx.reply(erroSalvar(err));
        return;
      }

      const tz = salvo.tz;
      const cab = [
        `▸ Abertura: ${salvo.open || '— não definida'}`,
        `▸ Fechamento: ${salvo.close || '— não definido'}`,
        `▸ Fuso: ${tz}`,
      ];

      /* ---------------- desativar ---------------- */
      if (acao === 'off') {
        await ctx.reply(
          [
            `${EMOJI.status.inativo} *Programação diária desativada.*`,
            ...cab,
            `${EMOJI.status.salvo} Os horários continuam salvos (\`${p}horariogrupo on\` reativa).`,
            '▸ O estado atual do grupo foi mantido — nada foi aberto nem fechado.',
          ].join('\n')
        );
        return;
      }

      /* ---------------- salvo, mas não ativo ---------------- */
      if (!salvo.enabled) {
        const linhas = [`${EMOJI.status.salvo} *Configuração salva.*`, ...cab];
        if (bloqueioBot) {
          linhas.push(
            `${EMOJI.status.aviso} *Programação NÃO ativada:* ${schedule.motivo(bloqueioBot)}.`,
            `▸ Depois de corrigir, use \`${p}horariogrupo on\`.`
          );
        } else if (!schedule.completa(salvo)) {
          const f = faltando(salvo);
          linhas.push(
            `${EMOJI.status.aviso} Falta o horário de *${f.join('* e de *')}* — a programação só pode ser ativada com os dois.`,
            !salvo.open ? `▸ \`${p}horariogrupo abrir 06:00\`` : `▸ \`${p}horariogrupo fechar 00:00\``
          );
        } else {
          linhas.push(`▸ A programação continua *desativada*. Use \`${p}horariogrupo on\` para ativar.`);
        }
        linhas.push('▸ O estado do grupo não foi alterado.');
        await ctx.reply(linhas.join('\n'));
        return;
      }

      /* ---------------- ativo: reconciliar agora ---------------- */
      const res = await schedule.reconcile(ctx.remoteJid, { reason: 'comando', silent: true });
      const titulo1 =
        acao === 'ambos' || acao === 'on'
          ? `${EMOJI.status.ok} *Programação diária ativada.*`
          : `${EMOJI.status.ok} *Horário atualizado* (programação ativa).`;
      await ctx.reply(
        [
          titulo1,
          ...cab,
          `${EMOJI.status.salvo} Configuração salva.`,
          linhaResultado(res, p),
          ...proximas(salvo, schedule.agora()),
        ]
          .filter(Boolean)
          .join('\n')
      );
    },
  },
];

module.exports._interno = { validarHorario, statusTexto, linhaResultado };
