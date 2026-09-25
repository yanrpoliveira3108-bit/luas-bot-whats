# Apagar mensagem e comandos de dono (25/09/2026)

Duas correções pedidas juntas: as **regras de apagar mensagem** e os **comandos de
dono** que negavam o próprio dono.

---

## 1. `{prefix}apagar` — regras por cargo

| Quem manda | O que consegue apagar |
|---|---|
| **DONO** | qualquer mensagem (grupo ou privado) |
| **ADMIN do grupo** | qualquer mensagem do grupo |
| **MEMBRO comum** | somente a **própria** mensagem |

Formas de uso:

- **Respondendo/citando** uma mensagem → apaga aquela mensagem (regra da tabela);
- `!apagar @usuario 10` → **admin/dono**: apaga as 10 últimas do usuário
  (histórico do bot: 50 mensagens por pessoa, TTL de 30 min; é o mesmo histórico
  usado pelos antis);
- `!apagar` sem marcar nada:
  - **membro** → apaga a **última mensagem dele** (a "enviada anteriormente");
  - **admin/dono** → **não apaga nada** e explica como marcar. É de propósito:
    quem pode apagar qualquer coisa não deve perder a própria mensagem só porque
    tocou no botão do menu sem marcar.

### Detalhe da plataforma (não é limitação do bot)

Quem executa a revogação é o **bot**. Ele consegue revogar:

- as mensagens **dele** sempre;
- as mensagens de **outras pessoas** apenas quando **é admin do grupo**.

Por isso, quando o bot não é admin, o comando responde exatamente isso
("Preciso ser *admin do grupo* para apagar mensagem de outra pessoa") em vez de
falhar no servidor com um erro genérico. E mensagem de terceiro no **privado** o
WhatsApp não permite apagar — também é avisado.

Sem mensagem de erro genérica: cada recusa diz o motivo (é o que faltava para
saber *por que* não apagou).

## 2. `{prefix}d` (aliases `!del`, `!apagarmsg`, `!deletarmsg`)

Criado a pedido: apaga **somente a mensagem marcada** — nunca histórico, nunca em
lote. Regras de permissão idênticas ao `!apagar` (membro apaga a própria; admin
apaga qualquer uma). Sem mensagem marcada, cai na mesma regra do `!apagar`
(membro: a última dele; admin/dono: instrução, sem apagar nada).

As duas implementações usam **uma fonte só**:
`commands/_shared/apagarMsg.js` — nada de regras duplicadas divergindo.

## 3. Comandos de dono: por que alguns negavam o dono

A identidade do dono passa a ser aceita por **qualquer forma** que o WhatsApp
mande:

- **PN** (telefone) e **LID** — em grupo de comunidade/LID o remetente pode
  chegar só como LID; o bot converte LID → telefone pelo mapa da própria
  biblioteca (`pnPeloMapaDeLid`), com prazo de 3 s;
- **com/sem código de dispositivo** — `5511...:12@s.whatsapp.net` e
  `5511...@s.whatsapp.net:12` são a **mesma pessoa** (as duas posições aparecem,
  dependendo da origem: mensagem própria × participante);
- mensagem **enviada do aparelho do próprio bot** (`fromMe`) do **dono**: aceita
  qualquer forma que confira com `OWNER_NUMBER`.

Isso corrige as duas causas reais do "não funciona mesmo eu sendo o dono":

1. **Autorização** (`isOwner`/`isAdmin`) — agora verdadeira se qualquer forma
   confere;
2. **Sessão de confirmação** (`!reload`, `!restore`…) — o pedido "sim/não" era
   gravado com **uma** forma do remetente; se a resposta chegasse identificada de
   outra forma (LID, sem o código de dispositivo), o bot parecia ignorar o "sim".
   Agora a sessão é gravada e procurada por **todas** as formas
   (`session.setAny/getAny/clearAny/clearTodas`).

### Diagnóstico no aparelho: `{prefix}identidade`

Mostra, no chat, o que o bot viu sobre você:

```
🪪 COMO O BOT IDENTIFICOU VOCÊ
Conversa......: grupo
Você é o DONO?: ✅ sim
Admin do grupo: ✅ sim
Bot é admin...: ❌ não

Formas de identidade que chegaram
▸ *********9999 (telefone)
▸ ****7766 (LID)
▸ escolhida: *********9999

Donos configurados: 1 (*********9999)
```

- números **mascarados** (só os 4 últimos): nada de telefone completo no chat;
- quando **não** é o dono, lista as causas possíveis (número diferente em
  `OWNER_NUMBER`, LID não convertido, aparelho vinculado com outro número);
- `!identidade comandos` lista todos os comandos de dono (`!backup`, `!freio`,
  `!reload`…) e os plugins desativados — comando de dono dentro de plugin
  desativado por `!plugins off` não responde.

Comando **aberto a qualquer pessoa** de propósito: se a identidade falha, é
exatamente o dono que precisa conseguir rodar isso para descobrir o porquê.

## 4. Pausa do freio: comando de dono não fica sem resposta

A pausa automática (sinal de restrição 429) deixava o bot mudo em **tudo** menos
na conversa do dono. Duas melhorias nesta rodada:

- **Chat do dono em GRUPO** também passa durante a pausa: o chat onde ele acabou
  de falar fica liberado por 10 min (`sendGuard.noteOwnerChat`). O resto continua
  parado.
- **Acordar no ritmo certo**: quando o item do dono só estava esperando o
  intervalo (ex.: 39 ms), o agendador dormia o timer inteiro (até **60 s**) e a
  resposta ficava parada — parecia "comando que não funciona". Agora ele acorda
  no tempo do item (`nextWaitLiberado`). E item novo que chega durante a pausa
  acorda o freio na hora (`wake()`), em vez de esperar o timer do sono longo.

## 5. Como verificar

```bash
# suíte completa (inclui o novo test/apagar.test.js — 12 casos)
OWNER_NUMBER=5511999999999 npm test

# no aparelho
!identidade            # mostra como o bot te viu
!identidade comandos   # lista os comandos de dono e plugins desativados
!freio                 # estado do freio, fila e pausa
```

`test/apagar.test.js` cobre: dono apaga de outro, admin apaga de outro, membro
**não** apaga de outro, membro apaga a própria, mensagem **do bot** com
`fromMe: true` (era o campo que faltava e fazia a revogação falhar), apagar a
última sem citar, bot não-admin explicando o que falta, `!d` registrado,
identidade vinda como LID reconhecida como dono, `!identidade` com números
mascarados e a confirmação casando por qualquer forma do número.

Fonte das regras: `commands/_shared/apagarMsg.js` (apagar), `commands/admin/delete.js`
(`!d`), `commands/admin/purge.js` (`!apagar`), `commands/owner/identidade.js`
(`!identidade`), `utils/session.js` (identidade por várias formas),
`utils/sendGuard.js` (pausa).
