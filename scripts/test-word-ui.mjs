import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import React, { act } from 'react';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

if (!existsSync('artifacts/TE2mcomyNH8/processed/revisions/a6f14fae215e14fa/transcript.json')) {
  console.log('Skipped video UI integration: local video fixture is not included in the source repository.');
  process.exit(0);
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  if (typeof url === 'string' && /^\/dictionary\/\d+\.json$/.test(url)) return { ok: true, json: async () => JSON.parse(await readFile(`public${url}`, 'utf8')) };
  return originalFetch(url);
};

const window = new Window({ url: 'http://localhost:5173' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'MouseEvent', 'Event']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Native dialog focus/backdrop behavior belongs to browser QA. Here only
// emulate opening/closing to verify our React actions and player integration.
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };

const calls = { pauses: 0, seeks: [], plays: 0 };
const spoken = [];
Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
  getVoices: () => [{ name: 'Japanese test voice', lang: 'ja-JP' }],
  addEventListener() {}, removeEventListener() {}, cancel() {}, speak: utterance => spoken.push(utterance),
} });
Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
  constructor(text) { this.text = text; }
} });
window.YT = { Player: class {
  constructor(mount, options) {
    this.iframe = document.createElement('iframe');
    mount.replaceWith(this.iframe);
    queueMicrotask(() => options.events.onReady({ target: this }));
  }
  getIframe() { return this.iframe; }
  getCurrentTime() { return 0; }
  getPlayerState() { return 2; }
  getAvailablePlaybackRates() { return [0.5, 0.75, 1, 1.25, 1.5]; }
  setPlaybackRate() {}
  pauseVideo() { calls.pauses++; }
  seekTo(value) { calls.seeks.push(value); }
  playVideo() { calls.plays++; }
  destroy() { this.iframe.remove(); }
} };

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom',
  define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' } });
const { createRoot } = await import('react-dom/client');
const mount = document.createElement('div');
document.body.append(mount);
const root = createRoot(mount);
const click = async element => {
  assert.ok(element, 'Expected clickable element');
  await act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
};

