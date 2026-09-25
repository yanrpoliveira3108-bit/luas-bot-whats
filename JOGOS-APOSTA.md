# Jogos com aposta — 🗺️ Caça ao Tesouro e 🐯 Tigrinho

Este documento cobre os **dois jogos que movimentam a carteira** e o painel de
aposta **compartilhado** entre eles. Ele existe para não sobrar dúvida sobre
**de onde vem o saldo**, **quando o dinheiro anda** e **o que o card HTML pode e
não pode fazer**.

- Caça ao tesouro: `commands/games/cacatesouro.js` (3×3 até 13×13, aposta opcional)
- Tigrinho: `commands/rpg/tigrinho.js` (preservado, agora com o painel)
- Painel: `utils/betPanel.js` (o MESMO nos dois jogos)

---

## 1. De onde vem o saldo (fonte única)

| | |
|---|---|
| Fonte | `database/economy.js` → tabela `economy`, coluna `wallet` (INTEGER, LuaCoins/LC) |
| Quem compartilha | RPG, Lua Life (`database/life.js` reusa a mesma carteira), cassino, cripto, investimentos, tigrinho e caça ao tesouro |
| Identidade do jogador | `ctx.sender` (JID já resolvido de LID→PN pelo pipeline) — **nunca** um valor vindo do HTML |
| Quem lê no caça | `utils/gameWallet.saldo/maximoPermitido` → `economy.get` |
| Quem lê no tigrinho | o mesmo `utils/gameWallet` (o painel e a cobrança usam a mesma leitura) |
| Fora do escopo | `bank`, patrimônio e inventário **não** entram na aposta |

Não existe segunda carteira, fichas paralelas nem coluna de reserva. O painel
mostra `saldo`, `disponível` e `comprometido`:

- **disponível** = `wallet` (a aposta é debitada no ato da confirmação, como já
  faziam `database/tigrinho.applySpin` e `commands/rpg/cassino.js`);
- **comprometido** = soma das apostas de partidas/rodadas que já foram cobradas
  e ainda não terminaram (status `pending` no livro-caixa). É **informativo**:
  o valor já saiu da carteira, então **não** é descontado de novo.

Falha de consulta nunca vira saldo zero: o painel mostra **“—”** e bloqueia a
confirmação com o motivo (`data-indisponivel`), e o bot pede nova tentativa.

---

## 2. Camadas (nada duplicado)

| Arquivo | Papel |
|---|---|
| `utils/gameWallet.js` | camada financeira ÚNICA: `saldo`, `maximoPermitido`, `validarAposta`, `parseValor`, `cobrarAposta`, `pagarPremio`, `liquidar`, `historico`; usa `withLock` + transações do SQLite; idempotência por `game:user:ref`. Também expõe as primitivas `*Interno` (sem trava) para quem já está dentro de um `withLock` — **`withLock` não é reentrante** |
| `utils/betPanel.js` | painel compartilhado (saldo/comprometido/disponível/mín/máx, campo de valor, ±, chips 10/25/50%/Máx, prévia, atualizar saldo, confirmar que **copia o comando**, regras) |
| `utils/treasureGame.js` | lógica pura do caça: tabuleiro, mapa (com seed), pistas, cálculo de pagamento |
| `database/treasure.js` | estado das expedições (criar, cavar, sair, expirar, estatísticas) |
| `database/gameRounds.js` | rodadas (`game_rounds`): grava o resultado **antes** de pagar, para não perder nada numa queda |
| `database/tigrinho.js` | estatísticas/histórico/ranking/cooldown do tigrinho (`applySpin` continua existindo; `registrarRodada` faz só estatística, sem dinheiro) |
| `database/database.js` | migração 36 (a última; a `version` gravada é o índice + 1): `game_bets` (livro-caixa), `treasure_games` (expedição, com o **mapa secreto**), `game_rounds` (rodada) — e a auto-cura `ensureGameSchema()` |
| `utils/menuFormat.js` | `usarHtmlJogo()`: decide card × texto para os **jogos** |

---

## 3. Caça ao tesouro — regras e parâmetros

Tabuleiro de `n×n`, colunas **A–M**, linhas **1–13**. Cada casa só pode ser
escavada uma vez; repetir não gasta escavação nem paga de novo.

Parâmetros (todos em `utils/treasureGame.js`):

