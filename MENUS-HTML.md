# Menus em HTML (`!modohtml`)

Menu interativo em **Rich HTML** enviado como card, com abas por categoria,
busca e painel de comandos — no lugar do menu tradicional em texto/listas.

O menu tradicional **continua existindo e continua sendo o padrão**. Nada foi
removido: o HTML é um formato alternativo que o dono liga quando quiser.

> **Mudou nesta versão (correção do botão “Usar”):** o botão parou de ser um
> link `wa.me` (que **não navegava** — ver §5) e passou a **montar o comando no
> próprio card, com campos, validação e avisos, para você copiar**. Leia §5
> antes de estranhar: é a limitação do formato, não uma escolha de estilo.
>
> **Corrigido no patch seguinte (altura do card):** a versão com as setas
> declarava a altura como `height:min(520px,100vh)`. No WebView do card a
> viewport acompanha o **conteúdo**, então `100vh` resolve para ~0 e, como a
> segunda declaração **sobrescreve** a primeira, o card inteiro virava uma faixa
> de 1px de altura (o “quadradinho”). A altura voltou a ser **px fixo** e o
> encaixe em janela mais baixa passou a ser feito **em runtime**, com guarda —
> §2.1 e §7 explicam como isso está travado por teste.

---

## 1. Como usar

| Comando | Quem | O que faz |
|---|---|---|
| `!modohtml` | qualquer pessoa | mostra o estado atual (ligado/desligado, escopo, motivo) |
| `!modohtml on` | **dono** | liga os menus em HTML (salva no banco) |
| `!modohtml off` | **dono** | volta ao menu tradicional (salva no banco) |
| `!menu --texto` | qualquer pessoa | força o menu tradicional **nesta** chamada, mesmo com o HTML ligado |
| `!menu --tradicional` / `--antigo` | idem | sinônimos de `--texto` |

Aliases do comando: `modohtml`, `menuhtml`, `htmlmenu`.

O que muda quando está ligado:

| Entrada | Sem `modohtml` (padrão) | Com `modohtml on` |
|---|---|---|
| `!menu` | menu tradicional | **card HTML** com todas as categorias |
| `!menuadm` / `!menumembros` / `!menudownload` … | tela de categoria | card HTML já aberto na categoria |
| `!stickers`, `!rankings`, `!config`… (telas com botões próprios) | tela própria | tela própria (ver §5) |

Depois de reiniciar o bot, a escolha **continua** (fica no banco, não em
variável de ambiente).

---

## 2. O que tem dentro do card

- **Cabeçalho**: nome do bot, categoria atual e o **prefixo real** do bot
  (lido da configuração — se o prefixo é `#`, os exemplos aparecem com `#`).
- **Abas**: uma por categoria real do bot (geral, downloads, diversão, membros,
  utilidades, stickers, IA, games, anime, RPG, admin, dono, rankings…).
- **Busca**: filtra os comandos pelo nome enquanto você digita. O índice é
  montado no próprio aparelho, a partir do texto já presente no card — não
  depende de rede.
- **Cartões de comando**: emoji, nome, **descrição** e **exemplo de uso**
  (`!ytmp3 <link>`), com etiquetas quando o comando pede contexto
  (`precisa do contexto do grupo`, `só admin`, `bot precisa ser admin`).
- **Botão `Usar`** (novo): abre um **painel dentro do card** com
  - o comando já montado (ex.: `!ytmp3`),
  - **um campo por argumento** do uso real (`<link>`, `[nome]`,
    `@usuario`, `imagem|texto`),
  - **validação** (obrigatório vazio, menção sem `@`, opção fora da lista,
    link com espaço…) e **prévia ao vivo** do comando,
  - **avisos de contexto** (precisa responder uma mensagem, precisa de mídia,
    só funciona no grupo, só admin…),
  - botão **Copiar comando** e um **Voltar** que devolve a lista **no mesmo
    lugar** (categoria, busca, rolagem e campos preenchidos preservados).
