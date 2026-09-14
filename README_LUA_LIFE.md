# 🌎 LUA LIFE — Simulador de Vida + Economia

O **Lua Life** é um módulo adicional do Lua (não substitui nada do bot). Cada
jogador tem uma **vida virtual persistente** dentro do WhatsApp: trabalha,
ganha **LuaCoins (🪙 LC)**, usa banco, minera, pesca, planta, cria animais,
compra casas/terrenos/veículos, abre empresas, faz missões, conquistas e
sobe no ranking. Tudo conectado e persistido no SQLite existente.

> Início rápido: `!vida` cria o personagem → `!trabalho` escolhe profissão →
> `!trabalhar` ganha dinheiro → `!loja` / `!comprar` / `!minerar` / `!pescar`…

---

## 1. Comandos

### Personagem e vitais
| Comando | Descrição |
|---|---|
| `!vida` / `!luavida` | Cria o personagem (1ª vez) ou mostra o perfil completo |
| `!atributos` | Energia, conhecimento, eficiência, sorte, reputação, carreira |
| `!descansar` | Recupera energia (+60, cooldown 1h) |
| `!comer` | Consome comida e recupera fome (+40) |

### Trabalho (profissões evolutivas)
| Comando | Descrição |
|---|---|
| `!empregos` / `!trabalhos` | Lista as 11 profissões (salário, requisitos, cooldown) |
| `!emprego <profissão>` | Escolhe a profissão |
| `!trabalho` | Menu de profissões **por botões** |
| `!trabalhar` | Trabalha (salário, XP, energia, cooldown) |
| `!carreira` | Cargo atual e progressão (Estagiário → Júnior → …) |

Cada profissão evolui em cargos (mult de salário +25% por cargo) e sofre efeito
moderado dos atributos (eficiência ↑ salário, conhecimento ↑ XP).

### Economia
| Comando | Descrição |
|---|---|
| `!saldo` | Carteira + banco |
| `!banco` / `!depositar` / `!sacar` | Banco (com histórico em `!extrato`) |
| `!pagar @user <v>` / `!transferir @user <v>` | Transferências |
| `!patrimonio` | Patrimônio total (carteira + banco + propriedades + empresas + animais) |
| `!diario` | Presente diário com **sequência** (streak, bônus progressivo) |
| `!loteria <n 1-10> [valor]` | Loteria (prêmio 7x, aposta máxima limitada) |

### Coleta
| Comando | Descrição |
|---|---|
| `!minerar` | Minera (precisa de picareta; durabilidade; minérios raros) |
| `!pescar [isca]` | Pesca (precisa de vara; isca aumenta a sorte) |
| `!venderpeixes` | Vende todos os peixes do inventário |
| `!vender <item> [qtd]` | Vende itens (preço mostrado antes) |
| `!precos` | Preços de venda do dia (mercado dinâmico) |

### Fazenda e animais
| Comando | Descrição |
|---|---|
| `!fazenda` | Visão geral (plantações + animais) |
| `!plantar` / `!colher` / `!regar` | Agricultura (novas culturas: batata, tomate, melancia, uva) |
| `!compraranimal` | Compra animais (capacidade limitada por galinheiro/estábulo) |
| `!galinheiro` / `!estabulo` | Aumenta a capacidade de animais |
| `!alimentar` / `!venderanimal` | Produção e venda de animais |

### Propriedades e empresas
| Comando | Descrição |
|---|---|
| `!propriedades` | Suas propriedades |
| `!comprarcasa` / `!comprarterreno` | Compra casas/terrenos |
| `!melhorar <casa\|terreno\|veiculo> <spec>` | Upgrade (nível 1→4) |
| `!veiculos [comprar <tipo>]` | Veículos (reduzem o cooldown de trabalho) |
| `!empresas` / `!abrirempresa <tipo>` | Empresas (renda passiva) |
| `!contratar <empresaId> <tipo>` / `!coletar <empresaId>` | Funcionários e lucro |

### Mercado entre jogadores e social
| Comando | Descrição |
|---|---|
| `!ofertar <item> <qtd> <preço>` | Cria oferta (item vai para custódia) |
| `!mercado` | Ofertas ativas + clima/evento |
| `!compraroferta <id>` / `!cancelaroferta <id>` | Compra/cancela ofertas |
| `!presente @user <item> [qtd]` | Envia item de presente |

### Progressão
| Comando | Descrição |
|---|---|
| `!missoes` / `!missao <id>` | Missões diárias/semanais/especiais/lendárias |
| `!conquistas` | Conquistas (10) com recompensas |
| `!ranking <tipo>` / `!top <tipo>` | Rankings (xp, rpg, dinheiro, patrimonio, level, fazenda, conquistas…) |
| `!clima` / `!evento` | Clima e evento ativo (afetam preços/XP/coleta) |

