'use strict';

// ============================================================================================
// Référentiel de l'équipe marchande : rôles, permissions, codes d'activation.
//
// Ce fichier ne contient AUCUNE règle métier exécutable : uniquement des listes stables.
// Les contrôles d'accès sont dans team.js (côté serveur) et l'interface ne fait que refléter.
// ============================================================================================

const ROLES = [
  { code: 'general_manager', label: 'Gérant général', short: 'Gérant', designationPrefix: 'Gérant' },
  { code: 'waitress', label: 'Serveuse', short: 'Serveuse', designationPrefix: 'Serveuse' },
];

// Le rôle « Administrateur général » et le rôle « Marchand » ne sont pas des membres d'équipe :
// ils existent déjà (session admin, compte marchand). On ne crée donc jamais de membre pour eux.
const PLATFORM_ROLES = ['admin_general', 'merchant'];

// Permissions vérifiées côté serveur. `waitressDefault` / `managerDefault` servent seulement à
// proposer une case pré-cochée : le marchand peut tout modifier, sauf les permissions réservées.
const PERMISSIONS = [
  { code: 'orders.view', label: 'Voir les commandes', description: 'Consulter la liste et le détail des commandes de la boutique.', appliesTo: 'both', waitressDefault: true, managerDefault: true },
  { code: 'orders.create', label: 'Prendre une commande', description: 'Enregistrer une commande au nom du client.', appliesTo: 'both', waitressDefault: true, managerDefault: true },
  { code: 'orders.update', label: 'Modifier une commande', description: 'Corriger une commande non clôturée.', appliesTo: 'both', waitressDefault: false, managerDefault: true },
  { code: 'orders.cancel', label: 'Annuler une commande', description: 'Annuler une commande et tracer le motif.', appliesTo: 'both', waitressDefault: false, managerDefault: true },
  { code: 'orders.discount', label: 'Accorder une remise', description: 'Appliquer une remise dans la limite fixée par le marchand.', appliesTo: 'both', waitressDefault: false, managerDefault: true },
  { code: 'orders.free_price', label: 'Saisir un prix libre', description: 'Enregistrer un article hors catalogue avec un prix décidé sur place.', appliesTo: 'both', waitressDefault: true, managerDefault: true },
  { code: 'scans.use', label: 'Scanner un QR code', description: 'Utiliser la caméra pour reconnaître une table ou un emplacement.', appliesTo: 'both', waitressDefault: true, managerDefault: true },
  { code: 'points.view', label: 'Voir les points des serveuses', description: 'Consulter les points et statistiques individuelles.', appliesTo: 'both', waitressDefault: false, managerDefault: true },
  { code: 'tables.manage', label: 'Gérer les tables', description: 'Créer, renommer, désactiver les tables et emplacements.', appliesTo: 'both', waitressDefault: false, managerDefault: true },
  { code: 'products.view', label: 'Consulter les produits', description: 'Voir le catalogue de la boutique et les disponibilités.', appliesTo: 'both', waitressDefault: true, managerDefault: true },
  { code: 'products.update', label: 'Modifier les produits', description: 'Modifier une fiche produit (nom, description, photo).', appliesTo: 'both', waitressDefault: false, managerDefault: true },
  { code: 'products.price', label: 'Modifier les prix', description: 'Changer le prix de vente d’un produit de la boutique.', appliesTo: 'both', waitressDefault: false, managerDefault: false },
  { code: 'products.availability', label: 'Gérer les disponibilités', description: 'Rendre un produit disponible ou en rupture.', appliesTo: 'both', waitressDefault: true, managerDefault: true },
  { code: 'stock.view', label: 'Consulter les stocks', description: 'Voir les quantités restantes.', appliesTo: 'both', waitressDefault: false, managerDefault: true },
  { code: 'stats.view', label: 'Consulter les statistiques', description: 'Voir les chiffres de la boutique.', appliesTo: 'both', waitressDefault: false, managerDefault: true },
  { code: 'activity.view', label: 'Voir l’activité de l’équipe', description: 'Consulter les actions des serveuses et des gérants.', appliesTo: 'general_manager', waitressDefault: false, managerDefault: true },
  { code: 'tasks.view_all', label: 'Voir toutes les tâches', description: 'Consulter les tâches attribuées à toute l’équipe.', appliesTo: 'general_manager', waitressDefault: false, managerDefault: true },
  { code: 'tasks.assign', label: 'Attribuer des tâches', description: 'Créer et attribuer des tâches aux serveuses.', appliesTo: 'general_manager', waitressDefault: false, managerDefault: true },
  { code: 'tables.view_all', label: 'Voir toutes les tables', description: 'Consulter l’occupation, l’affectation et l’historique des tables de la boutique.', appliesTo: 'both', waitressDefault: true, managerDefault: true },
  { code: 'tables.assign', label: 'Affecter les tables', description: 'Attribuer une table ou un emplacement à une serveuse, et réaffecter.', appliesTo: 'general_manager', waitressDefault: false, managerDefault: true },
  { code: 'messaging.manage', label: 'Répondre aux messages', description: 'Lire et répondre aux messages envoyés au gestionnaire.', appliesTo: 'general_manager', waitressDefault: false, managerDefault: true },
  { code: 'messaging.reply', label: 'Écrire à mon gestionnaire', description: 'Ouvrir une demande et répondre dans son propre fil.', appliesTo: 'both', waitressDefault: true, managerDefault: true },
  { code: 'points.manage', label: 'Corriger les points', description: 'Ajouter ou retirer des points avec un motif. Jamais accordé par défaut.', appliesTo: 'general_manager', waitressDefault: false, managerDefault: false },
  { code: 'members.manage', label: 'Gérer les membres', description: 'Créer, bloquer, archiver des membres. Jamais accordé par défaut : réservé au marchand.', appliesTo: 'general_manager', waitressDefault: false, managerDefault: false },
];

