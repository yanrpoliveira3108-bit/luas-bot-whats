'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..');
const TEST_DB = path.join(RAIZ, 'tmp', 'perfil-tabs-test.db');

async function testPerfilTabs() {
  console.log('=== TESTES DO PERFIL TABULADO EM HTML & ATIVIDADES ===');

  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DATABASE_FILE = TEST_DB;

  const db = require('../database/database');
  db.open();

  const profileStats = require('../database/profileStats');
  const user1 = '5511999991111@s.whatsapp.net';
  const group1 = '12036300000001@g.us';

  // 1. Teste de detecção e estimativa de dispositivo
  assert.strictEqual(profileStats.estimatePlatform('3A123456789012345678'), 'iOS', 'Detecção de iOS');
  assert.strictEqual(profileStats.estimatePlatform('3EB01234567890123456789012345678'), 'Android', 'Detecção de Android');
  assert.strictEqual(profileStats.estimatePlatform('3E12345678901234567890'), 'Web', 'Detecção de Web');
  assert.strictEqual(profileStats.estimatePlatform('3F1234567890123456'), 'Desktop', 'Detecção de Desktop');
  console.log('✅ 1: Estimativa de plataforma baseada em padrão de ID validada');

  // 2. Registro de Atividades por Escopo Estrito (Privacidade)
  profileStats.recordMessage(user1, group1, 'Android');
  profileStats.recordCommand(user1, group1, 'perfil', 'Android');
  profileStats.recordCommand(user1, group1, 'perfil', 'Android');
  profileStats.recordCommand(user1, group1, 'loja', 'Android');

  profileStats.recordMessage(user1, 'private', 'iOS');
  profileStats.recordCommand(user1, 'private', 'saldo', 'iOS');

  const groupStats = profileStats.getActivityStats(user1, group1);
  const privStats = profileStats.getActivityStats(user1, 'private');

  assert.strictEqual(groupStats.messages, 1, 'mensagens no grupo');
  assert.strictEqual(groupStats.commands, 3, 'comandos no grupo');
  assert.strictEqual(groupStats.commandCounts['perfil'], 2, 'contagem de perfil no grupo');
  assert.strictEqual(groupStats.commandCounts['loja'], 1, 'contagem de loja no grupo');
  assert.strictEqual(groupStats.commandCounts['saldo'], undefined, 'saldo NÃO deve aparecer no grupo');

  assert.strictEqual(privStats.commands, 1, 'comandos no privado');
  assert.strictEqual(privStats.commandCounts['saldo'], 1, 'saldo aparece no privado');
  assert.strictEqual(privStats.commandCounts['perfil'], undefined, 'perfil do grupo NÃO vaza no privado');
  console.log('✅ 2: Separação estrita de atividades e privacidade entre grupo e privado');

  // 3. Registro e Estatísticas de Figurinhas
  profileStats.recordStickerOperation(user1, 'from_image');
  profileStats.recordStickerOperation(user1, 'from_video_gif', { animated: true });
  profileStats.recordStickerOperation(user1, 'steal');
  profileStats.recordStickerOperation(user1, 'text');
  profileStats.recordStickerOperation(user1, 'to_media');

  const fig = profileStats.getStickerStats(user1);
  assert.strictEqual(fig.created, 3, 'total criadas (imagem + video + texto)');
  assert.strictEqual(fig.stolen, 1, 'roubadas via !take');
  assert.strictEqual(fig.fromImage, 1, 'a partir de imagem');
  assert.strictEqual(fig.fromVideoGif, 1, 'a partir de vídeo/gif');
  assert.strictEqual(fig.animated, 1, 'animadas');
  assert.strictEqual(fig.textStickers, 1, 'de texto');
  assert.strictEqual(fig.conversionsToMedia, 1, 'conversões para mídia');
  console.log('✅ 3: Estatísticas detalhadas de figurinhas registradas com sucesso');

  // 4. Renderização HTML do Perfil Tabulado
  const perfilHtmlView = require('../utils/perfilHtmlView');
  const htmlOutput = perfilHtmlView.renderPerfilHtml({
    userId: user1,
    name: 'Guerreiro Lua',
    level: 7,
    xp: 350,
    nextXp: 700,
    reputation: 25,
    firstSeen: new Date().toISOString(),
    estimatedPlatform: 'Android',
    contextName: 'Grupo Alpha',
    isGroup: true,
    isRequesterSelf: true,
    isBotOwner: false,
    prefix: '!',
    initialTab: 'rpg',
    activity: {
      messages: groupStats.messages,
      commands: groupStats.commands,
      commandCounts: groupStats.commandCounts,
      topCommands: profileStats.getTopCommands(user1, group1),
      lastInteraction: new Date().toISOString(),
    },
    hasCharacter: true,
    rpg: {
      profession: 'Alquimista',
      level: 4,
      energy: 160,
      inventoryTotal: 5,
      topItems: [{ emoji: '🧪', name: 'Poção de Cura', quantity: 3 }],
      completedExpeditions: 3,
      coopDamage: 1200,
      activeMarketListings: 1,
      completedMissions: 2,
    },
    economy: { wallet: 5000, bank: 25000 },
    stickers: fig,
    collections: [
      { id: 'minerador', name: 'Mestre da Mineração', emoji: '⛏️', foundCount: 4, total: 6, percent: 66, isComplete: false }
    ],
    showcase: [{ emoji: '💎', name: 'Diamante Nobre' }],
    achievementsCount: 5,
  });

  assert.ok(htmlOutput.includes('Guerreiro Lua'), 'nome do usuário renderizado');
  assert.ok(htmlOutput.includes('Alquimista'), 'profissão do RPG renderizada');
  assert.ok(htmlOutput.includes('data-tab="geral"'), 'aba Geral presente');
  assert.ok(htmlOutput.includes('data-tab="atividade"'), 'aba Atividade presente');
  assert.ok(htmlOutput.includes('data-tab="rpg"'), 'aba RPG presente');
  assert.ok(htmlOutput.includes('data-tab="figurinhas"'), 'aba Figurinhas presente');
  assert.ok(htmlOutput.includes('data-tab="colecoes"'), 'aba Coleções presente');
  assert.ok(htmlOutput.includes('tab-pane active'), 'aba ativa selecionada');
  assert.ok(htmlOutput.includes('Diamante Nobre'), 'vitrine exibida');
  assert.ok(htmlOutput.includes('Mestre da Mineração'), 'coleções exibidas');
  assert.ok(htmlOutput.includes('Figurinhas Criadas'), 'oficina de figurinhas presente');
  console.log('✅ 4: Card HTML tabulado gerado com todas as seções e navegação local');

  // 5. Execução do comando perfil com fallback e argumentos de aba direta
  const perfilCmdModule = require('../commands/members/perfil');
  const perfilCmd = perfilCmdModule[0];
  const users = require('../database/users');
  users.upsert(user1, 'Guerreiro Lua');

  let textReply = '';
  const mockCtx = {
    sender: user1,
    remoteJid: group1,
    isGroup: true,
    args: ['figurinhas'],
    prefix: '!',
    reply: async (msg) => { textReply = msg; },
    socket: {},
  };

  await perfilCmd.execute(mockCtx);
  assert.ok(textReply.includes('PERFIL • Guerreiro Lua'), 'título do fallback em texto');
  assert.ok(textReply.includes('Figurinhas'), 'seção de figurinhas no texto');
  assert.ok(textReply.includes('RPG & Economia'), 'seção de RPG no texto');
  assert.ok(textReply.includes('Coleções & Conquistas'), 'seção de coleções no texto');
  console.log('✅ 5: Execução do comando com fallback de texto e seleção de aba direta bem-sucedida');

  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(TEST_DB + s)) fs.unlinkSync(TEST_DB + s);
  }
  console.log('=== TODOS OS TESTES DO PERFIL TABULADO PASSARAM! 🎉 ===\n');
}

testPerfilTabs().catch((err) => {
  console.error('Falha nos testes de perfil:', err);
  process.exit(1);
});
