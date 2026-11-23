# OYMIKE — MISSION 6 : SUIVI DES COMMANDES, POINTS DES SERVEUSES, MESSAGERIE ET CONTRÔLE OPÉRATIONNEL

**Date : 22 novembre 2026 · delta à déployer par-dessus la Mission 5 · 26 fichiers · aucune archive imbriquée**

---

## 1. Ce que ce delta apporte

Tout ce qui suit est **réellement branché sur la base PostgreSQL** : chaque chiffre affiché est calculé à partir d'opérations enregistrées, chaque action est vérifiée côté serveur, et toute décision est tracée. Aucune interface factice, aucune valeur de démonstration.

| Bloc demandé | Où cela se passe |
|---|---|
| 1. Vue d'ensemble marchand | Espace marchand → onglet **Opérations → Vue d'ensemble** (`/api/merchant/overview`) |
| 2. Tableau de bord gérant général | `/equipe/` → **Tableau de bord** (`/api/staff/manager-dashboard`) |
| 3. Points des serveuses | Marchand : **Opérations → Points et classement** ; serveuse : **Mes points** |
| 4. Classement « Performance de l'équipe » | Même écran, filtre par période (jour / 7 jours / 30 jours) |
| 5. Traçabilité des commandes | Marchand : **Opérations → Traçabilité des commandes** |
| 6. Affectation aux serveuses | Marchand (tables + commandes), gérant (`/api/staff/.../assign`) |
| 7. « Contacter mon gestionnaire » | `/equipe/` → **Messagerie** ; gestionnaire : tableau de bord des messages |
| 8. Notifications internes persistantes | `/api/staff/notifications` + compteur sans doublon |
| 9. Tables et emplacements | Marchand : **Opérations → Tables et emplacements** ; serveuse : **Tables** |
| 10. Temps réel | Notifications persistées en base + diffusion SSE marchand |
| 11. Contrôle Administrateur général | Admin → **Supervision opérationnelle** |
| 12. Sécurité | Contrôles serveur, journal d'audit, anti-doublon, révocation immédiate |
| 13. Parcours de test en 19 étapes | `tools/ops-journey.js` — 53/53 vérifications |

---

## 2. Contenu du zip (26 fichiers)

### Base de données (1)
- `schema-ops-mission6.sql` — migration **additive et rejouable** : 8 nouvelles tables + 2 colonnes, aucune suppression, aucune réécriture de données existantes.

