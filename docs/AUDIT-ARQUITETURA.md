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

---

## 10. Fase 3 — pipeline de mensagens (concluída)

**Problema.** `handleMessage` era uma função de 215 linhas com 10 responsabilidades
encadeadas por `return`s implícitos: sem nomes para as etapas, sem como testar uma
delas isoladamente e sem como saber, num erro, em que ponto da cadeia ele ocorreu.

**Solução.** A cadeia foi extraída para `engine/pipeline.js` como `createPipeline(deps)`
— middlewares próprios, sem framework externo, com as dependências injetadas pelo
`commandHandler` (evita ciclo de `require`). `handlers/commandHandler.js` manteve
`buildContext`, `checkGate`, `executeCommand`, `runByName`, `shouldProcessMessage` e
o cache de metadata; `handleMessage` virou um adaptador de 3 linhas.

**Ordem efetiva preservada** (lida do código, não reordenada):

| # | Etapa | O que faz |
|---|-------|-----------|
| 1 | `accept` | eco do bot / status (`shouldProcessMessage`, `isStatusJid`) |
| 2 | `normalize` | `buildContext` + `perf.add('messages')` + log comunidade/LID |
| 3 | `gateUser` | bloqueados → **flood** → `enforceMute` |
| 4 | `register` | viewonce, upserts, contadores, XP, AFK |
| 5 | `interactive` | botões/listas (`buttonHandler.process`) |
| 6 | `moderation` | histórico do automod + `applyFilters` (só em grupo) |
| 7 | `dispatch` | parse por prefixo → comando ou sugestão fuzzy |
| 8 | `shortcuts` | `prefixo` / `menu` / `0`-`voltar` sem prefixo |
| 9 | `confirmation` | `!call` / `!poll` pendentes |
| 10 | `sessionFlow` | sessão de jogo + menu numerado |

`state.stop = true` substitui os `return`s; o `catch` central é o mesmo de antes
(`logger.error(..., 'erro no processamento de mensagem')`) e agora loga a etapa
culpada. `perf.timing('pipeline', ms)` foi adicionado no `finally`.

**Única mudança de contrato:** `handleMessage` agora devolve o `state` (antes não
devolvia nada). Nenhum chamador usava o retorno — `index.js:123` só encadeia
`.catch`, e os testes ignoram o valor.

**Prova de extração fiel:** a sequência de chamadas do bloco antigo e da pipeline é
idêntica e na mesma ordem (39 chamadas); as únicas adições são `Date.now` e
`perf.timing`. Inventário idêntico antes/depois: 332 comandos, 658 gatilhos,
37 ownerOnly, 53 adminOnly, 62 groupOnly, 332 com cooldown, 0 descartados.

**Testes:** `test/pipeline.test.js` (19 cenários, ligado ao `npm test`) cobrindo
mensagem comum, comando válido, comando inexistente, ownerOnly negar/permitir,
adminOnly negar/permitir, groupOnly em privado, cooldown, confirmação (`1` e `2`),
flood, plugin, hot reload e erro dentro de etapa. As asserções foram validadas por
mutação: reordenar etapas e remover o `state.stop` da confirmação fazem a suíte
falhar (2 falhas em cada caso).

**Dívida descoberta (não corrigida nesta fase, para não mudar comportamento):**
`utils/cooldown.js` registra também a chave `global:*:<comando>`, então o uso de um
comando por qualquer usuário trava o mesmo comando para todos durante o cooldown.

---

## 11. Fase 4 — Banco: moderation_cases, command_usage, scheduled_jobs

### Banco analisado (o padrão REAL do repositório)

