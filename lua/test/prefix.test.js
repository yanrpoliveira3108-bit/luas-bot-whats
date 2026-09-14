/**
 * test/prefix.test.js — regressão do prefixo de comando.
 *
 * Bug real (Termux): a variável de ambiente PREFIX já existe no Termux e
 * aponta para /data/data/com.termux/files/usr. Como o dotenv não sobrescreve
 * variáveis existentes, o bot adotava esse caminho como prefixo e NENHUM
 * comando respondia.
 */
'use strict';

const assert = require('assert');

function clearCache() {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
}

async function main() {
  // 1) PREFIX do Termux (caminho) NUNCA pode virar o prefixo do bot
  clearCache();
  process.env.PREFIX = '/data/data/com.termux/files/usr';
  delete process.env.BOT_PREFIX;
  let CONFIG = require('../config');
  assert.strictEqual(
    CONFIG.bot.prefix,
    '!',
    'PREFIX do Termux (caminho) deve cair para "!"'
  );
  console.log('✅ 1/3: PREFIX do Termux (caminho) → prefixo "!"');

  // 2) BOT_PREFIX explícito vence (mesmo com PREFIX do Termux presente)
  clearCache();
  process.env.PREFIX = '/data/data/com.termux/files/usr';
  process.env.BOT_PREFIX = '$';
  CONFIG = require('../config');
  assert.strictEqual(CONFIG.bot.prefix, '$', 'BOT_PREFIX deve vencer');
  console.log('✅ 2/3: BOT_PREFIX explícito ($) vence');

  // 3) legado PREFIX=! (sem caminho) continua funcionando
  clearCache();
  process.env.PREFIX = '!';
  delete process.env.BOT_PREFIX;
  CONFIG = require('../config');
  assert.strictEqual(CONFIG.bot.prefix, '!', 'PREFIX legado "!" deve funcionar');
  console.log('✅ 3/3: PREFIX legado "!" funciona');

  // 4) effectivePrefix rejeita valor corrompido/em formato de caminho no banco
  clearCache();
  delete process.env.PREFIX;
  delete process.env.BOT_PREFIX;
  process.env.DATABASE_FILE = '/tmp/lua-prefix-test.db';
  try { require('fs').rmSync('/tmp/lua-prefix-test.db', { force: true }); } catch (_) {}
  CONFIG = require('../config');
  const db = require('../database/database');
  db.open();
  const settings = require('../database/settings');
  // banco vazio → prefixo padrão do CONFIG
  assert.strictEqual(settings.effectivePrefix(), CONFIG.bot.prefix, 'sem valor no banco usa CONFIG');
  // valor corrompido no banco (caminho) → ignora e usa CONFIG
  settings.set('prefix', '/data/data/com.termux/files/usr');
  assert.strictEqual(settings.effectivePrefix(), CONFIG.bot.prefix, 'valor em formato de caminho no banco deve ser ignorado');
  db.close();
  console.log('✅ 4/4: effectivePrefix ignora prefixo corrompido (caminho) no banco');

  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
