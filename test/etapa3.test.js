'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..');
const TEST_DB = path.join(RAIZ, 'tmp', 'etapa3-test.db');

async function testEtapa3() {
  console.log('=== TESTES DA ETAPA 3 (Busca, Favoritos, Ajuda & Sugestões) ===');

  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DATABASE_FILE = TEST_DB;

  const db = require('../database/database');
  db.open();

  const loader = require('../commands/loader');
  loader.loadCommands(true);

  // 1. Busca funcional e sinônimos
  const buscarCmd = require('../commands/general/buscar')[0];
  let replyBuscar = '';
  const mockCtxBuscar = {
    args: ['baixar', 'musica'],
    prefix: '!',
    reply: async (msg) => { replyBuscar = msg; },
  };

  await buscarCmd.execute(mockCtxBuscar);
  assert.ok(replyBuscar.includes('RESULTADOS DA BUSCA'), 'cabeçalho de busca presente');
  assert.ok(replyBuscar.includes('play'), 'comando play encontrado para baixar musica');
  console.log('✅ 1: Busca leve por sinônimos funcionais (baixar musica -> play/ytmp3)');

  // 2. Favoritos: fluxo completo
  const favListCmd = require('../commands/general/favoritos')[0];
  const favActionCmd = require('../commands/general/favoritos')[1];
  const userX = '5511988880001@s.whatsapp.net';

  let replyFav = '';
  const mockCtxFav = {
    sender: userX,
    prefix: '!',
    args: ['adicionar', 'play'],
    reply: async (msg) => { replyFav = msg; },
  };

  await favActionCmd.execute(mockCtxFav);
  assert.ok(replyFav.includes('adicionado aos seus favoritos'), 'confirmação de adição aos favoritos');

  // Listar favoritos
  let listReply = '';
  await favListCmd.execute({
    sender: userX,
    prefix: '!',
    reply: async (msg) => { listReply = msg; },
  });
  assert.ok(listReply.includes('MEUS COMANDOS FAVORITOS'), 'cabeçalho de favoritos');
  assert.ok(listReply.includes('play'), 'comando play na lista de favoritos');

  // Remover
  let rmReply = '';
  await favActionCmd.execute({
    sender: userX,
    prefix: '!',
    args: ['remover', 'play'],
    reply: async (msg) => { rmReply = msg; },
  });
  assert.ok(rmReply.includes('removido dos seus favoritos'), 'confirmação de remoção');
  console.log('✅ 2: Comandos !favoritos e !favorito (adicionar/remover) funcionais');

  // 3. Ajuda detalhada (!ajuda <comando>)
  const helpCmd = require('../commands/general/help')[0];
  let helpReply = '';
  await helpCmd.execute({
    args: ['play'],
    prefix: '.',
    reply: async (msg) => { helpReply = msg; },
    socket: {},
    remoteJid: '12345@s.whatsapp.net',
  });
  assert.ok(helpReply.includes('Finalidade:'), 'finalidade na ajuda');
  assert.ok(helpReply.includes('Sintaxe/Uso:'), 'sintaxe na ajuda');
  assert.ok(helpReply.includes('Permissão:'), 'permissão descrita');
  assert.ok(helpReply.includes('.play'), 'uso do prefixo dinâmico no exemplo');
  console.log('✅ 3: Comando de ajuda com metadados estruturados e prefixo dinâmico');

  // 4. Sugestão difusa vs permissão
  const fuzzy = require('../utils/fuzzySearch');
  const { registry } = require('../engine/plugins');
  const similar = fuzzy.findSimilarCommands('menoadm', registry.all(), 3);
  assert.ok(similar.length > 0, 'encontrou sugestões');
  assert.ok(similar.some((s) => s.cmd.name === 'menuadm' || s.trigger === 'menuadm'), 'sugeriu menuadm para menoadm');
  console.log('✅ 4: Sugestão difusa de erro de digitação sem auto-execução');

  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(TEST_DB + s)) fs.unlinkSync(TEST_DB + s);
  }
  console.log('=== ETAPA 3 VALIDADA COM SUCESSO! 🎉 ===\n');
}

testEtapa3().catch((err) => {
  console.error('Falha no teste da Etapa 3:', err);
  process.exit(1);
});
