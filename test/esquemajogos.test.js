#!/usr/bin/env node
/**
 * test/esquemajogos.test.js — esquema do banco dos jogos + auto-cura.
 *
 * Contexto (24/09): no aparelho, `,cacatesouro` e `,tigrinho` respondiam as
 * mensagens genéricas de erro. Um banco em que a version de `schema_migrations`
 * está ADIANTE do código (banco vindo de outro estado/deploy) pula a migração
 * dos jogos para sempre — e aí qualquer consulta às tabelas `game_bets`,
 * `treasure_games` e `game_rounds` falha no SQLite. Este teste garante:
 *
 *  1) o array MIGRATIONS está íntegro (sem buracos/undefined — um `,,` acidental
 *     cria um buraco silencioso, que `forEach` pula);
 *  2) a migração dos jogos é a ÚLTIMA e cria as três tabelas com as colunas que
 *     o código usa;
 *  3) banco com version adiantada e tabelas ausentes é CURADO no `open()`
 *     (esquema conferido por medição, não por número de versão);
 *  4) tabela existente sem uma coluna ganha a coluna sem apagar dado;
 *  5) depois da cura, os dois comandos rodam de verdade (registro + execução);
 *  6) `scripts/jogos-doctor.js` roda num banco assim e sai com sucesso.
 *
 * Cada cenário roda em SUBPROCESSO (o módulo do banco é um singleton por
 * processo — a única forma honesta de simular "abrir o bot de novo").
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dbtmp = require('./dbtmp');

const RAIZ = path.resolve(__dirname, '..');
let feitos = 0;
let falhas = 0;
function ok(l) {
  feitos++;
  console.log('✅ ' + l);
}
function fail(l, e) {
  falhas++;
  console.log('❌ ' + l + ' — ' + (e && e.message));
}

/** Roda um script node filho com um banco próprio; devolve o que ele imprimiu. */
function noFilho(nomeBanco, linhas, env = {}) {
  const arquivo = dbtmp.tmpFile(nomeBanco);
  const script =
    `process.env.DATABASE_FILE=${JSON.stringify(arquivo)};` +
    `process.env.OWNER_NUMBER='5511999999999';` +
    `const path=require('path');` +
    linhas;
  const saida = execFileSync(process.execPath, ['-e', script], {
    cwd: RAIZ,
    env: Object.assign({}, process.env, env),
    encoding: 'utf8',
  });
  return { saida, arquivo };
}

/** O que o filho escreve como resultado legível (última linha). */
function ultima(saida) {
  const l = String(saida).trim().split('\n').filter((x) => x.trim().startsWith('{'));
  return JSON.parse(l[l.length - 1]);
}

