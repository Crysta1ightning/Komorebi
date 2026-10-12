import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile('dist-mobile/index.html', 'utf8');
const manifest = JSON.parse(await readFile('dist-mobile/manifest.webmanifest', 'utf8'));
assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/');
assert.ok(html.includes('viewport-fit=cover'));
const assets = await readdir('dist-mobile/assets');
assert.ok(assets.every(file => /\.(js|css)$/.test(file)), 'Mobile deploy contains no video/audio assets');
for (const file of assets) {
  assert.ok((await stat(`dist-mobile/assets/${file}`)).size < 25 * 1024 * 1024);
  if (file.endsWith('.js')) {
    const text = await readFile(`dist-mobile/assets/${file}`, 'utf8');
    assert.ok(!/gsk_[A-Za-z0-9]{20,}/.test(text), 'Private transcription keys are not bundled');
    assert.ok(!text.includes('www.youtube.com/iframe_api'), 'No player dependency');
  }
}

const handlers = {}, store = new Map();
const cacheFor = name => {
  if (!store.has(name)) store.set(name, new Map());
  const entries = store.get(name);
  const key = request => typeof request === 'string' ? request : new URL(request.url).pathname;
  return { async addAll(files) { for (const file of files) { const path = file === '/' ? '/index.html' : file; entries.set(file, { ok: true, text: await readFile(`dist-mobile${path}`, 'utf8') }); } },
    async match(request) { return entries.get(key(request)); }, async put(request, response) { entries.set(key(request), response); } };
};
const caches = { async open(name) { return cacheFor(name); }, async keys() { return [...store.keys()]; }, async delete(name) { return store.delete(name); }, async match(request) { for (const name of store.keys()) { const value = await cacheFor(name).match(request); if (value) return value; } } };
let online = true, requests = 0;
const self = { location: { origin: 'https://test.example' }, clients: { async claim() {} }, async skipWaiting() {}, addEventListener(type, handler) { handlers[type] = handler; } };
runInNewContext(await readFile('dist-mobile/mobile-sw.js', 'utf8'), { self, caches, URL, fetch: async () => { requests++; if (!online) throw new Error('offline'); return { ok: true, marker: 'dictionary', clone() { return this; } }; } });
async function event(type, request) {
  const waits = []; let response;
  handlers[type]({ request, waitUntil(promise) { waits.push(promise); }, respondWith(promise) { response = promise; } });
  const result = await response; await Promise.all(waits); return result;
}
await event('install'); await event('activate');
const request = (path, mode = 'cors') => ({ url: `https://test.example${path}`, mode, method: 'GET' });
await event('fetch', request('/dictionary/1.json'));
const count = requests; online = false;
assert.equal((await event('fetch', request('/dictionary/1.json'))).marker, 'dictionary');
assert.equal(requests, count, 'Previously loaded dictionary works offline');
assert.ok((await event('fetch', request('/', 'navigate'))).text.includes('<title>Komorebi'));
assert.equal(await event('fetch', { url: 'https://project.supabase.co/rest/v1/study_libraries', method: 'GET', mode: 'cors' }), undefined, 'Private cloud responses never enter the offline cache');
console.log('Mobile deploy and service worker passed: install manifest, asset limits, offline shell/dictionary and excluded cloud responses.');