| Item | Como é |
|---|---|
| Banco | SQLite, arquivo único em `CONFIG.paths.databaseFile` |
| Driver | `better-sqlite3` 13.0.3 (SQLite 3.53.4), API síncrona |
| Migrações | array `MIGRATIONS` dentro de `database/database.js`; **versão = posição no array** (`i + 1`), registradas em `schema_migrations(version, applied_at)` e aplicadas só se `version > MAX(version)`, cada uma em `db.transaction()` |
| Rollback | **não existe** (não há `down`). Não foi inventado um sistema paralelo — ver "Limitações" |
| Tabelas | `CREATE TABLE IF NOT EXISTS` no SQL da migração |
| Índices | `CREATE INDEX IF NOT EXISTS` na mesma migração da tabela |
| Transactions | `db.transaction(fn)` do better-sqlite3 (usado em migrate/seed/economy) |
| Queries | `database.prepare(nome, sql)` — prepared statements com cache por `nome::sql`, sempre parametrizados |
| Timestamps | TEXT ISO-8601 (`new Date().toISOString()`); exceção histórica: `tigrinho_players.last_spin_at` INTEGER |
| JSON | TEXT (`groups.settings`, `rpg_players.achievements`, `quiz_questions.options`) |
| Foreign keys | pragma `foreign_keys = ON`, mas **nenhuma tabela declara FK** |
| Backup | `database.backup(dest)` / `restore(src)` + rotação em `utils/autoBackup` |
| Isolamento em teste | `process.env.DATABASE_FILE` + `test/dbtmp.js` (tmp/ do projeto: no Termux `/tmp` não é gravável) |

Nada disso foi trocado, duplicado ou substituído. Nenhum ORM, nenhum pool, nenhum
segundo gerenciador de banco, nenhum segundo sistema de migração.

### Migrações criadas (anexadas ao FIM do array — a versão é posicional)

| Versão | Conteúdo |
|---|---|
| 35 | `moderation_cases` + 2 índices |
| 36 | `command_usage` + 3 índices |
| 37 | `scheduled_jobs` + 1 índice |

Cada uma é pequena, focada, determinística e idempotente (`IF NOT EXISTS`), no
formato exato das 34 anteriores. Upgrade verificado: um banco na versão 34 recebe
apenas 35/36/37 e preserva tudo que já existia.

### Tabelas

**`moderation_cases`** — caso de moderação com ciclo de vida.
`id` (PK AUTOINCREMENT = **case_id**: único, persistente, imutável, seguro sob
concorrência), `group_id`, `user_id`, `moderator_id` ('' = automod/sistema),
`action` (texto livre: warn/mute/kick/ban/unban/…), `reason`, `status`
(`open`/`closed`, com CHECK), `metadata` (JSON: `{duration, source, …}`),
`created_at`, `updated_at`, `closed_at`.

Não substitui `warnings` (eventos imutáveis de `!warn`) nem `group_logs` (trilha
do X9): as duas continuam sendo escritas pelos fluxos atuais. A unificação da
escrita é trabalho da Fase 5.

**`command_usage`** — uso de comandos **agregado por dia**.
PK composta `(command, user_id, group_id, day, ok)` + `uses`, `total_ms`,
`last_used_at`. `day` é `YYYY-MM-DD` (UTC) e `ok` é 1/0.

**`scheduled_jobs`** — jobs agendados (base da Fase 6; **sem scheduler aqui**).
`id`, `type`, `payload` (JSON), `status` (CHECK), `run_at`, `created_at`,
`updated_at`, `started_at`, `finished_at`, `attempts`, `max_attempts`,
`last_error`, `worker_id`.

### Índices (6 novos; o banco tinha 3)

| Índice | Consulta que atende |
|---|---|
| `idx_mod_cases_group (group_id, id)` | casos de um grupo, já ordenados do mais recente |
| `idx_mod_cases_user (user_id, group_id, id)` | casos de um usuário (qualquer grupo) **e** usuário dentro de um grupo |
| `idx_cmd_usage_day (day)` | retenção (`DELETE WHERE day < ?`) e uso por período |
| `idx_cmd_usage_user (user_id, day)` | quais comandos um usuário usa |
| `idx_cmd_usage_group (group_id, command)` | qual grupo usa determinado comando |
| `idx_sched_jobs_due (status, run_at, id)` | busca do worker: `status='pending' AND run_at <= agora` |

Caso por ID e "casos recentes" usam o rowid (PK) — sem índice extra de propósito.
Todos os planos foram conferidos com `EXPLAIN QUERY PLAN` no teste: nenhuma
consulta crítica faz varredura completa.

