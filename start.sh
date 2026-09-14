#!/usr/bin/env bash
# ============================================================
#  start.sh — inicia o Lua com reinício automático.
#  Para de reiniciar quando o dono usa !shutdown (flag .shutdown).
# ============================================================
cd "$(dirname "$0")"

rm -f .shutdown

# ── Pré-voo: dependências e módulo nativo precisam estar prontos ──────
if [ ! -d node_modules ] || [ ! -f node_modules/dotenv/package.json ]; then
  echo ""
  echo "❌ Dependências não instaladas (pasta node_modules ausente ou incompleta)."
  echo "   Rode UMA vez:  npm install --legacy-peer-deps"
  echo "   (ou, mais completo:  bash install.sh)"
  echo ""
  exit 1
fi

if ! node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
  echo ""
  echo "❌ O módulo nativo better-sqlite3 não carrega (não está compilado)."
  echo "   (No Android ele não vem pré-compilado — precisa compilar uma vez.)"
  echo "   Rode:  bash install.sh"
  echo "   ou manualmente:"
  echo "     pkg install python make clang"
  echo "     cd node_modules/better-sqlite3 && npm run build-release"
  echo "     cd -"
  echo ""
  exit 1
fi

echo "🌙 Iniciando o Lua..."
echo "   (Ctrl+C para parar)"

while [ ! -f .shutdown ]; do
  node index.js
  EXIT=$?
  echo ""
  if [ -f .shutdown ]; then
    echo "🛑 Desligamento solicitado pelo dono. Até logo!"
    break
  fi
  if [ "$EXIT" -eq 0 ]; then
    # saída limpa (Ctrl+C ou opção "Sair"): NÃO reinicia
    echo "👋 Encerrado normalmente (código 0)."
    echo "   Para iniciar novamente, rode: ./start.sh"
    break
  fi
  echo "⚠️  O bot encerrou com erro (código $EXIT)."
  echo "🔄 Reiniciando em 3 segundos..."
  sleep 3
done
