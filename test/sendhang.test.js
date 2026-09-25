#!/usr/bin/env node
/**
 * test/sendhang.test.js — ENVIO QUE TRAVA (o "escrevendo infinitamente").
 *
 * Relato do dono (25/09, depois do freio): "o bot fica escrevendo infinitamente
 * no chat… ele fica escrevendo e não manda nada, mesmo que no terminal apareça
 * o comando e ele faça o que o comando pede; não aparece no chat do grupo".
 *
 * A causa está no caminho do envio da BIBLIOTECA: para montar uma mensagem de
 * grupo ela busca a lista de participantes com `await groupMetadata(jid)`
 * (Socket/messages-send.js:837) e essa consulta NÃO tem prazo
 * (Socket/groups.js:24). Quando o servidor não responde — acontece em
 * comunidade/LID — a promessa nunca resolve: nada sai, o "digitando…" nunca é
 * desfeito e, como o freio esperava esse envio, a fila parava inteira.
 *
 * O que este teste garante:
 *   1) envio que trava NÃO pendura: o freio estoura o prazo, REENVIA UMA vez
 *      sem citação (com os metadados do grupo em cache) e a fila continua;
 *   2) grupo cuja consulta de participantes trava → NÃO reenvia às cegas
 *      (melhor não mandar do que mandar para a lista errada) e libera a fila;
 *   3) a presença SEMPRE é encerrada (`paused`) — nada de "digitando…" eterno;
 *   4) cache de metadados: quente responde na hora, vencido renova em segundo
 *      plano, e busca travada devolve em vez de pendurar (com prazo).
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const DB = require('./dbtmp').tmpFile('lua-sendhang-test.db');

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

/** Roda um cenário em processo filho e devolve o último JSON impresso. */
function noFilho(linhas, extra = {}) {
  const saida = execFileSync(process.execPath, ['-e', linhas.join('\n')], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      OWNER_NUMBER: '5511999999999',
      DATABASE_FILE: DB,
      BUTTONS_ENABLED: 'true',
      SAFE_MODE: '0',
      SEND_STATE_DIR: './tmp/sendhang-state',
      SEND_MIN_INTERVAL_MS: '5',
      SEND_CHAT_INTERVAL_MS: '5',
      SEND_JITTER_MS: '0',
      SEND_WARMUP_HOURS: '0',
      SEND_CONNECT_GRACE_MS: '0',
      GROUP_META_WARM: '0',
    }, extra),
  });
  const linha = String(saida)
    .split('\n')
    .filter((l) => l.trim().startsWith('##R##'))
    .pop();
  if (!linha) throw new Error('o cenário não devolveu resultado:\n' + String(saida).slice(-1500));
  return JSON.parse(linha.trim().slice('##R##'.length));
}

const PRELUDIO = [
  "const path=require('path');",
  `const raiz=${JSON.stringify(RAIZ)};`,
  "require('fs').rmSync('tmp/sendhang-state',{recursive:true,force:true});",
  "const database=require(path.join(raiz,'database/database'));database.open();",
  "require(path.join(raiz,'commands/loader')).loadCommands(true);",
  "const commandHandler=require(path.join(raiz,'handlers/commandHandler'));",
  "const guard=require(path.join(raiz,'utils/sendGuard'));",
  "const md=require(path.join(raiz,'utils/groupMetadataCache'));",
];

const CHAT = '120363046296961148@g.us';

