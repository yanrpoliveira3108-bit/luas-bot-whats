/**
 * commands/life/work.js — menu de profissões por lista (!trabalho).
 */

'use strict';

const nav = require('../../utils/nav');
const commandHandler = require('../../handlers/commandHandler');
const { JOBS } = require('../../plugins/life/config');

// tela de escolha de profissão (lista → mesmo handler do !emprego)
nav.registerScreen('lua_jobs', () => ({
  id: 'lua_jobs',
  title: '💼 TRABALHO',
  body: 'Escolha uma profissão para começar a ganhar LuaCoins.',
  image: 'main',
  buttons: JOBS.map((j) => ({
    id: `job_${j.id}`,
    text: `${j.emoji} ${j.name}`,
    run: (c) => commandHandler.runByName(c, 'emprego', [j.id]),
  })),
}));

module.exports = [
  {
    name: 'trabalho',
    commands: ['trabalho'],
    category: 'life',
    description: 'Abre o menu de profissões.',
    usage: '!trabalho',
    cooldown: 2000,
    execute: async (ctx) => {
      await nav.openScreen(ctx, 'lua_jobs');
    },
  },
];