### Administração (SOMENTE dono)
`!economia` (painel), `!economy` (logs), `!player @user`, `!givecoin @user <v>`,
`!setmoney @user <v>`, `!giveitem` / `!additem` / `!removeitem`, `!setlevel`,
`!setxp`, `!setprice <item> <base> [min] [max]`, `!event <id|off>`.

**Todas as telas importantes têm botões** (`!menu` → 🎮 LUA LIFE) com
⬅️ Voltar / 🏠 Menu / ❌ Fechar. Botões e comandos compartilham os mesmos
handlers — nada é duplicado.

---

## 2. Estrutura (separação em camadas)

```
plugins/life/            # regras de negócio (sem WhatsApp)
  config.js              # dados + balanceamento (profissões, minérios, casas…)
  leveling.js            # níveis, títulos, carreira, efeitos de atributos
  market.js              # preços dinâmicos com min/max (anti-inflação)
  weather.js             # clima + eventos + calendário (determinísticos)
  networth.js            # cálculo consistente de patrimônio
  engine.js              # ações atômicas + segurança econômica
database/life.js         # persistência (entidades separadas)
commands/life/           # comandos de interface (WhatsApp)
menus/screens.js         # telas de navegação por botões
utils/nav.js             # motor de navegação (Voltar/Menu/Fechar/paginação)
utils/readmore.js        # "ler mais" configurável (!lermais)
utils/menuImage.js       # imagens de menu (com fallback)
```

## 3. Banco de dados (entidades separadas)

`life_players`, `life_properties`, `life_businesses`, `life_employees`,
`life_market`, `life_missions`, `life_achievements`, `life_daily`,
`life_tools`, `economy_logs` — **reaproveitando** `economy` (carteira/banco/
inventário/transações), `rpg_players` (profissão/energia legada), `farms`,
`plantations`, `animals` e `cooldowns`. Nada de objeto gigante.

## 4. Segurança econômica

- **Atomicidade**: toda operação multi-etapa roda em transação SQLite (+mutex
  por usuário). Se qualquer etapa falhar, há rollback.
- **Sem saldo negativo** (`INSUFFICIENT_FUNDS`), sem duplicação de itens,
  venda de item inexistente bloqueada, compra sem dinheiro bloqueada.
- **Cooldowns persistentes** (trabalho, mineração, pesca, descanso, loteria,
  diário) — sem bypass por reinício.
- **Ferramentas com durabilidade** (picareta/vara) e itens de coleta nunca
  "nascem" sem compra/coleta/colheita.
- **Preços com limites** (min/max) e oscilação determinística por dia.
- **Log econômico completo** (`economy_logs`): ação, item, valor,
  saldo antes/depois, timestamp.
- **Fonte de verdade**: carteira/banco vêm do `.env`+banco; dono vem do
  `.env` (`OWNER_NUMBER`); nada de dono fixo no código.

## 5. Configuração (.env)

```ini
LUA_COIN_SYMBOL=LC
LUA_COIN_EMOJI=🪙
LUA_START_MONEY=1000
LUA_ENERGY_MAX=200
LUA_DAILY_BASE=250
LUA_DAILY_MAX=500
LUA_DAILY_STREAK_MAX=7
LUA_LOTTERY_MAX=500
LUA_READMORE=true
MENU_IMAGE=./assets/menu.jpg
MENU_IMAGE_ADMIN=./assets/admin.jpg
MENU_IMAGE_RPG=./assets/rpg.jpg
MENU_IMAGE_DOWNLOAD=./assets/download.jpg
MENU_IMAGE_PROFILE=./assets/profile.jpg
```

## 6. Extensão

- **Nova profissão/minério/peixe/casa**: edite `plugins/life/config.js` (e
  adicione o item em `database/seed/life.js` se for vendável).
- **Nova missão/conquista**: `MISSIONS`/`ACHIEVEMENTS` em `config.js` + métrica
  em `engine.js` (`progressMissions`/`achievementMet`).
- **Novo evento/clima**: `EVENTS`/`WEATHER` em `config.js`.
- **Nova tela de menu**: `nav.registerScreen(id, builder)` em `menus/screens.js`.

## 7. Testes

```bash
npm test        # inclui test/life.test.js (23 regressões) e test/e2e.test.js
node test/life.test.js   # só o Lua Life
node test/e2e.test.js    # pipeline ponta a ponta (socket fake)
```

Cobertura: criação de personagem, trabalho (cooldown/energia), banco,
compra/venda (rollback), mineração/pesca (durabilidade), casa/patrimônio,
missões, conquistas (idempotentes), mercado, diário (streak), loteria,
admin (ownerOnly), ler mais, imagem de menu, router de downloads,
persistência pós-reinício e menu por botões → clique → comando.
