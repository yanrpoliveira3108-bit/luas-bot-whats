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

**Comandos:**

```
!freio                     → painel (limites, fila, warmup, restrições detectadas)
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
