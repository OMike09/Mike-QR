# COLIS 06 — Reprise durable du wizard QR et protection du JSON

**Date : 10 octobre 2026**  
**Type : colis incrémental à intégrer/committer dans l’application existante. Ce n’est pas un déploiement.**

## Contenu

Ce ZIP contient uniquement les fichiers modifiés ou ajoutés pour cette étape :

- brouillons QR persistants côté navigateur, récupération des champs/étapes/photos et reprise idempotente;
- erreurs HTTP conservées par les clients PDG/gestionnaire pour traiter les résultats définitifs distinctement des coupures;
- arrêt non destructif si le fichier JSON local est invalide;
- tests ciblés et rapport d’étape.

## Intégration

Extraire le contenu du ZIP **à la racine du projet `/home/user/qr-studio` existant**, en fusionnant les chemins `public/` et `test/`. Ce colis n’est pas une archive complète de l’application.

Ne pas remplacer, supprimer ou réinitialiser :

- `data/store.json` ou toute base existante;
- `.env`, variables d’environnement, comptes et secrets;
- le service, la configuration de domaine, le lien marchand ou le schéma de production.

Aucune migration SQL n’est incluse ou requise pour cette étape. Aucune dépendance n’a été ajoutée.

## Vérification

- Suite locale : `npm test` — **32/32 réussis**.
- Le test `test/qr-wizard-real-api-recovery.test.js` utilise le serveur Express local et un magasin JSON temporaire; les réponses sont volontairement abandonnées par le client après commit serveur.
- Le test de rechargement IndexedDB utilise un adaptateur simulé; ni navigateur physique ni base PostgreSQL de production ne sont testés.
- Aucun changement de ce colis n’est déployé. Le code de production doit être mis à jour séparément puis contrôlé après déploiement.

Le rapport complet et les limitations figurent dans `RAPPORT-AUDIT-ETAPE-QR-2026-10-10.md`. Les empreintes du contenu du ZIP sont dans `SHA256SUMS_COLIS_06.txt`.
