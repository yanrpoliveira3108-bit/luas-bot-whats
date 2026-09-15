# 🌙 Lua Bot — Auditoria de arquitetura

> Fase 1 do programa de evolução (prompt mestre, seção 2).
> Todos os números abaixo foram **medidos** no commit `c8eac84` com os comandos
> citados em cada item. Nada aqui é estimativa. Onde a verificação foi por leitura
> de código (e não por execução), está marcado como *(leitura)*.

---

## 1. Arquitetura atual

```
luas-bot-whats
├── index.js            entrypoint: processo, sinais, conexão
├── config.js           385 linhas — configuração central (.env + defaults)
├── connection/         connect.js (610), connectionUI.js (603) — Baileys + QR/pareamento
├── handlers/           5 arquivos / 1.271 linhas — commandHandler (516), groupHandler (468),
│                       buttonHandler, errorHandler, mediaHandler
├── engine/             2 arquivos / 231 linhas — plugins.js (registry), interactionEngine.js
├── commands/           131 arquivos / 11.643 linhas — 14 categorias
├── plugins/            13 arquivos / 2.413 linhas — life/engine.js (799), welcome/…
├── database/           16 arquivos / 2.439 linhas — SQLite (better-sqlite3) + migrations
├── services externos   ai/, anime/, downloaders/ (youtube.js 613)
├── utils/              55 arquivos / 8.783 linhas
├── menus/              18 arquivos / 671 linhas (nav + telas)
├── scripts/            audit.js, smoke.js, preflight
├── test/               30 arquivos / 6.578 linhas
└── vendor/             boruto_vk7-baileys (152 arquivos rastreados)
```

**Totais:** 299 arquivos `.js` (sem `node_modules`/`vendor`), **39.151 linhas**.

**Inventário de comandos (medido via registry):**

| métrica | valor |
|---|---|
| comandos registrados | **331** |
| gatilhos | **655** (todos únicos) |
| descartados no load por conflito | **0** |
| plugins (categorias) | 14 |
| `ownerOnly` / `adminOnly` / `groupOnly` / `privateOnly` | 37 / 53 / 62 / 0 |
| comandos com cooldown | **331 de 331** |

Categorias: `admin=56, life=44, rpg=41, fun=37, general=37, owner=22, members=19,
stickers=15, utility=15, downloads=14, anime=10, games=10, ai=6, rankings=5`.

**Pipeline real hoje** *(leitura de `handlers/commandHandler.js`)*:

```
messages.upsert → shouldProcessMessage → buildContext (71 linhas)
  → grantXp → número/menu curto-circuito → confirmações pendentes (call/poll)
  → parser (prefixo+trigger via commandCache) → checkGate (permissões)
  → cooldown.check → executeCommand → errorHandler → logger/perf
```

---

## 2. O que já existe (não reconstruir)

Verificado por presença de módulo e uso real:

| Área pedida no prompt | Estado | Onde |
|---|---|---|
| Router de comandos + parser | ✅ existe | `handlers/commandHandler.js`, `utils/commandCache.js` |
| Permissões (gate) | ✅ existe | `checkGate()` + `utils/permissions.js` |
| Cooldown central | ✅ existe | `utils/cooldown.js` (331/331 comandos) |
| Rate limit / flood | ✅ existe | `utils/flood.js` |
| Error handler central | ✅ existe | `handlers/errorHandler.js` + `process.on(uncaughtException/unhandledRejection)` |
| Logger estruturado | ✅ existe | `utils/logger.js` (pino, níveis + child) |
| Cache com TTL | ✅ existe | `utils/cache.js`, `utils/mediaCache.js` |
| Fila com concorrência | ✅ existe | `utils/downloadQueue.js` |
| Timeout/retry/backoff | ✅ existe | `utils/resilience.js` (`withTimeout`, `retry`) |
| Mutex por chave | ✅ existe | `utils/keyedMutex.js` |
| Métricas | 🟡 parcial | `utils/perf.js` (`add/count/timing/avg/snapshot`) — sem comando de exibição |
| Single instance | ✅ existe | `utils/singleInstance.js` |
| Backup automático + rotação | ✅ existe | `utils/autoBackup.js` |
| Migrações de banco | ✅ existe | `MIGRATIONS` em `database/database.js`; WAL ativo |
| Transações | ✅ existe | economy (5 usos), life (4) — `transfer()` é atômica com rollback |
| Confirmações com expiração | ✅ existe | `utils/confirmFlow.js` (call/poll) |
| Anti/automod | ✅ existe | `utils/antiManager.js` + `handlers/groupHandler.applyFilters` (151 linhas) |
| Plugins com enable/disable | ✅ existe | `engine/plugins.js` + `isPluginEnabled` |
| Hot reload seguro | ✅ existe | `loadCommands(true)` desregistra tudo antes *(leitura)* |
| UI/UX central | ✅ existe | `utils/menuRenderer.js`, `uiKit.js`, `ui.js`, `dividers.js`, `fonts.js`, `icons.js` |

