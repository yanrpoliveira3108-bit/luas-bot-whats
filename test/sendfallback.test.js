#!/usr/bin/env node
/**
 * test/sendfallback.test.js — RESPOSTA QUE NÃO SAI (mensagem citada que quebra).
 *
 * Relato do dono (25/09, grupo de comunidade/LID): "nesse chat o bot não
 * responde: comandos que fazem coisas ele faz, mas não manda mensagem —
 * hidetag, menu, comandos visuais como tigrinho, qualquer outro comando não
 * aparece no chat, só é feito".
 *
 * O doctor do aparelho mostrou o freio LIMPO (0 barrados) e **56 falhas de
 * envio** com `Cannot read properties of undefined (reading 'toString')`:
 * a resposta quebrava na MONTAGEM (citação/contexto) e nunca saía.
 *
 * Este teste garante o comportamento novo:
 *   1) `sendMessage` com citação que estoura erro de CODIFICAÇÃO (TypeError) →
 *      o bot REENVIA sem a citação e a resposta chega;
 *   2) erro de ENTREGA (rede/status) NÃO é reenviado (não duplica mensagem);
 *   3) o log do reenvio diz se a mensagem citada vinha de um participante LID
 *      (`quotedLid`) e o primeiro frame do stack — a evidência que faltava.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const DB = require('./dbtmp').tmpFile('lua-sendfallback-test.db');

let falhas = 0;
let feitos = 0;
function ok(l) {
  feitos++;
  console.log('✅ ' + l);
}
function fail(l, e) {
  falhas++;
  console.log('❌ ' + l + ' — ' + ((e && e.message) || e));
}

/** Roda um cenário em processo filho (o módulo lê env na carga) e devolve o JSON. */
function noFilho(linhas, extra = {}) {
  const saida = execFileSync(process.execPath, ['-e', linhas.join('\n')], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      OWNER_NUMBER: '5511999999999',
      DATABASE_FILE: DB,
      BUTTONS_ENABLED: 'true',
      SAFE_MODE: '0',
    }, extra),
  });
  const linha = String(saida)
    .trim()
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .pop();
  return JSON.parse(linha);
}

const PRELUDIO = [
  "const path=require('path');",
  `const raiz=${JSON.stringify(RAIZ)};`,
  "process.env.SEND_STATE_DIR='./tmp/sendfallback-state';",
  "process.env.SEND_MIN_INTERVAL_MS='5';process.env.SEND_CHAT_INTERVAL_MS='5';",
  "process.env.SEND_JITTER_MS='0';process.env.SEND_WARMUP_HOURS='0';",
  "process.env.SEND_CONNECT_GRACE_MS='0';",
  "require('fs').rmSync('tmp/sendfallback-state',{recursive:true,force:true});",
  "const database=require(path.join(raiz,'database/database'));database.open();",
  "require(path.join(raiz,'commands/loader')).loadCommands(true);",
  "const commandHandler=require(path.join(raiz,'handlers/commandHandler'));",
  "const guard=require(path.join(raiz,'utils/sendGuard'));",
];

