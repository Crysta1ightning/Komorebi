import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const files = (await readdir('dist-mobile/assets')).filter(file => /\.(js|css)$/.test(file));
const version = createHash('sha256').update(await readFile('dist-mobile/index.html')).update(files.join('|')).digest('hex').slice(0, 12);
const dictionaryVersion = createHash('sha256').update(await readFile('dist-mobile/dictionary/metadata.json')).digest('hex').slice(0, 12);
const precache = ['/', '/index.html', '/manifest.webmanifest', '/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', ...files.map(file => `/assets/${file}`)];
const worker = `const CACHE = 'komorebi-mobile-${version}';
const DICTIONARY = 'komorebi-dictionary-${dictionaryVersion}';
const FILES = ${JSON.stringify(precache)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('komorebi-mobile-') && key !== CACHE) || (key.startsWith('komorebi-dictionary-') && key !== DICTIONARY)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Auth tokens and Supabase responses never enter the service-worker cache.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
    return;
  }
  if (!url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/dictionary/') && !url.pathname.startsWith('/icons/')) return;
  event.respondWith(caches.open(url.pathname.startsWith('/dictionary/') ? DICTIONARY : CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(cache.put(event.request, copy).catch(() => {}));
    }
    return response;
  }));
});
`;
await writeFile('dist-mobile/mobile-sw.js', worker);
await writeFile('dist-mobile/_headers', '/mobile-sw.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/dictionary/*\n  Cache-Control: public, max-age=86400\n');
console.log(`Offline shell ${version}: ${precache.length} files. Dictionary shards cached as used.`);