**Comandos pedidos que faltam (medido no registry):** dos 32 citados no prompt,
apenas `x9` existe. Faltam 31: `configgrupo, resetconfig, exportconfig,
importconfig, casos, caso, historico, notacaso, fecharcaso, audit, extrato,
transacoes, transcrever, tts, resumiraudio, pesquisar, wiki, noticias, nota,
notas, todo, lembrete, lembretes, agendar, agenda, alias, analytics, health,
cargo, perfiltema, recompensas`.

---

## 3. Problemas críticos

> **Status: C1, C2 e C3 corrigidos no mesmo commit deste relatório**
> (`test/core-fixes.test.js`, 6 verificações). Detalhes em cada item.

### C1 — Comando duplicado: `!tigrinho` existe em dois arquivos — ✅ corrigido
```
commands/rpg/tigrinho.js    391 linhas  → ATIVO ("Caça-níquel de 5 rolos")
commands/games/tigrinho.js  364 linhas  → CARREGADO E SOMBREADO ("arcade de fichas")
132 linhas idênticas entre os dois
```
O loader registra `games/` antes de `rpg/`; o segundo sobrescreve o primeiro sem
aviso (`skippedCommands()` = 0, ou seja, nem é contabilizado como conflito).
**Impacto:** editar `commands/games/tigrinho.js` não produzia efeito nenhum — risco
direto de "consertei e não mudou nada" e de manutenção dupla (755 linhas para um
jogo).

**Causa raiz (achada durante a correção):** `engine/plugins.js` só barrava
trigger duplicado quando o `name` era *diferente*. Com o mesmo `name` em dois
arquivos, o segundo sobrescrevia o primeiro **sem registrar nada em `skipped`** —
por isso nem o `scripts/audit.js` enxergava (ele lê o registry, e o perdedor já
tinha sumido).

**Correção aplicada (nada foi apagado):**
1. `commands/games/tigrinho.js` virou **`!tigrearcade`** (aliases
   `tigrinhoarcade`, `arcadetigrinho`) — o jogo arcade deixou de ser código morto
   e o `!tigrinho` de 5 rolos continua como estava;
2. `engine/plugins.js` agora desregistra o comando anterior por completo (sem
   gatilho órfão apontando para objeto morto) e registra o caso em
   `skippedCommands()` — a próxima colisão aparece no `npm test`, não em produção.

### C2 — Estado de spam cresce sem limite (`handlers/groupHandler.js:26`) — ✅ corrigido
```js
const spamState = new Map(); // userJid -> { count, windowStart, lastText }
```
Nenhuma limpeza, TTL ou `delete` no arquivo: cada usuário novo que dispara o
filtro adiciona uma entrada permanente. Em bot com muitos grupos é vazamento
lento e contínuo de memória.

**Correção aplicada:** `pruneSpamState()` remove entradas com mais de 5 minutos e
só roda quando a Map passa de 500 itens (custo zero no caminho da mensagem).
Teste: 600 entradas vencidas + 3 ativas → remove exatamente 600 e mantém 3;
abaixo do teto não remove nada.

### C3 — `!eval` sem timeout — ✅ corrigido (gravidade revisada)

