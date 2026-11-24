#!/usr/bin/env node
'use strict';

// ============================================================================================
// OYMIKE TECH — DÉMARRAGE EN UN CLIC (Windows, macOS, Linux)
//
// Objectif : ouvrir l'espace Administrateur général sur VOTRE ordinateur, sans connaître
// PostgreSQL, sans ligne de commande compliquée, sans rien installer d'autre que Node.js.
//
// Ce script :
//   1. vérifie Node.js ;
//   2. installe les dépendances si besoin (npm install) ;
//   3. choisit automatiquement le stockage :
//        - PostgreSQL si DATABASE_URL est défini et répond,
//        - sinon stockage local JSON (fichier data/store.json) — suffisant pour ouvrir l'admin ;
//   4. génère un fichier .env avec un secret de session aléatoire ;
//   5. démarre le serveur et ouvre le navigateur sur /admin/.
//
// Usage :  node demarrer.js   (ou double-clic sur DÉMARRER-WINDOWS.bat / DEMARRER-MAC-LINUX.command)
// ============================================================================================

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

const ROOT = __dirname;
const IS_WINDOWS = process.platform === 'win32';
const ENV_FILE = path.join(ROOT, '.env');

function line(text = '') { process.stdout.write(`${text}\n`); }
function title(text) { line(`\n=== ${text} ===`); }

// ------------------------------------------------------------------ 1. Node.js
function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    line(`\nNode.js ${process.versions.node} est trop ancien.`);
    line('Installez Node.js 20 ou plus récent : https://nodejs.org/fr/download');
    process.exit(1);
  }
  line(`Node.js ${process.versions.node} — OK`);
}

// ------------------------------------------------------------------ 2. dépendances
function dependenciesPresent() {
  return ['express', 'pg', 'dotenv', 'web-push'].every((name) => fs.existsSync(path.join(ROOT, 'node_modules', name)));
}

function installDependencies() {
  if (dependenciesPresent()) { line('Dépendances déjà présentes.'); return; }
  title('Installation des dépendances (une seule fois, 1 à 2 minutes)');
  const npm = IS_WINDOWS ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: IS_WINDOWS });
  if (result.status !== 0) {
    line('\nL’installation a échoué. Vérifiez votre connexion Internet, puis relancez ce script.');
    line('Si le problème persiste, supprimez le dossier node_modules et réessayez.');
    process.exit(1);
  }
}

// ------------------------------------------------------------------ 3. port libre
function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function pickPort() {
  const preferred = Number(process.env.PORT || 3000);
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await portFree(port)) return port;
  }
  line('Aucun port libre entre 3000 et 3020. Fermez l’application qui les utilise, puis relancez.');
  process.exit(1);
}

// ------------------------------------------------------------------ 4. base de données
async function postgresReachable(connectionString) {
  if (!connectionString) return false;
  let pg;
  try { pg = require('pg'); } catch (_) { return false; }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 4000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch (_) {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function chooseDatabase() {
  const declared = (process.env.DATABASE_URL || '').trim();
  if (declared) {
    line('DATABASE_URL détecté, vérification de la connexion…');
    if (await postgresReachable(declared)) {
      line('PostgreSQL répond : toutes les fonctions seront disponibles (consignation, équipes, commandes).');
      return declared;
    }
    line('PostgreSQL ne répond pas à cette adresse.');
    line('→ Démarrage en stockage local JSON : l’espace admin s’ouvre, mais les modules');
    line('  qui exigent PostgreSQL (consignation, audit avancé) resteront indisponibles.');
    return '';
  }
  line('Aucun DATABASE_URL défini.');
  line('→ Démarrage en stockage local JSON (data/store.json). Parfait pour ouvrir l’admin');
  line('  immédiatement. Pour la consignation, installez PostgreSQL et définissez DATABASE_URL.');
  return '';
}

// ------------------------------------------------------------------ 5. .env
function ensureEnv({ databaseUrl, port }) {
  let current = '';
  try { current = fs.readFileSync(ENV_FILE, 'utf8'); } catch (_) {}
  const has = (key) => new RegExp(`^${key}=`, 'm').test(current);

  const sessionSecret = has('SESSION_SECRET')
    ? (current.match(/^SESSION_SECRET=(.*)$/m) || [])[1]
    : crypto.randomBytes(48).toString('base64url');

  const adminUser = (current.match(/^ADMIN_USERNAME=(.*)$/m) || [])[1] || 'admin';
  const adminPass = (current.match(/^ADMIN_PASSWORD=(.*)$/m) || [])[1] || 'admin1234';

  const wanted = {
    NODE_ENV: 'development',
    PORT: String(port),
    ADMIN_USERNAME: adminUser,
    ADMIN_PASSWORD: adminPass,
    SESSION_SECRET: sessionSecret,
  };
  if (databaseUrl) wanted.DATABASE_URL = databaseUrl;

  // On réécrit proprement le fichier : les clés déjà choisies par l'utilisateur sont conservées.
  const lines = [
    '# Généré par demarrer.js — modifiable à la main.',
    '# ADMIN_PASSWORD : changez-le avant de mettre l’application en ligne.',
  ];
  for (const [key, value] of Object.entries(wanted)) lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV_FILE, `${lines.join('\n')}\n`, 'utf8');
  return { adminUser, adminPass };
}

// ------------------------------------------------------------------ 6. démarrage
function openBrowser(url) {
  try {
    if (IS_WINDOWS) spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (_) { /* l'utilisateur ouvrira l'adresse affichée */ }
}

async function main() {
  line('');
  line('╔══════════════════════════════════════════════════╗');
  line('║   OYMIKE TECH — démarrage local                  ║');
  line('║   Espace Administrateur général (PDG)            ║');
  line('╚══════════════════════════════════════════════════╝');
  checkNode();
  installDependencies();
  const port = await pickPort();
  const databaseUrl = await chooseDatabase();
  const { adminUser, adminPass } = ensureEnv({ databaseUrl, port });

  const url = `http://localhost:${port}/admin/`;
  title('Démarrage du serveur');
  line(`Adresse : ${url}`);
  line(`Identifiant : ${adminUser}`);
  line(`Mot de passe : ${adminPass}`);
  line('Pour arrêter : Ctrl + C dans cette fenêtre.');
  line('');

  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}), PORT: String(port), NODE_ENV: 'development' },
  });

  // On attend que le serveur réponde avant d'ouvrir le navigateur (max 20 s).
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        clearInterval(timer);
        line('\nServeur prêt. Ouverture du navigateur…');
        openBrowser(url);
      }
    } catch (_) { /* pas encore prêt */ }
    if (Date.now() - started > 20000) { clearInterval(timer); openBrowser(url); }
  }, 600);

  child.on('exit', (code) => { clearInterval(timer); process.exit(code ?? 0); });
  process.on('SIGINT', () => { child.kill('SIGINT'); });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); });
}

main().catch((error) => {
  line(`\nErreur inattendue : ${error.message}`);
  process.exit(1);
});
