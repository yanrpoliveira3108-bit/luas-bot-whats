'use strict';

const { categoryMenu } = require('../utils/menu');

module.exports = (ctx) =>
  categoryMenu(ctx, { category: 'members', title: '👥 Membros', description: 'Perfil, rank, XP e interações.' });