async function main() {
  fs.mkdirSync(path.join(RAIZ, 'tmp'), { recursive: true });

  /* 1) MIGRATIONS íntegro: sem buracos (o `,,` acidental some no forEach) */
  try {
    const database = require('../database/database');
    const M = database.MIGRATIONS;
    assert.ok(Array.isArray(M), 'MIGRATIONS é array');
    assert.strictEqual(M.length, M.filter((s) => typeof s === 'string').length, 'nenhum item vazio (buraco de vírgula)');
    assert.ok(
      M.every((s) => /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)|ALTER TABLE|PRAGMA|INSERT|UPDATE|DROP/i.test(s)),
      'toda migração tem SQL de verdade'
    );
    const jogos = M[M.length - 1];
    assert.ok(/game_bets/.test(jogos) && /treasure_games/.test(jogos) && /game_rounds/.test(jogos), 'a última migração cria as 3 tabelas dos jogos');
    ok(`1: MIGRATIONS íntegro (${M.length} migrações, a última cria as tabelas dos jogos)`);
  } catch (e) {
    fail('1: MIGRATIONS', e);
  }

  /* 2) banco novo: tabelas + colunas que o código usa */
  try {
    const { saida } = noFilho('lua-esquema-novo.db', `
      const db=require(path.join(${JSON.stringify(RAIZ)},'database/database'));db.open();
      const c=db.get();
      const cols=(t)=>c.prepare('PRAGMA table_info('+t+')').all().map(x=>x.name);
      const r={
        version:(c.prepare('SELECT MAX(version) v FROM schema_migrations').get()||{}).v,
        game_bets:cols('game_bets'), treasure_games:cols('treasure_games'), game_rounds:cols('game_rounds'),
        ajustes:db.ensureGameSchema().length,
      };
      console.log(JSON.stringify(r));
    `);
    const r = ultima(saida);
    assert.ok(r.version >= 36, `versão aplicada (${r.version})`);
    assert.strictEqual(r.ajustes, 0, 'banco novo não precisa de ajuste depois de migrar');
    for (const col of ['user_id', 'game', 'bet', 'status', 'reward', 'ref_id']) {
      assert.ok(r.game_bets.includes(col), `game_bets.${col}`);
    }
    for (const col of ['user_id', 'chat_id', 'size', 'secret', 'revealed', 'digs_used', 'expires_at', 'status']) {
      assert.ok(r.treasure_games.includes(col), `treasure_games.${col}`);
    }
    for (const col of ['user_id', 'game', 'bet', 'reward', 'state', 'payload', 'settled_at']) {
      assert.ok(r.game_rounds.includes(col), `game_rounds.${col}`);
    }
    ok('2: banco novo cria as 3 tabelas com as colunas usadas pelo código');
  } catch (e) {
    fail('2: esquema novo', e);
  }

  /* 3) banco "hostil": version ADIANTE e tabelas dos jogos ausentes → curado */
  try {
    const { saida } = noFilho('lua-esquema-hostil.db', `
      const db=require(path.join(${JSON.stringify(RAIZ)},'database/database'));db.open();
      const c=db.get();
      // simula um banco de OUTRO deploy: versão no futuro e as tabelas novas faltando
      c.exec('DROP TABLE game_bets; DROP TABLE treasure_games; DROP TABLE game_rounds;');
      c.prepare("INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (99, '')").run();
      // aqui o bot é "aberto de novo" (o open() do singleton não roda duas vezes;
      // chamamos as mesmas etapas que o open() chama)
      const ajustes=db.ensureGameSchema();
      const nomes=c.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
      console.log(JSON.stringify({
        ajustes:ajustes.length,
        game_bets:nomes.includes('game_bets'), treasure_games:nomes.includes('treasure_games'),
        game_rounds:nomes.includes('game_rounds'), version:(c.prepare('SELECT MAX(version) v FROM schema_migrations').get()||{}).v,
      }));
    `);
    const r = ultima(saida);
    assert.ok(r.ajustes >= 3, `a auto-cura relatou ${r.ajustes} ajuste(s)`);
    assert.strictEqual(r.game_bets, true, 'game_bets criada com a version adiantada');
    assert.strictEqual(r.treasure_games, true, 'treasure_games criada com a version adiantada');
    assert.strictEqual(r.game_rounds, true, 'game_rounds criada com a version adiantada');
    assert.strictEqual(r.version, 99, 'a version do banco NÃO é reescrita (não mexe no que não é nosso)');
    ok('3: version adiantada + tabelas ausentes → esquema curado sem apagar nada');
  } catch (e) {
    fail('3: banco hostil', e);
  }

  /* 4) tabela existente sem coluna: coluna entra e o dado fica */
  try {
    const { saida } = noFilho('lua-esquema-coluna.db', `
      const db=require(path.join(${JSON.stringify(RAIZ)},'database/database'));db.open();
      const c=db.get();
      c.exec('DROP TABLE treasure_games');
      c.exec("CREATE TABLE treasure_games (id TEXT PRIMARY KEY, user_id TEXT, size INTEGER, status TEXT)");
      c.prepare("INSERT INTO treasure_games (id,user_id,size,status) VALUES ('x','u',7,'active')").run();
      const ajustes=db.ensureGameSchema();
      const row=c.prepare("SELECT * FROM treasure_games WHERE id='x'").get();
      console.log(JSON.stringify({ ajustes:ajustes.length, temBet:Object.prototype.hasOwnProperty.call(row,'bet'), size:row.size, status:row.status }));
    `);
    const r = ultima(saida);
    assert.ok(r.ajustes >= 1, 'relatou a coluna adicionada');
    assert.strictEqual(r.temBet, true, 'coluna que faltava foi adicionada');
    assert.strictEqual(r.size, 7, 'dado existente preservado');
    assert.strictEqual(r.status, 'active', 'estado preservado');
    ok('4: coluna ausente adicionada sem perder dados');
  } catch (e) {
    fail('4: coluna ausente', e);
  }

  /* 5) depois da cura, os dois comandos RODAM (não é só o esquema bonito) */
  try {
    const { saida } = noFilho('lua-esquema-comandos.db', `
      const db=require(path.join(${JSON.stringify(RAIZ)},'database/database'));db.open();
      const c=db.get();
      c.exec('DROP TABLE game_bets; DROP TABLE treasure_games; DROP TABLE game_rounds;');
      c.prepare("INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (99, '')").run();
      db.ensureGameSchema();
      require(path.join(${JSON.stringify(RAIZ)},'commands/loader')).loadCommands(true);
      const {registry}=require(path.join(${JSON.stringify(RAIZ)},'engine/plugins'));
      const life=require(path.join(${JSON.stringify(RAIZ)},'database/life'));
      const eco=require(path.join(${JSON.stringify(RAIZ)},'database/economy'));
      const u='5511977777777@s.whatsapp.net';
      life.createCharacter(u,{name:'Teste',age:22,city:'Sumaré'}); eco.setWallet(u,1000);
      const mk=(nome,args)=>{const enviados=[];
        const ctx={socket:{user:{id:'x'},relayMessage:async(j,m)=>{enviados.push(m);return{key:{id:'k'}}}},
          remoteJid:'g@g.us',isGroup:true,isOwner:true,prefix:',',sender:u,args,message:{key:{id:'M-'+Math.random().toString(36).slice(2)}},
          replies:[],reply:async(m)=>{ctx.replies.push(String(m));return{}}};
        return {ctx,enviados,cmd:registry.getCommand(nome)};};
      (async()=>{
        const out={};
        for(const nome of ['cacatesouro','tigrinho']){
          const {ctx,enviados,cmd}=mk(nome,[]);
          try{ await cmd.execute(ctx); out[nome]={card:enviados.length>0, resposta:ctx.replies[0]||null}; }
          catch(e){ out[nome]={erro:e.message}; }
        }
        console.log(JSON.stringify(out));
      })();
    `);
    const r = ultima(saida);
    assert.ok(!r.cacatesouro.erro, `caça rodou (${r.cacatesouro.erro || 'ok'})`);
    assert.ok(!r.tigrinho.erro, `tigrinho rodou (${r.tigrinho.erro || 'ok'})`);
    assert.strictEqual(r.cacatesouro.card, true, 'caça mandou o card (nenhuma mensagem de erro)');
    assert.strictEqual(r.tigrinho.card, true, 'tigrinho mandou o card (nenhuma mensagem de erro)');
    ok('5: comandos rodam de verdade depois da auto-cura do esquema');
  } catch (e) {
    fail('5: comandos depois da cura', e);
  }

  /* 6) o doctor roda nesse mesmo cenário e falha?? não: ele conserta e reporta */
  try {
    const arquivo = dbtmp.tmpFile('lua-esquema-doctor.db');
    const pre = `
      process.env.DATABASE_FILE=${JSON.stringify(arquivo)};
      process.env.OWNER_NUMBER='5511999999999';
      const db=require(${JSON.stringify(path.join(RAIZ, 'database/database'))});db.open();
      db.get().exec('DROP TABLE game_bets;');
      db.get().prepare("INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (99, '')").run();
    `;
    execFileSync(process.execPath, ['-e', pre], { cwd: RAIZ, env: process.env, encoding: 'utf8' });
    const saida = execFileSync(process.execPath, ['scripts/jogos-doctor.js'], {
      cwd: RAIZ,
      env: Object.assign({}, process.env, { DATABASE_FILE: arquivo, OWNER_NUMBER: '5511999999999' }),
      encoding: 'utf8',
    });
    assert.ok(/schema_migrations \(version aplicada\): 99/.test(saida), 'o doctor mostra a version do banco');
    assert.ok(/✅ tabela game_bets/.test(saida) || /game_bets/.test(saida), 'o doctor mostra o estado das 3 tabelas');
    assert.ok(/✅ cacatesouro: card enviado/.test(saida), 'o doctor executa o caça sem erro');
    assert.ok(/✅ tigrinho: card enviado/.test(saida), 'o doctor executa o tigrinho sem erro');
    ok('6: scripts/jogos-doctor.js roda no banco problemático e mostra tudo');
  } catch (e) {
    fail('6: doctor', e);
  }

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ erro fatal:', e);
  process.exit(1);
});
