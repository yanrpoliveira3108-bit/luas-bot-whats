#!/usr/bin/env bash
# ============================================================
#  make-release.sh — gera o pacote de ATUALIZAÇÃO do Lua.
#
#  O pacote NÃO contém dados do usuário, então pode ser colado
#  por cima de uma instalação existente sem apagar nada:
#    exclui .env, session/, database/*.db, backup/, logs/, tmp/*,
#    node_modules/, .git/ e .shutdown
#
#  Uso:
#    ./scripts/make-release.sh        → release/lua-update-vX.Y.Z.zip
#    ./scripts/make-release.sh tar    → release/lua-update-vX.Y.Z.tar.gz
#
#  (Termux: pkg install zip)
# ============================================================
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")
OUT_DIR="release"
mkdir -p "$OUT_DIR"

# padrões excluídos (dados do usuário + artefatos de build)
# obs: NÃO excluir ".env.*" — o .env.example DEVE ir no pacote
EXCL=(
  ".env"
  "session" "session/*"
  "database/*.db" "database/*.db-wal" "database/*.db-shm"
  "backup" "backup/*"
  "logs" "logs/*"
  "tmp/*"
  "node_modules" "node_modules/*"
  ".git" ".git/*"
  "release" "release/*"
  ".shutdown" "*.log"
)

FORMAT="${1:-zip}"
case "$FORMAT" in
  zip)
    if ! command -v zip >/dev/null 2>&1; then
      echo "❌ Instale o zip: pkg install zip"; exit 1
    fi
    OUT="$OUT_DIR/lua-update-v$VERSION.zip"
    rm -f "$OUT"
    # monta a lista de exclusões no formato do Info-ZIP
    XARGS=()
    for p in "${EXCL[@]}"; do XARGS+=("-x" "$p"); done
    zip -r "$OUT" . "${XARGS[@]}" >/dev/null
    ;;
  tar)
    OUT="$OUT_DIR/lua-update-v$VERSION.tar.gz"
    rm -f "$OUT"
    TEXCL=()
    for p in "${EXCL[@]}"; do TEXCL+=("--exclude=$p"); done
    tar -czf "$OUT" "${TEXCL[@]}" .
    ;;
  *)
    echo "❌ Formato desconhecido: use 'zip' ou 'tar'"; exit 1
    ;;
esac

echo ""
echo "✅ Pacote de atualização criado:"
echo "   $OUT"
echo ""
echo "Envie este arquivo para quem quiser atualizar o Lua."
echo "Na máquina de destino:"
echo "   1) cole/extraia o conteúdo dentro da pasta ~/lua"
echo "   2) rode:  ./update.sh"
echo ""
echo "Os dados do usuário NÃO estão neste pacote e não serão apagados."