```
RTP_BASE      = 0.85      BONUS_VITORIA = 0.25
tesouros      T = max(2, round(n × 0.6))
armadilhas    A = max(1, round(n × 0.35))      (limitado ao tabuleiro)
escavações    D = min(n²−1, max(T+2, round(n² × 0.2)))
valor/tesouro = floor(aposta × (n²/D) × (RTP_BASE/T))
```

| n | casas | tesouros | armadilhas | escavações | % da aposta por tesouro | retorno máximo (aposta 100) |
|---|---|---|---|---|---|---|
| 3 | 9 | 2 | 1 | 4 | 95,6% | 215 |
| 4 | 16 | 2 | 1 | 4 | 170,0% | 365 |
| 5 | 25 | 3 | 2 | 5 | 141,7% | 448 |
| 6 | 36 | 4 | 2 | 7 | 109,3% | 461 |
| 7 | 49 | 4 | 2 | 10 | 104,1% | 441 |
| 8 | 64 | 5 | 3 | 13 | 83,7% | 440 |
| 9 | 81 | 5 | 3 | 16 | 86,1% | 455 |
| 10 | 100 | 6 | 4 | 20 | 70,8% | 445 |
| 11 | 121 | 7 | 4 | 24 | 61,2% | 452 |
| 12 | 144 | 7 | 4 | 29 | 60,3% | 445 |
| 13 | 169 | 8 | 5 | 34 | 52,8% | 441 |

O “retorno máximo” é o teto teórico (achar TODOS os tesouros). O que um jogador
aleatório consegue, medido por simulação determinística (4.000 expedições por
tamanho, `test/tesouro.test.js`):

| n | RTP simulado | vitórias |
|---|---|---|
| 3 | 79,0% | 13,7% |
| 4 | 82,2% | 4,3% |
| 5 | 79,0% | 0,3% |
| 6 | 79,5% | 0,1% |
| 7 a 13 | 79,3% – 83,2% | ~0% (a pista de vizinhança é que permite vencer) |

Ou seja: **nunca acima de 100%** e a vitória depende de raciocínio (a dica de
cada casa mostra quantos tesouros existem nas 8 casas vizinhas), não de sorte
pura.

Outras regras:

- **Armadilha** queima **2** escavações (a queima extra é anunciada antes de confirmar).
- **Vitória**: achar todos os tesouros antes de acabar as escavações (**+25% da aposta**).
- **Derrota**: escavações esgotadas com tesouro no chão.
- **Desistir (`sair`)**: encerra, paga o que já foi achado (**sem** o bônus de vitória) e a aposta **não** volta.
- **Expiração**: 30 min sem escavar → status `expired`; a aposta não volta e o
  livro-caixa é fechado (sem pendência eterna). Sem timer por partida: a limpeza
  roda sob demanda (`limparExpiradas`).
- **Modo casual**: `... jogar <n> casual` roda por pontuação, com aposta 0 —
  nenhuma linha no livro-caixa. Também é a saída quando o saldo disponível é 0.
- **Aposta NÃO exige personagem do RPG/vida**: a moeda mora na carteira
  (`economy.wallet`), que existe para todo mundo. O personagem só entra no XP —
  quem não tem personagem aposta normalmente e ganha moeda; só não ganha XP.
- XP: 5 por tesouro + 20 ao completar a expedição (e também ao `sair` com o que
  achou), via `database/life.addLifeXp` (personagem do Lua Life) ou
  `database/rpg.addRpgXp` (personagem do RPG) — serviços existentes, na ordem
  vida → RPG. Sem personagem: nenhum XP, nenhum erro (XP não é moeda).
- **Cada escavação responde EM TEXTO** (💎 tesouro / 🕳️ vazia + pista / 💥
  armadilha), com o progresso e o **retorno acumulado** — o resultado não fica
  só dentro do card, então a jogada é legível mesmo se o card não abrir.

---

## 4. Aposta e pagamento (regras comuns aos dois jogos)

1. **Abrir, consultar ou digitar não cobra nada.** O débito só acontece quando o
   comando de confirmação chega ao bot.
2. **Cobrança única** por `(usuário, jogo, ref)` — a `ref` é o **id da mensagem**
   (ou o id da partida, no caso da expedição). Clique duplo, mensagem
   retransmitida ou reenvio devolvem o mesmo resultado **sem cobrar de novo**.
3. **Prêmio único**: o crédito usa o id da aposta (`pagarPremio`), então repetir
   a ação não paga duas vezes.
4. **Atomicidade real**: tudo dentro de `withLock(userId)` + transação do SQLite,
   na mesma ordem que cassino e tigrinho. Bloquear botão/UI não é garantia.
