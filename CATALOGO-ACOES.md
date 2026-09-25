# Catálogo e Renovação de Mídias de Interação da Lua

Este documento descreve a reformulação visual e o catálogo centralizado de mídias para comandos de interação do bot (`beijo`, `sirrica`/`siririca`, `bater`/`tapa`, `gado`, `abraco`, `tapinha`, `cafune`, `zoar`).

---

## 1. Diretriz Visual & Objetivo
- **Substituição do estilo cute/chibi**: Anteriormente o bot utilizava imagens estáticas genéricas e chibi. Foram substituídas por cenas expressivas de animes e memes irreverentes da cultura de internet brasileira e mundial.
- **`beijo`**: Cenas de beijo apaixonadas, dramáticas e de cinema (romance expressivo).
- **`bater` / `tapa`**: Tapas expressivos de anime de comédia/ação, além do clássico meme do Batman dando tapa no Robin.
- **`sirrica` / `siririca`**: Reações cômicas de constrangimento e duplo sentido, com garotas e garotos de animes morrendo de vergonha (vermelhos, vapor subindo, tapando os olhos com as mãos), sem qualquer conotação de nudez ou violação das diretrizes.
- **`gado`**: Memes exagerados de gado/simp (olhos de coração, babando de admiração e os icônicos memes de gado/vaca no pasto).
- **`abraco` / `tapinha` / `cafune` / `zoar`**: Abraços dramáticos e acolhedores de anime, headpats expressivos e risadas debochadas/apontando o dedo.

---

## 2. Arquitetura do Catálogo (`utils/actionCatalog.js` e `utils/actionImage.js`)

1. **Variedade**: Mínimo de 3 animações (GIFs animados) e 2 imagens estáticas por comando principal em `assets/actions/media/<comando>/`.
2. **Anti-repetição imediata**: `pickMedia(actionKey)` monitora o último item enviado por comando e garante que duas invocações subsequentes nunca repitam a mesma mídia (enquanto houver mais de uma opção no catálogo).
3. **Reprodução Contínua no WhatsApp**: Arquivos animados são enviados via `ctx.sendVideo(path, caption, { gifPlayback: true, mimetype: 'video/mp4' })`.
4. **Fallback Resiliente**:
   - Caso `sendVideo` falhe com um arquivo GIF, o sistema tenta enviá-lo como imagem (`ctx.sendImage`).
   - Se ainda assim falhar (ou se o contexto não possuir capacidade de mídia), o comando segue enviando apenas a mensagem de texto via `ctx.reply`. **Uma mídia ausente ou corrompida nunca quebra o bot.**
5. **Compatibilidade Total**: Mantida a função `resolvePath(key)` para scripts e plugins legados que buscam arquivos estáticos em `assets/actions/<comando>.<ext>`.

---

## 3. Inventário de Comandos e Mídias

| Comando / Gatilhos | Mídias no Catálogo | Tipos | Fontes & Atribuições |
| :--- | :--- | :--- | :--- |
| `!beijo` | 5 itens (`beijo_01` a `05`) | 3 GIFs, 2 Imagens | Aniyuki, GifDB, WallpaperCave, Backiee |
| `!bater` (alias: `!tapa`) | 5 itens (`bater_01` a `05`) | 3 GIFs, 2 Imagens | GifDB (Tsukimichi), Tenor, Imgflip (Batman Slap), Pinterest |
| `!sirrica` (alias: `!siririca`) | 5 itens (`sirrica_01` a `05`) | 3 GIFs, 2 Imagens | UsaGif (Anime Blush), GifDB, Reddit Animemebank, Pinterest |
| `!gado` | 5 itens (`gado_01` a `05`) | 3 GIFs, 2 Imagens | GifDB, Tenor, Memedroid (Gado Demais) |
| `!abraco` | 5 itens (`abraco_01` a `05`) | 3 GIFs, 2 Imagens | GifDB (Spice and Wolf), Wallpapers.com, Peakpx |
| `!tapinha` | 5 itens (`tapinha_01` a `05`) | 3 GIFs, 2 Imagens | GifDB (Umaru-chan, Edens Zero), Wallpapers.com, Pinterest |
| `!cafune` | 5 itens (`cafune_01` a `05`) | 3 GIFs, 2 Imagens | GifDB (Umaru-chan, Hitori Bocchi), Wallpapers.com, Pinterest |
| `!zoar` | 5 itens (`zoar_01` a `05`) | 3 GIFs, 2 Imagens | Tenor (Point and laugh), GifDB, Pinterest, Reddit |

---

## 4. Testes e Validação
- Testes automatizados executados via `test/actionCatalog.test.js`:
  - Verificação de existência física dos arquivos.
  - Verificação da proporção mínima de 3 GIFs e 2 imagens estáticas.
  - Verificação de anti-repetição imediata consecutiva.
  - Verificação dos métodos de envio com `{ gifPlayback: true }` e fallback suave para `reply`.
  - Suíte de auditoria completa da aplicação (`scripts/audit.js` e bateria de 28 testes unitários/integração) aprovada integralmente (377 comandos registrados sem erros).
