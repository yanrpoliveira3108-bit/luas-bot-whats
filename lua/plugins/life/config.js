/**
 * plugins/life/config.js — dados e balanceamento do Lua Life.
 *
 * Tudo configurável aqui (profissões evolutivas, minérios, peixes, casas,
 * terrenos, veículos, empresas, funcionários, missões, conquistas, eventos,
 * clima, títulos). Nenhum valor monetário fica espalhado nos comandos.
 *
 * Economia controlada: fontes (trabalho/coleta/venda), sumidouros (loja,
 * upgrades, funcionários, loteria) e limites (min/max de preço, cooldowns).
 */

'use strict';

const M = 60 * 1000;
const H = 3600 * 1000;

function randomBetween([min, max]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/* ------------------------------ moeda -------------------------------- */
// A moeda exibida vem de CONFIG.life.currency (🪙 LC por padrão).

/* --------------------------- profissões ------------------------------ */
// reward = faixa de salário base; cooldownMs = intervalo entre trabalhos;
// energy = custo de energia; xp = XP de vida; requires = ferramenta (qualquer
// nível) ou levelReq = nível de vida mínimo; tiers = evolução de carreira.
const JOBS = [
  { id: 'faxineiro', name: 'Faxineiro', emoji: '🧹', reward: [50, 90], cooldownMs: 20 * M, energy: 10, xp: 10, requires: null, levelReq: 1, desc: 'Limpeza pesada, dinheiro honesto.', tiers: ['Faxineiro', 'Encarregado', 'Supervisor', 'Gestor de limpeza'] },
  { id: 'entregador', name: 'Entregador', emoji: '📦', reward: [60, 120], cooldownMs: 15 * M, energy: 12, xp: 12, requires: null, levelReq: 1, desc: 'Entrega encomendas pela cidade.', tiers: ['Entregador', 'Motoboy', 'Logístico', 'Frota própria'] },
  { id: 'atendente', name: 'Atendente', emoji: '🍔', reward: [70, 130], cooldownMs: 20 * M, energy: 12, xp: 12, requires: null, levelReq: 1, desc: 'Atende clientes e recebe gorjetas.', tiers: ['Atendente', 'Caixa', 'Gerente', 'Sócio'] },
  { id: 'motorista', name: 'Motorista', emoji: '🚕', reward: [90, 160], cooldownMs: 25 * M, energy: 15, xp: 15, requires: null, levelReq: 3, desc: 'Dirige pela cidade.', tiers: ['Motorista', 'Taxista', 'Motorista de app', 'Frotista'] },
  { id: 'programador', name: 'Programador', emoji: '💻', reward: [150, 300], cooldownMs: 60 * M, energy: 20, xp: 30, requires: null, levelReq: 5, desc: 'Escreve código (e toma café).', tiers: ['Estagiário', 'Júnior', 'Pleno', 'Sênior', 'Especialista'] },
  { id: 'mecanico', name: 'Mecânico', emoji: '🔧', reward: [110, 200], cooldownMs: 40 * M, energy: 18, xp: 20, requires: null, levelReq: 3, desc: 'Conserta motores e máquinas.', tiers: ['Aprendiz', 'Mecânico', 'Especialista', 'Mestre'] },
  { id: 'agricultor', name: 'Agricultor', emoji: '👨‍🌾', reward: [80, 150], cooldownMs: 30 * M, energy: 15, xp: 15, requires: null, levelReq: 1, desc: 'Colhe o sustento da terra.', tiers: ['Iniciante', 'Produtor', 'Fazendeiro', 'Grande produtor', 'Agroempresário'] },
  { id: 'minerador', name: 'Minerador', emoji: '⛏️', reward: [120, 220], cooldownMs: 60 * M, energy: 25, xp: 25, requires: ['picareta_simples', 'picareta_reforcada', 'picareta_pro'], levelReq: 2, desc: 'Extrai minérios valiosos.', tiers: ['Aprendiz', 'Minerador', 'Especialista', 'Mestre'] },
  { id: 'pescador', name: 'Pescador', emoji: '🎣', reward: [100, 180], cooldownMs: 45 * M, energy: 20, xp: 20, requires: ['vara_simples', 'vara_reforcada', 'vara_pro'], levelReq: 2, desc: 'Vive da pescaria.', tiers: ['Aprendiz', 'Pescador', 'Especialista', 'Mestre'] },
  { id: 'construtor', name: 'Construtor', emoji: '🏗️', reward: [120, 220], cooldownMs: 50 * M, energy: 22, xp: 22, requires: null, levelReq: 4, desc: 'Constrói e reforma imóveis.', tiers: ['Servente', 'Pedreiro', 'Mestre de obras', 'Engenheiro'] },
  { id: 'cozinheiro', name: 'Cozinheiro', emoji: '🧑‍🍳', reward: [80, 160], cooldownMs: 30 * M, energy: 16, xp: 16, requires: null, levelReq: 1, desc: 'Prepara pratos deliciosos.', tiers: ['Ajudante', 'Cozinheiro', 'Chef', 'Chef executivo'] },
];

function findJob(nameOrId) {
  const k = String(nameOrId || '').toLowerCase();
  return JOBS.find((j) => j.id === k || j.name.toLowerCase() === k) || null;
}

/* --------------------------- títulos de nível ------------------------ */
const TITLES = [
  { level: 1, title: 'Iniciante' },
  { level: 5, title: 'Trabalhador' },
  { level: 10, title: 'Empreendedor' },
  { level: 20, title: 'Produtor' },
  { level: 30, title: 'Empresário' },
  { level: 50, title: 'Magnata' },
];

function titleForLevel(level) {
  let t = TITLES[0].title;
  for (const it of TITLES) if (level >= it.level) t = it.title;
  return t;
}

/* ------------------------------ mineração ---------------------------- */
const PICKAXES = {
  picareta_simples: { name: 'Picareta Simples', emoji: '⛏️', durability: 25, luck: 0, xpMul: 1 },
  picareta_reforcada: { name: 'Picareta Reforçada', emoji: '⛏️', durability: 50, luck: 6, xpMul: 1.1 },
  picareta_pro: { name: 'Picareta Profissional', emoji: '⛏️', durability: 120, luck: 12, xpMul: 1.25 },
};

const ORES = [
  { id: 'pedra', name: 'Pedra', emoji: '🪨', chance: 32, price: [5, 12], xp: 2 },
  { id: 'carvao', name: 'Carvão', emoji: '🪵', chance: 25, price: [12, 20], xp: 3 },
  { id: 'cobre', name: 'Cobre', emoji: '🟠', chance: 18, price: [20, 40], xp: 4 },
  { id: 'prata', name: 'Prata', emoji: '🥈', chance: 12, price: [50, 90], xp: 6 },
  { id: 'ouro', name: 'Ouro', emoji: '🥇', chance: 8, price: [100, 180], xp: 9 },
  { id: 'diamante', name: 'Diamante', emoji: '💎', chance: 4, price: [300, 600], xp: 15 },
  { id: 'esmeralda', name: 'Esmeralda', emoji: '💚', chance: 2, price: [500, 900], xp: 20 },
  { id: 'minerio_raro', name: 'Minério Raro', emoji: '🔮', chance: 1, price: [1000, 2000], xp: 30 },
];

/* ------------------------------- pesca ------------------------------- */
const RODS = {
  vara_simples: { name: 'Vara Simples', emoji: '🎣', durability: 25, luck: 0, xpMul: 1 },
  vara_reforcada: { name: 'Vara Reforçada', emoji: '🎣', durability: 50, luck: 6, xpMul: 1.1 },
  vara_pro: { name: 'Vara Profissional', emoji: '🎣', durability: 120, luck: 12, xpMul: 1.25 },
};

const FISH = [
  { id: 'sardinha', name: 'Sardinha', emoji: '🐟', chance: 35, price: [15, 25], xp: 3 },
  { id: 'tilapia', name: 'Tilápia', emoji: '🐟', chance: 30, price: [25, 45], xp: 4 },
  { id: 'peixe_raro', name: 'Peixe Raro', emoji: '🐠', chance: 18, price: [60, 120], xp: 7 },
  { id: 'peixe_exotico', name: 'Peixe Exótico', emoji: '🐡', chance: 12, price: [120, 250], xp: 12 },
  { id: 'peixe_lendario', name: 'Peixe Lendário', emoji: '👑', chance: 5, price: [400, 900], xp: 25 },
];

/* ------------------------------ imóveis ------------------------------ */
const HOUSES = [
  { id: 'barraco', name: 'Barraco', emoji: '🏚️', price: 5000, comfort: 1, capacity: 2, sellValue: 1500, levelReq: 1 },
  { id: 'casa_simples', name: 'Casa Simples', emoji: '🏠', price: 20000, comfort: 2, capacity: 4, sellValue: 8000, levelReq: 4 },
  { id: 'casa_media', name: 'Casa Média', emoji: '🏡', price: 60000, comfort: 3, capacity: 6, sellValue: 28000, levelReq: 8 },
  { id: 'casa_grande', name: 'Casa Grande', emoji: '🏘️', price: 150000, comfort: 4, capacity: 10, sellValue: 75000, levelReq: 12 },
  { id: 'mansao', name: 'Mansão', emoji: '🏰', price: 500000, comfort: 5, capacity: 20, sellValue: 260000, levelReq: 20 },
];

const LANDS = [
  { id: 'rural', name: 'Rural', emoji: '🌱', price: 3000, size: 1, sellValue: 1200, levelReq: 2 },
  { id: 'residencial', name: 'Residencial', emoji: '🏘️', price: 12000, size: 2, sellValue: 6000, levelReq: 5 },
  { id: 'urbano', name: 'Urbano', emoji: '🏙️', price: 50000, size: 3, sellValue: 26000, levelReq: 10 },
  { id: 'premium', name: 'Premium', emoji: '🏞️', price: 180000, size: 4, sellValue: 95000, levelReq: 16 },
];

const COOPS = {
  galinheiro: { name: 'Galinheiro', emoji: '🐔', levels: [{ price: 800, cap: 5 }, { price: 2500, cap: 15 }, { price: 8000, cap: 40 }] },
  estabulo: { name: 'Estábulo', emoji: '🐄', levels: [{ price: 1500, cap: 3 }, { price: 5000, cap: 8 }, { price: 15000, cap: 20 }] },
};

/* ------------------------------ veículos ----------------------------- */
const VEHICLES = [
  { id: 'bicicleta', name: 'Bicicleta', emoji: '🚲', price: 1500, speedBonus: 0.9, capacity: 2, levelReq: 3, sellValue: 700 },
  { id: 'moto', name: 'Moto', emoji: '🛵', price: 8000, speedBonus: 0.8, capacity: 3, levelReq: 5, sellValue: 4000 },
  { id: 'carro', name: 'Carro', emoji: '🚗', price: 30000, speedBonus: 0.7, capacity: 5, levelReq: 8, sellValue: 15000 },
  { id: 'caminhao', name: 'Caminhão', emoji: '🚚', price: 90000, speedBonus: 0.6, capacity: 15, levelReq: 12, sellValue: 45000 },
  { id: 'trator', name: 'Trator', emoji: '🚜', price: 120000, speedBonus: 0.5, capacity: 10, levelReq: 15, sellValue: 60000 },
  { id: 'barco', name: 'Barco', emoji: '🚤', price: 60000, speedBonus: 0.6, capacity: 4, levelReq: 10, sellValue: 30000 },
];

/* ------------------------------ empresas ----------------------------- */
const BUSINESSES = [
  { id: 'loja', name: 'Loja', emoji: '🏪', price: 50000, levelReq: 15, revenuePerH: 300, costPerH: 50, maxEmployees: 3 },
  { id: 'fazenda_comercial', name: 'Fazenda Comercial', emoji: '🌾', price: 80000, levelReq: 18, revenuePerH: 500, costPerH: 80, maxEmployees: 4 },
  { id: 'pesqueiro', name: 'Pesqueiro', emoji: '🎣', price: 100000, levelReq: 20, revenuePerH: 700, costPerH: 100, maxEmployees: 4 },
  { id: 'mineradora', name: 'Mineradora', emoji: '⛏️', price: 150000, levelReq: 22, revenuePerH: 1000, costPerH: 150, maxEmployees: 5 },
  { id: 'fazenda_gado', name: 'Fazenda de Gado', emoji: '🐄', price: 200000, levelReq: 25, revenuePerH: 1400, costPerH: 200, maxEmployees: 5 },
  { id: 'fabrica', name: 'Fábrica', emoji: '🏭', price: 400000, levelReq: 30, revenuePerH: 2500, costPerH: 350, maxEmployees: 6 },
];

const EMPLOYEES = [
  { id: 'trabalhador', name: 'Trabalhador', emoji: '👷', wagePerH: 20 },
  { id: 'agricultor', name: 'Agricultor', emoji: '👨‍🌾', wagePerH: 30 },
  { id: 'tratador', name: 'Tratador', emoji: '🐄', wagePerH: 30 },
  { id: 'pescador', name: 'Pescador', emoji: '🎣', wagePerH: 35 },
  { id: 'entregador', name: 'Entregador', emoji: '📦', wagePerH: 25 },
];

/* ------------------------------ missões ------------------------------ */
const MISSIONS = [
  { id: 'pescar5', type: 'diaria', desc: 'Pesque 5 peixes', target: 5, metric: 'fish', reward: 300, xp: 40, emoji: '📅' },
  { id: 'vender20', type: 'diaria', desc: 'Venda 20 produtos', target: 20, metric: 'sell', reward: 400, xp: 50, emoji: '📅' },
  { id: 'trabalhar3', type: 'diaria', desc: 'Trabalhe 3 vezes', target: 3, metric: 'work', reward: 250, xp: 30, emoji: '📅' },
  { id: 'minerar10', type: 'semanal', desc: 'Minere 10 vezes', target: 10, metric: 'mine', reward: 700, xp: 90, emoji: '📆' },
  { id: 'plantar10', type: 'semanal', desc: 'Plante 10 culturas', target: 10, metric: 'plant', reward: 800, xp: 100, emoji: '📆' },
  { id: 'primeira_casa', type: 'especial', desc: 'Compre sua primeira casa', target: 1, metric: 'house', reward: 1500, xp: 150, emoji: '🏆' },
  { id: 'rico', type: 'lendaria', desc: 'Acumule 50.000 LC de patrimônio', target: 50000, metric: 'networth', reward: 10000, xp: 500, emoji: '🌟' },
];

/* ----------------------------- conquistas ---------------------------- */
const ACHIEVEMENTS = [
  { id: 'primeiro_salario', name: 'Primeiro Salário', emoji: '🏆', desc: 'Trabalhe pela primeira vez', reward: 100 },
  { id: 'primeira_casa', name: 'Primeira Casa', emoji: '🏠', desc: 'Compre uma casa', reward: 500 },
  { id: 'primeiro_terreno', name: 'Primeiro Terreno', emoji: '🌱', desc: 'Compre um terreno', reward: 300 },
  { id: 'primeiro_animal', name: 'Primeiro Animal', emoji: '🐔', desc: 'Tenha um animal', reward: 200 },
  { id: 'primeiro_milhao', name: 'Primeiro Milhão', emoji: '💰', desc: 'Patrimônio de 1.000.000', reward: 10000 },
  { id: 'fazendeiro', name: 'Fazendeiro', emoji: '🌾', desc: 'Colha 20 plantações', reward: 500 },
  { id: 'minerador', name: 'Minerador', emoji: '⛏️', desc: 'Minere 15 vezes', reward: 500 },
  { id: 'pescador', name: 'Pescador', emoji: '🎣', desc: 'Pesque 15 peixes', reward: 500 },
  { id: 'empresario', name: 'Empresário', emoji: '🏪', desc: 'Abra uma empresa', reward: 1500 },
  { id: 'magnata', name: 'Magnata', emoji: '👑', desc: 'Alcance o nível 50', reward: 5000 },
];

/* ------------------------------ eventos ------------------------------ */
const EVENTS = [
  { id: 'chuva', name: 'Semana de Chuva', emoji: '🌧️', priceMul: 0.9, xpMul: 1.2, fishingMul: 1.3 },
  { id: 'festival_pesca', name: 'Festival da Pesca', emoji: '🎣', priceMul: 1.0, fishingMul: 1.5, xpMul: 1.2 },
  { id: 'colheita', name: 'Colheita Especial', emoji: '🌾', farmingMul: 1.5, priceMul: 0.95 },
  { id: 'mineracao', name: 'Corrida da Mineração', emoji: '⛏️', miningMul: 1.5, xpMul: 1.3 },
  { id: 'descontos', name: 'Semana de Descontos', emoji: '🛍️', shopMul: 0.8 },
  { id: 'mercado_aquecido', name: 'Mercado Aquecido', emoji: '💰', priceMul: 1.25, sellMul: 1.25 },
];

/* ------------------------------- clima ------------------------------- */
const WEATHER = [
  { id: 'ensolarado', name: 'Ensolarado', emoji: '☀️', farmingMul: 1.1 },
  { id: 'chuva', name: 'Chuva', emoji: '🌧️', farmingMul: 1.2, fishingMul: 1.1 },
  { id: 'tempestade', name: 'Tempestade', emoji: '⛈️', farmingMul: 0.8, fishingMul: 0.7 },
  { id: 'neblina', name: 'Neblina', emoji: '🌫️', miningMul: 0.9 },
  { id: 'frio', name: 'Frio', emoji: '❄️', farmingMul: 0.9, fishingMul: 0.9 },
];

module.exports = {
  JOBS,
  findJob,
  TITLES,
  titleForLevel,
  PICKAXES,
  ORES,
  RODS,
  FISH,
  HOUSES,
  LANDS,
  COOPS,
  VEHICLES,
  BUSINESSES,
  EMPLOYEES,
  MISSIONS,
  ACHIEVEMENTS,
  EVENTS,
  WEATHER,
  randomBetween,
};
