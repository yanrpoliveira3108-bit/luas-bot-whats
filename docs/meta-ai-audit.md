# Auditoria Meta AI — fork `boruto-vk7-baileys`

## Classificação atual

```text
Suporte de schema/parsing: SIM
Descoberta dinâmica de bots: SIM, via getBotListV2()
Caminho de invocação reproduzível: NÃO COMPROVADO
Resposta Meta AI observada nesta sessão: NÃO
META AI protocol support: NÃO COMPROVADO
```

A presença de nomes de bot, protobuf ou uma chamada `sendMessage()` sem erro não é tratada como sucesso.

## Evidências no código da fork

| Arquivo | Elementos | Interpretação |
|---|---|---|
| `lib/Socket/chats.js` | `getBotListV2()`; IQ `xmlns=bot`, `bot v=2`, leitura de `jid` e `persona_id` | Fonte dinâmica mais segura para descobrir bots na conta; ainda precisa de runtime real |
| `lib/Socket/messages-send.js` | `relayMessage(..., { AI = false })`; `sendMessage(..., options.ai)`; nó `bot` com `biz_bot=1` apenas para entrega privada | Há um caminho interno de transporte, mas ele não prova que o destino é Meta AI nem que houve resposta |
| `lib/WABinary/jid-utils.js` | `META_AI_JID`; `isJidMetaAI`; `isJidBot` | A constante usa `@c.us`, enquanto `isJidMetaAI` só testa `@bot`; não usar nenhuma isoladamente como prova |
| `WAProto/BotMetadata/BotMetadata.proto` | `personaId`, `invokerJid`, `aiConversationContext`, `botResponseId`, `botMessageOriginMetadata` | Schema conhece metadados de bots/IA |
| `WAProto/E2E/E2E.proto` | `MessageContextInfo.botMessageSecret`, `botMetadata`, `Message.botInvokeMessage=67` | Schema e parsing suportam campos de bot; não é um builder público de invocação |
| `lib/Utils/messages.js` | normalização/desembrulho de `botInvokeMessage` | Compatibilidade de leitura/forward compatibility |
| `lib/Socket/newsletter.js` | comentário TODO relacionado a Meta AI | Não é implementação |

## Diferenciação operacional

- **Menção normal:** texto com `mentionedJid`; pode ser apenas uma menção e não ativa Meta AI.
- **Invocação especial:** exige campos/evento de bot ou mecanismo protocolar observado em captura real. Não é inferida de `mentionedJid`.
- **Feature de chat:** estado `enabled` salvo pelo LUA é apenas um helper local por chat; nunca representa estado interno do WhatsApp.

## Instrumentação adicionada

`utils/metaAi.js` implementa a base de auditoria e descoberta dinâmica; nesta fase ela não é exposta por comandos.

- resolução dinâmica pelo `getBotListV2()`;
- probe opt-in em `connection/connect.js`, no evento real `messages.upsert`;
- log `[META_AI_PROBE]` contendo somente tipos, nomes de campos, presença e JIDs com hash;
- nenhum comando `.metaai` foi criado antes da captura e confirmação protocolar.

O probe não registra texto, mídia, payload bruto nem conteúdo privado. O envio confirmado pela biblioteca continua sendo distinguido de uma resposta Meta AI confirmada.

## Pendências de captura Desktop

1. Iniciar o processo com `META_AI_PROBE=1` e produzir uma menção real ao Meta AI no WhatsApp Desktop.
2. Produzir, no mesmo contexto, uma menção de usuário comum.
3. Comparar `messageKeys`, `mentionedJids`, `contextInfo`, campos `bot*`, `ai*`, `invoke*` e participante (grupo/PV separadamente).
4. Só então decidir se existe wrapper público ou se o caminho `relayMessage`/`options.ai` reproduz o evento real.

Enquanto esses passos não ocorrerem, comandos não alegam ativação permanente nem sucesso protocolar.