5. **Saldo nunca negativo**: a validação é refeita dentro da transação, com o
   saldo relido.
6. **Revalidação no servidor**: o bot ignora o que a tela mostra. Se o saldo
   mudou entre abrir e confirmar, a aposta é recusada com o motivo e o **máximo
   permitido agora**.
7. **Recusas distintas** (cada uma com texto próprio): vazio, negativo, zero,
   decimal, malformado/não finito, abaixo do mínimo, acima do saldo, acima do
   limite do jogo, e “não consegui consultar agora”.
8. **Retorno × lucro**: as mensagens dizem o **retorno total** (que inclui a
   aposta devolvida no prêmio) e o **lucro líquido** (retorno − aposta).
9. **Desistência/expiração** não desfazem perda determinada; **timeout não é
   falha** — antes de repetir qualquer movimentação o bot consulta o estado
   (livro-caixa/rodada).
10. **Uma expedição por vez** e **uma rodada por mensagem**: pedido novo com jogo
    aberto é respondido com o estado atual, sem segunda cobrança.

---

## 5. Tigrinho — o que foi preservado e o que mudou

**Preservado**: o comando, os subcomandos (`jogar`, `fichas`, `historico`,
`ranking`, `ajuda`), a categoria `rpg`, o cooldown, a tabela de prêmios, o
`applySpin` (usado por teste) e a máquina visual.

**Integrado**:

- o card abre com o **painel compartilhado** (saldo, disponível, mín/máx, campo
  de valor, atualizar saldo, regras de pagamento e o botão que **copia**
  `!tigrinho jogar <valor>`);
- **`{p}tigrinho saldo` / `fichas` abre esse mesmo card** (antes era só texto):
  saldo real lido pelo bot + o **botão de jogar** com a **aposta padrão
  (100 LC) já digitada** — um toque copia o comando, você envia e o giro
  acontece. O valor nunca vem preenchido com o saldo todo (regra comum aos dois
  jogos), e o campo continua livre para trocar;
- o giro passa pela camada financeira comum (`cobrarAposta` → resultado no
  backend → `pagarPremio`), com idempotência pelo id da mensagem;
- a **rodada** é gravada em `game_rounds` **antes** do pagamento;
- **o botão de “rever a última rodada” foi removido** (pedido do dono): no lugar
  dele ficou uma faixa com o **último resultado já validado** — rolos e prêmio do
  registro da rodada, sem animação e sem sorteio. Sem rodada registrada, a faixa
  diz que ainda não houve giro e o card convida a jogar;
- reabrir o card mostra **o mesmo** resultado (não sorteia de novo) e o **mesmo**
  painel: nada é sorteado, cobrado ou alterado só por abrir a tela;
- **um card por conversa** (pedido do dono: “não criar vários html”). `!tigrinho
  saldo` (ou `!tigrinho`, `!tigrinho fichas`) manda o card **uma vez** — com o
  valor já preenchido (o que o jogador adiciona) e o botão 🎰 de girar. O
  **giro responde em TEXTO** (rolos, aposta, prêmio, retorno, lucro e saldo) e
  **não** manda outro HTML; pedir o card de novo na mesma conversa dentro de
  ~2 min também responde em texto, dizendo que o card já está aberto acima. Em
  outra conversa (ou depois da janela) o card sai normalmente;
- o card usa a **moldura livre** de `menus/html/moldura.js` (`cssLivre()`): sem
  altura declarada. O WebView do card se dimensiona pelo conteúdo — altura fixa
  menor que o conteúdo **corta** (era o que escondia o botão de girar). O menu
  continua com altura fixa + rolagem por setas, porque é uma lista longa
  (§2.4 do `MENUS-HTML.md`);
- rodada pendente (queda no meio) é concluída ao reabrir/usar: paga uma vez e
  registra a estatística uma vez. Rodada **sem resultado** registrado devolve a
  aposta (não houve giro a concluir).

---

### 5.1 Correções desta rodada (relato do dono: “o caça ainda não está funcionando, não acha o dinheiro”)

Três causas **encontradas no código** (cada uma com teste que a trava de voltar):

1. **Tabelas dos jogos ausentes em banco com `version` adiantada.** A migração
   dos jogos só roda se a `version` gravada estiver atrás dela; num banco vindo
   de outro estado do bot, `game_bets`/`treasure_games`/`game_rounds` não
   existiam e os DOIS jogos respondiam erro de SQL. Agora o `open()` confere o
   esquema por medição (`ensureGameSchema`) e cria o que faltar, sem apagar dado
   e sem reescrever a `version`. Como conferir no aparelho: `npm run
   jogos:doctor` (seção 2) — e a linha `✅ esquema dos jogos íntegro`.
