// Mission 10 — compression des réponses.
//
// Constat d'audit : aucune réponse n'était compressée. `/merchant.js` partait à 163 637 octets
// et le document marchand à 74 Ko, soit ~6× leur taille compressée. Sur une 3G lente, c'est le
// premier facteur de lenteur — pour les espaces de travail comme pour la page publique ouverte
// après un scan.
//
// Choix techniques :
//   - brotli quand le navigateur l'accepte (≈ 20 % plus petit que gzip), sinon gzip ;
//   - les images et les médias déjà compressés ne sont jamais recompressés (aucun gain, CPU perdu) ;
//   - la compression est faite à la volée, avec un cache mémoire borné des fichiers statiques,
//     pour ne pas recompresser le même fichier à chaque visiteur ;
//   - les flux SSE (`text/event-stream`) et les réponses déjà encodées sont laissés intacts.
'use strict';

const zlib = require('node:zlib');
const fs = require('node:fs/promises');
const path = require('node:path');

const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|manifest\+json|xml|ld\+json)|image\/svg\+xml)/i;
const ALREADY_COMPRESSED = /^(?:image\/(?!svg)|video\/|audio\/|application\/(?:zip|gzip|x-zip-compressed|pdf|octet-stream)|font\/woff)/i;
const MIN_BYTES = 700; // en dessous, l'en-tête coûte plus cher que le gain
const CACHE_LIMIT_BYTES = 24 * 1024 * 1024; // borne mémoire du cache de fichiers statiques

const cache = new Map(); // clé -> { brotli, gzip, etag, mtimeMs, size }
let cachedBytes = 0;

function acceptEncoding(req) {
  const header = String(req.headers['accept-encoding'] || '');
  return { brotli: /\bbr\b/.test(header), gzip: /\bgzip\b/.test(header) };
}

function isCompressible(type) {
  const value = String(type || '').split(';')[0].trim();
  if (!value) return false;
  if (ALREADY_COMPRESSED.test(value)) return false;
  return COMPRESSIBLE.test(value);
}

function compress(buffer, { brotli, gzip }) {
  if (brotli) return { encoding: 'br', body: zlib.brotliCompressSync(buffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length } }) };
  if (gzip) return { encoding: 'gzip', body: zlib.gzipSync(buffer, { level: 7 }) };
  return null;
}

function cacheGet(key) { return cache.get(key) || null; }
function cacheSet(key, value) {
  if (value.brotli?.length + value.gzip?.length > CACHE_LIMIT_BYTES / 4) return;
  const previous = cache.get(key);
  if (previous) cachedBytes -= (previous.brotli?.length || 0) + (previous.gzip?.length || 0);
  cache.set(key, value);
  cachedBytes += (value.brotli?.length || 0) + (value.gzip?.length || 0);
  while (cachedBytes > CACHE_LIMIT_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value;
    const row = cache.get(oldest);
    cachedBytes -= (row.brotli?.length || 0) + (row.gzip?.length || 0);
    cache.delete(oldest);
  }
}

// Middleware principal. À monter avant les routes et avant express.static.
//
// Les réponses sont mises en tampon jusqu'à 1 Mo (les pages et API JSON font bien moins) : c'est
// le seul moyen de compresser aussi les réponses envoyées en flux par `res.sendFile`, comme la
// page publique ouverte après un scan. Au-delà de cette borne, ou pour un flux SSE, la réponse
// repart sans compression, immédiatement, sans rien casser.
const MAX_BUFFER = 1024 * 1024;