// Permissions qu'un membre ne peut JAMAIS recevoir ni s'attribuer lui-même.
const OWNER_ONLY_PERMISSIONS = [
  'owner.settings',        // paramètres de la boutique (nom, thème, paiement, publication)
  'owner.transfer',        // transfert de propriété
  'owner.delete',          // suppression / archivage du compte marchand
  'owner.team_permissions' // attribution des permissions et des rôles
];

const PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

function permissionsForRole(role) {
  return PERMISSIONS.filter((p) => p.appliesTo === 'both' || p.appliesTo === role).map((p) => p.code);
}

function defaultPermissionsFor(role) {
  return PERMISSIONS.filter((p) => (p.appliesTo === 'both' || p.appliesTo === role)
    && (role === 'general_manager' ? p.managerDefault : p.waitressDefault)).map((p) => p.code);
}

// Un code d'activation : 4 groupes de 4 caractères, alphabet sans ambiguïté (ni I, ni O, ni 0, ni 1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUPS = 4;
const CODE_LENGTH = 4;

function generateActivationCode(randomBytes) {
  // `randomBytes` est injecté (node:crypto.randomBytes) : aucune dépendance implicite.
  const bytes = randomBytes(CODE_GROUPS * CODE_LENGTH);
  const chars = [];
  for (let i = 0; i < bytes.length; i += 1) chars.push(ALPHABET[bytes[i] % ALPHABET.length]);
  const groups = [];
  for (let g = 0; g < CODE_GROUPS; g += 1) groups.push(chars.slice(g * CODE_LENGTH, (g + 1) * CODE_LENGTH).join(''));
  return groups.join('-');
}

function normalizeActivationCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== CODE_GROUPS * CODE_LENGTH) return '';
  const groups = [];
  for (let g = 0; g < CODE_GROUPS; g += 1) groups.push(raw.slice(g * CODE_LENGTH, (g + 1) * CODE_LENGTH));
  const normalized = groups.join('-');
  // Rejette tout caractère hors alphabet : un code ne doit jamais être « à peu près » le bon.
  return [...normalized.replace(/-/g, '')].every((c) => ALPHABET.includes(c)) ? normalized : '';
}

function codeHint(code) {
  return String(code || '').replace(/-/g, '').slice(-4);
}

module.exports = {
  ROLES, PLATFORM_ROLES, PERMISSIONS, PERMISSION_CODES, OWNER_ONLY_PERMISSIONS,
  permissionsForRole, defaultPermissionsFor, generateActivationCode, normalizeActivationCode, codeHint,
  ALPHABET,
};
