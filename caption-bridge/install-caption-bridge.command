#!/bin/bash
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/EditorVideoViniciusCaptionBridge"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/EditorVideoViniciusCaptionBridge"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

# Habilita extensões CEP não assinadas para desenvolvimento nas versões CSXS comuns.
for V in 9 10 11 12 13 14 15; do
  defaults write "com.adobe.CSXS.$V" PlayerDebugMode 1 >/dev/null 2>&1 || true
done

clear
echo "=============================================="
echo "Editor de Video do Vinicius"
echo "Ponte de legendas nativas instalada."
echo "=============================================="
echo
echo "Agora feche completamente o Premiere Pro e abra novamente."
echo "Depois, no painel, Configuracoes e diagnostico deve mostrar:"
echo "Ponte de legendas nativas ativa."
echo
echo "Pressione ENTER para fechar."
read