Correção de gravidade em relação à primeira leitura: o `!eval` **já** era
`ownerOnly: true`, exigia `ENABLE_EVAL=true` (padrão **false**, `config.js:231`) e
passava por `confirmAction`. O risco real que sobrava era um: laço síncrono
(`while(true)`) trava o event loop e nenhum handler de erro salva o processo.

**Correção aplicada:** `new Function` → `vm.runInNewContext(code, sandbox,
{ timeout: 5000 })` + `withTimeout(..., 15000)` no resultado assíncrono. Medido:
um laço infinito é interrompido em **5006 ms** com erro amigável. `vm` não é
sandbox de segurança (e não precisa ser, dado `ownerOnly` + flag desligada); o
ganho aqui é o timeout.

---

## 4. Problemas médios

### M1 — Funções gigantes (14 funções com mais de 90 linhas)
| linhas | função | local |
|---|---|---|
| 234 | `buildPingHtml` | `utils/pingHtml.js:126` |
| 214 | `handleMessage` | `handlers/commandHandler.js:270` |
| 164 | `execute` | `commands/general/criador.js:130` |
| 151 | `applyFilters` | `handlers/groupHandler.js:107` |
| 151 | `render` | `utils/nav.js:120` |
| 133 | `connect` | `connection/connect.js:189` |
| 128/112 | `buildMachineHtml` | tigrinho (nos dois arquivos) |

`handleMessage` concentra parsing, atalhos, confirmações, sessão de jogo,
fallback numérico e dispatch — é o ponto onde um middleware resolveria vários
problemas de uma vez.

### M2 — Arquivos grandes demais para manter
`plugins/life/engine.js` (799), `utils/stickerEngine.js` (690),
`downloaders/youtube.js` (613), `connection/connect.js` (610),
`connection/connectionUI.js` (603), `database/database.js` (549).

### M3 — Ausência de scheduler (seção 19 do prompt)
Só existe `utils/downloadQueue.js`. Não há agendador persistente nem comandos
`lembrete/agendar/agenda`. Qualquer "mensagem diária" hoje dependeria de
`setInterval` avulso.

### M4 — `utils/dividers.js:111` — ❌ falso positivo (retirado)

A heurística da auditoria marcou `cursors = new Map()` como cache sem limpeza,
mas a chave é a **categoria** do separador (`cursors.get(category)`, com
`category` sempre vinda de `CATALOG`): o conjunto de chaves é fixo e pequeno.
Não é vazamento. Registrado aqui para não virar "correção" desnecessária.

