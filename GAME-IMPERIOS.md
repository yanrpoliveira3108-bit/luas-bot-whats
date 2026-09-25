# Lua: Impérios

Jogo web solo de estratégia territorial. O navegador envia intenções; o servidor valida e calcula construções, recrutamento, movimento, combate, diplomacia, turno e IA.

## Execução local

Em um terminal:

```bash
LUA_GAME_URL=http://127.0.0.1:8787 node game/server.js
```

O servidor escuta em `0.0.0.0:8787` por padrão. Para acesso externo, configure um domínio HTTPS/proxy reverso e use:

```bash
LUA_GAME_URL=https://seu-dominio.example node game/server.js
```

A campanha é persistida atomicamente em `tmp/lua-imperios.json` (ou em `LUA_GAME_DATA`). O arquivo não deve ser exposto pelo servidor web.

## Acesso pelo bot

Com o servidor de jogo ativo e `LUA_GAME_URL` configurado, envie no privado:

```text
,imperio
```

O comando real é `,imperio` e o alias `,imperios`. Em grupos ele não expõe ticket: orienta o solicitante a abrir o comando no privado. Tickets são aleatórios, expiram em 10 minutos e só são consumidos na troca POST por uma sessão.

## Primeira versão

- 36 províncias fixas e adjacência compartilhada entre mapa e regras.
- 4 nações, com escolha inicial e três adversários.
- Mercado, Quartel e Fortaleza.
- Recrutamento, movimento, ataque e resolução determinística por versão da campanha.
- IA expansionista, defensiva e econômica.
- Guerra, paz e comércio.
- Eventos, manutenção, população e limite de 80 turnos.
- Controle de versão e `operationId` contra ações repetidas e conflitos entre abas.

Para produção, publique somente atrás de HTTPS, configure cookies de sessão seguros/CSRF no proxy ou camada de autenticação e não reutilize este ticket como autenticação permanente.
