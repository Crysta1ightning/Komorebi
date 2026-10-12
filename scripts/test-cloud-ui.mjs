import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import React, { act } from 'react';
import { addReviewWords, collectManualWord, libraryJSON, parseLibrary, STORAGE_KEY } from '../src/study.mjs';
import { documentFor } from '../src/study-sync.mjs';

const window = new Window({ url: 'https://cloud-ui.example/' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'MouseEvent', 'Event']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const now = new Date();
const cards = addReviewWords(collectManualWord([], { word: '猫', reading: 'ねこ' }, now), 1, now);
window.localStorage.setItem(STORAGE_KEY, libraryJSON(cards));
const listeners = new Set();
let session = null;
let rpcError = null;
let remote = { revision: 0, document: { version: 1, cards: [] } };
globalThis.__cloudUITestClient = {
  auth: {
    async getSession() { return { data: { session } }; },
    onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
    async signInWithPassword({ email }) { session = { user: { id: 'test-user', email } }; for (const callback of listeners) callback('SIGNED_IN', session); return {}; },
    async signOut() { session = null; for (const callback of listeners) callback('SIGNED_OUT', null); return {}; },
  },
  from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: structuredClone(remote) }; } }; },
  async rpc(_name, { expected_revision, next_document }) {
    if (rpcError) return { error: rpcError };
    if (expected_revision !== remote.revision) return { data: { applied: false, ...structuredClone(remote) } };
    remote = { revision: remote.revision + 1, document: structuredClone(next_document) };
    return { data: { applied: true, ...structuredClone(remote) } };
  },
};
const server = await createServer({
  server: { middlewareMode: true, ws: false }, appType: 'custom',
  ssr: { noExternal: ['@supabase/supabase-js'] },
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fake.supabase.co'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_test') },
  plugins: [{ name: 'test-cloud-client', enforce: 'pre', resolveId(id) { if (id === '@supabase/supabase-js') return '\0test-cloud-sdk'; }, load(id) { if (id === '\0test-cloud-sdk') return 'export function createClient(){return globalThis.__cloudUITestClient;}'; } }],
});
const { createRoot } = await import('react-dom/client');
const mount = document.createElement('div'); document.body.append(mount);
const root = createRoot(mount);
const click = async element => { assert.ok(element); await act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))); };
const wait = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });
const nav = label => [...document.querySelectorAll('.mobile-nav button')].find(button => button.textContent.endsWith(label));
try {
  const { default: MobileApp } = await server.ssrLoadModule('/src/MobileApp.jsx');
  await act(async () => root.render(React.createElement(MobileApp)));
  await click(nav('同步'));
  assert.ok(document.querySelector('.cloud-panel form'), 'Configured cloud shows login form');
  async function enter(label, value) {
    await act(async () => {
      const input = document.querySelector(`[aria-label="${label}"]`);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }
  await enter('同步帳號電子郵件', 'personal@example.com'); await enter('同步帳號密碼', 'test-password');
  await act(async () => document.querySelector('.cloud-panel form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await wait();
  assert.equal(remote.document.cards.length, 1, `First login uploads local collection: ${document.querySelector('.cloud-panel').textContent}`);
  assert.equal(remote.revision, 1);
  assert.ok(document.querySelector('.cloud-panel summary').textContent.includes('已同步'));
  assert.ok(document.querySelector('.cloud-counts').textContent.includes('此裝置：1'));
  assert.ok(document.querySelector('.cloud-counts').textContent.includes('雲端資料：1'));
  await click(nav('複習')); await click(document.querySelector('.flip-button')); await click(document.querySelector('.rating-good'));
  await wait();
  assert.equal(remote.document.cards[0].reviews.length, 1);
  assert.equal(remote.document.cards[0].familiarity.score, 90);
  remote.document = documentFor(collectManualWord(remote.document.cards, { word: '犬' }, now)); remote.revision++;
  const revision = remote.revision;
  await click(nav('同步')); await click([...document.querySelectorAll('.cloud-panel button')].find(button => button.textContent === '立即同步'));
  assert.ok(parseLibrary(window.localStorage.getItem(STORAGE_KEY)).some(card => card.word === '犬'), 'Other device word is downloaded');
  await wait();
  assert.equal(remote.revision, revision, 'No write loop after pulling unchanged cloud state');
  // A pending local addition forces a write and surfaces a missing RPC clearly.
  const extra = collectManualWord(parseLibrary(window.localStorage.getItem(STORAGE_KEY)), { word: '鳥' }, now);
  window.localStorage.setItem(STORAGE_KEY, libraryJSON(extra));
  rpcError = { code: 'PGRST202', message: 'internal debug detail must not be shown' };
  await click([...document.querySelectorAll('.cloud-panel button')].find(button => button.textContent === '立即同步'));
  assert.ok(document.querySelector('.cloud-panel summary').textContent.includes('找不到同步函式'));
  assert.ok(!document.querySelector('.cloud-panel').textContent.includes('internal debug detail'));
  assert.equal(parseLibrary(window.localStorage.getItem(STORAGE_KEY)).length, 3, 'Failed upload preserves local collection');
  rpcError = null;
  await click([...document.querySelectorAll('.cloud-panel button')].find(button => button.textContent === '立即同步'));
  assert.equal(remote.document.cards.length, 3);
  await click([...document.querySelectorAll('.cloud-panel button')].find(button => button.textContent === '登出'));
  assert.equal(parseLibrary(window.localStorage.getItem(STORAGE_KEY)).length, 3, 'Logout retains offline collection');
  assert.equal(listeners.size, 1);
  console.log('Cloud UI adapter passed: login, initial upload, rating sync, remote pull, no write loop, logout and local retention (mock backend).');
} finally {
  await act(async () => root.unmount()); await server.close(); await window.happyDOM.cancelAsync(); delete globalThis.__cloudUITestClient;
}
