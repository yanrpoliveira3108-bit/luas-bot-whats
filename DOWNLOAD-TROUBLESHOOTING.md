# 📥 Downloads não funcionam — guia de conserto

Vale para `!ytmp3`, `!ytmp4`, `!play`, `!audio`, `!video`, `!tiktok`, `!instagram`,
`!download`, `!imagem`, `!facebook`, `!pinterest`.

## 0. Rode o diagnóstico primeiro (30 segundos)

```bash
node scripts/downloads-doctor.js
```

Ele testa, na ordem: ambiente → rede → download real de cada site → saída (freio).
Cada linha vermelha já vem com o conserto. **A saída inteira é o que resolve o
caso** — não precisa adivinhar.

---

## 1. Os 3 motivos mais comuns

### 1.1 Faltam os motores no Termux (causa nº 1 do YouTube)

O `@distube/ytdl-core` (motor reserva) já **não consegue** baixar boa parte dos
vídeos: o YouTube passou a exigir token de sessão ("Sign in to confirm you're not
a bot"). O motor que funciona é o **yt-dlp**.

```bash
pkg install python ffmpeg
pip install -U yt-dlp
yt-dlp --version      # tem que mostrar a versão
```

Depois reinicie o bot. No boot ele imprime:

```
[MOTORES] yt-dlp: DISPONÍVEL ✔ (motor principal do YouTube)
[MOTORES] ffmpeg: DISPONÍVEL ✔ (mescla vídeo+áudio e converte)
```

- **`pkg install yt-dlp` não existe** no Termux — é `pip install -U yt-dlp`.
- Se der erro de permissão: `pip install --user -U yt-dlp` ou `python3 -m pip install -U yt-dlp`.
- **ffmpeg** é necessário para juntar vídeo+áudio (qualidade 720p) e para áudio MP3.
  Sem ele, só formato já pronto funciona.

### 1.2 O YouTube pediu sessão validada (`Sign in to confirm you're not a bot`)

Mesmo com yt-dlp atualizado, alguns vídeos exigem **cookies**:

1. No navegador logado no YouTube, instale a extensão **"Get cookies.txt"**.
2. Exporte os cookies do `youtube.com` e salve como `cookies.txt` na pasta do bot.
3. No `.env`:

```env
YT_COOKIES=./cookies.txt
```

4. `node scripts/downloads-doctor.js youtube` para confirmar.

> `cookies*.txt` já está no `.gitignore`. Cookies dão acesso à sua conta —
> **nunca** mande esse arquivo para ninguém nem suba no GitHub.

Alternativa sem cookies: `YT_VIDEO_QUALITY=360` costuma ser o formato que o
YouTube libera com menos exigência.

### 1.3 Diretório temporário inválido (a pegadinha do Android)

O Baileys grava todo upload de mídia em `os.tmpdir()`. No Android, quando o bot é
iniciado por script/cron/Termux:Boot, `TMPDIR` pode vir vazia e o Node tenta usar
`/tmp`, que **não existe** no Android.

Sintoma exato: **texto funciona, mídia não** — ou seja, "nenhum download funciona".

O `index.js` já conserta sozinho no boot (ver `utils/tmpdir.js`). Se você inicia
por script próprio, garanta:

```bash
export TMPDIR="$HOME/lua/tmp"
```

O diagnóstico mostra se está OK ("TMPDIR do sistema gravável").

---

## 2. Por site

| Site | Como funciona | Quando falha |
|---|---|---|
| YouTube | yt-dlp → reserva ytdl-core | Sem yt-dlp/ffmpeg, ou bot-check (item 1.1/1.2) |
| TikTok | API pública `tikwm.com` | Serviço de terceiro fora do ar → tentar de novo mais tarde |
| Instagram | Open Graph da página | Post privado/stories exigem login → falha esperada |
| Facebook | Open Graph da página | Vídeo privado ou link de app (`fb.watch`) pode falhar |
| Pinterest | Open Graph (`og:video`/`og:image`) | Pin privado |
| X/Twitter | API pública `fxtwitter` | Serviço de terceiro instável |
| Reddit | API pública | Subreddit NSFW/privado |

Serviço de terceiro fora do ar **não é bug do bot** — o bot avisa e você tenta
depois. Se o diagnóstico mostrar todos os sites inacessíveis, o problema é a
**rede do celular** (VPN, operadora, Wi-Fi com bloqueio).

---

## 3. Se o download funciona mas o arquivo não chega

Aqui o problema é no **envio**, não no download. O freio de envio controla o
ritmo justamente para não derrubar o número (ver `SEGURANCA-ENVIO.md`).

- **Número recém-pareado (warmup de 48h)**: o teto por minuto cai para ⅓. Se o
  número já é antigo: `!freio warmup off`.
- **Envio pausado por sinal de restrição**: `!freio` mostra; `!freio retomar`.
- **Fila cheia / modo seguro**: o bot agora **avisa** ("o arquivo ficou pronto,
  mas o freio barrou a saída") em vez de ficar em silêncio.
- **Arquivo grande**: WhatsApp tem limite prático (~16MB para vídeo depois de
  comprimido, ~100MB em documento). `DOWNLOAD_MAX_MB` (padrão 100) não deve
  passar disso para vídeo; o ideal em grupo é até 30–50MB.

---

## 4. Testes rápidos

```bash
node scripts/downloads-doctor.js youtube     # só YouTube
node scripts/downloads-doctor.js tiktok      # só TikTok
node test/sendguard.test.js                  # garante que o freio não atrasa o arquivo
```

Se o diagnóstico passa mas no WhatsApp não chega, mande a saída do diagnóstico
**e** as últimas linhas de `logs/lua-*.log` do momento em que você rodou o comando.