- **Setas de rolagem** (novo): `↑ ↓` ao lado da lista e `← →` nas extremidades
  da faixa de categorias. Cada toque anda **70% da área visível** (ajustável —
  ver §3) e a rolagem acontece **só no contêiner interno**: a página, o card e a
  conversa do WhatsApp não se movem. Setas desativadas (e ainda no lugar, sem
  mexer no layout) quando não há mais conteúdo naquela direção — ver §2.1.
- **Navegação local**: trocar de aba, buscar, abrir o painel e voltar **não
  recarrega o card** — é troca de tela dentro do próprio documento, com
  transição curta (~110–170 ms, desligada em “movimento reduzido”).
- **CSS e JS vão embutidos** no próprio card: nenhuma fonte, imagem ou script
  externo é carregado (isso é exigência do formato e também evita lentidão).
- **Altura do card**: no máximo `MENU_HTML_HEIGHT` (padrão 520 px) — mas sempre
  **cabendo no WebView** (`min(520px, 100vh)`). Ver §2.1: era exatamente aí que
  o fim da lista ficava cortado.

### 2.1 Rolagem por botões (↑ ↓ ← →)

Motivo: arrastar o dedo dentro da mensagem briga com os gestos do WhatsApp
(responder arrastando, por exemplo). Aqui a rolagem tem botão.

| Contêiner | O que rola | Quem comanda | Overflow |
|---|---|---|---|
| `#lua-tabs` | a faixa de categorias (eixo **X**) | `←` `→`, fixas nas extremidades | `overflow-x:auto` |
| `#lua-list` | os comandos (eixo **Y**) | `↑` `↓` na barra vertical à direita | `overflow-y:auto` |
| `#lua-panel-body` | o painel do “Usar” (eixo **Y**) | as mesmas `↑` `↓` enquanto o painel está aberto | `overflow-y:auto` |

- A **página inteira não rola**: `html`, `body` e `#__wrap` ficam com
  `overflow:hidden` — é o que evita o gesto de arrastar virar “responder”.
- **A largura também é 100% do card** (`max-width:640px` para telas grandes, com
  o conteúdo centrado). O bloco já teve `margin:0 auto` num flex em coluna: isso
  fazia o item ser dimensionado pelo **conteúdo** (~640 px) e, num WebView de
  360 px, a barra das setas e a seta `→` eram desenhadas **fora da tela** — o
  mesmo tipo de defeito do corte vertical, só que no eixo X.
- **A altura do card é px FIXO** (`MENU_HTML_HEIGHT`, padrão 520 px), declarada
  em `html`, `body` e `#__wrap`, com `overflow:hidden` — nada de `vh`, `min()`
  ou `calc()` em altura. **Regra aprendida na prática:** o WebView do card
  dimensiona a viewport pelo **conteúdo**, então `100vh` resolve para ~0 lá
  dentro; declarar `height:520px;height:min(520px,100vh)` fazia a **segunda**
  declaração vencer e o card inteiro colapsar numa faixa de 1px. Não use unidade
  de viewport em altura de card.
- **Quem encaixa em janela baixa é o cliente, em runtime:** `encaixar()` mede
  `document.documentElement.clientHeight` e **só encolhe** (nunca estica) — e só
  quando a medida é **plausível (≥ 240 px)**. Medida absurda (0/1 px, que foi
  exatamente o que produziu o colapso) é ignorada: o card mantém o px do CSS. Se
  a janela folgar de novo, ele volta à altura do CSS. Com altura < 380 px o
  cliente liga `body.curto` (aperto do topo), substituindo as antigas
  `@media (max-height:)` — que dependiam da mesma viewport não confiável.
  **Onde ajustar a altura:** `MENU_HTML_HEIGHT` (§3); a guarda de 240 px vive em
  `menus/html/client.js`, dentro de `encaixar()`.
