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
> **Menu maior e mais denso (esta versão):** o card passou de 520 px para
> **640 px** de altura, com fonte ~15% maior — e, o que mais importa, cada
> cartão de comando caiu de **163 px para 110 px**: aparecem **~3 comandos por
> tela** (antes 1 e meio) e o **primeiro comando fica inteiro ao abrir**, sem
> precisar rolar. O que limitava, o que dá e o que não dá para aumentar estão em
> **§2.2** — inclusive o limite que é do aplicativo, não do bot.
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
- **Altura do card**: `MENU_HTML_HEIGHT` (padrão **640 px**, faixa 240–900) em
  **px fixo** — nunca unidade de viewport. Quem encolhe para caber é o cliente,
  em runtime (`encaixar()`, com guarda). Ver §2.1 e §2.2.

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

### 2.2 Tamanho do card: o que limita e onde ajustar

Todos os números de tamanho vivem em **`menus/html/dimensoes.js`** — uma escala
(`ESCALA`, padrão `1.15`) e a tabela `DIM`. Mudar o tamanho do menu é mudar ali:
o CSS (`styles.js`), a trava de altura (`templates.js`) e o JS do cliente
(`client.js`, guarda do encaixe e `body.curto`) leem do mesmo lugar.

**O que o card recebe hoje** (medido no Chromium a 360 px de largura, card na
altura declarada):

| Medida | Antes | Agora |
|---|---|---|
| altura do card | 520 px | **640 px** |
| área de comandos (`#lua-list`) | 264 px (51% do card) | **430 px (67%)** |
| **cartão de comando** | 163 px | **110 px** |
| **comandos visíveis por tela** | ~1,3 | **~3** |
| moldura (cabeçalho + faixa + busca) | 256 px | **202 px** |
| fontes (corpo / comando / descrição / categoria) | 15 / 14 / 13 / 13 px | **17 / 16 / 15 / 14 px** |
| alvo de toque (Usar, abas, busca) | 44 px | **55 px** (Usar no cartão: 53 px) |
| setas ↑↓ / ← → | 48×56 / 44 px | **48×60 / 46 px** |
| largura máxima (tela grande) | 640 px | **720 px** (no celular: 100% da bolha) |
| respiro da moldura (`#__wrap`) | 12 px lateral / 28 px fundo | **8 px / 8 px** |

Numa área menor (quando o aplicativo dá menos que os 640 px pedidos), o card
entra em **modo denso** (`alturaCurta = 480`) e mantém o comando inteiro visível:
com 430 px de área, a lista fica com 273 px e o cartão com 87 px; com 300 px, a
lista fica com 143 px e o cartão com 87 px (capacidade de toque preservada).

**O que LIMITAVA o tamanho (e o que dá para fazer):**

1. **A altura era escolhida no CSS — e estava em 520 px.** O tamanho da área
   externa do card **não tem campo no payload**: a primitiva carrega só
   `payload`, `url` e `trusted_sources`. O helper de referência do formato faz
   exatamente o que fazemos aqui: injeta `<style>html,body{height:NNpx}</style>`
   antes do HTML (`lockHeight`). Ou seja: **o único controle real da altura é o
   px declarado** — e agora ele é 640 (ou `MENU_HTML_HEIGHT`).
2. **A moldura comia metade do card.** Cabeçalho, faixa de categorias e busca
   somavam 256 px de 520. Agora somam 244 px de 640 — e o que cresceu foi só a
   lista.
3. **A fonte e os toques eram pequenos para o dedo**: 13 px de descrição e 44 px
   de alvo. Subiram para 15 px e 55 px com a `ESCALA`.
3b. **O que mais pesava (e a queixa “nem 1 comando direito”): o cartão e o topo
   da lista.** Cada cartão tinha 163 px — um botão “Usar” de 55 px numa coluna
   própria, descrição de várias linhas — e, antes do primeiro comando, vinham
   **120 px** de título da categoria + descrição + aviso de corte. Junto, isso
   dava um comando e meio por tela. Agora: o “Usar” fica **na linha do nome** (a
   descrição usa a largura toda), a descrição é limitada a **2 linhas** (o texto
   completo aparece no painel do “Usar”), a categoria virou **uma linha**
   (título + contagem + descrição com reticências), o **aviso de corte mudou para
   o rodapé** (fim da lista) e o cabeçalho ficou em **duas linhas**. Cartão:
   163 → **110 px**. Topo da lista: 120 → **46 px**.