### Backend (4)
- `team-ops.js` — moteur des points (journal append-only), affectations, notifications persistantes.
- `team-analytics.js` — calculs de la vue d'ensemble (commandes, CA, scans, équipe, tâches, top articles).
- `merchant-ops-routes.js` — 16 routes marchand (vue d'ensemble, points, classement, traçabilité, affectations, tables, notifications, messagerie).
- `manager-ops-routes.js` — routes gérant (`/api/manager/ops/*`) et supervision Administrateur général (`/api/admin/ops/*`).

### Frontend (4 fichiers + 1 feuille)
- `public/staff-ops.js` + `public/staff-ops.css` — espace équipe : mes points, tableau de bord gérant, tables, suivi des commandes, messagerie, notifications.
- `public/merchant-ops.js` — espace marchand : vue d'ensemble, points/classement, traçabilité, tables, messagerie.
- `public/admin-ops.js` — supervision globale.

### Fichiers existants modifiés (11)
- `server.js` — montage des 3 routeurs, instance `TeamOps`, diffusion SSE.
- `store.js` — ajout du schéma Mission 6 à la chaîne d'initialisation.
- `schema.sql` — contraintes de scan élargies (`staff`) dès la création.
- `team.js` — résolution d'identifiant multi-boutiques par mot de passe.
- `team-seed.js` — 5 permissions ajoutées (`tables.view_all`, `tables.assign`, `messaging.manage`, `messaging.reply`, `points.manage`).
- `staff-routes.js` — crédit des points par événement, notifications persistées, tableau de bord gérant, messages, affectations.
- `team-routes.js` — statistiques membre enrichies (scans, points).
- `merchant-commerce.js` — `getOrder` expose l'auteur et la serveuse responsable.
- `merchant-routes.js` — export de `publish` pour le temps réel.
- `merchant-lifecycle.js` — scans du personnel acceptés (`category='staff'`).

### Pages (5)
- `index.html`, `merchant.html`, `staff.html`, `public/admin.js`, `public/merchant.js` — onglets, panneaux et points d'entrée des nouvelles vues.

### Tests (3)
- `test/ops-postgres.test.js` — **11 tests `node --test` sur PostgreSQL réel** (points, anti-doublon, annulation, correction, cloisonnement, blocage, barème, classement).
- `tools/ops-journey.js` — **parcours de 19 étapes** (53 vérifications) contre un serveur réel.
- `tools/ui-test-6.js` — contrôle d'interface Playwright des 7 écrans (0 erreur console).

---

## 3. Règles métier réellement appliquées (vérifiées par les tests)

**Points**
- Barème par défaut : scan 1, commande enregistrée 2, commande terminée 2, tâche validée 2.
- Un scan relancé ne compte qu'une fois : l'unicité est portée par `staff_point_events (merchant_id, source_key, action)`.
- Une commande annulée ne crédite jamais de « commande terminée ».
- Une commande crédite **uniquement** celle qui l'a enregistrée ; créditer la serveuse responsable (celle de la table) exige d'activer explicitement « Créditer la serveuse responsable de la commande ».
- Une correction est une **nouvelle ligne motivée et signée** ; rien n'est effacé. Une serveuse ne peut ni lire les points d'une autre, ni modifier les siens, ni changer le barème (403 serveur).

**Commandes et affectations**
- La source (`staff_assisted`, `manager_assisted`, `customer_qr`…), l'auteur et son rôle sont figés à la création : une modification ultérieure ne change jamais l'auteur d'origine.
- L'affectation de suivi est séparée de l'auteur, avec historique (`assigned`, `transferred`, `unassigned`), motif et auteur du transfert.
- Une table affectée à une serveuse capte automatiquement les commandes prises sur cette table.

**Messagerie**
- Fil de support avec statuts `envoyé → reçu → lu → répondu → clôturé`, pièce jointe facultative (3 Mo, image/PDF/texte).
- Réponse possible côté gérant général (`messaging.manage`) et côté gestionnaire Oymike.
- Une serveuse sans permission ne peut pas répondre à la place du gérant (403).

**Sécurité**
- Toute route vérifie la session, le rôle, le rattachement à la boutique et la permission, côté serveur.
- Un membre bloqué perd son accès **immédiatement** (session invalidée) ; **ses données restent** (commandes, scans, points, affectations).
- Les QR restent cloisonnés : scanner la table d'une autre boutique renvoie 403.
- Chaque affectation, correction de points et changement de barème écrit une ligne d'audit.

---

## 4. Déploiement (5 minutes)

1. **Sauvegarder** le dossier actuel du serveur (copie complète).
2. Copier le contenu du zip **par-dessus** en conservant les chemins (`public/` reste `public/`, etc.).
3. Redémarrer le service. Au démarrage, le serveur applique `schema-ops-mission6.sql` (idempotent : peut être rejoué sans perte).
4. Vérifier dans le journal la ligne d'initialisation, puis ces trois URLs :
   - `https://<votre-domaine>/merchant/` → 200
   - `https://<votre-domaine>/equipe/` → 200
   - `https://<votre-domaine>/admin/` → 200
5. Se connecter en marchand : l'onglet **Opérations** doit afficher les compteurs réels de la boutique.

### Vérification de la migration (facultatif)
```sql
SELECT COUNT(*) FROM staff_point_events;
\d team_conversations
\d staff_point_settings
```
Les 8 nouvelles tables sont : `staff_point_settings`, `staff_point_events`, `team_conversations`, `team_messages`, `team_message_reads`, `team_notifications`, `team_service_point_assignments`, `team_order_assignments`.

---

## 5. Comment refaire les tests

```bash
# 1. Suite automatisée sur base PostgreSQL dédiée (11 tests)
DATABASE_URL_TEST=postgres://user@host:5432/base_test node --test test/ops-postgres.test.js

# 2. Parcours complet en 19 étapes (53 vérifications) contre un serveur local
PORT=4913 DATABASE_URL=postgres://user@host:5432/base_test \
  ADMIN_USERNAME=admin ADMIN_PASSWORD=… SESSION_SECRET=… node server.js &
OPS_BASE_URL=http://127.0.0.1:4913 node tools/ops-journey.js
OPS_BASE_URL=http://127.0.0.1:4913 node tools/ui-test-6.js   # capture des 7 écrans
```

L'adresse du serveur testé se règle par `OPS_BASE_URL` (défaut `http://127.0.0.1:4913`) : ne lancez jamais ces deux outils contre la production.

Résultats mesurés le 22 novembre 2026 : **11/11** tests `ops-postgres`, **53/53** vérifications du parcours, **142/142** sur la suite complète `node --test`, **7/7** écrans sans erreur console.

---

## 6. Points d'attention honnêtes

- La **messagerie de support vers un gestionnaire Oymike** n'est active que si un gestionnaire est rattaché au marchand ; sinon l'interface l'indique clairement et le canal interne reste disponible. Aucun message n'est inventé ni redirigé silencieusement.
- Les notifications internes sont **persistées en base** et diffusées en temps réel au navigateur du marchand via le flux SSE existant. Il n'y a toujours **pas de push ni de SMS** vers les membres (limite déjà connue).
- Les serveuses ont chacune leur propre session : dans un même navigateur, un seul rôle à la fois (le serveur refuse les cookies de rôles mélangés).
- Une commande 100 % libre reste réservée au mode PostgreSQL (`PG_REQUIRED` en mode JSON), comme avant ce delta.