- As setas (e o atalho **`⇱` topo**) ficam na barra lateral, **fora** da área
  que rola: nunca cobrem um comando, nunca saem de vista e não se movem quando
  o conteúdo anda. `←`/`→` ficam nas pontas da faixa, com a faixa correndo
  entre elas.
- Cada toque anda **70% da área visível** daquele contêiner — sobra um pedaço
  do que já estava na tela, para não perder o fio da leitura.
  **Onde ajustar:** o número vive em um lugar só,
  `menus/html/client.js` → `const PASSO_PADRAO = 0.7` (é ele que emite o JS do
  card); sem editar código, use `MENU_HTML_STEP` (§3). O mesmo valor serve para
  os dois eixos. Para passos mais finos (e nenhum cartão “pela metade”), `0.3`
  é uma boa pedida.
- **Toques rápidos não entram em fila**: o destino é acumulado e, quando a
  animação anterior ainda está rodando (toque a menos de ~350 ms), o novo passo
  é aplicado **na hora**. Primeiro toque anima suave; rajada anda um passo por
  toque, exato; pausa volta ao modo suave. Sem isso, 5 toques seguidos andavam
  quase nada e o fim da lista parecia inalcançável.
- Movimento **suave** quando o WebView aceita `scrollTo({behavior:'smooth'})`;
  sem suporte (motor antigo) ou com **movimento reduzido**, o deslocamento é
  **imediato** — mesmo destino, sem animação.
- `↑`/`↓` e `←`/`→` **desativam** no começo e no fim (continuam visíveis, só
  apagadas — nada de sumir e empurrar o layout). Se todo o conteúdo couber, as
  quatro ficam desativadas.
- Estados recalculados em rAF depois de **rolar** (listener passivo), **buscar**,
  **trocar de categoria**, **abrir/fechar painel** e **redimensionar**. Nada de
  consulta contínua ao DOM.
- A **posição de cada categoria é guardada**: sair para outra categoria (ou
  para o painel) e voltar devolve a lista na mesma altura. Ao escolher a
  categoria, a faixa anda **só o necessário** para deixá-la visível — e é a
  seleção que troca o menu; rolar a faixa apenas revela categorias.
- **No fim da lista** vem só um rodapé curto (~58 px, antes eram ~154 px). Numa
  janela de 520 px a rolagem termina com o **último comando e o botão “Usar”
  inteiros** na tela. Numa janela **bem baixa** (ex.: 430 px ajustado pelo
  `encaixar()`), o que aparece no fim é o rodapé: o último comando continua
  **inteiro e alcançável**, rolando um toque para cima (o cartão tem ~104 px e a
  área útil ~168 px). Se o cartão for **mais alto que a área útil** (janelas de
  ~300 px), ele não cabe inteiro por definição — a verificação cobra que ele
  esteja visível e alcançável, não inteiro. O texto completo sobre o “Usar” só
  copiar continua no painel (`.pn-tip`). Em janela baixa (`body.curto`) o rodapé
  é omitido para não comer a área rolável.
- O antigo botão “↑ Voltar ao topo”, que ficava no fim do conteúdo (só
  aparecia depois de rolar tudo), virou o atalho **`⇱`** na barra — sempre
  acessível de qualquer ponto.
- Nenhum `touchstart`/`touchmove` é interceptado e nenhum `preventDefault`
  global é usado: seleção de texto, cópia e os gestos do WhatsApp continuam
  valendo.

A lista de comandos **não é digitada à mão**: sai do registro de comandos
(`engine/plugins.js` + `commands/loader.js`). Comando novo, alias novo ou
categoria nova aparecem no card automaticamente, com os mesmos nomes e as
mesmas permissões do bot.

---

## 3. Configuração e escopo

- Chave no banco: **`menu_html`** (padrão `false` — se a chave não existe, o
  modo está **desligado**).