4. **Só uma categoria cabia na faixa.** O contador por aba (`34`) ocupava a
   largura de meia aba; ele saiu da faixa (o número continua no título da seção,
   “GERAL **30 COMANDOS**”). Com abas mais justas, **duas categorias inteiras**
   aparecem de uma vez a 360 px (e a terceira “espia”), com `←`/`→` para as
   demais.
5. **O limite que é do aplicativo:** o card não pode ser mais alto que a área
   que o WhatsApp desenha na conversa. Esse teto é do host — não temos como
   medir daqui nem como passar por cima dele. Por isso: (a) a altura é pedida em
   px e o cliente **mede em runtime** (`encaixar()`), encolhendo quando a janela
   medida é plausível e menor; (b) nada no layout depende de viewport (a regressão
   do “quadradinho” veio justamente de `100vh`); (c) o excedente vai todo para a
   lista, que é a parte útil.

**O que NÃO foi usado (de propósito):** `transform: scale()`, `zoom`, altura em
porcentagem e altura em `vh`. O tamanho é resolvido em dimensões reais do
layout, com `flex` (cabeçalho/faixa/busca fixos, lista com o resto) e px.

**A área real aparece sozinha quando o aplicativo limita o card:** se o WebView
der menos que os 640 px pedidos, o **rodapé mostra** `▸ área do card aqui: 512px
(pedido 640px) — é o que o aplicativo desenha`. Para ver o número a qualquer
momento (e também quando a área for igual à pedida), **toque no nome da
categoria no cabeçalho** (ex.: “⚙️ Geral”) ou no título da seção: aparece
`📐 área do card aqui: …`. Me diga esse valor e eu ajusto a altura para o máximo
que couber **no seu aparelho** — o card nunca pede mais do que a área que o
aplicativo desenha (§2.2, item 5).

**O card NÃO pede resize ao host** (era o que encolhia o card — ver §2.3). A
altura continua sendo o px declarado no CSS; a única coisa que o card faz com a
área recebida é *medir* (e só encolher dentro do piso, §2.3).

**Onde ajustar depois:** `menus/html/dimensoes.js` → `ESCALA` (texto e toque:
`1.0` volta ao tamanho anterior, `1.3` é bem grande), `altura` (padrão 640),
`alturaCurta` (quando o topo aperta), `larguraMax`, `toque`, `snav`,
`tabAltura`, `folgaLateral`/`folgaInferior`, `passo`. Sem editar código:
`MENU_HTML_HEIGHT` (altura) e `MENU_HTML_STEP` (passo das setas) — §3.

### 2.3 Regressão 24/09 — “o menu voltou a ficar muito pequeno encolhido”

**O que aconteceu.** O card apareceu no aparelho com ~244 px de altura (cabeçalho
em modo denso, quase nenhum comando visível). Não era tamanho declarado (640 px):
era o **encaixe em runtime** (`encaixar()`) aceitando uma medição pequena e
*travando* o card ali.

**Como foi reproduzido** (`node tmp/repro-menu.js`, jsdom, com um host que
responde ao pedido de altura como um WebView Android responde — interpretando o
número em px do aparelho e redimensionando a view):

```
host recebeu updateSize(640) → área do card virou 244px CSS (dpr 2.625)
logo depois do load        area= 244px  html.height= 244px  curto=true
depois de 2 interações     area= 244px  html.height= 244px  curto=true   ← travado
```

O encadeamento: `encaixar()` chamava `AndroidBridge.updateSize(640)` → o host
redimensionava a view (640 px *do aparelho* = 244 px de CSS num dpr 2.625) →
`resize` → `encaixar()` media 244 px, considerava “plausível” (≥ 240) e gravava
`html/body{height:244px}`. Como só encolhe, **nunca voltava**. O pedido à ponte
saiu no `4b83a5f` (densidade) junto com o resto.

**Correção (o que mudou):**

1. **Nenhum pedido de resize ao host.** A unidade que `AndroidBridge.updateSize`
   espera (px de CSS? dp? px físico?) **não é verificável** daqui — pedir com a
   unidade errada *encolhe* a view. A altura mora no CSS e pronto; é a mesma
   decisão do helper de referência do formato, que só injeta `height` no HTML.
