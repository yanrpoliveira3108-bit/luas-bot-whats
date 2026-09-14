#!/usr/bin/env bash
# ============================================================
#  make-host-complete-zip.sh — pacote AUTOCONTIDO para painel/VPS
#  que NÃO roda `npm install`.
#
#  Diferença para make-host-zip.sh: INCLUI node_modules pronto.
#   - O único módulo nativo é o better-sqlite3, cujos prebuilds N-API
#     vêm para TODAS as plataformas (linux x64/arm64/musl, etc.) → roda
#     em host Linux x64 e ARM64 sem compilar nada.
#   - `sharp` é REMOVIDO de propósito: binário nativo plataforma-específico
#     e o bot já tem fallback (jimp/ffmpeg/node-webpmux WASM). Mantê-lo
#     quebraria a portabilidade x64/arm64 e não é necessário.
#   - O fork @lucasmod/boruto-vk7-baileys entra como CÓPIA REAL dentro de
#     node_modules (não symlink) — funciona mesmo se o painel extrair sem
#     preservar symlinks.
#
#  Uso:  bash scripts/make-host-complete-zip.sh
#  Saída: release/lua-host-completo-v<VERSION>.zip
# ============================================================
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")
OUT_DIR="release"
STAGE=".host-stage"
OUT="$OUT_DIR/lua-host-completo-v$VERSION.zip"
mkdir -p "$OUT_DIR"

# ── staging: cópia limpa do projeto + node_modules tratado ──────────────
rm -rf "$STAGE"
mkdir -p "$STAGE"

# 1) copia node_modules (dereferencia só o symlink do fork)
cp -a node_modules "$STAGE/node_modules"
rm -rf "$STAGE/node_modules/@lucasmod/boruto-vk7-baileys"
mkdir -p "$STAGE/node_modules/@lucasmod"
cp -r vendor/boruto-vk7-baileys "$STAGE/node_modules/@lucasmod/boruto-vk7-baileys"

# 2) remove binários nativos plataforma-específicos e lixo
rm -rf "$STAGE/node_modules/sharp"
rm -rf "$STAGE/node_modules/.cache"

# 3) copia o projeto (sem node_modules, dados, segredos e lixo)
EXCL=(
  ".env"
  "session" "session/*"
  "database/*.db" "database/*.db-*" "database/*.db-shm" "database/*.db-wal"
  "backup" "backup/*"
  "logs" "logs/*"
  "tmp/*" "tmp/.[!.]*"
  "node_modules" "node_modules/*"
  ".git" ".git/*"
  "release" "release/*"
  ".host-stage" ".host-stage/*"
  ".selective-backup" ".selective-backup/*"
  ".shutdown" "*.log" "*.zip" "*.tar.gz"
)
if ! command -v zip >/dev/null 2>&1; then echo "❌ Instale o zip: sudo apt install zip"; exit 1; fi
rm -f "$OUT"
XARGS=()
for p in "${EXCL[@]}"; do XARGS+=("-x" "$p"); done
zip -q -r "$OUT" . "${XARGS[@]}"

# 4) acrescenta o node_modules tratado dentro do zip
( cd "$STAGE" && zip -q -r "../$OUT_DIR/lua-host-completo-v$VERSION.zip" node_modules )

rm -rf "$STAGE"

echo ""
echo "✅ Pacote AUTOCONTIDO gerado: $OUT"
du -h "$OUT" | awk '{print "   Tamanho: "$1}'
echo ""
echo "   No painel/VPS:"
echo "     1) envie ESTE arquivo (já vem com node_modules pronto)"
echo "     2) extraia na pasta do bot"
echo "     3) edite o .env (OWNER_NUMBER) e rode: node index.js  (ou ./start.sh)"
echo "        NÃO precisa rodar npm install."
echo ""
echo "   ⚠️  Requer Node 22+ no host. Veja HOST.md para detalhes."
