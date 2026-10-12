import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chooseWordReading, collectManualWord, addWordExamples, addReviewWords, collectWord, libraryJSON, parseLibrary, rateWord, refreshExamples, removeWordExample, reviewQueue } from './study.mjs';
import { dictionaryBucket, lookupStudyReadings, lookupStudyWord, dictionaryExamples, parseExampleFile } from './study-dictionary.mjs';

const now = new Date(2026, 9, 11, 12);
test('new manual words stay outside an existing playlist until explicitly selected', () => {
  let cards = addReviewWords(collectManualWord([], { word: '猫' }, now), 1, now);
  const queuedId = cards[0].id;
  cards = collectManualWord(cards, { word: '犬' }, now);
  assert.deepEqual(reviewQueue(cards, now).map(card => card.id), [queuedId]);
  assert.equal(cards.find(card => card.word === '犬').queueOrder, undefined);
  cards = addReviewWords(cards, 1, now);
  assert.equal(reviewQueue(cards, now).length, 2);
});
test('full local dictionary looks up a word absent from any video and retrieves sense-linked bilingual examples', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => JSON.parse(await readFile(`public${url}`, 'utf8')) });
  try {
    const entries = await lookupStudyWord('図書館');
    assert.ok(entries.some(entry => entry.senses.some(sense => sense.meanings.includes('library'))));
    const examples = await dictionaryExamples(entries.map(entry => entry.id), '図書館', entries[0].reading);
    assert.ok(examples.length);
    assert.ok(examples.every(example => example.text && example.english && /^\d+$/.test(example.sentenceId)));
    const kanaEntries = await lookupStudyWord('としょかん');
    assert.equal(kanaEntries.find(entry => entry.id === entries[0].id).headword, '図書館', 'Kana lookup uses the same card identity as the dictionary spelling');
    assert.equal(dictionaryBucket('word:図書館') < 256, true);
    assert.deepEqual(await lookupStudyWord('存在しない架空の詞条XYZ'), []);
    const potential = await lookupStudyWord('頼める');
    assert.ok(potential.some(entry => entry.headword === '頼む' && entry.reading === 'たのむ'));
    assert.ok((await lookupStudyWord('見える')).every(entry => entry.headword === '見える'), 'Existing dictionary words keep their meanings');
    const readings = await lookupStudyReadings('側');
    const near = readings.find(detail => detail.reading === 'そば');
    const side = readings.find(detail => detail.reading === 'がわ');
    assert.ok(near.senses.some(sense => sense.meanings.includes('(place) near by')));
    assert.ok(side.senses.some(sense => sense.meanings.includes('side (of something, or taking someone\'s side)')));
    let cards = addReviewWords(collectManualWord([], { word: '側', reading: 'がわ', definitions: [side] }, now), 1, now);
    cards = rateWord(cards, cards[0].id, 'ordinary', now);
    const previous = cards[0];
    cards = chooseWordReading(cards, previous.id, near);
    assert.equal(cards[0].reading, 'そば');
    assert.equal(cards[0].id, previous.id);
    assert.deepEqual(cards[0].reviews, previous.reviews);
    assert.deepEqual(cards[0].queueOrder, previous.queueOrder);
    assert.deepEqual(parseLibrary(libraryJSON(cards)), cards);
    cards = collectManualWord(cards, { word: '側', reading: 'がわ', definitions: [side] }, now);
    assert.equal(cards[0].reading, 'そば', 'Recollecting does not undo a chosen reading');
    assert.equal(cards[0].definitions[0].reading, 'そば');
  } finally { globalThis.fetch = original; }
});

test('manual cards preserve familiarities, survive backup and participate in playlist reviews', () => {
  let cards = collectManualWord([], { word: ' なんですね ', reading: 'なんですね', examples: [{ source: 'custom', text: 'そうなんですね。', english: 'Oh, I see.' }] }, now);
  assert.equal(cards[0].familiarity.score, 0);
  assert.deepEqual(cards[0].examples, []);
  cards = addReviewWords(cards, 1, now);
  cards = rateWord(cards, cards[0].id, 'familiar', now);
  const history = cards[0].reviews;
  cards = collectManualWord(cards, { word: 'なんですね', reading: 'なんですね' }, now);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].reviews, history);
  assert.equal(reviewQueue(cards, now).length, 0);
  cards = collectManualWord(cards, { word: '猫', reading: 'ねこ' }, now);
  assert.equal(reviewQueue(cards, now).length, 0, 'New manual word does not restart a finished session');
  cards = addReviewWords(cards, 1, now);
  assert.equal(reviewQueue(cards, now)[0].word, '猫');
  assert.deepEqual(parseLibrary(libraryJSON(cards)), cards);
});

test('custom examples are deduplicated and retained through video recollection and subtitle refresh', () => {
  const custom = { source: 'custom', text: '猫がいます。', english: 'There is a cat.' };
  let cards = collectManualWord([], { word: '猫', reading: 'ねこ', examples: [custom] }, now);
  cards = addWordExamples(cards, cards[0].id, [custom]);
  assert.equal(cards[0].extraExamples.length, 1);
  const vocabulary = { entries: {}, cues: [{ tokens: [{ surface: '猫', base: '猫', reading: 'ねこ', entryIds: [], selectable: true }] }] };
  const cue = { start: 1, end: 3, text: '猫です。' };
  const video = { id: 'abcdefghijk', title: '猫' };
  cards = collectWord(cards, vocabulary.cues[0].tokens[0], vocabulary, cue, video, now);
  assert.equal(cards.length, 1, 'Manual and video saves share the same word identity');
  cards = refreshExamples(cards, { cues: [{ ...cue, text: 'これは猫です。' }] }, vocabulary, video, ['This is a cat.']);
  assert.deepEqual(cards[0].extraExamples, [custom]);
  assert.equal(cards[0].examples[0].text, 'これは猫です。');
  cards = removeWordExample(cards, cards[0].id, 0);
  assert.equal(cards[0].extraExamples.length, 0);
  assert.equal(cards[0].examples.length, 1);
});

test('JSON/TSV uploads validate atomically and backups reject malformed extra examples', () => {
  assert.deepEqual(parseExampleFile('猫です。\tIt is a cat.\n犬です。', 'sentences.tsv'), [
    { source: 'custom', text: '猫です。', english: 'It is a cat.' }, { source: 'custom', text: '犬です。', english: '' }]);
  assert.equal(parseExampleFile('\uFEFF[{"text":"猫です。","english":"A cat."}]', 'sentences.json').length, 1);
  assert.throws(() => parseExampleFile('[{"text":"猫"},{"text":42}]', 'sentences.json'));
  assert.throws(() => parseExampleFile('猫\tcat\textra', 'sentences.tsv'));
  assert.throws(() => collectManualWord([], { word: ' ' }, now));
  const cards = collectManualWord([], { word: '猫' }, now);
  cards[0].extraExamples = [{ source: 'dictionary', text: '猫', english: 'cat', sentenceId: '../bad' }];
  assert.throws(() => parseLibrary(libraryJSON(cards)));
});