### M5 — 50 blocos `catch` vazios
Distribuição: `utils/autoBackup.js` (10), `utils/download.js` (8),
`utils/mediaCache.js` (6), `downloaders/youtube.js` (6), `utils/stickerMeta.js`
(5), `index.js` (5), demais espalhados. Parte é intencional ("não interrompe a
brincadeira"), mas sem comentário nem log fica impossível distinguir erro
ignorado de erro aceitável.

### M6 — I/O síncrono em caminhos quentes
Contagem de chamadas `*Sync` por arquivo: `autoBackup` 35, `stickerEngine` 14,
`singleInstance` 11, `mediaCache` 10, `download` 10, `downloaders/youtube` 10.
Backup e single-instance podem ser síncronos (rodam fora do caminho da
mensagem); `stickerEngine`, `mediaCache` e `download` estão no caminho do
usuário.

---

## 5. Problemas pequenos

- **P1 — Rede:** 14 chamadas `fetch(` diretas; apenas 3 passam por
  `withTimeout`. Mitigação parcial: 12 arquivos usam `AbortSignal`/`signal`
  no próprio fetch. Falta padronizar.
- **P2 — `Promise.all` ilimitado:** **0 ocorrências** ✅ (nada a corrigir).
- **P3 — SQL:** apenas 1 interpolação (`database/database.js:532`, nome de
  tabela vindo de lista fixa) ✅; todo o resto usa parâmetros `?`.
- **P4 — `privateOnly = 0`:** nenhum comando declara ser exclusivo de privado,
  embora existam comandos que só fazem sentido lá.
- **P5 — Listeners do Baileys:** anexados ao socket novo a cada conexão
  (`connection/connect.js:326-358`) — sem duplicação em reconexão *(leitura)*.
- **P6 — Hot reload:** `loadCommands(true)` desregistra todos os comandos,
  reseta `skipped` e limpa `loadedFiles` antes de recarregar ✅ *(leitura)*.

---

## 6. Duplicações

1. `!tigrinho` em `commands/rpg/` e `commands/games/` (C1) — 132 linhas idênticas.
2. `buildMachineHtml` duplicada nos dois tigrinhos (128 e 112 linhas).
3. Confirmação: já foi centralizada em `utils/confirmFlow.js` (call/poll) —
   modelo pronto para reusar nas confirmações destrutivas (seção 39).
4. Identidade do criador: já centralizada em `utils/creatorProfile.js`
   (`!criador`, `!owner` e selo leem da mesma fonte).

---

## 7. Riscos

| risco | probabilidade | impacto | origem |
|---|---|---|---|
| ~~Memória crescer até OOM em bot grande~~ | ~~alta~~ | ~~derruba o processo~~ | ✅ C2 corrigido |
| ~~Editar o tigrinho errado e não ver efeito~~ | ~~alta~~ | ~~retrabalho~~ | ✅ C1 corrigido |
| ~~`!eval` travar o event loop~~ | ~~média~~ | ~~bot parado~~ | ✅ C3 corrigido |
| Falha de API externa sem timeout padrão | média | comando pendurado | P1 |
| Erros silenciados dificultando diagnóstico | alta | manutenção | M5 |
| Perda de dados em operação financeira | baixa | grave | ✅ já mitigado (transações + rollback) |

---

## 8. Melhorias recomendadas (com custo/benefício)

1. ~~Resolver C1~~ ✅ feito — sem apagar jogo: `!tigrearcade` + colisão visível.
2. ~~Resolver C2~~ ✅ feito — `pruneSpamState()` (M4 era falso positivo).
3. ~~C3~~ ✅ feito — `vm` com timeout de 5s.
4. **Middleware no `handleMessage`** — extrair a cadeia (rate limit →
   confirmações → parser → permissão → cooldown → dispatch) para
   `engine/pipeline.js`; `handleMessage` cai de 214 linhas e ganha pontos de
   extensão sem quebrar nada.
5. **`utils/jobQueue.js` + scheduler persistente** — reusar o padrão de
   `downloadQueue` (concorrência, timeout, retry) para jobs e lembretes.
6. **`!health` e `!analytics`** — os dados já existem em `utils/perf.js`; falta
   só a camada de apresentação.
7. **`!extrato`/`!transacoes`** — `recordTransaction()` já existe em
   `database/economy.js`; falta expor.
8. **Casos de moderação** — tabela `moderation_cases` + serviço; os eventos já
   passam por `groupHandler`/comandos de admin.
9. **Padronizar `withTimeout` em todo `fetch`** (P1).
10. **Comentar ou logar os `catch` vazios** (M5).

---

## 9. Ordem ideal de implementação

```
Fase 2  Correções críticas      ✅ CONCLUÍDA (C1, C2, C3 + colisão visível no registry)
Fase 3  Core                    pipeline/middleware, padronizar timeouts, catch auditados
Fase 4  Database                moderation_cases, command_usage, scheduled_jobs + migrations
Fase 5  Services                ModerationService (casos/warn), EconomyService (extrato),
                                LifeService/RPG (extrair regras dos handlers)
Fase 6  Scheduler + Queue       utils/jobQueue.js + !lembrete/!agendar persistentes
Fase 7  Observabilidade         !health, !analytics sobre utils/perf.js
Fase 8  UX                      !configgrupo/!exportconfig/!importconfig, menus por categoria
Fase 9  Comandos novos          !pesquisar/!wiki/!nota/!todo/!tts/!transcrever (com provider isolado)
Fase 10 Qualidade               testes das áreas acima + CI (lint/test/build) + docs
```

Cada fase entra com testes próprios e `npm test` verde antes do commit — o
projeto já tem 17 suítes (188 verificações) + audit (69) + smoke (27) como rede
de proteção contra regressão.
