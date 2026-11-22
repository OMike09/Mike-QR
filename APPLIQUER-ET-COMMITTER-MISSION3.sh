#!/usr/bin/env bash
# Applique le colis Mission 3 dans votre dépôt local et crée le commit.
# À exécuter depuis la racine de votre dépôt (celle qui contient server.js et public/).
#
#   bash APPLIQUER-ET-COMMITTER-MISSION3.sh [chemin/du/colis.zip] [--push]
#
# Le script ne pousse rien par défaut : relisez le diff, puis relancez avec --push si vous le souhaitez.
set -euo pipefail

ZIP="${1:-colis-mission3-inscriptions-scans-2026-11-22.zip}"
PUSH="${2:-}"
[ -f "$ZIP" ] || { echo "Colis introuvable : $ZIP" >&2; exit 1; }

# --- Contrôles préalables : on n'écrit jamais dans un dossier qui n'est pas le bon projet.
[ -f server.js ] || { echo "server.js introuvable : lancez ce script depuis la racine du dépôt." >&2; exit 1; }
[ -d public ] || { echo "Dossier public/ introuvable : mauvais répertoire." >&2; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Ce dossier n'est pas un dépôt git." >&2; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Dépôt : $(git config --get remote.origin.url 2>/dev/null || echo '(sans remote)')"
echo "Branche : $BRANCH"

# --- Sauvegarde de l'état courant avant toute modification (aucune perte possible).
BACKUP="sauvegarde-avant-mission3-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$BACKUP" server.js schema.sql public/merchant.html public/merchant.js public/index.html public/admin.js \
  public/manager.html public/manager.js merchant-routes.js merchant-commerce.js merchant-extras.js manager-routes.js store.js 2>/dev/null || true
echo "Sauvegarde créée : $BACKUP"

# --- Extraction dans un dossier temporaire, puis copie fichier par fichier (chemins préservés).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" -d "$TMP"

# Les pièces de preuve et la note ne sont pas copiées dans le dépôt applicatif.
mkdir -p preuve-mission3
for f in preuve-*.png; do :; done
copied=0
while IFS= read -r rel; do
  case "$rel" in
    *.png|*.md|*.zip|*.sha256) continue ;;
  esac
  src="$TMP/$rel"
  [ -f "$src" ] || continue
  mkdir -p "$(dirname "$rel")"
  cp -p "$src" "$rel"
  copied=$((copied + 1))
done < <(cd "$TMP" && find . -type f | sed 's|^\./||' | sort)
# Les captures sont conservées hors du code pour la revue, pas dans le build.
for img in "$TMP"/preuve-*.png; do [ -f "$img" ] && cp -p "$img" preuve-mission3/ ; done

echo "$copied fichier(s) applicatif(s) appliqué(s)."

# --- Vérifications réelles avant commit : syntaxe JS + migration présente.
fail=0
for js in merchant-lifecycle.js merchant-lifecycle-routes.js merchant-routes.js merchant-commerce.js merchant-extras.js \
          manager-routes.js store.js server.js public/merchant.js public/merchant-signup.js public/merchant-scanner.js \
          public/merchant-registrations.js public/manager-merchants.js public/manager.js public/admin.js; do
  node --check "$js" || { echo "Erreur de syntaxe : $js" >&2; fail=1; }
done
grep -q "merchant_scan_events" schema.sql || { echo "Migration absente de schema.sql" >&2; fail=1; }
grep -q "merchant-lifecycle-routes" server.js || { echo "Module non monté dans server.js" >&2; fail=1; }
[ "$fail" -eq 0 ] || { echo "Contrôles en échec : rien n'a été commité." >&2; exit 1; }
echo "Contrôles syntaxiques et migration : OK"

