# 🔎 Restrição de conta — o que foi investigado, o que é fato e o que é hipótese

> Relatório do problema **"ta entrando em restrição, já perdi um número e tá pra
> perder outro"**. Aqui está: o que os dados mostram, o que **não** está provado
> (e foi retirado do caminho), o freio de envio que ficou, e como descobrir a
> causa real com `scripts/restricao.js`.

---

## 1. Correção de rumo (importante)

Na primeira versão deste relatório eu apontei os **cards HTML** (`botForwardedMessage`
/ `richResponseMessage`) e o **menu por lista/botões nativos** como a causa da
restrição. **Isso não está provado — e a evidência do dono aponta contra:**

* vários bots rodam com HTML/cards ligados e **não** caem;
* o relato inclui `!ping` — que é **texto puro** (`🏓 Pong! Latência: ...`). Uma
  mensagem de texto simples não tem como ser "payload de cliente modificado".

Então: **HTML, cards e menu interativo estão de volta como padrão**
(`SAFE_MODE=0`). O bloqueio virou opção (`!freio seguro on`), não padrão.

O que sobrou ligado é o que **não muda o conteúdo de nada**: o freio de ritmo
(fila, intervalo, teto por minuto, pausa automática).

---

## 2. Os fatos do seu caso

| Fato (do relato) | O que isso indica |
|---|---|
| `!menu` → restrição; passou; `!ping` → restrição; passou; outro comando → bloqueio | Escalonamento típico do WhatsApp: **restrição → restrição → ban**. Cada tentativa durante/logo após o aviso soma penalidade. |
| Nada de automação ligada, nada de broadcast, nada de anti-PV | O volume **não** foi o gatilho. |
| Número alternativo (secundário), pareado por código | Conta **nova/recém-pareada** + cliente não oficial. É exatamente o perfil que a moderação olha primeiro. |
| Depois, **outro número** conectado → **primeira** restrição de novo | Se um número recém-conectado cai **no primeiro comando**, o conteúdo da mensagem é a explicação mais fraca. O que os dois números têm em comum é a **conta** (nova, sem histórico, pareada num cliente não oficial), não o texto enviado. |

**Conclusão honesta:** o gatilho mais provável está na **conta/número**, não no
formato da mensagem. E o `!ping` de texto puro é a prova de que "payload
estranho" não explica tudo.

---

## 3. O que realmente derruba número (em ordem de frequência real)

1. **Número/`chip` de origem ruim** — SMS virtual, chip de terceiro, número
   reciclado. Isso restringe **com ou sem bot**. É a causa nº 1 e a mais ignorada.
2. **Conta nova (< 7 dias) automatizada** — conta recém-criada que começa a
   mandar mensagem por cliente não oficial é restringida rápido, mesmo com
   pouquíssima atividade.
3. **Re-parear o mesmo número várias vezes** — cada pareamento reinicia a
   confiança da conta; vários pareamentos em pouco tempo é sinal forte (e gera
   `429`).
4. **Mesmo aparelho/IP com vários números de bot** — o WhatsApp correlaciona.
5. **Mensagem idêntica para muita gente** (broadcast/anúncio) e **entrada em
   muitos grupos de uma vez**.
6. **Rajada de envios** (bot respondendo instantaneamente em vários grupos).
7. **Payload de cliente oficial ausente** (lista/botões nativos, cards HTML) —
   é um fator, mas como você bem observou, **não é suficiente** para explicar
   sozinho, já que outros bots convivem com isso.

Sem os logs, ninguém — eu inclusive — consegue dizer qual desses foi. Com os
logs, dá para eliminar hipóteses uma a uma: é o que a seção 4 resolve.

---

## 4. Como descobrir a causa real do SEU caso

### 4.1 Auditoria dos logs

```bash
node scripts/restricao.js              # últimos 7 dias
node scripts/restricao.js --dias 30
node scripts/restricao.js --arquivo logs/lua-2026-09-20.log
```