### Concorrência (claim de job)

`claimJob(workerId, at)` é **UM ÚNICO statement** `UPDATE … WHERE status='pending'
AND id = (SELECT … ORDER BY run_at, id LIMIT 1) RETURNING *` — compare-and-set no
nível do banco, sem `SELECT` seguido de `UPDATE`. Dois workers em processos
diferentes não ficam com o mesmo job: o segundo vê `status='running'`, a guarda
falha e nada é retornado. Nenhuma trava em memória é usada para isso.

Testado de verdade: 500 jobs, **dois processos** (`test/db-claim-worker.js` usa o
mesmo repository) disputando com largada sincronizada e teto de 300 por lado →
500 claims, 500 ids distintos, 0 `SQLITE_BUSY`, intercalação comprovada
(250/250). Com o claim trocado pelo anti-padrão SELECT+UPDATE, o teste acusa
516/526 claims para 500 jobs — ou seja, ele detecta a corrida.

Transições: `pending → running → completed|failed`; `running → pending` (retry,
só enquanto `attempts < max_attempts`); `pending|running → cancelled`.
Todas as funções de transição têm guarda de estado no `WHERE` e devolvem `null`
quando a guarda não bate (corrida perdida é detectável, nunca silenciosa).

### Retenção de `command_usage`

Decisão: **contadores agregados por (comando, usuário, grupo, dia, sucesso)**,
não uma linha por execução.

- volume: 1 linha por execução cresce com o número de mensagens; o agregado cresce
  com o número de combinações distintas por dia;
- as perguntas do futuro `!analytics` são todas de agregação → `SUM()` sobre
  poucas linhas;
- retenção: `prune(beforeDay)` é um único `DELETE WHERE day < ?` usando
  `idx_cmd_usage_day`;
- o detalhe por execução continua em memória (`utils/activity.js`, 200 entradas)
  para `!logs`; `utils/perf.js` segue sendo a métrica volátil do processo — não há
  duplicação.

Quem chama o `prune` é a Fase 6 (scheduler) ou o dono manualmente. `scheduled_jobs`
tem o equivalente `pruneFinished(before)` para jobs terminados.

### Limitações documentadas

- **Sem rollback**: `schema_migrations` não guarda `down`. Como as migrações são
  aditivas e `IF NOT EXISTS`, o caminho seguro de reversão é o backup existente
  (`database.backup`/`restore` + rotação). Não foi criado um sistema paralelo.
- **Sem FK**: mantido o padrão do banco (zero FK declaradas). Relacionamentos são
  por JID em TEXT; integridade é responsabilidade da camada de acesso.
- `database.stats()` **não** foi alterado: incluir as tabelas novas mudaria a saída
  de `!database`/`!statsbot` (fora do escopo desta fase).

### Problemas encontrados durante a auditoria (classificados, não corrigidos)

| # | Achado | Classificação |
|---|---|---|
| 1 | Comentários de versão duplicados no array `MIGRATIONS` (dois "20", "21", "22", "23"): a versão real é a posição. Erro de documentação que induz a inserir migração no meio do array e renumerar bancos existentes | MELHORIA FUTURA (comentário já adicionado nas entradas da Fase 4) |
| 2 | `pragma foreign_keys = ON` sem nenhuma FK declarada — pragma sem efeito | MELHORIA FUTURA |
| 3 | Tabelas antigas sem índice em colunas de consulta: `warnings`, `transactions`, `economy_logs`, `group_logs`, `plantations`, `animals`, `life_market` (3 índices no banco inteiro antes da Fase 4) | MELHORIA FUTURA (Fase 7/10) — mexer em tabelas existentes é mudança de schema fora do escopo |
| 4 | `tigrinho_players.last_spin_at` é INTEGER enquanto todo o resto é TEXT ISO | FORA DO ESCOPO (as tabelas novas seguiram o padrão dominante ISO) |
| 5 | Sem rollback de migração | DOCUMENTADO acima |

Nenhum deles foi "corrigido por achar bonito": só o necessário para a Fase 4 entrou.