2. **XP pago duas vezes** na caça (o comando pagava 5/tesouro + 20 e o
   `database/treasure.js` pagava de novo) — dava para ganhar XP em dobro. O XP
   agora é pago **num lugar só** (`database/treasure.js → premiarXp`), uma vez
   por expedição que termina, e o comando só mostra o que foi registrado.
3. **Aposta que exigia personagem** do RPG/vida para apostar: quem não tinha
   personagem caía no modo casual (sem aposta) e por isso “não achava o
   dinheiro”. A moeda é da **carteira** (`economy.wallet`), que existe para
   todo mundo — agora a aposta vale com ou sem personagem (o personagem só
   entra no XP).

Além disso, o card dos jogos passou a usar a **moldura livre** de
`menus/html/moldura.js` (§2.4 do `MENUS-HTML.md`): altura fixa em px cortava o
botão de girar no tigrinho e deixava partes do caça inalcançáveis. Sem altura
declarada, o card cresce com o conteúdo e a ação principal ganhou prioridade
(botão colado no tabuleiro, painel em modo compacto).

## 6. Comandos

Prefixo real do bot (`!` por padrão). Caça ao tesouro:

```
{p}cacatesouro                       painel (carteira + aposta)
{p}cacatesouro 3 | 13                mesmo painel, já no tamanho
{p}cacatesouro jogar <3-13> <valor>  abre a expedição (cobra UMA vez)
{p}cacatesouro jogar <3-13> casual   expedição por pontuação (sem aposta)
{p}cacatesouro saldo                  saldo real + estatísticas (o card mostra o botão)
{p}tigrinho saldo (fichas)            card com o saldo real + BOTÃO DE JOGAR (aposta padrão já preenchida)
{p}cacatesouro cavar <partida> A1    escava uma casa (A1..M13)
{p}cacatesouro continuar             mostra a expedição ativa
{p}cacatesouro sair                  encerra (aposta não volta)
{p}cacatesouro regras [3-13]         regras + carteira
{p}cacatesouro saldo                 carteira e estatísticas
{p}cacatesouro rapido                jogo rápido 3×3 casual (o antigo, preservado)
```

Triggers preservados: `cacatesouro`, `cacar`, `tesouro`.

Tigrinho (inalterado): `{p}tigrinho`, `{p}tigrinho jogar [valor|tudo]`,
`{p}tigrinho fichas`, `{p}tigrinho historico`, `{p}tigrinho ranking`,
`{p}tigrinho ajuda`.

### Card × texto

`utils/menuFormat.usarHtmlJogo()` é a decisão única dos jogos:

- `{p}modohtml on` → card;
- `{p}modohtml off` → **texto equivalente** (mesmos saldos, limites, regras,
  tabuleiro, comando completo) — nada de funcionalidade perdida;
- nunca configurado → card (o tigrinho já era HTML e o caça é pedido como card);
- **modo seguro** ligado (`!freio seguro on`) → nunca card (o payload é
  bloqueado por segurança), com o texto assumindo.

O menu continua sendo gerado do registro (`menus/html/*`), com o caça na
categoria **games** e o tigrinho em **rpg** — nada de lista paralela.

---

## 7. O que o card pode e não pode (limite honesto)

- O WebView do card **não tem canal de volta** para o bot (sem `fetch`/XHR/WSS
  utilizável, sem storage). Então a interface **escolhe e copia o comando**; quem
  cobra, sorteia, revela e paga é o **bot**, a cada comando recebido.
- **Copiar não é executar** — o card diz isso na própria tela.
- O card **não** recebe posições secretas, sementes nem resultados futuros: só o
  que o jogador **já** escavou (com a dica daquela casa), os contadores e o
  resultado já validado.
- Identificadores de partida **não** substituem autorização: cada ação revalida
  remetente, chat, dono da partida, coordenada (dentro do mapa), saldo, limites e
  permissões. Em grupo, ninguém joga com a carteira de outro.
- Valores dinâmicos são escapados (`betPanel.esc`) antes de entrar no HTML.
- O tabuleiro grande (13×13) monta as 169 casas no DOM e usa **setas fora da área
  do tabuleiro** para mover a janela (5×5), com o rótulo “Colunas D–H · Linhas
  4–8”, setas desativadas nos extremos e respeito a `prefers-reduced-motion`.