- Escopo: **GLOBAL**, igual a `!botao on/off` e `!tema`: vale para todos os
  chats e é alterado **só pelo dono**. Admin de grupo recebe a negativa padrão
  de dono e **não** muda a configuração de ninguém.
- A confirmação só aparece **depois** de o banco confirmar a gravação (o
  comando relê o valor antes de responder).
- Argumento inválido (`!modohtml ligado?`) é recusado e **não altera nada**.
- Com o modo **desligado**, os templates HTML nem são carregados (requisição
  preguiçosa em `utils/menuFormat.js`) — zero custo para quem não usa.

Variáveis opcionais (não precisam ser definidas):

| Variável | Padrão | Para que serve |
|---|---|---|
| `MENU_HTML_MAX_BYTES` | `120000` | teto do documento enviado; se passar, o card corta comandos e avisa |
| `MENU_HTML_MAX_PER_CAT` | `30` | máximo de comandos por categoria no card |
| `MENU_HTML_HEIGHT` | `520` | altura MÁXIMA do card em px (240–900); o card ainda encolhe se o WebView for menor |
| `MENU_HTML_STEP` | `0.7` | quanto cada toque das setas anda, como fração da área visível (aceita 0.05–1) |

O corte é adaptativo (reduz por categoria em passos até caber) e o card mostra
“Mostrando X de Y comandos” com o atalho `!menucompleto <categoria>` para ver a
lista completa pelo menu tradicional.

---

## 4. Como o card é enviado

Mesmo caminho já comprovado no bot pelo `!ping2` e `!tigrinho`
(`utils/richHtml.js` → `botForwardedMessage` → `richResponseMessage` →
`AIRichResponseUnifiedResponse`), que é o que o WhatsApp renderiza como
bloco HTML. Não é arquivo `.html` anexado, não é imagem, não é link externo e
**não é WhatsApp Flows** (botão nativo/flow não tem relação com isso).

Fluxo de decisão (um lugar só, `utils/menuFormat.js`):

```
comando de menu
   ├─ modo HTML desligado?              → menu tradicional
   ├─ MODO SEGURO ligado (bloqueia card)? → menu tradicional, com motivo
   ├─ --texto / --tradicional?           → menu tradicional
   ├─ erro ao enviar o card?             → menu tradicional (1 tentativa só,
   │                                       sem envio duplicado)
   └─ senão                              → card HTML
```

Nenhuma tela some: se o card falhar, a pessoa recebe o menu de sempre.

---

## 5. Limites honestos — por que o “Usar” copia em vez de executar

**Não existe canal do card para o bot.** A conclusão vem de duas fontes, e eu
separo as duas de propósito:

1. **relatos de quem mediu o WebView do card em aparelho** — os projetos que
   publicaram esse mesmo formato (o upstream `elaina-baileys` e a documentação
   do `@Yudzxml/Baileys`) descrevem o ambiente abaixo;
2. **o sintoma no seu aparelho** — com `!modohtml on`, o toque no `Usar` antigo
   (`<a href="https://wa.me/<bot>?text=!comando">`) não realizava a ação
   esperada.

Nós **não** conseguimos repetir a medição daqui (o sandbox do assistente não tem
o WebView do WhatsApp): o item 2 é a evidência do seu aparelho; o item 1 é
ambiente documentado por terceiros, coerente com o item 2.

| Pergunta | O que se sabe |
|---|---|
| Onde o card roda? | WebView interno do WhatsApp, em Android, com origem **opaca** (`about:`, `origin = null`) |
| Tem rede? | **Não.** `fetch`, `XMLHttpRequest`, `sendBeacon`, `<img>` remoto, `<script src>` e `<iframe>` **falham em silêncio** |
| `trustedSources` libera rede? | **Não** |
| Tem armazenamento? | **Não.** `localStorage`/`sessionStorage`/`indexedDB`/`document.cookie` lançam erro |
| Dá para navegar (`<a href="https://…">`)? | **Não conta como caminho.** No aparelho o toque não abriu o chat, e o WebView não oferece API para pedir execução |
| Existe ponte `HTML → bot`? | **Não.** A única ponte nativa exposta é `AndroidBridge.updateSize` (altura do card) |