Ele lê `logs/lua-*.log`, `logs/baileys-*.log` e `data/sends.jsonl` e mostra:

1. **Histórico da conta**: quantos pareamentos, quantos logins novos, quantas
   quedas e por qual motivo, `429`, `loggedOut`, `connectionReplaced`;
2. **Ritmo**: pico de mensagens por minuto, conversas mais usadas;
3. **Repetição**: mesma mensagem em vários chats (assinatura de spam);
4. **Comandos** executados por hora;
5. **Sinais de restrição** já detectados pelo freio;
6. **Leitura do resultado**: lista os sinais encontrados — e diz explicitamente
   quando **não** há nenhum sinal de comportamento abusivo (o que aponta para a
   conta em si).

A partir desta versão o bot grava `data/sends.jsonl`: uma linha por envio
(horário, conversa, tipo — **nunca o conteúdo**). Isso dá o ritmo exato de tudo
que saiu, e é o que responde "o bot estava fazendo o quê?".

### 4.1.1 Um chat específico não recebe as respostas

Quando o sintoma é **"o bot faz o comando, mas a mensagem não aparece" e só num
chat**, use o doctor de conversa (somente leitura; pode rodar com o bot ligado):

```bash
npm run chat:doctor -- 120363046296961148@g.us     # ou: node scripts/chat-doctor.js <jid>
```

Ele lê a auditoria do freio, o estado (`data/sendguard.json`) e os logs, filtra
pelo chat e diz qual das três coisas aconteceu:

1. **O freio barrou** (aparece `blocked: <motivo>`) → a mensagem foi descartada
   antes de sair; a correção está acima (trava idêntica ligada por engano);
2. **O envio deu erro** → o log mostra `[SEND] sendMessage FALHOU` e o motivo;
3. **O WhatsApp aceitou** (envio sem bloqueio e sem erro) → a mensagem saiu do
   bot: a barreira está no aplicativo/grupo (bot sem direito de postar,
   membro restrito, ou outro bot apagando mensagens).

A partir desta versão o log de comando também traz o `chat` — sem isso não dava
para separar as conversas no relatório.

### 4.1.2 Caso real (25/09) — "o bot faz o comando e não manda mensagem"

Relato: num grupo específico (comunidade/LID) o bot **executava** os comandos
(adicionar número, fechar/abrir grupo, hidetag, menu, tigrinho) e **nenhuma
mensagem aparecia**. O doctor de conversa respondeu com dado do aparelho:

```
1) O QUE O FREIO FEZ COM ESTE CHAT
   Envios ACEITOS  : 29        ← o bot ENTREGOU em outros momentos
   Envios BARRADOS : 0         ← o freio NÃO era a causa aqui
3) LOGS
   Comandos recebidos : 13     ← os comandos chegavam
   Falhas de envio    : 56     ← Cannot read properties of undefined (reading 'toString')
```

Leitura: o comando rodava, e a **montagem da mensagem** (citação/contexto) quebrava
com `TypeError` — a resposta nunca saía. Duas proteções entraram:

1. **Reenvio sem citação.** No ponto único de saída (`utils/sendGuard.js`, que
   envolve `sock.sendMessage`) um erro de MONTAGEM (TypeError/`Cannot read
   properties…`) faz o envio ser repetido **sem o `quoted`** — o texto, as
   menções, o menu, a lista e o card vão do mesmo jeito; só o "responder citando"
   é abandonado. Erro de **entrega** (rede/status/Boom) **não** é repetido: pode
   ter saído, e repetir duplicaria.
2. **Evidência no log.** A falha escreve `frame` (arquivo:linha), `stack`,
   `tipo` do envio e `quotedLid` (se a mensagem citada vinha de um participante
   `@lid`) — sem isso, "não aparece nada" no aparelho vira adivinhação. O
   `npm run chat:doctor <jid>` mostra a **assinatura de erro** (módulo +
   mensagem + primeiro frame) agrupada e contada.