async function main() {
  /* 1) envio travado → prazo, reenvio sem citação, fila andando ------------- */
  try {
    const r = noFilho(
      PRELUDIO.concat([
        'const chamadas=[];',
        'const socket=guard.attach({user:{id:"5511999999998@s.whatsapp.net"},sendPresenceUpdate:async()=>{},',
        '  groupMetadata:async(jid)=>({id:String(jid),addressingMode:"lid",participants:[{id:"5511999999998@s.whatsapp.net"}]}),',
        '  sendMessage:async(jid,content,opts={})=>{',
        '    chamadas.push({jid:String(jid),citado:Boolean(opts.quoted)});',
        '    if(chamadas.length===1) return new Promise(()=>{}); // consulta de participantes que NUNCA responde',
        '    return {key:{id:"OK"+chamadas.length,remoteJid:String(jid)}};}});',
        'md.attach(socket);',
        `const msg={key:{remoteJid:${JSON.stringify(CHAT)},fromMe:false,id:"H1",participant:"123456789012345@lid"},`,
        '  message:{conversation:"!menu"},pushName:"Dono"};',
        '(async()=>{const t0=Date.now();',
        '  const ctx=await commandHandler.buildContext(socket,msg);',
        '  await ctx.reply("resposta do bot");',
        '  const ms=Date.now()-t0;',
        '  // a fila CONTINUA: outro chat manda logo depois',
        '  await socket.sendMessage("120363000000000002@g.us",{text:"outro chat"});',
        '  await new Promise(r=>setTimeout(r,300)); // a auditoria é gravada em disco de forma assíncrona',
        '  const audit=require("fs").readFileSync("tmp/sendhang-state/sends.jsonl","utf8").trim().split("\\n").map(JSON.parse);',
        '  const st=guard.stats();',
        '  console.log("##R##"+JSON.stringify({ms,chamadas,travados:st.travados.total,ultimo:st.travados.ultimo,',
        '    prazoMs:st.travados.prazoMs,emAndamento:st.travados.emAndamento,',
        '    travouAudit:audit.filter(a=>a.travou).length,chats:chamadas.map(c=>c.jid)}));',
        '})();',
      ]),
      { SEND_TIMEOUT_MS: '800', SEND_RETRY_TIMEOUT_MS: '600', GROUP_META_TIMEOUT_MS: '500' }
    );
    assert.strictEqual(r.chamadas.length, 3, '1ª (travou) + reenvio + o outro chat');
    assert.strictEqual(r.chamadas[0].citado, true, 'a 1ª tentativa foi com citação e travou');
    assert.strictEqual(r.chamadas[1].citado, false, 'o reenvio saiu SEM citação');
    assert.strictEqual(r.chamadas[2].jid, '120363000000000002@g.us', 'a fila continuou depois do travamento');
    assert.strictEqual(r.travados, 1, 'o travamento ficou registrado no estado do freio');
    assert.strictEqual(r.ultimo.jid, CHAT, 'e aponta o chat onde aconteceu');
    assert.strictEqual(r.ultimo.tentativa2, 'ok', 'e diz que o reenvio funcionou');
    assert.strictEqual(r.travouAudit, 1, 'a auditoria (sends.jsonl) registra o travamento');
    assert.strictEqual(r.emAndamento, null, 'nada fica "em andamento" depois de resolver');
    assert.ok(r.ms < 4000, `o comando não fica pendurado (levou ${r.ms}ms)`);
    ok(`1: envio que trava não pendura mais — prazo ${r.prazoMs}ms, reenvio sem citação, fila liberada (${r.ms}ms)`);
  } catch (e) {
    fail('1: envio travado', e);
  }

  /* 2) grupo cuja consulta de participantes trava → NÃO reenvia às cegas ----- */
  try {
    const r = noFilho(
      PRELUDIO.concat([
        'const chamadas=[];',
        'const socket=guard.attach({user:{id:"5511999999998@s.whatsapp.net"},sendPresenceUpdate:async()=>{},',
        '  groupMetadata:async()=>new Promise(()=>{}), // a consulta TRAVA (caso do aparelho)',
        '  sendMessage:async(jid,c,opts={})=>{chamadas.push(Boolean(opts.quoted));return new Promise(()=>{});}});',
        'md.attach(socket);',
        `const msg={key:{remoteJid:${JSON.stringify(CHAT)},fromMe:false,id:"H2"},message:{conversation:"!menu"},pushName:"D"};`,
        '(async()=>{const ctx=await commandHandler.buildContext(socket,msg);',
        '  const t0=Date.now();await ctx.reply("resposta");',
        '  const st=guard.stats();',
        '  console.log("##R##"+JSON.stringify({ms:Date.now()-t0,chamadas:chamadas.length,travados:st.travados.total,',
        '    tentativa2:st.travados.ultimo&&st.travados.ultimo.tentativa2}));})();',
      ]),
      { SEND_TIMEOUT_MS: '700', SEND_RETRY_TIMEOUT_MS: '500', GROUP_META_TIMEOUT_MS: '350' }
    );
    assert.strictEqual(r.chamadas, 1, 'não reenvia quando não dá para saber os participantes');
    assert.strictEqual(r.travados, 1, 'o travamento foi registrado');
    assert.ok(/sem metadados/.test(String(r.tentativa2)), `motivo explícito (${r.tentativa2})`);
    assert.ok(r.ms < 4000, `mas a fila é liberada (levou ${r.ms}ms)`);
    ok('2: grupo sem metadados não é reenviado às cegas — registra o motivo e libera a fila');
  } catch (e) {
    fail('2: grupo sem metadados', e);
  }

  /* 3) presença sempre encerrada (fim do "digitando…" eterno) --------------- */
  try {
    const r = noFilho(
      [
        "const path=require('path');",
        `const raiz=${JSON.stringify(RAIZ)};`,
        "const antiBan=require(path.join(raiz,'utils/antiBan'));",
        'const presencia=[];',
        'const sock={sendPresenceUpdate:async(p)=>{presencia.push(p);}};',
        '(async()=>{await antiBan.simulateTyping(sock,"120363046296961148@g.us","mensagem de teste",'+'"composing");',
        '  await antiBan.encerrarPresenca(sock,"120363046296961148@g.us");',
        '  console.log("##R##"+JSON.stringify({presencia}));})();',
      ],
      { HUMAN_DELAYS: '1', MIN_TYPING_DELAY_MS: '10', MAX_TYPING_DELAY_MS: '20', NODE_ENV: 'production' }
    );
    assert.strictEqual(r.presencia[0], 'composing', 'começa "digitando…"');
    assert.ok(r.presencia.includes('paused'), 'e SEMPRE encerra a presença');
    assert.strictEqual(r.presencia[r.presencia.length - 1], 'paused', 'a última presença é "paused" (não fica eterno)');
    ok('3: a presença "digitando…" é sempre desfeita — não fica escrevendo para sempre');
  } catch (e) {
    fail('3: presença encerrada', e);
  }

  /* 4) cache de metadados de grupo ----------------------------------------- */
  const SOCK_META = [
    'let buscas=0;',
    'const socket={groupMetadata:async(jid)=>{buscas++;await new Promise(r=>setTimeout(r,80));',
    '  return {id:String(jid),addressingMode:"lid",participants:[{id:"a@s.whatsapp.net"},{id:"b@s.whatsapp.net"}]};}};',
    'md.attach(socket);',
  ];

  /* 4a) quente responde na hora; frio busca uma vez só */
  try {
    const r = noFilho(
      PRELUDIO.concat(SOCK_META).concat([
        '(async()=>{const t0=Date.now();const a=await md.cachedGroupMetadata("111@g.us");const t1=Date.now();',
        '  const b=await md.cachedGroupMetadata("111@g.us");const t2=Date.now();',
        '  const c=await md.garantir("111@g.us");',
        '  console.log("##R##"+JSON.stringify({temA:!!a,temB:!!b,temC:!!c,participantes:(a||{}).participants&&a.participants.length,',
        '    buscas,primeiraMs:t1-t0,segundaMs:t2-t1,stats:md.stats()}));})();',
      ])
    );
    assert.strictEqual(r.temA, true, 'frio: busca e devolve');
    assert.strictEqual(r.participantes, 2, 'com os participantes (é o que o envio precisa)');
    assert.strictEqual(r.buscas, 1, 'a 2ª chamada veio do cache — sem nova consulta');
    assert.strictEqual(r.segundaMs, 0, 'e respondeu na hora');
    assert.strictEqual(r.temC, true, 'garantir() também usa o cache');
    ok('4a: metadados frescos respondem sem rede (é o que evita a consulta que trava)');
  } catch (e) {
    fail('4a: cache quente', e);
  }

  /* 4b) vencido: devolve na hora e renova em segundo plano */
  try {
    const r = noFilho(
      PRELUDIO.concat(SOCK_META).concat([
        '(async()=>{await md.cachedGroupMetadata("222@g.us");',
        '  const buscasDepoisDa1a=buscas;',
        '  await new Promise(r=>setTimeout(r,1150)); // TTL = 1s → venceu',
        '  const t0=Date.now();const x=await md.cachedGroupMetadata("222@g.us");const t1=Date.now();',
        '  await new Promise(r=>setTimeout(r,400)); // tempo para a renovação terminar',
        '  console.log("##R##"+JSON.stringify({ms:t1-t0,temX:!!x,buscasDepoisDa1a,buscasFinais:buscas}));})();',
      ]),
      { GROUP_META_TTL_MS: '1000' }
    );
    assert.ok(r.temX, 'vencido: devolve os metadados que já tinha');
    assert.ok(r.ms < 20, `e devolve NA HORA (${r.ms}ms) — o envio nunca espera`);
    assert.ok(r.buscasFinais > r.buscasDepoisDa1a, 'a renovação aconteceu em segundo plano');
    ok('4b: metadados vencidos não seguram o envio — renovam em segundo plano');
  } catch (e) {
    fail('4b: cache vencido', e);
  }

  /* 4c) busca travada devolve (com prazo) em vez de pendurar */
  try {
    const r = noFilho(
      PRELUDIO.concat([
        'const socket={groupMetadata:async()=>new Promise(()=>{})};',
        'md.attach(socket);',
        '(async()=>{const t0=Date.now();',
        '  const a=await md.cachedGroupMetadata("333@g.us");',
        '  const t1=Date.now();',
        '  const g=await md.garantir("444@g.us",400);',
        '  const t2=Date.now();',
        '  console.log("##R##"+JSON.stringify({temA:!!a,msA:t1-t0,temG:!!g,msG:t2-t1,travadas:md.stats().travadas,',
        '    motivo:md.stats().ultimoErro&&md.stats().ultimoErro.motivo}));})();',
      ]),
      { GROUP_META_TIMEOUT_MS: '300' }
    );
    assert.strictEqual(r.temA, false, 'busca travada → devolve vazio');
    assert.ok(r.msA < 1500, `dentro do prazo (${r.msA}ms), não pendura`);
    assert.strictEqual(r.temG, false, 'garantir() também respeita o prazo');
    assert.ok(r.msG < 1500, `sem pendurar (${r.msG}ms)`);
    assert.ok(r.travadas >= 1, 'e o travamento fica contado para o diagnóstico');
    ok(`4c: consulta travada devolve vazio no prazo (${r.msA}ms) e fica registrada no diagnóstico`);
  } catch (e) {
    fail('4c: busca travada', e);
  }

  /* 4d) quando o BOT muda o grupo, o cache é invalidado (lista não fica velha) */
  try {
    const r = noFilho(
      PRELUDIO.concat([
        'let buscas=0,participantes=2;',
        'const socket={',
        '  groupMetadata:async(jid)=>{buscas++;await new Promise(r=>setTimeout(r,40));',
        '    return {id:String(jid),participants:new Array(participantes).fill(0).map((_,i)=>({id:i+"@s.whatsapp.net"}))};},',
        '  groupParticipantsUpdate:async()=>({status:"200"})};',
        'md.attach(socket);',
        '(async()=>{const a=await md.cachedGroupMetadata("555@g.us");',
        '  const antes=buscas;',
        '  participantes=3; // o bot acabou de adicionar alguém',
        '  await socket.groupParticipantsUpdate("555@g.us",["novo@s.whatsapp.net"],"add");',
        '  await new Promise(r=>setTimeout(r,250)); // renovação em segundo plano',
        '  const b=await md.cachedGroupMetadata("555@g.us");',
        '  console.log("##R##"+JSON.stringify({antes,temA:!!a,temB:!!b,buscas,participantesB:(b||{}).participants&&b.participants.length}));})();',
      ])
    );
    assert.strictEqual(r.temA, true, 'começou com 2 participantes em cache');
    assert.ok(r.buscas > r.antes, 'mudar o grupo invalidou o cache (buscou de novo)');
    assert.strictEqual(r.participantesB, 3, 'e a lista nova (3) é a usada no envio seguinte');
    ok('4d: o bot mudando o grupo invalida o cache — o envio não usa lista velha');
  } catch (e) {
    fail('4d: invalidação ao mudar o grupo', e);
  }

  fs.rmSync(path.join(RAIZ, 'tmp', 'sendhang-state'), { recursive: true, force: true });

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ erro fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