# --- Commit (les fichiers du colis uniquement, pour ne pas embarquer de travail en cours).
git add -- merchant-lifecycle.js merchant-lifecycle-routes.js merchant-commerce.js merchant-extras.js merchant-routes.js \
  manager-routes.js store.js server.js schema.sql \
  public/merchant-registrations.js public/merchant-registrations.css public/merchant-scanner.js public/merchant-signup.html \
  public/merchant-signup.js public/manager-merchants.js public/manager.html public/manager.js public/merchant.html \
  public/merchant.js public/merchant-assisted-orders.css public/admin.js public/index.html \
  public/vendor/jsQR.js public/vendor/jsQR.LICENSE-APACHE-2.0.txt test/merchant-lifecycle.test.js

git status --short --untracked-files=no | sed -n '1,40p'

git commit -q -F - <<'MSG'
Mission 3 : inscriptions autonomes, commande marchand par scan, scans séparés

Inscription autonome (M1)
- Page publique /devenir-marchand + /devenir-marchand/suivi, formulaire responsive,
  statut initial « En attente de validation » et message exact demandé.
- Aucun accès marchand avant validation : connexion refusée, QR non activable.
- Après approbation : compte actif avec le mot de passe choisi par le marchand,
  boutique créée mais NON publiée, QR laissé à l'activation PDG (procédure existante).
- Doublons téléphone/e-mail/identifiant : 409 + marche à suivre, jamais de suppression.
- Décision idempotente (verrou + version d'examen + index unique) : une demande
  ne peut pas être validée deux fois.

Permission gestionnaire
- « Autoriser la validation des inscriptions marchands » désactivée par défaut,
  révocable ; sans elle : 403 REGISTRATION_VALIDATION_FORBIDDEN et aucune entrée de menu.

Commande du marchand avec scan intégré (M2)
- Scanner caméra arrière dans l'écran « Prendre une commande », détection automatique,
  arrêt propre de la caméra, réessai après échec, repli sélection manuelle.
- Résolution du QR côté serveur : QR d'une autre boutique refusé (403 QR_OTHER_STORE),
  QR inconnu/inactif refusé (404 QR_INVALID).
- Provenance persistée sur la commande : order_source, scanned_qr_code, scanned_via,
  scan_event_id, customer_contact_status ; téléphone facultatif.
- Même circuit de commandes et même idempotence : pas de double création ni de
  double déduction de stock.

Scans séparés (M3)
- Table merchant_scan_events (catégorie client/marchand/historique) avec clé anti-doublon.
- Statistiques marchand et PDG : clients, marchands, total général = clients + marchands,
  historique antérieur conservé et affiché à part, aucun compteur remis à zéro.
- Un scan marchand n'est jamais compté comme une visite publique.

Contrôle PDG et espaces délégués (M4)
- Rubrique PDG « Inscriptions marchands » : bascules des fonctionnalités, demandes,
  dossier et pièces, approbation/refus motivé/examen/suspension, historique, statistiques,
  commandes saisies par les marchands.
- Gestionnaire : uniquement ses marchands ; marchand : uniquement ses données.
  Contrôles effectués côté serveur.

Migration
- Ajouts strictement additifs en fin de schema.sql (ADD COLUMN IF NOT EXISTS,
  CREATE TABLE IF NOT EXISTS, index et contraintes conditionnels).
- Aucun QR, lien public (/t/, /s/, /r/), compte, commande ou compteur existant modifié.

Tests
- test/merchant-lifecycle.test.js : 10 scénarios (inscription, décisions concurrentes,
  permission, scan, commande, statistiques, bascules).
- Suite complète : 92 tests, 91 réussis, 0 échec, 1 ignoré.
- Parcours navigateur vérifié sur mobile et bureau (inscription, approbation PDG,
  publication + QR, scan caméra d'un QR réel, commande, statistiques).
MSG

echo
echo "Commit créé :"
git --no-pager log -1 --stat | sed -n '1,25p'

if [ "$PUSH" = "--push" ]; then
  echo
  read -r -p "Pousser sur origin/$BRANCH ? (oui/non) " answer
  if [ "$answer" = "oui" ]; then git push origin "$BRANCH"; else echo "Aucun envoi effectué."; fi
else
  echo
  echo "Rien n'a été envoyé. Relisez avec : git show --stat HEAD"
  echo "Puis : git push origin $BRANCH   (ou relancez avec --push)"
fi