Travas: `test/sendfallback.test.js` (4 cenários — reenvio em texto, reenvio no
menu/lista, sem reenvio em erro de entrega, e o log com stack + `quotedLid`).

### 4.1.3 "Fica escrevendo e não manda nada" — ENVIO PENDURADO (25/09/2026)

Segundo relato do dono, no MESMO grupo (`120363046296961148@g.us`), já com o
freio corrigido:

> "o bot fica escrevendo infinitamente no chat, isso que acontece, mas quando
> não tinha o delay ele também não respondia, mas agora ele fica escrevendo e
> não manda nada, mesmo que no terminal apareça o comando, e ele faça o que o
> comando pede, não aparece no chat do grupo"

A pista decisiva é o **"escrevendo"**: a presença (`composing`) CHEGA ao
WhatsApp (o "digitando…" aparece), mas nenhuma mensagem sai. Ou seja: conexão
boa, comando executando, **envio pendurado** — pendurado não é erro, nenhum
`catch` pega, e como o freio esperava esse envio, a fila inteira ficava parada.

A causa está no caminho do envio da BIBLIOTECA (`vendor/boruto-vk7-baileys`):
para montar a mensagem de grupo ela precisa da lista de participantes e faz

```
let groupData = ... await cachedGroupMetadata(jid)      // messages-send.js:837
else groupData = await groupMetadata(jid)              // ← consulta SEM prazo
const groupMetadata = async (jid) => groupQuery(jid,'get',[...])  // groups.js:24
```

Se o servidor não responde essa consulta (acontece em comunidade/LID), a
promessa **nunca resolve**. Correções desta versão, em quatro camadas:

| camada | onde | o que faz |
|---|---|---|
| cache de metadados | `utils/groupMetadataCache.js` (novo) + `makeWASocket({cachedGroupMetadata})` | o envio de grupo usa metadados guardados (TTL 5 min) e **não faz a consulta**; vencido renova em segundo plano; frio busca **com prazo**; cache aquecido na conexão (`groupFetchAllParticipating`) |
| prazo de envio | `utils/sendGuard.js` (`SEND_TIMEOUT_MS`, 45 s) | envio que não conclui não pendura mais: registra, libera a fila e **reenvia UMA vez sem citação** (com os metadados já em cache). Sem metadados do grupo, **não reenvia às cegas** |
| presença | `utils/antiBan.js` (`encerrarPresenca`) | o "digitando…" é SEMPRE desfeito (`paused`) — era isso que ficava eterno |
| diagnóstico | `scripts/chat-doctor.js` §3.2 + `!freio` | conta e mostra "envios travados (sem resposta)"; a auditoria ganhou `fim`/`travou` por envio (antes só registrava a ACEITAÇÃO, então um envio pendurado parecia entregue) |

Travas: `test/sendhang.test.js` (6 cenários — travamento com prazo + reenvio sem
citação + fila andando, grupo sem metadados que não é reenviado, presença
encerrada, cache quente/vencido/travado).

**Como distinguir os dois defeitos (o doctor responde os dois):**
* envio BARRADO → §1 "Envios BARRADOS > 0" (freio; `!freio bloqueios`);
* erro de MONTAGEM (TypeError) → §3.1 (reenvio sem citação);
* envio PENDURADO → §3.2 / `!freio` "Envios travados (sem resposta)".

### 4.1.4 CAUSA RAIZ (confirmada no aparelho) — participante sem id derruba o envio

O doctor do aparelho (25/09/2026, grupo `120363046296961148@g.us`) entregou o
primeiro frame do stack, e com ele a causa exata das 65 falhas de envio:

```
at NodeCache.formatKey (…/node_modules/@cacheable/node-cache/dist/index.cjs:509:16)
```

A cadeia, linha por linha:

