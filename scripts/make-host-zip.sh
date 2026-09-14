#!/usr/bin/env bash
# ============================================================
#  make-host-zip.sh — gera o pacote COMPLETO para deploy em host/VPS.
#
#  Uso:  bash scripts/make-host-zip.sh [zip|tar]
#  Saída: release/lua-host-v<VERSION>.zip (ou .tar.gz)
#
#  Diferenças para o make-release.sh (pacote de UPDATE):
#   - é o projeto inteiro (instalação do zero, sem depender de nada);
#   - NUNCA inclui: .env, session/, database/*.db*, node_modules,
#     logs/, backup/, release/, .git, arquivos de log ou zips antigos;
#   - inclui .env.example, install.sh, start.sh, update.sh e HOST.md.
# ============================================================
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")
FORMAT="${1:-zip}"
OUT_DIR="release"
mkdir -p "$OUT_DIR"

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
  ".shutdown" "*.log"
  "*.zip" "*.tar.gz"
  ".selective-backup" ".selective-backup/*"
)

case "$FORMAT" in
  zip)
    if ! command -v zip >/dev/null 2>&1; then echo "❌ Instale o zip: sudo apt install zip"; exit 1; fi
    OUT="$OUT_DIR/lua-host-v$VERSION.zip"
    rm -f "$OUT"
    XARGS=()
    for p in "${EXCL[@]}"; do XARGS+=("-x" "$p"); done
    zip -r "$OUT" . "${XARGS[@]}" >/dev/null
    ;;
  tar)
    OUT="$OUT_DIR/lua-host-v$VERSION.tar.gz"
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
echo "✅ Pacote de HOST gerado: $OUT"
echo "   Envie este arquivo para o VPS/servidor."
echo ""
echo "   No host:"
echo "     1) mkdir -p ~/lua && cd ~/lua"
echo "     2) unzip $(basename "$OUT")"
echo "     3) bash install.sh"
echo "     4) edite o .env (OWNER_NUMBER) e rode ./start.sh"
echo ""
echo "   Veja HOST.md (dentro do pacote) para o passo a passo completo."
