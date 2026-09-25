#!/usr/bin/env node
/**
 * scripts/jogos-doctor.js — diagnóstico dos jogos com aposta (caça + tigrinho)
 * e do card do menu.
 *
 * Para que serve: quando `,cacatesouro` / `,tigrinho` / `,menu` respondem "algo
 * deu errado" ou o card aparece pequeno, este script mostra, no próprio
 * Termux, o estado real do banco e o ERRO COMPLETO (com stack) — sem depender
 * de print de conversa.
 *
 * Não envia nada no WhatsApp: usa um "socket" falso (só registra o que seria
 * enviado) e um destinatário de teste.
 *
 * Uso:
 *   node scripts/jogos-doctor.js
 *   npm run jogos:doctor
 */

'use strict';

const path = require('path');
const fs = require('fs');

const OUT = [];
function linha(txt = '') {
  OUT.push(txt);
  console.log(txt);
}
function titulo(txt) {
  linha('');
  linha('─'.repeat(58));
  linha(txt);
  linha('─'.repeat(58));
}

async function main() {
  const CONFIG = require('../config');

  titulo('1) Ambiente');
  linha(`node            : ${process.version} (${process.platform}/${process.arch})`);
  linha(`diretório       : ${process.cwd()}`);
  linha(`prefixo REAL    : ${CONFIG.bot.prefix || '!'}`);
  linha(`arquivo do banco: ${CONFIG.paths.databaseFile}${fs.existsSync(CONFIG.paths.databaseFile) ? ' (existe)' : ' (NÃO existe ainda)'}`);
  linha(`modo HTML       : MENU_HTML_HEIGHT=${process.env.MENU_HTML_HEIGHT || '(padrão)'} MENU_HTML_STEP=${process.env.MENU_HTML_STEP || '(padrão)'}`);

  titulo('2) Banco: versão e tabelas');
  const database = require('../database/database');
  let db;
  try {
    db = database.open();
  } catch (err) {
    linha(`❌ não consegui abrir o banco: ${err && err.message}`);
    linha((err && err.stack) || '');
    return;
  }
  const versao = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() || {}).v;
  const migracoes = database.MIGRATIONS.length;
  linha(`schema_migrations (version aplicada): ${versao}`);
  // O que identifica cada migração aplicada hoje é o NOME (v1..vN): um banco
  // vindo de outro deploy pode ter números à frente (o do aparelho tinha 38 com
  // o código tendo 36) e, sem isso, a migração nova nunca rodaria.
  const semNome = (db.prepare("SELECT COUNT(*) c FROM schema_migrations WHERE nome IS NULL OR nome = ''").get() || {}).c;
  linha(`migrações do código: ${migracoes} · linhas sem nome no banco: ${semNome}`);
  if (Number(versao) > migracoes) {
    linha(`⚠️  banco À FRENTE do código (version ${versao} > ${migracoes} migrações) — migrações novas entram por NOME;`);
    linha('    nada é apagado e o que faltar é criado por medição (é o caso dos jogos).');
  }
  const tabelas = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((t) => t.name);
  for (const t of ['game_bets', 'treasure_games', 'game_rounds']) {
    const existe = tabelas.includes(t);
    linha(`${existe ? '✅' : '❌'} tabela ${t}${existe ? ` (${db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c} linha(s))` : ' AUSENTE'}`);
    if (existe) {
      const colunas = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      linha(`   colunas: ${colunas.join(', ')}`);
    }
  }
  const ajustes = database.ensureEsquemaReal();
  linha(
    ajustes.length
      ? `🔧 esquema ajustado agora (por medição): ${ajustes.join(', ')}`
      : '✅ esquema íntegro (tabelas e colunas das migrações conferidas por medição)'
  );

  titulo('3) Configurações que afetam os jogos/menu');
  const settings = require('../database/settings');
  const menuFormat = require('../utils/menuFormat');
  linha(`menu_html (banco)      : ${JSON.stringify(settings.get('menu_html', null))}`);
  linha(`safe_mode (banco)      : ${JSON.stringify(settings.get('safe_mode', null))}`);
  linha(`usarHtmlJogo()         : ${JSON.stringify(menuFormat.usarHtmlJogo())}`);
  linha(`menu (modo card)       : ${JSON.stringify(menuFormat.status())}`);
  try {
    const safety = require('../utils/safety');
    linha(`modo seguro            : richCards bloqueados = ${safety.blocksRichCards()}`);
  } catch (err) {
    linha(`modo seguro            : não consegui checar (${err && err.message})`);
  }

  titulo('4) Comandos com um socket falso (nenhum envio real)');
  require('../commands/loader').loadCommands(true);
  const { registry } = require('../engine/plugins');

  function ctxFalso(args) {
    const enviados = [];
    const ctx = {
      enviados,
      socket: {
        user: { id: '5511900000000:1@s.whatsapp.net' },
        relayMessage: async (jid, message) => {
          enviados.push({ jid, message });
          return { key: { id: 'DOCTOR' } };
        },
      },
      remoteJid: '550000000000000000@g.us', // chat de teste: não é o seu grupo
      isGroup: true,
      isOwner: true,
      prefix: CONFIG.bot.prefix || '!',
      sender: '5511900000000@s.whatsapp.net',
      args,
      command: 'diagnostico',
      message: { key: { id: `doctor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } },
      replies: [],
      reply: async (m) => {
        ctx.replies.push(String(m));
        return {};
      },
    };
    return ctx;
  }

  const alvos = [
    ['cacatesouro', ['cacatesouro', []]],
    ['cacatesouro 3', ['cacatesouro', ['3']]],
    ['tigrinho', ['tigrinho', []]],
    ['menu', ['menu', []]],
  ];
  for (const [rotulo, [nome, args]] of alvos) {
    const cmd = registry.getCommand(nome);
    if (!cmd) {
      linha(`❌ ${rotulo}: comando NÃO registrado (plugin não carregou?)`);
      continue;
    }
    const ctx = ctxFalso(args);
    const t0 = Date.now();
    try {
      await cmd.execute(ctx);
      const card = ctx.enviados.length
        ? `card enviado (${(ctx.enviados[0].message.botForwardedMessage ? 'HTML' : 'outro')})`
        : 'texto';
      linha(`✅ ${rotulo}: ${card} em ${Date.now() - t0}ms`);
      if (ctx.enviados.length) {
        const payload = ctx.enviados[0].message.botForwardedMessage &&
          ctx.enviados[0].message.botForwardedMessage.message.richResponseMessage;
        if (payload) {
          const html = JSON.parse(payload.unifiedResponse.data.toString('utf8')).sections[0].view_model.primitive.payload;
          linha(`   card: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
          // MOLDURA: o card precisa declarar altura FIXA em px. Sem isso o host
          // mede o conteúdo e o card pode sair minúsculo ("encolhido").
          const m = /html,body\{margin:0;padding:0;height:(\d+)px;max-height:\d+px;overflow:hidden\}/.exec(html);
          linha(
            m
              ? `   moldura: altura fixa ${m[1]}px + #__wrap ${/id="__wrap"/.test(html) ? 'ok' : 'AUSENTE'} ✅`
              : '   moldura: ❌ SEM altura fixa — o card pode sair pequeno (ver menus/html/moldura.js)'
          );
        }
      }
      const resposta = ctx.replies[ctx.replies.length - 1];
      if (resposta) linha(`   resposta: ${resposta.split('\n')[0].slice(0, 120)}`);
    } catch (err) {
      linha(`❌ ${rotulo}: ERRO — ${err && err.message}`);
      linha('   stack:');
      String((err && err.stack) || '').split('\n').slice(0, 8).forEach((l) => linha(`   ${l.trim()}`));
    }
  }

  titulo('5) Card do menu (tamanho)');
  try {
    const menus = require('../menus/html');
    const { DIM, ESCALA } = require('../menus/html/dimensoes');
    linha(`altura declarada : ${menus.alturaDoCard()} px (faixa ${DIM.alturaMin}–${DIM.alturaMax}) — teto do host: ${DIM.alturaCurta} px`);
    linha(`escala do texto  : ${ESCALA}`);
    linha(`passo das setas  : ${menus.passoDoCard()}`);
    linha(`largura máxima   : ${DIM.larguraMax} px em tela larga (celular usa 100% da bolha)`);
    linha(`menus/html       : ${typeof menus.montarDocumento === 'function' ? 'ok' : 'sem montarDocumento'}`);
  } catch (err) {
    linha(`❌ não consegui ler as dimensões do card: ${err && err.message}`);
  }

  titulo('Resumo');
  linha('Se algum jogo falhou acima, o stack mostra o motivo real.');
  linha('Se um card está pequeno, toque no TÍTULO da seção DENTRO do card:');
  linha('  ▸ "área do card aqui: NNNpx" é a altura REAL que o aplicativo está dando.');
  linha('  ▸ MENU_HTML_HEIGHT no .env muda a altura declarada (de fábrica: 640 px) — MENUS-HTML.md §2.2/§2.4.');

  const destino = path.join(CONFIG.paths.tmpDir || 'tmp', 'jogos-doctor.txt');
  try {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, OUT.join('\n') + '\n');
    console.log(`\n📄 relatório salvo em: ${destino}`);
  } catch (_) {
    /* sem tmp gravável: o console já mostrou tudo */
  }
}

main().catch((err) => {
  console.error('❌ erro fatal no doctor:', (err && err.stack) || err);
  process.exit(1);
});
