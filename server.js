'use strict';

/**
 * The Scriptorium — a tiny, dependency-free HTTP server for the Pomodoro.
 *
 *   node server.js            # serves on http://localhost:4242
 *   PORT=8080 node server.js
 *
 * The server keeps two scrolls in the data directory:
 *   settings.json — the royal decrees (timer lengths)
 *   sessions.json — the ledger of completed vigils
 */

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { DEFAULT_SETTINGS, DecreeError, validateSettings, validateSession } = require('./lib/settings');
const { JsonStore } = require('./lib/store');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SESSIONS = 200;

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Scriptorium': 'The Royal Scriptorium',
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Scriptorium': 'The Royal Scriptorium',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new DecreeError('That scroll is too heavy for the royal courier (64 KB limit).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new DecreeError('The scroll is torn: it is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function createServer(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, 'data');
  const settingsStore = new JsonStore(path.join(dataDir, 'settings.json'), { ...DEFAULT_SETTINGS });
  const sessionsStore = new JsonStore(path.join(dataDir, 'sessions.json'), []);

  const log = options.log || ((message) => console.log(`[scriptorium] ${message}`));

  async function handleApi(req, res, pathname) {
    const method = req.method;

    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        realm: 'The Scriptorium',
        hour: new Date().toISOString(),
      });
    }

    if (pathname === '/api/settings' && method === 'GET') {
      const settings = await settingsStore.read();
      return sendJson(res, 200, { settings });
    }

    if (pathname === '/api/settings' && method === 'PUT') {
      const body = await readBody(req);
      const current = await settingsStore.read();
      const settings = validateSettings({ ...current, ...body });
      await settingsStore.write(settings);
      log(`The royal decrees were amended: ${JSON.stringify(settings)}`);
      return sendJson(res, 200, { settings });
    }

    if (pathname === '/api/sessions' && method === 'GET') {
      const sessions = await sessionsStore.read();
      return sendJson(res, 200, { sessions });
    }

    if (pathname === '/api/sessions' && method === 'POST') {
      const body = await readBody(req);
      const session = validateSession(body);
      const sessions = await sessionsStore.read();
      sessions.unshift(session);
      await sessionsStore.write(sessions.slice(0, MAX_SESSIONS));
      log(`A vigil was recorded in the ledger: ${session.mode} for ${session.durationSeconds}s`);
      return sendJson(res, 201, { session });
    }

    if (pathname === '/api/sessions' && method === 'DELETE') {
      await sessionsStore.write([]);
      log('The ledger was wiped clean by order of the crown.');
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, {
      error: 'No such chamber exists in this keep.',
      hint: 'Try /api/health, /api/settings, or /api/sessions.',
    });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendText(res, 405, 'The scribes only accept GET requests for these pages.');
      }

      const entry = STATIC_FILES.get(pathname);
      if (!entry) {
        return sendText(res, 404, 'This page lies beyond the castle walls. (404)');
      }

      const [fileName, contentType] = entry;
      let body;
      try {
        body = await fsp.readFile(path.join(PUBLIC_DIR, fileName));
      } catch {
        return sendText(res, 500, 'The royal archive is missing a page. (500)');
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
        'X-Scriptorium': 'The Royal Scriptorium',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      if (err instanceof DecreeError) {
        return sendJson(res, err.statusCode || 400, { error: err.message });
      }
      log(`A raven reports an error: ${err && err.stack ? err.stack : err}`);
      if (!res.headersSent) {
        return sendJson(res, 500, { error: 'A raven dropped the scroll. Please try again.' });
      }
      res.end();
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 4242;
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`[scriptorium] The Scriptorium is open at http://localhost:${port}`);
  });

  const shutdown = () => {
    console.log('[scriptorium] The candles are snuffed. Farewell.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer, MAX_SESSIONS };