try {
  const { default: App } = await server.ssrLoadModule('/src/App.jsx');
  const { videos } = await server.ssrLoadModule('/src/data/video-collection.js');
  const { vocabulary, transcript, translations } = videos.find(item => item.video.id === 'TE2mcomyNH8');
  await act(async () => { root.render(React.createElement(App, { initialVideoId: 'TE2mcomyNH8' })); });
  const words = [...document.querySelectorAll('.word-token')];
  const englishRows = [...document.querySelectorAll('.row-translation')];
  assert.equal(englishRows.length, transcript.cues.length, 'Every transcript passage has an English sentence');
  assert.ok(englishRows.every((row, index) => row.textContent === translations.cues[index].english));
  assert.equal(document.querySelector('.current-translation').textContent, translations.cues[0].english);
  assert.ok(englishRows.every(row => row.lang === 'en'));
  assert.ok(words.length >= vocabulary.cues.flatMap(cue => cue.tokens).filter(token => token.selectable).length);
  assert.equal(document.querySelector('button button'), null, 'No nested interactive buttons');

  const indexed = vocabulary.cues.flatMap((cue, cueIndex) => cue.tokens.filter(token => token.selectable).map((token, wordIndex) => ({ token, cueIndex, wordIndex })));
  const buttonFor = item => document.querySelectorAll('.transcript-row')[item.cueIndex].querySelectorAll('.word-token')[item.wordIndex];
  const matched = indexed.find(item => item.token.entryIds.length);
  assert.ok(matched, 'Imported fixture should include a word with a dictionary meaning');

  await click(buttonFor(matched));
  assert.equal(calls.pauses, 1, 'Word lookup pauses the player');
  assert.equal(calls.seeks.length, 0, 'Word lookup does not trigger parent passage seek');
  assert.equal(document.querySelector('dialog h2').textContent, matched.token.surface);
  assert.ok(document.querySelector('.word-entry li p').textContent.length);
  assert.ok(document.querySelector('.word-base').textContent.includes(matched.token.base));
  await click(document.querySelector('dialog [aria-label="朗讀單字"]'));
  assert.equal(spoken.at(-1).text, matched.token.reading || matched.token.surface, 'Video word popup speaks the selected word');
  assert.equal(spoken.at(-1).voice.lang, 'ja-JP');
  spoken.length = 0;
  await click(document.querySelector('.word-close'));
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(calls.plays, 0, 'Closing lookup leaves playback paused');

  await click(buttonFor(matched));
  await click(document.querySelector('.word-context button'));
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(calls.seeks.length, 1);
  assert.equal(calls.plays, 1, 'Replay seeks and starts the source passage');

  const unknown = indexed.find(item => !item.token.entryIds.length && !item.token.grammar);
  await click(buttonFor(unknown || matched));
  if (unknown) assert.ok(document.querySelector('dialog').textContent.includes('No dictionary match found.'));
  await act(async () => document.querySelector('dialog').dispatchEvent(new window.Event('cancel', { cancelable: true })));
  assert.equal(document.querySelector('dialog'), null, 'Escape/cancel dismisses lookup');

  const { STORAGE_KEY, parseLibrary, wordIdentity } = await server.ssrLoadModule('/src/study.mjs');
  const saved = () => parseLibrary(window.localStorage.getItem(STORAGE_KEY));
  const identity = wordIdentity(matched.token, vocabulary);
  assert.ok(saved().find(card => card.id === identity.id)?.starred, 'Word click automatically persists a star');
  assert.equal(saved().filter(card => card.id === identity.id).length, 1, 'Repeated clicks do not duplicate cards');
  await click(buttonFor(matched));
  await click(document.querySelector('dialog .study-star'));
  assert.equal(saved().find(card => card.id === identity.id).starred, false, 'Accidental selection can be unstarred');
  assert.equal(document.querySelector('dialog .study-star').getAttribute('aria-pressed'), 'false');
  await click(document.querySelector('.word-close'));
  if (unknown) {
    await click(buttonFor(unknown));
    await click(document.querySelector('dialog .study-star'));
    await click(document.querySelector('.word-close'));
  }
  await click(buttonFor(matched));
  await click(document.querySelector('.word-close'));
  const tab = name => [...document.querySelectorAll('.app-tabs button')].find(button => button.textContent.startsWith(name));
  await click(tab('單字複習'));
  assert.equal(document.querySelector('.flashcard'), null, 'Choose the daily count before starting');
  assert.equal(document.querySelector('#review-count-input').value, '50');
  assert.ok(document.querySelector('.saved-word .familiarity-score').textContent.includes('0 / 100'));
  await click(document.querySelector('.review-picker button'));
  assert.equal(document.querySelector('.flashcard h2').textContent, identity.word);
  const beforeLookup = saved();
  await click(document.querySelector('.saved-word-open'));
  assert.equal(document.querySelector('dialog h2').textContent, matched.token.surface, 'Collection uses the same video word popup');
  assert.ok(document.querySelector('dialog .word-entry li p').textContent.length);
  assert.equal(document.querySelector('dialog .word-context p[lang="en"]').textContent, translations.cues[matched.cueIndex].english);
  await click(document.querySelector('dialog [aria-label="朗讀單字"]'));
  assert.equal(spoken.at(-1).text, matched.token.reading || matched.token.surface);
  spoken.length = 0;
  await click(document.querySelector('.word-close'));
  assert.deepEqual(saved(), beforeLookup, 'Looking up a saved word does not change scores or review progress');
  assert.equal(document.querySelector('.app-tabs [aria-current="page"]').textContent.startsWith('單字複習'), true);
  assert.equal(document.querySelector('.saved-word button button'), null, 'Word and star are separate controls');
  assert.equal(document.querySelector('.flashcard-answer'), null, 'Reading and meanings stay hidden before reveal');
  assert.equal(document.querySelector('.review-ratings'), null, 'Cannot rate before revealing');
  await click(document.querySelector('.review-session .flip-button'));
  assert.equal(document.querySelector('.review-reading span').textContent, identity.reading);
  assert.ok(document.querySelector('.review-definition li').textContent.length, 'Dictionary meanings on the back');
  assert.ok(document.querySelector('.review-example p').textContent.length, 'Source subtitle becomes an example');
  assert.equal(document.querySelector('.review-example-translation').textContent,
    translations.cues[matched.cueIndex].english, 'Review example includes its English translation');
  assert.equal(saved().find(card => card.id === identity.id).examples[0].english,
    translations.cues[matched.cueIndex].english, 'English example is persisted with the card');
  await click(document.querySelector('[aria-label="朗讀單字"]'));
  assert.equal(spoken[0].text, identity.reading || identity.word);
  assert.equal(spoken[0].voice.lang, 'ja-JP');
  await click(document.querySelector('.rating-good'));
  assert.equal(document.querySelector('.flashcard'), null, 'Familiar is removed from today\'s queue');
  assert.ok(saved().find(card => card.id === identity.id).completedOn);

  // Remount the app to exercise hydration from the actual persisted snapshot.
  const legacyCards = saved();
  const legacyCard = legacyCards.find(card => card.id === identity.id);
  const latestExample = legacyCard.examples[0];
  legacyCard.examples.unshift({ ...latestExample, start: latestExample.start + 0.01,
    end: latestExample.end + 0.02, text: '更正前的舊字幕', english: 'Outdated translation.' });
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, cards: legacyCards }));
  await act(async () => root.render(null));
  await act(async () => root.render(React.createElement(App, { initialVideoId: 'TE2mcomyNH8' })));
  assert.equal(saved().find(card => card.id === identity.id).examples.length, 1, 'Reopening migrates and persists duplicate caption revisions');
  assert.equal(saved().find(card => card.id === identity.id).examples[0].text, latestExample.text, 'Only the latest Japanese example remains');
  assert.ok(buttonFor(matched).classList.contains('is-saved'), 'Stars survive reopening the app');
  await click(buttonFor(matched));
  await click(document.querySelector('.word-close'));
  await click(tab('單字複習'));
  assert.equal(document.querySelector('.flashcard'), null, 'Encountering a completed word does not reset its schedule');
  await click(document.querySelector('.saved-word .study-star'));
  assert.equal(document.querySelector('.saved-word'), null, 'Review library also supports removing stars');
  await click(tab('聽影片'));
  await click(buttonFor(matched));
  await click(document.querySelector('.word-close'));

  // With a one-card playlist, a repetition returns at the front without a timer.
  const second = indexed.find(item => item.token.entryIds.length && wordIdentity(item.token, vocabulary).id !== identity.id);
  await click(buttonFor(second));
  await click(document.querySelector('.word-close'));
  await click(tab('單字複習'));
  assert.equal(document.querySelector('.flashcard'), null, 'Newly collected words need explicit admission');
  await act(async () => document.querySelector('.review-picker').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await click(document.querySelector('.review-session .flip-button'));
  await click(document.querySelector('.rating-hard'));
  assert.equal(document.querySelector('.flashcard h2').textContent, wordIdentity(second.token, vocabulary).word);
  assert.equal(document.querySelector('.flashcard-answer'), null, 'Repeated card starts face down');
  assert.ok(document.querySelector('.review-message').textContent.includes('後 20 張'));
  const postponed = saved().find(card => card.id === wordIdentity(second.token, vocabulary).id);
  assert.equal(postponed.reviews[0].rating, 2);
  assert.ok(postponed.queueOrder);
  await click(document.querySelector('.review-session .flip-button'));
  await click(document.querySelector('.rating-good'));

  await click(tab('聽影片'));
  const expression = indexed.find(item => item.token.surface === 'なさすぎ');
  assert.ok(expression, 'The actual caption has one clickable なさすぎ expression');
  await click(buttonFor(expression));
  assert.equal(document.querySelector('dialog h2').textContent, 'なさすぎ');
  assert.ok(document.querySelector('[aria-label="文法組合"]').textContent.includes('太少、太缺乏'));
  assert.ok(!document.querySelector('dialog').textContent.includes('No dictionary match found.'));
  await click(document.querySelector('.word-close'));
  await click(tab('單字複習'));
  await act(async () => document.querySelector('.review-picker').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(document.querySelector('.flashcard h2').textContent, 'なさすぎる');
  await click(document.querySelector('.review-session .flip-button'));
  assert.ok(document.querySelector('.flashcard-answer').textContent.includes('太少、太缺乏'));
  assert.ok(!indexed.some(item => item.token.surface === 'なんですね'), 'Explanatory endings no longer have special grouped buttons');

  // A saved word from another video resolves its stored dictionary snapshot.
  const other = { ...saved().find(card => card.id === identity.id), id: JSON.stringify(['他の単語', 'ほかのたんご']),
    word: '他の単語', reading: 'ほかのたんご', surface: '他の単語',
    examples: [{ videoId: 'abcdefghijk', title: 'Other video', start: 12, end: 15,
      text: '過去の動画の例文。', english: 'An example from another video.' }] };
  const withOther = JSON.stringify({ version: 1, cards: [...saved(), other] });
  window.localStorage.setItem(STORAGE_KEY, withOther);
  await act(async () => window.dispatchEvent(new window.StorageEvent('storage', { key: STORAGE_KEY, newValue: withOther })));
  await click(document.querySelector('[aria-label="查看單字 他の単語"]'));
  assert.equal(document.querySelector('dialog h2').textContent, other.word);
  assert.ok(document.querySelector('dialog .word-entry li p').textContent.length, 'Stored meanings work independently of the current video');
  assert.equal(document.querySelector('dialog .word-context p[lang="ja"]').textContent, other.examples[0].text);
  await click(document.querySelector('dialog .study-star'));
  assert.equal(saved().find(card => card.id === other.id).starred, false, 'Collection popup toggles its own saved card');
  await click(document.querySelector('dialog .study-star'));
  const opened = [];
  window.open = (...args) => { opened.push(args); return null; };
  await click(document.querySelector('dialog .word-context button'));
  assert.equal(opened[0][0], 'https://www.youtube.com/watch?v=abcdefghijk&t=12s');
  assert.equal(document.querySelector('dialog'), null);

  await click(tab('影片收藏'));
  assert.equal(document.querySelectorAll('.collection-video').length, videos.length);
  const another = videos.find(item => item.video.id !== 'TE2mcomyNH8');
  if (another) {
    await click([...document.querySelectorAll('.collection-video')].find(button => button.textContent.includes(another.video.title)));
    assert.equal(document.querySelector('.video-info h2').textContent, another.video.title);
    assert.equal(document.querySelectorAll('.transcript-row').length, another.transcript.cues.length);
    const available = another.vocabulary.cues.flatMap((cue, cueIndex) => cue.tokens.filter(token => token.selectable).map((token, wordIndex) => ({ token, cueIndex, wordIndex })));
    const selectable = available.find(item => item.token.entryIds.some(id => !vocabulary.entries[id]))
      || available.find(item => item.token.entryIds.length);
    await click(document.querySelectorAll('.transcript-row')[selectable.cueIndex].querySelectorAll('.word-token')[selectable.wordIndex]);
    assert.equal(document.querySelector('dialog h2').textContent, selectable.token.surface);
    assert.ok(document.querySelector('dialog .word-entry li p').textContent.length, 'Switched video uses its own dictionary');
    await click(document.querySelector('.word-close'));
    assert.ok(saved().some(card => card.id === identity.id), 'Switching videos preserves saved vocabulary');
    await click(tab('影片收藏'));
    await click([...document.querySelectorAll('.collection-video')].find(button => button.textContent.includes('悩んでるのは君だけじゃない')));
    assert.equal(document.querySelector('.video-info h2').textContent, '悩んでるのは君だけじゃない恋愛相談室');
  }

  await click(tab('單字複習'));
  await click(document.querySelector('.manual-word-panel summary'));
  async function enter(element, value) {
    await act(async () => {
      const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }
  await enter(document.querySelector('[aria-label="新增日文單字"]'), '図書館');
  await act(async () => { document.querySelector('.manual-word-panel form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 100)); });
  assert.ok(document.querySelector('.manual-entry').textContent.includes('library'), 'Manual form searches the full local dictionary');
  await click(document.querySelector('.manual-word-panel .example-editor summary'));
  await enter(document.querySelector('.manual-word-panel [aria-label="自訂日文例句"]'), '図書館で勉強します。');
  await enter(document.querySelector('.manual-word-panel [aria-label="自訂例句英文翻譯"]'), 'I study at the library.');
  await act(async () => document.querySelector('.manual-word-panel .example-editor form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await click([...document.querySelectorAll('.manual-word-panel button')].find(button => button.textContent === '收藏這個單字'));
  const manual = saved().find(card => card.word === '図書館');
  assert.ok(manual, 'Manual card is saved without a video');
  assert.equal(manual.extraExamples[0].english, 'I study at the library.');
  assert.equal(manual.familiarity.score, 0);
  await act(async () => document.querySelector('.manual-word-panel').open = false);
  await click([...document.querySelectorAll('.saved-word-open')].find(button => button.textContent.startsWith('図書館')));
  assert.equal(document.querySelector('dialog .word-context'), null, 'Manual word does not offer a nonexistent video replay');
  assert.ok(document.querySelector('dialog').textContent.includes('I study at the library.'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
  assert.ok(document.querySelector('dialog .dictionary-examples a'), 'Dictionary examples are loaded in the same word dialog');
  const fileInput = document.querySelector('dialog [aria-label="上傳例句檔"]');
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [new window.File(['[{"text":"図書館に行きます。","english":"I go to the library."}]'], 'examples.json')] });
  await act(async () => { fileInput.dispatchEvent(new window.Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); });
  assert.equal(saved().find(card => card.id === manual.id).extraExamples.length, 2, 'Uploaded example is persisted on the selected card');
  await click(document.querySelector('dialog [aria-label="刪除例句 図書館に行きます。"]'));
  assert.equal(saved().find(card => card.id === manual.id).extraExamples.length, 1);
  await click(document.querySelector('.word-close'));
  console.log('Word and review UI passed, including manual dictionary lookup, custom examples, file upload, deletion and persistence.');
} finally {
  await act(async () => root.unmount());
  await server.close();
  await window.happyDOM.cancelAsync();
  globalThis.fetch = originalFetch;
}