Ou seja: o botão antigo (`<a href="https://wa.me/…">Usar</a>`) **não tinha como
executar o comando** — nem no privado, nem no grupo. Mesmo no melhor caso (o
link abrindo), ele só pré-escreveria a mensagem: quem envia é você. E no seu
aparelho nem isso aconteceu. Não era permissão, argumento, prefixo nem
listener: **não havia caminho de volta comprovado.**

**O que o card faz agora (e o que ele não faz):**

- `Usar` é um `<button>` que abre o painel local (§2): monta o comando com o
  `usage` real do registro, valida o que dá para validar e avisa o contexto que
  o card não consegue fornecer (mídia, mensagem respondida, menção).
- `Copiar comando` coloca `!comando argumentos` na área de transferência. O
  painel e o rodapé dizem isso **explicitamente**: o card **não envia** a
  mensagem, **não executa** o comando e **não tem** como saber se você colou.
- A execução continua sendo a de sempre: **você envia a mensagem**, e o bot
  revalida tudo (dono, admin, grupo, limite, moderação) comando por comando.
  Esconder o botão no card **nunca** foi controle de acesso — e não passou a ser.
- Comandos que só funcionam no grupo continuam aparecendo, agora com a etiqueta
  “precisa do contexto do grupo” e o aviso no painel — nada de botão decorativo
  que promete o que não acontece.

Telas com fluxo próprio seguem tradicionais de propósito: `!stickers`,
`!rankings`, `!config`, `!economia` e afins usam telas com botões de navegação
internos e não se encaixam no modelo de abas. Como o menu tradicional está
preservado, elas continuam funcionando igual.

Sucesso de envio **não** é o mesmo que renderização: o servidor confirma que a
mensagem saiu, o desenho do card depende do aparelho e da versão do WhatsApp
(ver §7).

---

## 6. Segurança e privacidade

- Todo texto dinâmico (nome de comando, descrição, exemplo, nome do bot) passa
  por escapagem por contexto (`escapeHtml` / `escapeAttr`) — descrição
  maliciosa não quebra o card nem injeta script.
- O card **não** contém mais o número do bot em link `wa.me`, e continua **sem**
  número de dono, token, sessão, caminho de arquivo ou qualquer credencial.
- Nenhuma ação é executada a partir de dados vindos do card: o painel só monta
  texto no aparelho; a execução passa pelo pipeline normal, que revalida
  identidade, permissão e contexto.
- Sem duplicação: o botão de copiar tem trava de toque repetido (900 ms) e não
  repete ação quando já deu certo.
- Mensagem de grupo é pública: quem vê o card vê os nomes dos comandos (o mesmo
  que já acontecia no menu de texto).

---

## 7. O que foi testado aqui × o que depende do aparelho

**Testado em sandbox** (`node --check`, `test/menuhtml.test.js` **36/36**,
suíte completa `npm test` **327 ✅ / 0 ❌** — inclui auditoria, smokes,
phone, downloads, fila de envio):

- padrão desligado quando a chave não existe;
- `on`/`off` salvando no banco e confirmando apenas após a gravação;
- persistência depois de reiniciar (lendo o banco em processo novo);
- dono altera / admin de grupo não altera / consulta liberada para todos;
- argumento inválido recusado sem alterar nada;
- prefixo dinâmico (`#` aparece nos cartões, no cabeçalho e no rodapé);
- templates de menu principal, admin, membros e categoria, todos gerados do
  registro (nenhuma lista paralela) e com nomes/aliases atuais;
