'use strict';

const { runInteraction } = require('../../engine/interactionEngine');
const R = require('./_responses');

function make(name, desc, bank, selfBank, karma = 1) {
  return {
    name,
    commands: [name],
    category: 'fun',
    description: desc,
    usage: `!${name} [@usuario]`,
    cooldown: 2000,
    execute: async (ctx) => {
      await runInteraction(ctx, {
        action: name,
        responses: bank,
        selfResponses: selfBank,
        karma,
      });
    },
  };
}

module.exports = [
  make('beijo', 'Manda um beijo para alguém.', R.beijo, R.beijoSelf),
  make('abraco', 'Dá um abraço em alguém.', R.abraco, R.abracoSelf),
  make('tapinha', 'Dá um tapinha amigável.', R.tapinha, R.tapinhaSelf),
  make('cumprimento', 'Cumprimenta alguém.', R.cumprimento, R.cumprimentoSelf),
  make('cafune', 'Faz um cafuné em alguém.', R.cafune, R.cafuneSelf),
];
