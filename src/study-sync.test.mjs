import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addReviewWords, chooseWordReading, collectManualWord, rateWord, removeWordExample, toggleStar } from './study.mjs';
import { documentFor, exchangeStudy, mergeLibraries, sameStudyData } from './study-sync.mjs';

const now = new Date(2026, 9, 11, 12);
const later = seconds => new Date(now.getTime() + seconds * 1000);
const saved = () => addReviewWords(collectManualWord([], { word: '猫', reading: 'ねこ', examples: [{ source: 'custom', text: '猫です。', english: 'A cat.' }] }, now), 1, now);

test('reading choices sync as a bundle and survive another device review', () => {
  const side = { id: '1', headword: '側', reading: 'がわ', senses: [{ meanings: ['side'] }] };
  const near = { id: '2', headword: '側', reading: 'そば', senses: [{ meanings: ['nearby'] }] };
  const otherSide = { ...side, id: '3' };
  const base = addReviewWords(collectManualWord([], { word: '側', reading: 'がわ', definitions: [side] }, now), 1, now);
  const remote = chooseWordReading(base, base[0].id, near);
  const local = rateWord(base, base[0].id, 'ordinary', later(1));
  let merged = mergeLibraries(base, local, remote);
  assert.equal(merged[0].reading, 'そば');
  assert.equal(merged[0].dictionaryChoice.entryId, '2');
  assert.equal(merged[0].reviews.length, 1);
  const conflicting = chooseWordReading(base, base[0].id, otherSide);
  merged = mergeLibraries(base, conflicting, remote);
  assert.equal(merged[0].reading, 'がわ');
  assert.equal(merged[0].definitions[0].id, '3');
});

test('two offline devices merge review events and recompute familiarity without double counting resends', () => {
  const base = saved();
  const a = rateWord(base, base[0].id, 'unfamiliar', later(10));
  const b = rateWord(base, base[0].id, 'familiar', later(20));
  const merged = mergeLibraries(base, a, b);
  assert.equal(merged[0].reviews.length, 2);
  assert.equal(merged[0].familiarity.day.unfamiliar, 1);
  assert.equal(merged[0].familiarity.day.familiar, 1);
  assert.ok(Math.abs(merged[0].familiarity.score - 90 / 1.9) < 0.001);
  assert.equal(merged[0].completedOn, b[0].completedOn);
  assert.equal(sameStudyData(mergeLibraries(base, a, merged), merged), true);
  assert.equal(sameStudyData(mergeLibraries(base, b, a), merged), true);
});

test('unchanged local data cannot undo a remote unstar or deleted example; new words survive', () => {
  const base = saved();
  const remote = removeWordExample(toggleStar(base, base[0].id), base[0].id, 0);
  const local = collectManualWord(base, { word: '犬', reading: 'いぬ' }, now);
  const merged = mergeLibraries(base, local, remote);
  assert.equal(merged.find(card => card.word === '猫').starred, false);
  assert.deepEqual(merged.find(card => card.word === '猫').extraExamples, []);
  assert.ok(merged.some(card => card.word === '犬'));
});

test('legacy history deduplicates and reordered JSONB keys do not create artificial changes', async () => {
  const cards = saved();
  cards[0].reviews = [{ at: now.toISOString(), rating: 3 }];
  delete cards[0].familiarity;
  const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)])) : value;
  const remote = reverse(cards);
  assert.equal(mergeLibraries(cards, cards, remote)[0].reviews.length, 1);
  assert.ok(sameStudyData(cards, remote));
  // Use a fully migrated record here: no no-op write merely due to key order.
  const normalized = mergeLibraries(cards, cards, remote);
  let writes = 0;
  await exchangeStudy({ base: normalized, readLocal: () => normalized,
    readRemote: async () => ({ revision: 3, document: documentFor(reverse(normalized)) }),
    compareAndSwap: async () => { writes++; throw new Error('Unexpected write'); }, commit: () => {} });
  assert.equal(writes, 0);
});

test('revision conflict retries with the other device change instead of overwriting it', async () => {
  const base = saved();
  const local = collectManualWord(base, { word: '犬' }, now);
  const other = collectManualWord(base, { word: '鳥' }, now);
  let commits, writes = 0;
  await exchangeStudy({ base, readLocal: () => local,
    readRemote: async () => ({ revision: 1, document: documentFor(base) }),
    compareAndSwap: async (_revision, document) => {
      writes++;
      return writes === 1 ? { applied: false, revision: 2, document: documentFor(other) }
        : { applied: true, revision: 3, document };
    }, commit: result => { commits = result; } });
  assert.equal(writes, 2);
  assert.deepEqual(new Set(commits.cloud.map(card => card.word)), new Set(['猫', '犬', '鳥']));
});

test('changes made during a request survive the commit and remain available for the next sync', async () => {
  const base = saved();
  let local = collectManualWord(base, { word: '犬' }, now);
  let cloud;
  await exchangeStudy({ base, readLocal: () => local,
    readRemote: async () => ({ revision: 1, document: documentFor(base) }),
    compareAndSwap: async (_revision, document) => {
      local = collectManualWord(local, { word: '鳥' }, now);
      return { applied: true, revision: 2, document };
    }, commit: result => { cloud = result.cloud; local = mergeLibraries(result.localAtSend, local, result.cloud); } });
  assert.equal(cloud.length, 2);
  assert.equal(local.length, 3);
  assert.ok(local.some(card => card.word === '鳥'));
});

test('network failures and invalid remote documents never commit or overwrite local storage', async () => {
  const local = saved();
  let commits = 0;
  const handlers = { base: [], readLocal: () => local, commit: () => { commits++; }, compareAndSwap: async () => { throw new Error('offline'); } };
  await assert.rejects(exchangeStudy({ ...handlers, readRemote: async () => { throw new Error('offline'); } }));
  await assert.rejects(exchangeStudy({ ...handlers, readRemote: async () => ({ revision: 1, document: { version: 1, cards: [{ word: 'broken' }] } }) }));
  assert.equal(commits, 0);
});