2. **Piso de encolhimento** (`alturaEncolhidaMin`, 480 px): medida abaixo disso é
   **ignorada** — o card fica na altura declarada e o host corta/rola o excedente
   (limite do aplicativo). Antes: 244 px aplicava.
3. **Medida estável** (`medidasEstaveis`, 2): encolher só com a **mesma** medida
   repetida — uma leitura isolada pode ser a animação de abertura da view. Crescer
   de volta para a altura declarada é imediato (nunca fica preso pequeno).

**Testes que impedem a volta** (`test/menuhtml.test.js`, bloco 20m — roda com
jsdom): medição de 1 px não encolhe; **244 px (< piso) é ignorada**; medida válida
de 560 px só encaixa **na segunda leitura igual**; 900 px volta à altura declarada.
O bloco 20q garante que **nenhum** `updateSize` é chamado, e o rodapé continua
mostrando a área real quando o aplicativo limita.

**Onde ajustar (um lugar só):** `menus/html/dimensoes.js` → `altura` (640),
`alturaEncolhidaMin` (480), `medidasEstaveis` (2), `alturaCurta` (480), `ESCALA`.
Sem editar código: `MENU_HTML_HEIGHT` e `MENU_HTML_STEP` (§3).


---

### 2.4 A moldura é a mesma para o menu E para os jogos (caça/tigrinho)

A regra de altura fixa (e o histórico da regressão com `vh`) mudou para
`menus/html/moldura.js`:

- `alturaDoCard()` — número único (`dimensoes.js`, com `MENU_HTML_HEIGHT`
  sobrescrevendo). O card do menu, o painel do caça e o card do tigrinho usam
  **esse mesmo** número;
- `css(altura)` — as regras `html,body{height:NNNpx;max-height:NNNpx;
  overflow:hidden}` + `#__wrap` (contêiner de altura cheia);
- a rolagem fica **dentro** do card (`.wrap` com `overflow-y:auto`), nunca na
  página: o gesto de arrastar na página viraria “responder” no WhatsApp.

Os cards dos jogos usavam só CSS próprio, **sem altura declarada** — e o WebView
do card se dimensiona pelo conteúdo quando não há altura em px. Resultado no
aparelho: o card saía minúsculo (“encolhido”). Agora os três cards declaram a
altura e o `npm run jogos:doctor` confere isso em cada card enviado (linha
`moldura: altura fixa 640px + #__wrap ok`).

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
| `MENU_HTML_HEIGHT` | `640` | altura do card em px (240–900); o card ainda encolhe se o WebView for menor (ver §2.2) |
| `MENU_HTML_STEP` | `0.7` | quanto cada toque das setas anda, como fração da área visível (aceita 0.05–1) |
| (sem env) `alturaEncolhidaMin` | `480` | **piso do encolhimento** em `menus/html/dimensoes.js`: medida de área abaixo disso é ignorada (o card não vira selo) — §2.3 |

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
| Existe ponte `HTML → bot`? | **Não.** O card não chama nenhuma ponte nativa (não pedimos resize — §2.3) |

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

**Testado em sandbox** (`node --check`, `test/menuhtml.test.js` **40/40**,
suíte completa `npm test` **331 ✅ / 0 ❌** — inclui auditoria, smokes,
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
- **tamanhos centralizados** em `dimensoes.js`: teste **20n** confere que a
  altura declarada, as fontes escaladas, o alvo de toque e a largura máxima do
  card são exatamente os valores daquele arquivo (mexer no tamanho em outro
  lugar não passa);
- **densidade**: teste **20p** exige o “Usar” na mesma linha do nome (cartão
  baixo), a descrição limitada por CSS, a categoria em uma linha e **nenhum
  aviso de corte antes do primeiro comando**; **20q** confere o aviso de corte
  no rodapé e que o pedido de altura ao host é único e usa a altura declarada;
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
avisa e sai sem falhar): **89 verificações, 0 falhas**, com o card principal
(265 comandos), nas alturas **640 px (a declarada), 520, 430 e 300**:

- **guarda estática** (roda sempre, sem navegador): altura do card em px fixo,
  sem `vh`/`min()`/`calc()`; nenhuma `@media` de altura de viewport; altura
  declarada ≥ 240 px;
- **tamanho/legibilidade** (o pedido “menu maior”): moldura ≤ 260 px de
  orçamento (medido: 202 px), **área de comandos = 430 px / 67% do card**,
  fontes 17/16/15/14 px, alvos de toque ≥ 46 px, **2 categorias inteiras** na
  faixa, nenhum botão “Usar” passando da borda da lista;