- payload no formato correto (`richResponseMessage` → `unifiedResponse`,
  primitiva `GenAIaeacdsnwHtmlPrimitive`), dentro do teto
  (menu principal: **114,1 KB**, 265 de 371 comandos, com aviso de corte);
  admin 77,1 KB / 100 comandos; membros 39,1 KB / 19; uma categoria 37,5 KB / 13;
- **altura do card em px fixo, sem unidade de viewport** (a declaração é lida e
  recusada se aparecer `vh`/`min()`/`calc()`), e **nenhuma `@media` de altura**
  no CSS gerado — a regra do “quadradinho de 1px” ficou cravada no teste 8 e no
  20j, além da guarda estática do `menu:check`;
- **dois** `<style>` (trava de altura + tema) e **dois** `<script>` (envolver o
  corpo + menu), **zero** subresource remoto;
- nenhuma API morta no card (`fetch`, `XMLHttpRequest`, `WebSocket`, storage,
  `crypto.subtle`, `setInterval`, `location.href=`, `window.open` — todos
  proibidos por teste);
- **botão `Usar` é `<button>`** (nenhum `<a href>` http(s) no documento), existe
  para **todos** os comandos da categoria e carrega `data-uso` (padrão de
  argumentos) e `data-req` (requisitos) do registro;
- **DOM de verdade** (jsdom, opcional — `npm i --no-save jsdom`): painel abre
  com o comando pronto; um campo por argumento; validação bloqueia cópia com
  obrigatório vazio; prévia atualiza ao digitar; cópia chama o clipboard uma vez
  e **não duplica** em toque repetido; falha de cópia orienta o usuário;
  **Voltar** preserva rolagem e campos preenchidos; busca e troca de categoria
  preservam o estado; **toques rápidos** terminam em uma única tela, sem
  sobreposição, com o estado do último toque; `prefers-reduced-motion` troca de
  tela sem timer pendente;
- **paridade de parser**: o JS embutido no card e `menus/html/actions.js`
  produzem exatamente os mesmos campos/valores (testado com `!ytmp3 <link>`,
  `!abrirempresa <tipo> [nome]`, `!advertir @usuario [motivo]`,
  `!sticker <imagem|texto>`, `!aimemory on|off|clear|status`, `!apagar`);
- escapagem de HTML malicioso vindo do registro;
- falha de envio → menu tradicional, com **uma** tentativa (sem duplicar);
- `!menu --texto` força o tradicional com o modo ligado;
- modo seguro tem precedência e explica o motivo;
- modo desligado não carrega `menus/html`;
- `!menu` e `!menuadm` entregam o card pelo pipeline real do comando
  (`relayMessage`), sem mandar o menu de texto junto;
- **setas de rolagem** (testes de DOM com geometria simulada — ver abaixo):
  passo de 70% nas quatro direções; rolagem restrita ao contêiner interno (a
  página e a faixa não se movem quando se rola os comandos, e vice-versa);
  desativação no começo/fim e com conteúdo curto (sem sair do layout);
  `←`/`→` revelando categorias **sem** trocar de menu; seleção da categoria
  ajustando a faixa só o necessário e com a ativa marcada (aba + cabeçalho);
  posição guardada por categoria (e devolvida ao limpar a busca); 6 toques
  seguidos parando exatamente no fim; `↑`/`↓` mirando o painel quando ele está
  aberto (rótulo muda) sem mexer na lista; deslocamento imediato com movimento
  reduzido; recálculo após resize; último comando e última categoria dentro das
  áreas roláveis.

**Testado em navegador de verdade** (`node scripts/menu-scroll-check.js`, com
Chromium/`puppeteer` instalado — sem ele a guarda estática roda igual e o script
avisa e sai sem falhar): **41 verificações, 0 falhas**, com o card principal
(265 comandos):

- **guarda estática** (roda sempre, sem navegador): altura do card em px fixo,
  sem `vh`/`min()`/`calc()`; nenhuma `@media` de altura de viewport; altura
  declarada ≥ 240 px;