| # | onde | o que acontece |
|---|---|---|
| 1 | `vendor/…/Socket/groups.js:346` | grupo em **modo LID**: o participante é montado como `id: attrs.phone_number`. Sem esse atributo no nó → **`id` = `undefined`** |
| 2 | `vendor/…/Socket/messages-send.js:243` | o envio faz `jidDecode(jid)` e `decoded?.user`. `jidDecode(undefined)` → **`undefined`** (`WABinary/jid-utils.js:21-25`, não tem `@`) → `user` = `undefined` |
| 3 | `vendor/…/Socket/messages-send.js:274` | **`userDevicesCache.get(undefined)`** → `NodeCache.formatKey` → `key.toString()` → **TypeError: Cannot read properties of undefined (reading 'toString')** |

Consequência: **todo** envio naquele grupo falhava — inclusive o reenvio sem
citação (o erro não tem relação com a citação), e nada aparecia no chat. Não era
o freio (0 barrados), não era conteúdo, não era conexão (o comando rodava).

**Correção em 3 camadas:**

1. **Patch na biblioteca** (`vendor/…/Socket/messages-send.js`, marcado
   `[LUA-BOT-PATCH]`): destinatário sem jid decodificável é **ignorado** (com
   aviso no log) em vez de derrubar a mensagem inteira — os demais recebem.
   ⚠️ Ao atualizar o vendor, este patch precisa ser reaplicado (a marca
   `[LUA-BOT-PATCH]` facilita localizar; há teste que falha se ele sumir).
2. **Cache blindado** (`utils/safeNodeCache.js`, novo): a classe usada no
   `userDevicesCache` e no store de chaves Signal não chama `key.toString()` às
   cegas — chave ausente vira **miss** (nunca TypeError). Protege também
   qualquer outro caminho que venha a passar chave inválida.
3. **Teste de regressão** (`test/vendorfix.test.js`): prova o elo quebrado
   (`jidDecode(undefined) → undefined`), reproduz o estouro no cache original,
   prova que o blindado não estoura e que o envio segue atendendo o resto.

**Consequência relacionada (mesmo defeito, outra vítima): quem é o remetente.**
Em grupo LID a lista de participantes também pode vir sem telefone, e aí o bot
não consegue converter o remetente `@lid` para o número: `!freio` respondia
"Apenas o dono do bot pode usar este comando" vinda do próprio dono, e a
identidade (carteira/registro) mudava só por estar num grupo LID. Correção:
quando os participantes não trazem o telefone, o bot consulta o **mapa LID↔PN da
própria biblioteca** (`signalRepository.lidMapping.getPNForLID`, com prazo de
3 s) em `handlers/commandHandler.js`. O doctor mostra a contagem quando isso
acontece no chat ("LID do remetente sem telefone"). Trava: teste 7 de
`test/vendorfix.test.js`.

**"Nao funciona em chat nenhum" — as quatro causas que o diagnostico separa.**
Quando o bot para de responder em TODOS os chats (privado e grupo), a causa quase
sempre e uma destas, e nenhuma e o conteudo:

| causa | como aparece | o que fazer |
|---|---|---|
| **freio PAUSADO** | `npm run diagnostico` -> "ENVIOS PAUSADOS ate HH:MM"; `!freio` (privado) -> "PAUSADO" | esperar a pausa ou `!freio retomar`. E reacao a sinal de restricao do WhatsApp (429/`rate-overlimit`/"restricted") |
| **dois processos** | `npm run diagnostico` -> "N processos do bot ao mesmo tempo" (a sessao e a mesma -> 440, o WhatsApp derruba um e o outro) | `pkill -f "node.*index.js"` e subir UM so |
| **processo antigo** | `npm run diagnostico` -> secao 2 "O PROCESSO NO AR E DE ANTES DO CODIGO ATUAL" | reiniciar (`git pull` nao troca processo) |
| **numero restringido** | secao 3 -> "SINAL DE RESTRICAO NO LOG" (`not-authorized`/`forbidden`/429) | e do lado do WhatsApp: parar de testar por horas |