- **densidade** (o pedido “ver os comandos”): **primeiro comando inteiro ao
  abrir** (sem rolar) em **todas** as alturas testadas — inclusive 430 e 300 px —,
  cartão ≤ 120 px (medido 110 px; 87 px em modo denso) e **~3 comandos por tela**
  no card de 640 px;
- **faixa de categorias de ponta a ponta**: `→` até a **última categoria**
  (inteira, seta desativa) e `←` de volta à primeira (inteira, seta desativa);
- em **640, 520, 430 e 300 px** de altura: a lista cabe no WebView e **rola de
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

**Não verificado em aparelho** (jsdom não tem layout): os testes de rolagem e de
tamanho da suíte (`20a`–`20q`) usam **geometria simulada** — altura/largura visível e total
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
6. quanto o WebView do WhatsApp dá de **altura real** ao card: o card **pede**
   640 px e isso foi verificado num navegador comum (Chromium), **não** no
   WebView do WhatsApp. Se o aparelho der menos que isso, o cliente encolhe em
   runtime (`encaixar()`) — o card fica do tamanho da área que o aplicativo
   desenhar, e não há como forçar mais que isso de dentro do bot (§2.2, item 5);
7. a largura real da bolha: no celular o card usa 100% dela (e a faixa mostra 2
   categorias inteiras a 360 px). Em tela larga, `larguraMax` (720 px) limita.

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
- Os **jogos com aposta** (🗺️ caça ao tesouro e 🐯 tigrinho) usam a mesma decisão
  por `menuFormat.usarHtmlJogo()`: `!modohtml on` → card; `!modohtml off` → texto
  equivalente; **nunca configurado** → card (o tigrinho sempre foi HTML e o caça
  é pedido como card); modo seguro → texto. Os cards de jogo têm painel próprio
  (`utils/betPanel.js`, compartilhado) e não entram no teto do menu — são
  enviados por comando, não como menu. Ver `JOGOS-APOSTA.md`.

---

## 9. Arquivos desta funcionalidade

**Novos**

| Arquivo | Papel |
|---|---|
| `utils/menuFormat.js` | decisão única do formato (ligado/desligado, modo seguro, `--texto`, fallback) |
| `menus/html/index.js` | monta e envia o documento; altura fixa, teto de tamanho e corte adaptativo |
| `menus/html/dimensoes.js` | **todos os números de tamanho** do card (escala, altura, largura, alvos de toque, folgas) — um lugar só para ajustar (ver §2.2) |
| `menus/html/data.js` | categorias e comandos vindos do registro |
| `menus/html/actions.js` | **regras do “Usar”**: lê os argumentos do `usage`, valida, monta o comando, deriva requisitos e avisos (funções puras, testáveis sem DOM) |
| `menus/html/templates.js` | templates: principal, admin, membros, categoria + as duas telas (lista/painel), os contêineres de rolagem com as setas e a trava de altura (px fixo, sem unidade de viewport) |
| `menus/html/components.js` | cartões, abas, seções, cabeçalho/rodapé, escapagem |
| `menus/html/styles.js` | CSS (variáveis do tema atual do bot; fontes e alvos de toque vindos de `dimensoes.js`; transições curtas) |
| `menus/html/client.js` | JS do card: abas, busca, painel do “Usar”, validação, prévia, cópia, “Voltar” com estado preservado, a **rolagem programática** das setas (limites, estados, passo) e o **encaixe de altura em runtime** (`encaixar()`, com guarda de 240 px) |
| `commands/general/modohtml.js` | comando `!modohtml` |
| `test/menuhtml.test.js` | 38 verificações desta funcionalidade (18 sem navegador + 20 de DOM com jsdom: “Usar”, navegação, setas de rolagem, encaixe de altura com guarda e os tamanhos centralizados) |
| `scripts/menu-scroll-check.js` | verificação OPCIONAL de layout num navegador de verdade (`npm run menu:check`): **guarda estática** (sempre roda: altura em px fixo, sem `vh`, sem `@media` de altura) + 4 alturas de janela + **viewport degenerada (60 px/1 px)** + **tamanho/legibilidade** (área de comandos, fontes, alvos de toque, categorias visíveis, botões dentro da lista); foi ela que pegou o corte do fim da lista, a barra de setas fora da tela e o colapso do card |

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