- em **520 px, 430 px e 300 px** de altura: a lista cabe no WebView e **rola de
  verdade** (conteúdo > área visível);
- **nada passa da largura da tela** (`document.scrollWidth == innerWidth`): a
  barra das setas fica visível e o conteúdo não é empurrado para fora;
- descendo com `↓` até o fim, a seta **desativa** e o **último comando + botão
  “Usar” ficam inteiros** na tela (em 430 px: inteiros e alcançáveis, com o
  rodapé fechando a rolagem — ver §2.1);
- **viewport degenerada (60 px e 1 px)**: é o cenário que reproduziu o
  “quadradinho” — o card mantém os 520 px declarados e a lista continua com
  264 px de área útil (a versão com `min(520px,100vh)` media 60 px de card e
  6 px de lista);
- “Usar” e **copiar funcionam depois de rolar tudo** (a cópia foi conferida com
  a área de transferência interceptada);
- o atalho `⇱` volta ao início e `↑` desativa; o primeiro comando aparece
  inteiro;
- **rajada de 5 toques = 5,00 passos** (sem fila de animação);
- as setas **horizontais** continuam movendo a faixa.

**Não verificado em aparelho** (jsdom não tem layout): os testes de rolagem da
suíte (`20a`–`20m`) usam **geometria simulada** — altura/largura visível e total
definidas à mão, `scrollTo` que aplica o destino (opcionalmente “animado”). Eles
provam a **lógica** — passo, limites, estados das setas, rajada, alvo certo —,
**não** o CSS; é justamente aí que nasceu o defeito do corte, e é por isso que
existe o `npm run menu:check`.

**Depende do seu aparelho / do WhatsApp (não dá para verificar daqui):**

1. se a sua versão do WhatsApp **renderiza** o card (envio ≠ renderização);
2. o **toque real** no `Usar`: abrir o painel, digitar, copiar e colar — o
   sandbox não tem WebView do WhatsApp nem área de transferência de verdade;
3. o **toque real nas setas** e o comportamento do gesto de arrastar dentro da
   lista (se ele ainda dispara o “responder” do WhatsApp, no seu aparelho e na
   sua versão do app);
4. se a cópia funciona no aparelho (usa a Clipboard API e cai para o método
   antigo se ela não existir);
5. velocidade de abertura em celular fraco e comportamento em conversa de grupo
   grande / WhatsApp Web;
6. quanto o WebView do WhatsApp dá de **altura real** ao card: é esse valor que
   define quantos comandos cabem na tela por vez. O layout **não** depende de
   unidade de viewport (a altura é px fixo); se a medida vier plausível e menor
   que 520 px, o cliente encolhe em runtime para caber — comportamento medido só
   em navegador, não no WebView do WhatsApp.

Se o card não aparecer bonito no seu aparelho: `!modohtml off` volta tudo ao
menu tradicional na hora — e `!menu --texto` é a saída por chamada, sem mexer
na configuração.

---

## 8. Relação com o freio e o modo seguro

- O envio do card passa pelo mesmo freio de envio (fila, atraso, limites) dos
  outros comandos: **nada de fura-fila**.
- Sua configuração atual é a padrão (HTML/cards liberados; freio só no
  volume). Se algum dia você ligar o modo seguro (`!freio seguro on`), os
  cards são bloqueados por segurança e o menu **volta sozinho** ao tradicional
  — o `!modohtml` continua marcado como ligado, e o próprio comando explica:
  “ligado, mas o MODO SEGURO bloqueia cards HTML”.
- Log de envio registra o formato usado e erro sem dados sensíveis.

---

## 9. Arquivos desta funcionalidade

**Novos**