Duas correcoes entraram junto: (a) **durante a pausa, a conversa do DONO
continua sendo respondida** — antes o bot ficava mudo ate para quem precisava ver
o motivo e retomar; (b) a pausa passou a ser **registrada no estado** e
**sobrevive ao reinicio** (a decisao de pausar veio de evidencia de restricao —
voltar a enviar so porque o processo reiniciou e o que transforma restricao
temporaria em banimento). Trava: teste 16 (`test/sendguard.test.js`).
`npm run diagnostico` imprime tudo isso em um comando.

**Como o doctor responde cada caso:**

| sintoma | onde ele mostra |
|---|---|
| freio barrou (mensagem descartada) | §1 "Envios BARRADOS" · `!freio bloqueios` |
| erro de MONTAGEM (citação) | §3.1 + "reenvio sem citação" |
| envio PENDURADO (nada sai, "digitando" eterno) | §3.2 + `!freio` "Envios travados" |
| **causa raiz do TypeError (este caso)** | §3.1 traz a pilha; a leitura aponta `NodeCache.formatKey` e a correção |

### 4.2 Teste controlado (é o que prova a causa)

```
1. Pegue UM número ANTIGO, com uso humano real (o seu principal, com conversas).
2. Rode o bot com HTML/cards LIGADOS (padrão agora) em UM grupo com 2–3 pessoas conhecidas.
3. Mande !menu e !ping2. Depois deixe rodando 24h com uso normal.
4. Resultado:
   • não caiu nada  → o gatilho é a CONTA/NÚMERO NOVO, não o payload (hipótese nº 1 e 2)
   • caiu também    → aí sim o formato volta à lista de suspeitos e a gente investiga o payload
```

Esse teste é barato, decisivo, e não depende da minha opinião nem da sua.

---

## 4.3 Sistemas unificados (não há duas proteções concorrentes)

Na mesma branch existia uma segunda camada anti-ban (`utils/antiBan.js`:
"digitando...", fingerprint de navegador, silent PV). As duas foram **unificadas**:

| Item | Qual ficou |
|---|---|
| Fila/ritmo de saída | **`utils/sendGuard.js`** (uma fila só). O `antiBan.enqueueOutbound` virou passthrough — manter os dois somava ~2s por mensagem e criava duas verdades sobre o ritmo |
| "digitando..." antes de responder | `antiBan.simulateTyping` (camada humana, complementar) |
| Fingerprint de navegador | `antiBan.getBrowserConfig` (Windows Chrome em vez de Ubuntu) |
| Online 24h | `MARK_ONLINE_ON_CONNECT=false` (menos artificial) |
| PV de estranho | `SILENT_PV` (não responde conversa casual) + bloqueio de PV frio do freio |
| Status | `!antiban` (status + dicas) · `!freio` (painel e controle) |

O guia `GUIA_ANTI_BAN.md` foi ajustado: ele afirmava que botões nativos são
causa de restrição — hoje está marcado como **fator de risco, não causa
comprovada**, coerente com o padrão devolvido.

## 5. O que ficou ligado (freio de envio) — e o que não ficou

**Ligado por padrão** (`utils/sendGuard.js`) — não bloqueia conteúdo, só ritmo:

* fila única com intervalo (**1,2 s** global, **2 s** por conversa) + jitter;
* teto de **15 msg/min** no total e **6/min** por conversa;
* mídia espera 2× mais; ordem preservada por conversa;
* **pausa automática** de tudo ao detectar `429`/"spam"/"restricted" numa falha
  de envio (15 min) — é o que impede transformar restrição em ban;
* espera de 8 s após conectar antes do 1º envio;
* **warmup**: número recém-pareado roda com limites ÷3 por 48 h;
* **PV frio**: o bot não inicia conversa com quem nunca falou com ele
  (`SEND_BLOCK_COLD_PV=0` desliga). No uso normal isso não muda nada — o bot só
  responde.

**Desligado por padrão** (ficou como opção):