---

## 8. Testes (o que dá para provar aqui × o que depende do aparelho)

Automatizados:

- `test/tesouro.test.js` — **25/25**: 3..13 (parâmetros, mapa, dicas,
  coordenadas), retorno esperado ≤ aposta em 3/5/8/13 (simulação), valores
  inválidos (vazio/negativo/zero/decimal/malformado/milhar), acima do saldo ×
  acima do limite, cobrança única por ref, prêmio único, saldo nunca negativo,
  apostas simultâneas caça+tigrinho, painel no card **sem segredos e sem rede**,
  `!modohtml off` em texto, cobrança única na mensagem repetida, expedição
  simultânea, dono/coordenada/casa repetida/retransmissão, vitória, derrota,
  armadilha (−2 escavações), saldo revalidado na confirmação, carteira vazia ×
  sem cadastro (casual), falha de consulta (“—”, sem 0 inventado), sair/expirar
  sem devolução, recuperação em **processo novo**, jogo rápido preservado,
  registro/menu preservados, **jsdom**: seleção, cópia do comando, setas nos
  extremos, janela 13×13, painel validando/prévia/cópia; **aposta sem
  personagem** (carteira decide) com o resultado de CADA escavação em texto,
  **XP 5/tesouro + 20 na vitória pago UMA vez** (Lua Life) e **moldura do card**
  (livre, sem altura fixa, com o número medido dentro do card; a ordem
  casas → Escavar → progresso é conferida pelo teste).
- `test/tigrinhopainel.test.js` — **13/13**: card com carteira e sem sorteio ao
  abrir (reabrir mostra o mesmo), giro com cobrança/prêmio/estatística únicos,
  card com o resultado validado, mensagem repetida e cooldown sem giro novo,
  rodada pendente paga uma vez, rodada sem resultado devolve a aposta, recusa por
  saldo, texto equivalente com `!modohtml off`, subcomandos preservados, apostas
  simultâneas entre jogos, jsdom (painel valida/copia + card = resultado do bot),
  reinício sem perder rodada/saldo/estatística e **moldura** do card (sem altura
  fixa, botão de girar antes da tabela de prêmios, CSS dentro de `<style>` e
  divs balanceadas).
- `test/esquemajogos.test.js` — **10/10**: integridade do array `MIGRATIONS`
  (sem buracos de vírgula), as 3 tabelas com as colunas usadas, banco com
  version adiantada + tabelas ausentes **curado** na abertura, coluna ausente
  adicionada sem perder dados, os dois comandos rodando de verdade depois da
  cura, o `scripts/jogos-doctor.js` no banco problemático, **banco à frente do
  código** (migração nova roda por NOME), **banco legado sem a coluna `nome`**
  (reexecução inofensiva, sem inflar linhas), a **invariante** de que toda
  migração é `CREATE ... IF NOT EXISTS` e a **cura por medição fora dos jogos**.
- Suíte completa: `npm test` (auditoria + smokes + todos os testes, incluindo os
  três acima) e `npm run menu:check` (guarda estática do card do menu).

Depende do aparelho (não dá para provar no sandbox): o WebView do card é
**Android-only**, sem volta para o bot e sem rede — por isso o fluxo “copiar +
enviar” é o único caminho suportado, e a conferência final (toque nas setas,
cópia, animação) precisa ser feita no seu WhatsApp.

### 8.1 “Algo deu errado” nos jogos — como descobrir a causa no aparelho

Os dois comandos têm um `try/catch` que respondia a mesma frase genérica para
todo mundo. Isso foi **corrigido**: o **dono** agora recebe o motivo real **e a
linha onde falhou** (`arquivo:linha`), e o resto do grupo continua com a frase
curta. Exemplo do que o dono vê:

```
⚠️ Erro na expedição: no such table: game_bets
▸ at Object.criarExpedicao (/…/database/treasure.js:120:9)
▸ Detalhes no log (módulo tesouro).
```

Para olhar tudo de uma vez, no Termux:

```
npm run jogos:doctor          # = node scripts/jogos-doctor.js
```