| Arquivo | Papel |
|---|---|
| `utils/menuFormat.js` | decisão única do formato (ligado/desligado, modo seguro, `--texto`, fallback) |
| `menus/html/index.js` | monta e envia o documento; altura fixa, teto de tamanho e corte adaptativo |
| `menus/html/data.js` | categorias e comandos vindos do registro |
| `menus/html/actions.js` | **regras do “Usar”**: lê os argumentos do `usage`, valida, monta o comando, deriva requisitos e avisos (funções puras, testáveis sem DOM) |
| `menus/html/templates.js` | templates: principal, admin, membros, categoria + as duas telas (lista/painel), os contêineres de rolagem com as setas e a trava de altura (px fixo, sem unidade de viewport) |
| `menus/html/components.js` | cartões, abas, seções, cabeçalho/rodapé, escapagem |
| `menus/html/styles.js` | CSS (usa as variáveis do tema atual do bot; alvos de toque ≥ 44 px; transições curtas) |
| `menus/html/client.js` | JS do card: abas, busca, painel do “Usar”, validação, prévia, cópia, “Voltar” com estado preservado, a **rolagem programática** das setas (limites, estados, passo) e o **encaixe de altura em runtime** (`encaixar()`, com guarda de 240 px) |
| `commands/general/modohtml.js` | comando `!modohtml` |
| `test/menuhtml.test.js` | 36 verificações desta funcionalidade (18 sem navegador + 18 de DOM com jsdom: “Usar”, navegação, as setas de rolagem e o encaixe de altura com guarda) |
| `scripts/menu-scroll-check.js` | verificação OPCIONAL de layout num navegador de verdade (`npm run menu:check`): **guarda estática** (sempre roda: altura em px fixo, sem `vh`, sem `@media` de altura) + 3 alturas de janela + **viewport degenerada (60 px/1 px)**; foi ela que pegou o corte do fim da lista, a barra de setas fora da tela e o colapso do card |

**Alterados (mudanças mínimas)**

| Arquivo | Mudança |
|---|---|
| `database/settings.js` | chave `menu_html` (padrão `false`) + leitura/gravação |
| `utils/buttons.js` | menu principal tenta o HTML primeiro (se ligado) |
| `utils/menu.js` | menus de categoria usam o HTML quando aplicável |
| `commands/general/menu.js` | `--texto` / `--tradicional` / `--antigo` |
| `commands/general/menus.js` | atalhos de categoria apontam para o card quando ligado |

Nenhuma dependência nova em produção (jsdom é opcional e só para teste). Nenhum
comando, alias, permissão ou função antiga foi removido.

---

## 10. Verificação rápida (no seu aparelho)

```
!modohtml            → mostra “desligado (padrão)”
!modohtml on         → “Menus em HTML ATIVADOS”
!menu                → card com abas, busca e botão Usar
   Usar num comando simples          → painel com o comando pronto → Copiar
   Usar em comando com argumentos    → campos + validação + prévia → Copiar
   trocar de aba, buscar, abrir/fechar o painel → abre na hora, sem recarregar
   setas ↑ ↓ na lista            → anda ~70% da tela, sem mexer no card/chat
   segurar o dedo e tocar rápido → anda um passo por toque, sem "arrastar" atrás
   ⇱ na barra                    → volta ao topo de qualquer ponto da lista
   descer até o fim              → último comando + "Usar" inteiros na tela
   setas ← → nas categorias      → revelam categorias; o menu só troca ao tocar
   chegar no fim / no começo     → a seta correspondente fica apagada (desativada)
   categoria que cabe inteira    → ← e → ficam apagadas, sem mexer no layout
!menu --texto        → menu tradicional continua disponível
!modohtml off        → volta ao tradicional
!modohtml on         → liga de novo
# reinicie o bot
!modohtml            → continua ligado (persistiu)
```

Se quiser ver o card sem aparelho (só para conferir layout em navegador comum —
o que **não** prova compatibilidade com o WhatsApp): gere o preview com o
gerador de teste ou abra `!menu` no aparelho.
