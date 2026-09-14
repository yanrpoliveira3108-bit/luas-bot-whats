#!/usr/bin/env bash
# ============================================================
#  make-host-total-zip.sh — ZIP TOTAL para painel/VPS.
#
#  Inclui TUDO para rodar sem configuração extra no host:
#   - projeto completo + node_modules pronto (sem npm install);
#   - fork @lucasmod/boruto-vk7-baileys como CÓPIA REAL (não symlink);
#   - SEM sharp (binário nativo não-portável; bot tem fallback);
#   - .env (dono já configurado) — ⚠️ O ZIP PASSA A SER SENSÍVEL;
#   - HOST.md + instruções.
#
#  NÃO inclui: session/ (não está neste ambiente), banco de teste,
#  logs, backup, node_modules antigos, zips antigos.
#
#  Uso:  bash scripts/make-host-total-zip.sh
#  Saída: release/lua-host-total-v<VERSION>.zip
# ============================================================
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")
OUT_DIR="release"
STAGE=".host-stage"
OUT="$OUT_DIR/lua-host-total-v$VERSION.zip"
mkdir -p "$OUT_DIR"
command -v zip >/dev/null 2>&1 || { echo "❌ Instale o zip"; exit 1; }

# ── staging ────────────────────────────────────────────────────────────
rm -rf "$STAGE"
mkdir -p "$STAGE"

# 1) node_modules tratado (fork real, sem sharp, sem cache)
cp -a node_modules "$STAGE/node_modules"
rm -rf "$STAGE/node_modules/@lucasmod/boruto-vk7-baileys"
mkdir -p "$STAGE/node_modules/@lucasmod"
cp -r vendor/boruto-vk7-baileys "$STAGE/node_modules/@lucasmod/boruto-vk7-baileys"
rm -rf "$STAGE/node_modules/sharp" "$STAGE/node_modules/.cache"

# 2) projeto + .env (dono configurado); exclui dados/segredos/lixo
EXCL=(
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
  ".env.example"
)
rm -f "$OUT"
XARGS=()
for p in "${EXCL[@]}"; do XARGS+=("-x" "$p"); done
zip -q -r "$OUT" . "${XARGS[@]}"

# 3) node_modules tratado entra no zip
( cd "$STAGE" && zip -q -r "../$OUT_DIR/lua-host-total-v$VERSION.zip" node_modules )

rm -rf "$STAGE"

echo ""
echo "✅ ZIP TOTAL gerado: $OUT"
du -h "$OUT" | awk '{print "   Tamanho: "$1}'
echo ""
echo "   No painel/VPS (Node 22+):"
echo "     1) envie ESTE arquivo e extraia na pasta do bot"
echo "     2) rode:  node index.js   (ou ./start.sh)"
echo "        → NÃO precisa npm install nem editar .env (dono já configurado)"
echo ""
echo "   ⚠️  Este zip contém o .env (número do dono) — trate como SEGREDO."
echo "   ⚠️  A sessão do WhatsApp NÃO está incluída: pareie uma vez no host."