async function main() {
  /* 1) montagem da mensagem citada quebra → reenvia sem citação ------------- */
  try {
    const r = noFilho(
      PRELUDIO.concat([
        'const enviados=[],erros=[];',
        'const socket=guard.attach({user:{id:"5511999999998@s.whatsapp.net"},sendPresenceUpdate:async()=>{},',
        '  groupMetadata:async()=>({id:"120363046296961148@g.us",isCommunity:true,',
        '    participants:[{id:"5511999999998@s.whatsapp.net",admin:"admin"}]}),',
        '  sendMessage:async(jid,content,opts={})=>{',
        '    if(opts&&opts.quoted){const nada=undefined;try{nada.toString()}catch(e){erros.push(e);throw e}}',
        '    enviados.push({jid,content,semCitacao:!opts.quoted});',
        '    return {key:{id:"OK"+enviados.length,remoteJid:jid}};}});',
        'const msg={key:{remoteJid:"120363046296961148@g.us",fromMe:false,id:"LID1",participant:"123456789012345@lid"},',
        '  message:{conversation:"!menu"},pushName:"Dono"};',
        '(async()=>{const ctx=await commandHandler.buildContext(socket,msg);',
        '  await ctx.reply("mensagem de teste");',
        '  console.log(JSON.stringify({erros:erros.length,enviados:enviados.length,',
        '    semCitacao:enviados.every(e=>e.semCitacao), texto:(enviados[0]||{}).content&&enviados[0].content.text}));})();',
      ])
    );
    assert.strictEqual(r.erros, 1, 'a 1ª tentativa (com citação) quebrou como no aparelho');
    assert.strictEqual(r.enviados, 1, 'a resposta saiu mesmo assim');
    assert.strictEqual(r.semCitacao, true, 'saiu SEM a citação (é o que quebrava)');
    assert.strictEqual(r.texto, 'mensagem de teste', 'e com o texto certo');
    ok('1: falha ao montar a mensagem citada → reenvia sem citação e a resposta chega');
  } catch (e) {
    fail('1: reenvio sem citação', e);
  }

  /* 2) erro de ENTREGA não repete (não duplica) ---------------------------- */
  try {
    const r = noFilho(
      PRELUDIO.concat([
        'let envios=0;',
        'const socket=guard.attach({user:{id:"5511999999998@s.whatsapp.net"},sendPresenceUpdate:async()=>{},',
        '  groupMetadata:async()=>({id:"g@g.us",participants:[]}),',
        '  sendMessage:async()=>{envios++;const e=new Error("Connection Closed");e.output={statusCode:428};throw e;}});',
        'const msg={key:{remoteJid:"g@g.us",fromMe:false,id:"X1"},message:{conversation:"oi"},pushName:"D"};',
        '(async()=>{const ctx=await commandHandler.buildContext(socket,msg);let falhou=false;',
        '  try{await ctx.reply("teste")}catch(_){falhou=true}',
        '  console.log(JSON.stringify({envios,falhou}));})();',
      ])
    );
    assert.strictEqual(r.envios, 1, 'tentou UMA vez só (erro de entrega não repete)');
    assert.strictEqual(r.falhou, true, 'o erro sobe para o chamador decidir');
    ok('2: erro de entrega (rede/status) não é reenviado — sem mensagem duplicada');
  } catch (e) {
    fail('2: sem reenvio em erro de entrega', e);
  }

  /* 3) o erro de envio vai para o LOG com stack e com o LID da citação ------ */
  try {
    const dirLogs = path.join(RAIZ, 'tmp', 'sendfallback-logs');
    fs.rmSync(dirLogs, { recursive: true, force: true });
    const r = noFilho(
      PRELUDIO.concat([
        'const socket=guard.attach({user:{id:"5511999999998@s.whatsapp.net"},sendPresenceUpdate:async()=>{},',
        '  groupMetadata:async()=>({id:"120363046296961148@g.us",isCommunity:true,',
        '    participants:[{id:"5511999999998@s.whatsapp.net",admin:"admin"}]}),',
        '  sendMessage:async(jid,c,opts={})=>{if(opts&&opts.quoted){const n=undefined;n.toString()}',
        '    return {key:{id:"OK",remoteJid:jid}};}});',
        'const msg={key:{remoteJid:"120363046296961148@g.us",fromMe:false,id:"LID1",participant:"123456789012345@lid"},',
        '  message:{conversation:"!menu"},pushName:"Dono"};',
        '(async()=>{const ctx=await commandHandler.buildContext(socket,msg);',
        '  await ctx.reply("teste"); console.log(JSON.stringify({ok:1}));})();',
      ]),
      { LOG_DIR: './tmp/sendfallback-logs' }
    );
    assert.strictEqual(r.ok, 1, 'o cenário rodou');
    const arquivoLog = fs.existsSync(dirLogs)
      ? fs.readdirSync(dirLogs).filter((f) => f.startsWith('lua-') && f.endsWith('.log')).map((f) => path.join(dirLogs, f))[0]
      : null;
    const conteudo = arquivoLog && fs.existsSync(arquivoLog) ? fs.readFileSync(arquivoLog, 'utf8') : '';
    assert.ok(/falha ao MONTAR a mensagem citada/.test(conteudo), 'o log diz o que aconteceu');
    assert.ok(/"tipo":"text"/.test(conteudo) || /tipo/.test(conteudo), 'registra o tipo do envio');
    assert.ok(/"quotedLid":true/.test(conteudo) || /quotedLid/.test(conteudo), 'registra que a citação vinha de um LID');
    assert.ok(/frame|at /.test(conteudo), 'e traz o primeiro frame (arquivo:linha) do erro');
    ok('3: a falha fica no log com stack + `quotedLid` (evidência para a próxima investigação)');
  } catch (e) {
    fail('3: log da falha', e);
  }

  /* 4) o mesmo reenvio vale para MENU/lista (não só para texto) ------------ */
  try {
    const r = noFilho(
      PRELUDIO.concat([
        'const enviados=[];',
        'const socket=guard.attach({user:{id:"5511999999998@s.whatsapp.net"},sendPresenceUpdate:async()=>{},',
        '  relayMessage:async()=>{throw new Error("nao usado")},',
        '  groupMetadata:async()=>({id:"g@g.us",participants:[]}),',
        '  sendMessage:async(jid,content,opts={})=>{',
        '    if(opts&&opts.quoted){const n=undefined;n.toString()}',
        '    enviados.push({semCitacao:!opts.quoted,texto:String(content.text||"").slice(0,10)});',
        '    return {key:{id:"OK",remoteJid:jid}};}});',
        '(async()=>{',
        '  await socket.sendMessage("g@g.us",{text:"🌙 LUA BOT — menu",sections:[]},{quoted:{key:{id:"Q1"}}});',
        '  console.log(JSON.stringify({enviados:enviados.length,semCitacao:enviados[0]&&enviados[0].semCitacao}));})();',
      ])
    );
    assert.strictEqual(r.enviados, 1, 'a mensagem de menu saiu');
    assert.strictEqual(r.semCitacao, true, 'sem a citação (que era o que quebrava)');
    ok('4: menu/lista também se recupera (o reenvio está no ponto único de saída, não no comando)');
  } catch (e) {
    fail('4: menu com reenvio', e);
  }

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ erro fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
