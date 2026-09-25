#!/usr/bin/env node
/**
 * test/vendorfix.test.js — CAUSA RAIZ do "o bot faz o comando e não manda nada".
 *
 * Cadeia provada pelo aparelho (25/09/2026) — o primeiro frame do stack foi
 * `at NodeCache.formatKey (…/@cacheable/node-cache/dist/index.cjs:509:16)`:
 *
 *   1. grupo em modo LID: o participante é montado como `id: attrs.phone_number`
 *      (vendor/…/Socket/groups.js:346). Sem esse atributo → `id` = undefined;
 *   2. o envio faz `jidDecode(jid)` e `decoded?.user` (messages-send.js:243).
 *      `jidDecode(undefined)` devolve undefined (não tem '@') → user undefined;
 *   3. `userDevicesCache.get(undefined)` → `key.toString()` → TypeError.
 *
 * Resultado: TODO envio naquele grupo falhava (65 falhas) — inclusive o reenvio
 * sem citação (o erro não tem relação com a citação). O bot "digitava" e nada
 * aparecia no chat.
 *
 * Este teste trava as três correções: o patch na biblioteca, o cache blindado e
 * a ligação deles no socket.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

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

async function main() {
  /* 1) o elo quebrado: jid sem '@' não decodifica ------------------------- */
  try {
    const { jidDecode } = require('../vendor/boruto-vk7-baileys/lib/WABinary');
    assert.strictEqual(jidDecode(undefined), undefined, 'jidDecode(undefined) → undefined (é o elo que quebra)');
    assert.strictEqual(jidDecode(''), undefined, 'jid vazio também não decodifica');
    assert.ok(jidDecode('5511999999999@s.whatsapp.net'), 'um jid normal decodifica');
    ok('1: em modo LID o participante sem id gera `jidDecode(undefined) → undefined` (o elo quebrado)');
  } catch (e) {
    fail('1: jidDecode', e);
  }

  /* 2) o estouro: cache da biblioteca com chave inválida ------------------ */
  try {
    const mod = require('@cacheable/node-cache');
    const NodeCache = mod && mod.default ? mod.default : mod;
    const cacheCru = new NodeCache({ stdTTL: 60, useClones: false, deleteOnExpire: true });
    let estourou = null;
    try {
      cacheCru.get(undefined);
    } catch (err) {
      estourou = err;
    }
    assert.ok(estourou, 'o cache ORIGINAL estoura (é o erro do aparelho)');
    assert.ok(/toString/.test(estourou.message), `a mensagem é a do aparelho (${estourou.message})`);
    let estourouSet = null;
    try {
      cacheCru.set(undefined, { a: 1 });
    } catch (err) {
      estourouSet = err;
    }
    assert.ok(estourouSet, 'e `set` com chave inválida também estoura');
    ok('2: o cache original da biblioteca estoura com chave inválida (reproduz o TypeError do aparelho)');
  } catch (e) {
    fail('2: cache original', e);
  }

  /* 3) o cache blindado não estoura e continua funcionando ----------------
   *    (roda em processo filho: o módulo registra aviso no log)             */
  try {
    const { execFileSync } = require('child_process');
    const saida = execFileSync(
      process.execPath,
      ['-e', `
        const s=require('./utils/safeNodeCache');
        const c=s.criar();
        const r={
          getUndefined:c.get(undefined),
          setUndefined:c.set(undefined,{a:1}),
          hasUndefined:c.has(undefined),
          delUndefined:c.del(undefined),
          takeUndefined:c.take(undefined),
          stats:s.stats()
        };
        c.set('chave',{v:42});
        r.getValida=c.get('chave').v;
        c.set(123,{v:7});
        r.getNumero=c.get(123).v;
        console.log('##R##'+JSON.stringify(r));
        process.exit(0);
      `],
      { cwd: RAIZ, encoding: 'utf8' }
    );
    const linha = String(saida).split('\n').filter((l) => l.trim().startsWith('##R##')).pop();
    const r = JSON.parse(linha.trim().slice(5));
    assert.strictEqual(r.getUndefined, undefined, 'get(undefined) → miss (sem erro)');
    assert.strictEqual(r.setUndefined, false, 'set(undefined) é ignorado');
    assert.strictEqual(r.hasUndefined, false, 'has(undefined) → false');
    assert.strictEqual(r.delUndefined, 0, 'del(undefined) → 0');
    assert.strictEqual(r.takeUndefined, undefined, 'take(undefined) → undefined');
    assert.strictEqual(r.getValida, 42, 'chave string continua funcionando');
    assert.strictEqual(r.getNumero, 7, 'chave numérica continua funcionando');
    assert.ok(r.stats.invalidas >= 5, 'e as chaves inválidas entram no diagnóstico');
    ok('3: o cache blindado nunca derruba (chave inválida vira "miss") e segue funcionando normalmente');
  } catch (e) {
    fail('3: cache blindado', e);
  }

  /* 4) o patch na biblioteca: descarta destinatário sem jid decodificável -- */
  try {
    const arquivo = path.join(RAIZ, 'vendor', 'boruto-vk7-baileys', 'lib', 'Socket', 'messages-send.js');
    const fonte = fs.readFileSync(arquivo, 'utf8');
    const marcador = fonte.indexOf('[LUA-BOT-PATCH]');
    const guarda = fonte.indexOf('if (!user) {', marcador);
    const uso = fonte.indexOf('userDevicesCache.get(user)', marcador);
    assert.ok(marcador > -1, 'o patch está marcado no código da biblioteca');
    assert.ok(guarda > -1, 'existe a guarda `if (!user)`');
    assert.ok(uso > guarda, 'a guarda vem ANTES do uso do cache (é o que evita o TypeError)');
    // o `jidDecode` está logo acima do patch (é o valor que ela testa)
    assert.ok(/jidDecode/.test(fonte.slice(Math.max(0, marcador - 600), guarda)), 'e ela olha o jid que não decodificou');
    ok('4: patch na biblioteca ignora destinatário sem jid decodificável (antes do uso do cache)');
  } catch (e) {
    fail('4: patch na biblioteca', e);
  }

  /* 5) o mesmo caminho, com e sem a guarda (comportamento) ----------------- */
  try {
    const mod = require('@cacheable/node-cache');
    const NodeCache = mod && mod.default ? mod.default : mod;
    const { jidDecode } = require('../vendor/boruto-vk7-baileys/lib/WABinary');
    const cache = new NodeCache({ stdTTL: 60, useClones: false, deleteOnExpire: true });
    const jids = [undefined, '5511999999999@s.whatsapp.net'];

    // SEM a guarda (código antigo): o 1º destinatário inválido derruba tudo
    let semGuarda = null;
    try {
      const entregues = [];
      for (const jid of jids) {
        const user = jidDecode(jid)?.user;
        const devices = cache.get(user); // ← estoura aqui (era o defeito)
        entregues.push({ user, devices });
      }
    } catch (err) {
      semGuarda = err;
    }
    assert.ok(semGuarda && /toString/.test(semGuarda.message), 'sem a guarda, o envio inteiro morre');

    // COM a guarda (código novo): o inválido é ignorado e o resto é atendido
    const validos = [];
    const ignorados = [];
    for (const jid of jids) {
      const user = jidDecode(jid)?.user;
      if (!user) {
        ignorados.push(String(jid));
        continue;
      }
      validos.push({ user, devices: cache.get(user) });
    }
    assert.strictEqual(ignorados.length, 1, 'o destinatário inválido é ignorado');
    assert.strictEqual(validos.length, 1, 'e o destinatário válido SEGUE sendo atendido (mensagem não se perde)');
    assert.strictEqual(validos[0].user, '5511999999999', 'com o usuário certo');
    ok('5: com a guarda o envio não morre — o inválido é ignorado e o resto recebe a mensagem');
  } catch (e) {
    fail('5: comportamento do caminho', e);
  }

  /* 6) e o cache blindado está ligado ao socket ---------------------------- */
  try {
    const fonte = fs.readFileSync(path.join(RAIZ, 'connection', 'connect.js'), 'utf8');
    assert.ok(/userDevicesCache:\s*safeNodeCache\.criar\(\)/.test(fonte), '`userDevicesCache` usa o cache blindado');
    assert.ok(
      /makeCacheableSignalKeyStore\([\s\S]{0,140}safeNodeCache\.criar\(/.test(fonte),
      'o store de chaves Signal também usa'
    );
    assert.ok(/cachedGroupMetadata:/.test(fonte), 'e o cache de metadados de grupo continua ligado');
    ok('6: os dois caches que a biblioteca usa no envio são os blindados (não os originais)');
  } catch (e) {
    fail('6: ligação no socket', e);
  }

  /* 7) mesmo defeito, outra consequência: remetente LID sem telefone ---------
   *    Em grupo LID a lista de participantes pode vir SEM o telefone. Sem ele,
   *    o bot não reconhece o DONO ("Apenas o dono do bot" para comandos de dono,
   *    como aconteceu com o `!freio` no aparelho). O fallback usa o mapa
   *    LID→PN da própria biblioteca.                                            */
  try {
    const { execFileSync } = require('child_process');
    const saida = execFileSync(
      process.execPath,
      ['-e', `
        process.env.OWNER_NUMBER='5511999999999';
        const path=require('path');
        const raiz=${JSON.stringify(RAIZ)};
        const database=require(path.join(raiz,'database/database'));database.open();
        require(path.join(raiz,'commands/loader')).loadCommands(true);
        const ch=require(path.join(raiz,'handlers/commandHandler'));
        const LID='99887766554433@lid';
        const socket={
          user:{id:'5511999999998@s.whatsapp.net'},
          sendPresenceUpdate:async()=>{},
          // grupo de comunidade: metadados SEM telefone nos participantes
          groupMetadata:async()=>({id:'120363046296961148@g.us',isCommunity:true,
            participants:[{id:undefined,lid:LID,admin:'admin'}]}),
          // mapa LID↔PN da biblioteca (é o que o fallback usa)
          signalRepository:{lidMapping:{getPNForLID:async(l)=>String(l).startsWith('99887766554433')?'5511999999999:0@s.whatsapp.net':null}},
          sendMessage:async()=>({key:{id:'OK'}})};
        const msg={key:{remoteJid:'120363046296961148@g.us',fromMe:false,id:'L1',participant:LID},
          message:{conversation:'!menu'},pushName:'Dono'};
        (async()=>{const ctx=await ch.buildContext(socket,msg);
          console.log('##R##'+JSON.stringify({sender:ctx.sender,isOwner:ctx.isOwner}));
          process.exit(0);})();
      `],
      { cwd: RAIZ, encoding: 'utf8' }
    );
    const linha = String(saida).split('\n').filter((l) => l.trim().startsWith('##R##')).pop();
    const r = JSON.parse(linha.trim().slice(5));
    assert.strictEqual(r.sender, '5511999999999@s.whatsapp.net', 'o telefone do remetente foi recuperado');
    assert.strictEqual(r.isOwner, true, 'e o DONO é reconhecido (comandos de dono param de ser negados)');
    ok('7: remetente LID sem telefone nos participantes → resolve pelo mapa e o dono é reconhecido');
  } catch (e) {
    fail('7: LID → telefone do remetente', e);
  }

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ erro fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
