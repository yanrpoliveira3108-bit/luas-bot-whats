#!/usr/bin/env bash
# ============================================================
#  install.sh — instalador do Lua (compatível com Termux)
#
#  Se a pasta estiver vazia, procura o pacote baixado na pasta
#  Downloads (lua*.zip / lua*.tar.gz) e extrai automaticamente
#  aqui dentro — ideal para a primeira instalação.
# ============================================================
set -e

cd "$(dirname "$0")"

echo ""
echo "🌙  Lua — instalador"
echo "=================================="

# ── Termux: corrige o bug do node-gyp (android_ndk_path) ───────────────
# O common.gypi do Node referencia a variável android_ndk_path em builds
# nativos no Android/Termux, mas ela nunca é definida → "gyp: Undefined
# variable android_ndk_path". Definimos vazia (o -I resultante é inócuo).
termux_gyp_fix() {
  if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "$TERMUX_VERSION" ]; then
    export GYP_DEFINES="android_ndk_path=''"
    mkdir -p ~/.gyp
    echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi
    echo "🔧 Termux detectado — correção do node-gyp (android_ndk_path) aplicada."
  fi
}

# ── garante better-sqlite3 13+ (compatível com Node 22/24/26) ──────────
pin_better_sqlite3() {
  if [ -f package.json ] && grep -qE '"better-sqlite3": *"\^11\.' package.json; then
    sed -i -E 's/"better-sqlite3": *"\^11\.[0-9.]+"/"better-sqlite3": "^13.0.3"/' package.json
    sed -i -E 's/"node": *">=20(\.0\.0)?"/"node": ">=22.0.0"/' package.json
    echo "🔧 package.json atualizado: better-sqlite3 → ^13.0.3 (Node ≥ 22)"
  fi
}

