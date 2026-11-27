#!/bin/bash
# ============================================================================================
# RECETTE MISSION 15 — rejoue TOUTES les vérifications de cette passe sur une base de recette.
# Chaque bloc affiche ses échecs ; un seul échec rend le script non nul.
# Prérequis : PostgreSQL 17 local, base oymike_m15, serveur sur le port 3720 (`/tmp/srv.sh`).
# ============================================================================================
set -u
cd "$(dirname "$0")/.." || exit 1
export PATH=/usr/lib/postgresql/17/bin:$PATH
export PGPASSWORD=postgres
PSQL="psql -h 127.0.0.1 -U postgres -d oymike_m15 -tAc"
fail=0
run() { # run "libellé" commande...
  local label="$1"; shift
  echo "── $label"
  $PSQL "DELETE FROM merchant_active_sessions;" >/dev/null 2>&1
  if "$@"; then echo "   ✓ OK"; else echo "   ✗ ÉCHEC"; fail=1; fi
}

run "Occupation des tables (§2.2–§2.4)"            node /tmp/test-occupation.js
run "Validation + paiement (§4.3)"                  node /tmp/test-settle.js
run "Règlement : refus et doubles validations"      node /tmp/test-settle2.js
run "Apparence du QR de table (§3.6)"               node /tmp/test-artwork.js
run "Permission de validation des inscriptions"     node /tmp/test-perm.js
run "Inscription autonome, code hérité ignoré"      node /tmp/signup-submit.js
run "Contraste de tous les espaces (29 contrôles)"  node tools-m15/audit-contraste.js
run "Tests unitaires du projet"                     npm test

echo
[ "$fail" -eq 0 ] && echo "RECETTE M15 : tout est vert." || echo "RECETTE M15 : au moins un contrôle a échoué (voir ci-dessus)."
exit "$fail"