O doctor **não envia nada no WhatsApp** (usa um socket falso e um chat de teste)
e mostra: node, caminho do banco, **version** de `schema_migrations` **e quantas
migrações o código tem**, as tabelas
`game_bets`/`treasure_games`/`game_rounds` com as colunas, o estado do
`menu_html`/modo seguro, e executa `!cacatesouro`, `!cacatesouro 3`, `!tigrinho`
e `!menu` registrando **o erro completo com stack**, **a moldura de cada card
enviado** (linha `moldura: LIVRE (cresce com o conteúdo, nada é cortado)` nos
jogos e `moldura: FIXA 640px ... + #__wrap ok` no menu) e “card enviado” quando está tudo certo). Salva o relatório em `tmp/jogos-doctor.txt`.

**Causa tratada de forma automática — três garantias independentes.**

1. **A migração é identificada por NOME** (`v1..vN`), não pelo número. `version`
   continua na tabela (é o índice + 1), mas quem decide o que falta é a coluna
   `nome`, criada no `open()`. Num banco cuja `version` esteja **adiante** do
   código (banco vindo de outro deploy/revisão — o do aparelho estava em 38 com
   o código tendo 36), a migração nova deste código **roda do mesmo jeito**: se o
   número já estiver tomado por outra linhagem, ela entra com o próximo número
   livre. É isso que impede o problema de voltar na próxima migração.
2. **O esquema é conferido por MEDIÇÃO** (`ensureEsquemaReal()`, no `open()`):
   as tabelas e colunas declaradas nas migrações são comparadas com as que
   existem de verdade (`sqlite_master` + `PRAGMA table_info`) e o que faltar é
   criado — tabela com o MESMO `CREATE TABLE IF NOT EXISTS` da migração, coluna
   com o mesmo tipo/DEFAULT. Nada é apagado, renomeado ou sobrescrito.

3. **A consulta que pedir tabela/coluna ausente se cura na hora** (`prepare()`,
   em `database/database.js`): se o `prepare` de QUALQUER consulta falhar com
   `no such table`/`no such column`, o esquema é refeito por medição
   (`ensureEsquemaReal()`) e a consulta roda **de novo**. Antes disso, um único
   `no such table` derrubava o comando inteiro no meio do jogo com
   “⚠️ algo deu errado” — foi o visto no aparelho (`no such table:
   treasure_games` na caça, `game_rounds` no tigrinho). Também cobre tabela
   apagada por fora/backup antigo, não só a abertura do bot. A cura é
   memoizada (uma consulta que continuar falhando por erro de verdade não cura
   em laço).

Por que reexecutar migração é seguro: **todas as 36 são só
`CREATE TABLE/INDEX IF NOT EXISTS`** (nenhum `ALTER`, `DROP`, `INSERT`, `UPDATE`
ou `DELETE`) — a suíte trava isso em `test/esquemajogos.test.js` (teste 9). Numa
atualização de banco antigo (sem a coluna `nome`), as migrações são reexecutadas:
o que já existe não muda e o que faltava nasce. A primeira abertura com este
código **não apaga nem reescreve nada**.

Cobertura: `test/esquemajogos.test.js` **11/11** (banco novo, banco à frente,
banco legado sem `nome`, coluna ausente de tabela comum, comandos rodando depois
da cura, doctor, a invariante das migrações e a **cura na consulta** com as
tabelas dos jogos apagadas em pleno uso).

Fumaça de ponta a ponta com as 3 tabelas apagadas antes de jogar
(`node tmp/fumaca-jogos.js`): caça aposta 100 e devolve card, tigrinho gira e
credita, e as 3 tabelas voltam sozinhas — nenhum “algo deu errado”.


---

## 9. Onde ajustar

- Faixa de RTP, bônus, tesouros/armadilhas/escavações por tamanho:
  `utils/treasureGame.js` (`RTP_BASE`, `BONUS_VITORIA`, `configDoTabuleiro`).
- Mínimo/máximo por jogo e todos os textos de recusa: `utils/gameWallet.js`
  (`JOGOS`, `MOTIVO`) — hoje `min: 1`, `max: null` (o máximo é o saldo).
- Textos e regras mostrados antes de confirmar: `utils/betPanel.js` +
  `regrasDoJogo()` de cada comando.
- TTL da expedição: `database/treasure.js` (`TTL_INATIVA_MS`).
- Esquema do banco dos jogos: `database/database.js` (`GAME_TABELAS_SQL`,
  `GAME_INDICES_SQL`, migração 36 e a auto-cura `ensureGameSchema()`);
  a cura na hora de qualquer consulta fica no `prepare()` do mesmo arquivo.
- Diagnóstico no aparelho: `scripts/jogos-doctor.js` (`npm run jogos:doctor`).