# ── devolve o bit de execução aos scripts (zip remove permissões) ──────
fix_permissions() {
  chmod +x install.sh start.sh update.sh scripts/*.sh 2>/dev/null || true
}

# ── compila o módulo nativo do banco, se necessário ────────────────────
# O better-sqlite3@13 NÃO tem script de instalação automática e não traz
# binário pré-compilado para Android (só Linux/macOS/Windows). Em Termux,
# o build/Release/better_sqlite3.node precisa ser gerado do código-fonte.
# O teste real é "o módulo carrega?" — cobre pré-compilado e compilado.
ensure_sqlite_binary() {
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
    return 0
  fi

  echo "🔨 better-sqlite3: binário nativo ausente (Android não tem pré-compilado)."
  echo "   Compilando do código-fonte..."

  local need=""
  { command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; } || need="python "
  command -v make >/dev/null 2>&1 || need="${need}make "
  { command -v clang >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v cc >/dev/null 2>&1; } || need="${need}clang/gcc"
  if [ -n "$need" ]; then
    echo "❌ Faltam ferramentas de compilação: $need"
    echo "   Termux:  pkg install python make clang"
    echo "   Linux:   sudo apt install build-essential python3"
    echo "   Depois rode novamente:  bash install.sh"
    exit 1
  fi

  termux_gyp_fix
  (cd node_modules/better-sqlite3 && npm run build-release) || {
    echo "❌ Falha ao compilar o better-sqlite3. Veja o erro acima."
    echo "   Tente manualmente:  cd node_modules/better-sqlite3 && npm run build-release"
    exit 1
  }
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
    echo "✅ better-sqlite3 compilado e funcionando."
  else
    echo "❌ better-sqlite3 ainda não carrega após a compilação."
    echo "   Verifique o erro acima e confira: pkg install python make clang"
    exit 1
  fi
}

# ── primeiro uso: extrair o projeto baixado da pasta Downloads ─────────
if [ ! -f package.json ] && [ ! -f index.js ]; then
  FOUND=()
  for f in "$HOME/storage/downloads"/lua*.zip "$HOME/storage/downloads"/lua*.tar.gz \
           "$HOME/storage/shared/Download"/lua*.zip "$HOME/storage/shared/Download"/lua*.tar.gz \
           "$HOME/downloads"/lua*.zip "$HOME/downloads"/lua*.tar.gz \
           "$HOME/Downloads"/lua*.zip "$HOME/Downloads"/lua*.tar.gz; do
    [ -f "$f" ] && FOUND+=("$f")
  done

  PKG=""
  [ ${#FOUND[@]} -gt 0 ] && PKG=$(ls -t "${FOUND[@]}" 2>/dev/null | head -1)

  if [ -n "$PKG" ]; then
    echo "📥 Pacote encontrado na pasta Downloads:"
    echo "   $PKG"
    case "$PKG" in
      *.zip)
        if ! command -v unzip >/dev/null 2>&1; then
          echo "❌ Instale o unzip: pkg install unzip"
          exit 1
        fi
        unzip -q "$PKG" -d .
        ;;
      *.tar.gz|*.tgz)
        tar -xzf "$PKG" -C .
        ;;
    esac
    # achata uma subpasta única (ex.: lua-main/) se o pacote tiver wrapper
    for d in */; do
      if [ -f "$d/package.json" ] && [ -f "$d/index.js" ]; then
        mv "$d"/* . 2>/dev/null || true
        mv "$d"/.[!.]* . 2>/dev/null || true
        rmdir "$d" 2>/dev/null || true
        break
      fi
    done
    echo "✅ Projeto extraído em $(pwd)"
  else
    echo "ℹ️  Nenhum pacote lua*.zip encontrado na pasta Downloads."
    echo "   Extraia os arquivos do projeto aqui e rode ./install.sh novamente."
    exit 1
  fi
fi

# 1. verificar Node
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js não encontrado."
  echo "   Termux:  pkg install nodejs-lts"
  echo "   Linux:   instale o Node 20+ (https://nodejs.org)"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "❌ Node $(node -v) detectado. O Lua requer Node 22 ou superior."
  echo "   Termux:  pkg install nodejs-lts   (ou pkg install nodejs)"
  echo "   Linux:   instale o Node 22+ (https://nodejs.org)"
  exit 1
fi
echo "✅ Node $(node -v)"

# 2. verificar npm
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm não encontrado."
  exit 1
fi
echo "✅ npm $(npm -v)"

# 3. criar diretórios
echo "📁 Criando diretórios..."
mkdir -p session tmp database logs backup assets

# 4. criar .env a partir do exemplo
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "✅ .env criado a partir de .env.example — EDITE o OWNER_NUMBER!"
  else
    echo "⚠️  .env.example não encontrado. Crie o .env manualmente."
  fi
else
  echo "ℹ️  .env já existe (mantido)."
fi

# 5. instalar dependências
#    --legacy-peer-deps é usado de propósito: aceita os peers do Baileys
#    sem --force cego.
#
#    No Termux/Android, o @innovatorssoft/baileys 7 traz sharp e
#    @roamhq/wrtc como dependências que NÃO têm binário pré-compilado para
#    Android. Pulamos os scripts de build nativo desses módulos
#    (--ignore-scripts): o Lua não os usa em runtime (sharp é opcional e
#    wrtc é só para chamadas VoIP). O better-sqlite3 — que o Lua usa de
#    verdade — é compilado logo depois por ensure_sqlite_binary.
#
#    Correções automáticas antes de instalar:
termux_gyp_fix
pin_better_sqlite3

echo "📦 Instalando dependências..."
INSTALL_FLAGS="--legacy-peer-deps --no-audit --no-fund"
if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "$TERMUX_VERSION" ]; then
  INSTALL_FLAGS="$INSTALL_FLAGS --ignore-scripts"
  echo "   (Termux: scripts de build nativo de sharp/wrtc ignorados)"
fi
npm install $INSTALL_FLAGS

# Compila o módulo nativo do banco, se necessário (Android sem pré-compilado)
ensure_sqlite_binary

# 6. dependências de sistema (opcionais, mas recomendadas)
echo ""
echo "🔧 Dependências de sistema recomendadas:"
if command -v ffmpeg >/dev/null 2>&1; then
  echo "✅ ffmpeg instalado ($(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3))"
else
  echo "⚠️  ffmpeg NÃO encontrado — stickers de vídeo/GIF não funcionarão."
  echo "   Termux:  pkg install ffmpeg"
  echo "   Linux:   sudo apt install ffmpeg"
fi

# 7. preparar banco
echo "🗄️  Preparando banco de dados..."
node -e "const c=require('./config');c.helpers.ensureDirs();const d=require('./database/database');d.open();console.log('✅ Banco pronto');d.close();"

# 8. garantir permissão de execução dos scripts (zip remove o +x)
fix_permissions
echo "🔑 Permissões de execução aplicadas (./start.sh, ./update.sh...)."

echo ""
echo "=================================="
echo "✅ Instalação concluída!"
echo ""
echo "Próximos passos:"
echo "  1. Edite o .env e defina OWNER_NUMBER (ex.: 5511999999999)"
echo "     e, opcionalmente, PAIRING_NUMBER."
echo "  2. Inicie com:  ./start.sh   (ou npm start)"
echo "  3. O bot exibirá um pairing code. No celular:"
echo "     WhatsApp → Aparelhos conectados → Conectar com número de telefone."
echo "=================================="