function compressionMiddleware() {
  return function compressResponse(req, res, next) {
    const accepted = acceptEncoding(req);
    if ((!accepted.brotli && !accepted.gzip) || req.method === 'HEAD') return next();

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    let mode = 'collect'; // 'collect' → 'pass'
    let chunks = [];
    let size = 0;

    const flushRaw = () => {
      mode = 'pass';
      for (const chunk of chunks) originalWrite(chunk);
      chunks = []; size = 0;
    };

    res.write = function write(chunk, encoding, callback) {
      if (mode === 'pass' || !chunk) return originalWrite(chunk, encoding, callback);
      const type = String(res.getHeader('Content-Type') || '');
      // Un flux ne doit jamais être tamponné : SSE et téléchargements repartent en direct.
      if (/event-stream/i.test(type) || res.getHeader('Content-Encoding')) { flushRaw(); return originalWrite(chunk, encoding, callback); }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
      chunks.push(buffer); size += buffer.length;
      if (size > MAX_BUFFER) flushRaw();
      if (typeof callback === 'function') callback();
      return true;
    };

    res.end = function end(chunk, encoding, callback) {
      if (mode === 'pass') return originalEnd(chunk, encoding, callback);
      try {
        if (chunk && typeof chunk !== 'function') {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
          chunks.push(buffer); size += buffer.length;
        }
        const type = String(res.getHeader('Content-Type') || '');
        if (!isCompressible(type) || res.getHeader('Content-Encoding') || size < MIN_BYTES) {
          mode = 'pass';
          for (const piece of chunks) originalWrite(piece);
          chunks = [];
          return originalEnd(typeof callback === 'function' ? callback : undefined);
        }
        const body = Buffer.concat(chunks); chunks = [];
        const result = compress(body, accepted);
        if (!result) return originalEnd(body, typeof encoding === 'string' ? undefined : callback);
        res.setHeader('Content-Encoding', result.encoding);
        res.setHeader('Vary', 'Accept-Encoding');
        res.removeHeader('Content-Length');
        return originalEnd(result.body, typeof encoding === 'string' ? undefined : callback);
      } catch (_) {
        mode = 'pass';
        try { for (const piece of chunks) originalWrite(piece); } catch (__) {}
        return originalEnd();
      }
    };
    next();
  };
}

// Service des fichiers statiques avec compression mise en cache.
// `express.static` gère les en-têtes (ETag, Last-Modified, 304) ; on compresse seulement la
// première lecture de chaque fichier, puis on sert la version compressée en mémoire.
function staticWithCompression(express, staticDir, options = {}) {
  const fallback = express.static(staticDir, options);
  return async function serveStatic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fallback(req, res, next);
    const accepted = acceptEncoding(req);
    if (!accepted.brotli && !accepted.gzip) return fallback(req, res, next);
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); }
    catch (_) { return fallback(req, res, next); }
    if (!pathname || pathname.includes('\0')) return fallback(req, res, next);
    const filePath = path.join(staticDir, pathname);
    if (!filePath.startsWith(staticDir)) return fallback(req, res, next);
    let stat;
    try { stat = await fs.stat(filePath); } catch (_) { return fallback(req, res, next); }
    if (!stat.isFile() || stat.size < MIN_BYTES) return fallback(req, res, next);
    const type = typeOf(express, filePath);
    if (!isCompressible(type)) return fallback(req, res, next);

    const key = `${filePath}:${stat.mtimeMs}:${accepted.brotli ? 'br' : 'gz'}`;
    let entry = cacheGet(key);
    if (!entry) {
      try {
        const raw = await fs.readFile(filePath);
        const result = compress(raw, accepted);
        if (!result) return fallback(req, res, next);
        const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}-${result.encoding}"`;
        entry = { brotli: result.encoding === 'br' ? result.body : null, gzip: result.encoding === 'gzip' ? result.body : null, etag, size: stat.size, mtimeMs: stat.mtimeMs };
        cacheSet(key, entry);
      } catch (_) { return fallback(req, res, next); }
    }
    const body = accepted.brotli ? entry.brotli : entry.gzip;
    if (!body) return fallback(req, res, next);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Encoding', accepted.brotli ? 'br' : 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('ETag', entry.etag);
    const maxAge = Number(options.maxAge) || 0;
    res.setHeader('Cache-Control', maxAge ? `public, max-age=${Math.floor(maxAge / 1000)}` : 'public, max-age=0, must-revalidate');
    if (req.headers['if-none-match'] === entry.etag) { res.statusCode = 304; return res.end(); }
    res.setHeader('Content-Length', String(body.length));
    return res.end(req.method === 'HEAD' ? undefined : body);
  };
}

function typeOf(express, filePath) {
  try { return express.static.mime?.lookup?.(filePath) || guessType(filePath); }
  catch (_) { return guessType(filePath); }
}
function guessType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' }[ext] || 'application/octet-stream';
}

module.exports = { compressionMiddleware, staticWithCompression, isCompressible, acceptEncoding, cacheSize: () => cache.size };
