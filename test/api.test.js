'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../server');
const { DEFAULT_SETTINGS, validateSettings, validateSession, DecreeError } = require('../lib/settings');
const { JsonStore } = require('../lib/store');

function reachableHost() {
  // Some sandboxes block loopback; prefer a real interface when one exists.
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

async function withServer(fn) {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scriptorium-test-'));
  const host = reachableHost();
  const server = createServer({ dataDir, log: () => {} });
  await new Promise((resolve) => server.listen(0, host, resolve));
  const { port } = server.address();
  const base = `http://${host}:${port}`;
  try {
    await fn({ base, dataDir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
}

async function request(base, method, pathname, body) {
  const options = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(base + pathname, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

test('the royal decrees default to a sensible Pomodoro', () => {
  assert.deepEqual(validateSettings({}), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.focusMinutes, 25);
});

test('decree validation rejects unchivalrous values', () => {
  assert.throws(() => validateSettings({ focusMinutes: 0 }), DecreeError);
  assert.throws(() => validateSettings({ focusMinutes: 1.5 }), DecreeError);
  assert.throws(() => validateSettings({ shortBreakMinutes: 999 }), DecreeError);
  assert.throws(() => validateSettings({ longBreakEvery: 1 }), DecreeError);
  assert.throws(() => validateSettings({ sound: 'yes' }), DecreeError);
  assert.throws(() => validateSettings(null), DecreeError);
  assert.throws(() => validateSession({ mode: 'nap', durationSeconds: 60 }), DecreeError);
  assert.throws(() => validateSession({ mode: 'focus', durationSeconds: -1 }), DecreeError);
  assert.throws(() => validateSession({ mode: 'focus', durationSeconds: 60, completedAt: 'yesterday' }), DecreeError);
});

test('the JSON store round-trips and recreates a missing scroll', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scriptorium-store-'));
  try {
    const store = new JsonStore(path.join(dir, 'nested', 'scroll.json'), { fallback: true });
    assert.deepEqual(await store.read(), { fallback: true });
    await store.write({ hello: 'scribe' });
    assert.deepEqual(await store.read(), { hello: 'scribe' });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('GET /api/health announces the realm', async () => {
  await withServer(async ({ base }) => {
    const res = await request(base, 'GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'ok');
    assert.equal(res.headers.get('x-scriptorium'), 'The Royal Scriptorium');
  });
});

test('the keep serves its front page and assets', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /The Scriptorium/);

    const css = await fetch(base + '/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const js = await fetch(base + '/app.js');
    assert.equal(js.status, 200);

    const missing = await fetch(base + '/dungeon');
    assert.equal(missing.status, 404);
  });
});

test('settings can be read, amended, and rejected', async () => {
  await withServer(async ({ base }) => {
    const initial = await request(base, 'GET', '/api/settings');
    assert.deepEqual(initial.json.settings, DEFAULT_SETTINGS);

    const amended = await request(base, 'PUT', '/api/settings', {
      focusMinutes: 50,
      shortBreakMinutes: 10,
      longBreakMinutes: 30,
      longBreakEvery: 3,
      sound: false,
    });
    assert.equal(amended.status, 200);
    assert.equal(amended.json.settings.focusMinutes, 50);
    assert.equal(amended.json.settings.sound, false);

    const reread = await request(base, 'GET', '/api/settings');
    assert.equal(reread.json.settings.focusMinutes, 50);

    const partial = await request(base, 'PUT', '/api/settings', { focusMinutes: 40 });
    assert.equal(partial.status, 200);
    assert.equal(partial.json.settings.focusMinutes, 40);
    assert.equal(partial.json.settings.shortBreakMinutes, 10, 'unspecified decrees keep their value');
    assert.equal(partial.json.settings.longBreakEvery, 3);

    const bad = await request(base, 'PUT', '/api/settings', { focusMinutes: 0 });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /between 1 and 180/);

    const torn = await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(torn.status, 400);
  });
});

test('the ledger records, lists, and burns vigils', async () => {
  await withServer(async ({ base }) => {
    const empty = await request(base, 'GET', '/api/sessions');
    assert.deepEqual(empty.json.sessions, []);

    const created = await request(base, 'POST', '/api/sessions', {
      mode: 'focus',
      durationSeconds: 1500,
      completedAt: '2026-01-02T03:04:05.000Z',
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.session.mode, 'focus');

    const listed = await request(base, 'GET', '/api/sessions');
    assert.equal(listed.json.sessions.length, 1);
    assert.equal(listed.json.sessions[0].durationSeconds, 1500);

    const bad = await request(base, 'POST', '/api/sessions', { mode: 'focus', durationSeconds: 0 });
    assert.equal(bad.status, 400);

    const cleared = await request(base, 'DELETE', '/api/sessions');
    assert.equal(cleared.status, 200);
    const after = await request(base, 'GET', '/api/sessions');
    assert.deepEqual(after.json.sessions, []);
  });
});

test('unknown chambers return a courteous 404', async () => {
  await withServer(async ({ base }) => {
    const res = await request(base, 'GET', '/api/tower');
    assert.equal(res.status, 404);
    assert.match(res.json.error, /No such chamber/);
  });
});