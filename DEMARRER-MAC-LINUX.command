#!/usr/bin/env bash
# Double-clic sur macOS (ou `bash DEMARRER-MAC-LINUX.command` sous Linux).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js n'est pas installé sur cet ordinateur."
  echo "1. Ouvrez https://nodejs.org/fr/download"
  echo "2. Installez la version LTS"
  echo "3. Relancez ce fichier"
  echo
  read -r -p "Appuyez sur Entrée pour fermer…" _
  exit 1
fi
node demarrer.js
echo
read -r -p "Appuyez sur Entrée pour fermer…" _
