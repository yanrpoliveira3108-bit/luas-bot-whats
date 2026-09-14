'use strict';

const { sendMenu } = require('../utils/menu');
const commandHandler = require('../handlers/commandHandler');

module.exports = async (ctx) => {
  const types = [
    { id: 'xp', title: '🏆 XP', desc: 'Top por XP', args: ['xp'] },
    { id: 'mensagens', title: '💬 Mensagens', desc: 'Top por mensagens', args: ['mensagens'] },
    { id: 'rpg', title: '⚔️ RPG', desc: 'Top do RPG', args: ['rpg'] },
    { id: 'zueira', title: '😂 Zueira', desc: 'Top de interações', args: ['zueira'] },
    { id: 'quiz', title: '🧠 Quiz', desc: 'Top do quiz', args: ['quiz'] },
    { id: 'reputacao', title: '⭐ Reputação', desc: 'Top por reputação', args: ['reputacao'] },
  ];

  await sendMenu(ctx, {
    id: 'rankings',
    title: '📊 Rankings',
    text: 'Escolha o ranking desejado.',
    rows: types.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.desc,
      run: (c) => commandHandler.runByName(c, 'ranking', t.args),
    })),
  });
};