* `SAFE_MODE=0` → HTML, cards, menu por lista/botões e `!sp` **liberados** (era o seu pedido);
* `SEND_DUP_MAX_CHATS=0` → `!broadcast` não é bloqueado (só respeita o ritmo).

> **Defeito corrigido (25/09) — "o bot faz o comando mas a mensagem não aparece
> no chat".** O `0` era lido como limite **1** (`Math.max(1, 0)`), então a trava
> anti-broadcast ficava **ligada no padrão**: bastava o MESMO texto ter sido
> enviado a QUALQUER outro chat nos últimos 10 minutos para o envio ser
> descartado em silêncio. O comando era executado (fechar/abrir grupo, add
> participante) e a resposta não saía — exatamente o sintoma relatado. Agora
> `0` (ou ausente) = desligado e a trava só vale com valor ≥ 2. Reprodução e
> travas: `test/sendguard.test.js` cenários 13 e 14.

**Comandos:**

```
!freio                     → painel (limites, fila, warmup, restrições detectadas,
                             envios barrados por conversa e por motivo)
!freio bloqueios           → o que o freio barrou, em cada conversa
!freio bloqueios <jid>     → detalhe de um chat ("por que não falou NESTE chat?")
!freio pausar 120          → silêncio total (use ao ver aviso de restrição)
!freio retomar
!freio warmup off          → encerra o aquecimento (número já antigo)
!freio seguro on|off       → liga/desliga o bloqueio de cards/menu nativo
```

---

## 6. Protocolo quando aparece "conta restrita"

1. **Pare de enviar.** Não reenvie a mensagem que falhou: `!freio pausar 1440` ou
   desligue o bot. Cada tentativa durante o aviso é penalizada.
2. Espere o prazo do aviso **+ algumas horas** com o número em silêncio absoluto.
3. Volte devagar: 1 grupo, poucos comandos.
4. Se cair de novo, o número está marcado: dias de uso humano (sem bot) antes de
   tentar de novo. Número muito sinalizado não volta a ser confiável.

**Número novo:**

| Tempo | O que fazer |
|-------|-------------|
| 0–24 h | uso humano no celular: conversas com contatos, 1–2 grupos. **Bot desligado.** |
| 1–3 dias | bot em 1 grupo, poucos comandos, sem automação (o warmup já aperta os limites). |
| 3–7 dias | mais grupos, ainda sem broadcast. |
| Depois | uso normal, com o freio ligado. |

---

## 7. Arquivos

**Criados**
```
utils/sendGuard.js           freio de envio (fila, limites, pausa, warmup, PV frio, auditoria)
utils/safety.js              modo seguro (opcional, DESLIGADO por padrão)
commands/owner/freio.js      !freio — painel e controles
scripts/restricao.js         auditoria de restrição (lê logs + data/sends.jsonl)
test/sendguard.test.js       10 blocos de teste do freio
data/sends.jsonl             auditoria de envios (gerado em runtime, fora do Git)
```

**Modificados**
```
config.js                    seção safety.* (SAFE_MODE=0 padrão + SEND_*)
.env.example                 variáveis novas documentadas
.gitignore                   data/
connection/connect.js        sendGuard.attach(sock) + markConnected() + warmup em pareamento novo
index.js                     init do freio, avisos no boot, noteInbound() por mensagem recebida
utils/interactive.js         bloqueio de lista/botões SÓ com modo seguro ligado
utils/richHtml.js            bloqueio de card HTML SÓ com modo seguro ligado
utils/pingHtml.js            idem
utils/buttons.js             menu interativo SÓ bloqueado com modo seguro ligado
commands/general/selectivepay.js  pagamento liberado (padrão)
commands/owner/broadcast.js  contabiliza o que o freio barrar (com SEND_DUP_MAX_CHATS ligado)
test/e2e.test.js             testa o padrão (HTML/menu liberados) E o modo seguro ligado
test/theme.test.js           idem
package.json                 suíte inclui test/sendguard.test.js
```
