import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addReviewWords, familiarityScore, familiarityState, migrateFamiliarity, reviewCandidates, collectWord, libraryJSON, localDay, nextDay, parseLibrary, rateWord, refreshExamples, reviewQueue, toggleStar } from './study.mjs';

const now = new Date(2026, 9, 10, 14, 0);
const vocabulary = { entries: { 1: { id: 1, headwords: ['食べる'],
  readings: [{ text: 'たべる', appliesTo: ['*'] }],
  senses: [{ meanings: ['to eat'], partsOfSpeech: ['verb'], notes: [], appliesToKanji: ['*'], appliesToKana: ['*'] }] } } };
const token = { surface: '食べよう', base: '食べる', reading: 'たべよう', entryIds: [1] };
const cue = { start: 12, end: 15, text: '寿司を食べよう。' };
const video = { id: 'TE2mcomyNH8', title: '日本語' };
const saved = () => addReviewWords(collectWord([], token, vocabulary, cue, video, now), 1, now);

test('example translations survive backup and refresh on recollection of an older card', () => {
  const cards = saved();
  delete cards[0].examples[0].english;
  const legacy = parseLibrary(libraryJSON(cards));
  const updated = collectWord(legacy, token, vocabulary, { ...cue, english: "Let's eat sushi." }, video, now);
  const restored = parseLibrary(libraryJSON(updated));
  assert.equal(restored[0].examples.length, 1);
  assert.equal(restored[0].examples[0].english, "Let's eat sushi.");
  assert.deepEqual(restored[0].schedule, cards[0].schedule);
});

test('old and corrected examples of one occurrence collapse to the latest cue, keeping other occurrences and review history', () => {
  let cards = saved();
  cards = rateWord(cards, cards[0].id, 'familiar', now);
  const original = cards[0];
  const current = { start: 11.8, end: 15.2, text: 'お寿司を食べよう。' };
  const later = { start: 100, end: 103, text: 'また食べよう。' };
  const other = { ...cue, videoId: 'abcdefghijk', title: 'Other video' };
  cards = [{ ...original, examples: [original.examples[0], { ...current, videoId: video.id, title: video.title },
    { ...later, videoId: video.id, title: video.title }, other] }];
  const words = { ...vocabulary, cues: [{ tokens: [{ ...token, selectable: true }] }, { tokens: [{ ...token, selectable: true }] }] };
  const updated = refreshExamples(cards, { cues: [current, later] }, words, video, ['Let’s eat sushi.', 'Let’s eat again.']);
  assert.equal(updated[0].examples.length, 3);
  assert.equal(updated[0].examples[0].text, current.text);
  assert.equal(updated[0].examples[0].start, current.start);
  assert.equal(updated[0].examples[0].english, 'Let’s eat sushi.');
  assert.equal(updated[0].examples[1].text, later.text);
  assert.deepEqual(updated[0].examples[2], other);
  assert.deepEqual(updated[0].schedule, original.schedule);
  assert.deepEqual(updated[0].reviews, original.reviews);
  assert.equal(updated[0].completedOn, original.completedOn);
  assert.equal(refreshExamples(updated, { cues: [current, later] }, words, video, ['Let’s eat sushi.', 'Let’s eat again.']), updated, 'Migration is idempotent');
});

test('example migration does not replace a saved word with an overlapping unrelated sentence', () => {
  const cards = saved();
  const updated = refreshExamples(cards, { cues: [{ ...cue, text: 'これは別の文。' }] },
    { ...vocabulary, cues: [{ tokens: [{ surface: '別', base: '別', reading: 'べつ', entryIds: [], selectable: true }] }] }, video);
  assert.equal(updated, cards);
});

test('clicking an inflection saves its dictionary form, pronunciation and actual example', () => {
  const [card] = saved();
  assert.equal(card.word, '食べる'); assert.equal(card.reading, 'たべる');
  assert.equal(card.surface, '食べよう'); assert.equal(card.starred, true);
  assert.deepEqual(card.definitions[0].senses[0].meanings, ['to eat']);
  assert.equal(card.examples[0].text, cue.text);
  assert.equal(reviewQueue([card], now).length, 1);
});

test('repeat encounters and different videos share one card without resetting review progress', () => {
  let cards = saved();
  cards = rateWord(cards, cards[0].id, 'familiar', now);
  const schedule = cards[0].schedule;
  cards = collectWord(cards, { ...token, surface: '食べました', reading: 'たべました' }, vocabulary,
    { ...cue, text: '寿司を食べました。' }, { ...video, id: 'abcdefghijk' }, now);
  assert.equal(cards.length, 1); assert.equal(cards[0].examples.length, 2);
  assert.deepEqual(cards[0].schedule, schedule);
  assert.equal(cards[0].reviews.length, 1);
});

test('unstar removes a card from review; collecting it again preserves its schedule', () => {
  let cards = saved(); const id = cards[0].id;
  cards = rateWord(cards, id, 'ordinary', now);
  const schedule = cards[0].schedule;
  cards = toggleStar(cards, id);
  assert.equal(reviewQueue(cards, new Date(now.getTime() + 11 * 60000)).length, 0);
  cards = collectWord(cards, token, vocabulary, cue, video, now);
  assert.deepEqual(cards[0].schedule, schedule);
  assert.equal(cards[0].starred, true);
});

test('playlist reinserts unfamiliar after 10 cards and ordinary after 20, regardless of elapsed time', () => {
  for (const [rating, gap] of [['unfamiliar', 10], ['ordinary', 20]]) {
    let cards = Array.from({ length: 26 }, (_, index) => ({ ...saved()[0], id: `word-${index}` }));
    const first = cards[0].id;
    cards = rateWord(cards, first, rating, now);
    const expected = [...Array.from({ length: 25 }, (_, i) => `word-${i + 1}`)];
    expected.splice(gap, 0, first);
    assert.deepEqual(reviewQueue(cards, now).map(card => card.id), expected);
    assert.deepEqual(reviewQueue(cards, new Date(now.getTime() + 60 * 60000)).map(card => card.id), expected, 'Waiting does not advance the playlist');
    cards = parseLibrary(libraryJSON(cards));
    assert.deepEqual(reviewQueue(cards, now).map(card => card.id), expected, 'Playlist order survives reopening and backup');
    for (let i = 0; i < gap; i++) {
      cards = rateWord(cards, reviewQueue(cards, now)[0].id, 'familiar', now);
      assert.equal(reviewQueue(cards, now).findIndex(card => card.id === first), gap - i - 1);
    }
    assert.equal(reviewQueue(cards, now)[0].id, first);
    assert.ok(cards.find(card => card.id === first).schedule.stability > 0);
  }
});

test('short playlists append repetitions to the end; a single card returns with no timer', () => {
  for (const rating of ['unfamiliar', 'ordinary']) {
    const cards = Array.from({ length: 3 }, (_, i) => ({ ...saved()[0], id: `word-${i}` }));
    const updated = rateWord(cards, cards[0].id, rating, now);
    assert.deepEqual(reviewQueue(updated, now).map(card => card.id), ['word-1', 'word-2', 'word-0']);
    const single = rateWord(saved(), saved()[0].id, rating, now);
    assert.equal(reviewQueue(single, now).length, 1);
  }
});

test('selected words stay in the playlist regardless of an old future due date', () => {
  const [card] = saved();
  const legacy = { ...card, schedule: { ...card.schedule, due: new Date(now.getTime() + 10 * 60000).toISOString() },
    reviews: [{ at: now.toISOString(), rating: 2 }] };
  assert.equal(reviewQueue([legacy], now).length, 1);
  assert.equal(reviewQueue([{ ...legacy, queueOrder: null }], now).length, 0);
});

test('familiar never reappears today and repeated fast clicks cannot double-rate it', () => {
  let cards = saved(); cards = rateWord(cards, cards[0].id, 'familiar', now);
  assert.equal(cards[0].completedOn, localDay(now));
  assert.equal(reviewQueue(cards, new Date(2026, 9, 10, 23, 59)).length, 0);
  assert.ok(new Date(cards[0].schedule.due) >= nextDay(now));
  const future = new Date(cards[0].schedule.due);
  assert.equal(reviewQueue(addReviewWords(cards, 1, future), future).length, 1);
  cards = rateWord(cards, cards[0].id, 'unfamiliar', now);
  assert.equal(cards[0].reviews.length, 1);
});

test('day boundary follows the local calendar, including DST, instead of adding 24 hours', () => {
  const before = new Date(2026, 10, 1, 0, 30);
  const tomorrow = nextDay(before);
  assert.equal(tomorrow.getDate(), 2); assert.equal(tomorrow.getHours(), 0);
});

test('export/import restores dictionary snapshots and FSRS dates for later reviews', () => {
  let cards = saved(); cards = rateWord(cards, cards[0].id, 'ordinary', now);
  const restored = parseLibrary(libraryJSON(cards));
  assert.deepEqual(restored, cards);
  const later = new Date(now.getTime() + 10 * 60000);
  assert.equal(reviewQueue(restored, later).length, 1);
  const reviewed = rateWord(restored, restored[0].id, 'familiar', later);
  assert.equal(reviewed[0].reviews.length, 2);
  assert.ok(Number.isFinite(Date.parse(reviewed[0].schedule.due)));
});

test('unknown words remain saveable and malformed backups are rejected', () => {
  const cards = collectWord([], { surface: '謎の語', base: '謎の語', reading: '', entryIds: [] }, { entries: {} }, cue, video, now);
  assert.equal(cards[0].definitions.length, 0);
  assert.equal(parseLibrary(libraryJSON(cards)).length, 1);
  assert.throws(() => parseLibrary('{invalid'));
  assert.throws(() => parseLibrary(JSON.stringify({ version: 1, cards: [{ ...cards[0], schedule: { due: 'bad' } }] })));
  assert.throws(() => parseLibrary(libraryJSON([cards[0], cards[0]])));
  for (const invalid of [
    { ...cards[0], word: 42 }, { ...cards[0], reading: null },
    { ...cards[0], examples: [null] }, { ...cards[0], definitions: [null] },
    { ...cards[0], reviews: [{ at: 'bad', rating: 3 }] },
    { ...cards[0], schedule: { ...cards[0].schedule, stability: -1 } },
  ]) assert.throws(() => parseLibrary(libraryJSON([invalid])));
});

test('grammar expressions preserve the whole expression and its meaning in flashcards', () => {
  const grammar = { base: 'なさすぎる', reading: 'なさすぎる',
    meaning: 'to have far too little; to be severely lacking', explanation: 'ない＋すぎる：太少、太缺乏。' };
  const expression = { surface: 'なさすぎ', base: grammar.base, reading: 'なさすぎ', entryIds: [], grammar };
  const cards = collectWord([], expression, vocabulary, cue, video, now);
  assert.equal(cards[0].word, 'なさすぎる');
  assert.equal(cards[0].reading, 'なさすぎる');
  assert.equal(cards[0].definitions[0].source, 'grammar');
  assert.ok(cards[0].definitions[0].senses[0].meanings.includes(grammar.meaning));
  assert.deepEqual(parseLibrary(libraryJSON(cards)), cards);
  assert.equal(collectWord(cards, { ...expression, surface: 'なさ過ぎる' }, vocabulary, cue, video, now).length, 1);
});


test('new words start at zero and selecting a count chooses the weakest without requiring FSRS due dates', () => {
  const fresh = collectWord([], token, vocabulary, cue, video, now);
  assert.equal(familiarityScore(fresh[0], now), 0);
  assert.equal(reviewQueue(fresh, now).length, 0, 'A daily list starts explicitly');
  const learned = rateWord(saved(), saved()[0].id, 'familiar', now)[0];
  const tomorrow = nextDay(now);
  const cards = [{ ...learned, id: 'strong' }, { ...fresh[0], id: 'new-1' }, { ...fresh[0], id: 'new-2' }];
  const chosen = addReviewWords(cards, 2, tomorrow);
  assert.deepEqual(new Set(reviewQueue(chosen, tomorrow).map(card => card.id)), new Set(['new-1', 'new-2']));
  assert.equal(reviewCandidates(chosen, tomorrow).length, 1);
  const added = addReviewWords(chosen, 50, tomorrow);
  assert.equal(reviewQueue(added, tomorrow).length, 3, 'Short libraries add every available word once');
  assert.equal(new Set(reviewQueue(added, tomorrow).map(card => card.id)).size, 3);
  assert.throws(() => addReviewWords(cards, 0, now));
  assert.throws(() => addReviewWords(cards, 1.5, now));
});

test('repeated failures lower the final daily score and memory duration even after choosing familiar', () => {
  const easy = rateWord(saved(), saved()[0].id, 'familiar', now)[0];
  let hard = saved();
  for (let i = 0; i < 3; i++) hard = rateWord(hard, hard[0].id, 'unfamiliar', new Date(now.getTime() + i * 1000));
  hard = rateWord(hard, hard[0].id, 'familiar', new Date(now.getTime() + 4000));
  assert.equal(easy.familiarity.score, 90);
  assert.ok(hard[0].familiarity.score < 30);
  assert.equal(hard[0].familiarity.day.unfamiliar, 3);
  assert.equal(hard[0].familiarity.day.familiar, 1);
  assert.equal(hard[0].familiarity.lastPracticedAt, new Date(now.getTime() + 4000).toISOString());
  const tomorrow = new Date(now.getTime() + 86400000);
  assert.ok(familiarityScore(hard[0], tomorrow) < familiarityScore(easy, tomorrow));
  assert.ok(familiarityScore(hard[0], tomorrow) < 10, 'Difficult word becomes a high priority tomorrow');
  assert.ok(familiarityScore(easy, tomorrow) < familiarityScore(easy, now));
  const ordinary = rateWord(saved(), saved()[0].id, 'ordinary', now);
  const ordinaryFinal = rateWord(ordinary, ordinary[0].id, 'familiar', now)[0];
  assert.ok(ordinaryFinal.familiarity.score < easy.familiarity.score);
  const selected = addReviewWords([{ ...easy, id: 'easy' }, { ...hard[0], id: 'hard' }], 1, tomorrow);
  assert.equal(reviewQueue(selected, tomorrow).length, 1);
  assert.equal(reviewQueue(selected, tomorrow)[0].id, 'hard', 'Lower score wins selection');
});

test('successful practice across days slows decay, and old history migrates without losing progress', () => {
  let cards = rateWord(saved(), saved()[0].id, 'familiar', now);
  const firstHalfLife = cards[0].familiarity.halfLifeDays;
  const tomorrow = new Date(now.getTime() + 86400000);
  cards = addReviewWords(cards, 1, tomorrow);
  cards = rateWord(cards, cards[0].id, 'familiar', tomorrow);
  assert.ok(cards[0].familiarity.halfLifeDays > firstHalfLife);
  assert.equal(cards[0].familiarity.day.familiar, 1, 'Daily counters reset');
  const legacy = { ...cards[0] };
  delete legacy.familiarity;
  assert.deepEqual(familiarityState(legacy), cards[0].familiarity);
  const migrated = migrateFamiliarity([legacy]);
  assert.deepEqual(migrated[0].reviews, cards[0].reviews);
  assert.deepEqual(migrated[0].schedule, cards[0].schedule);
  assert.deepEqual(parseLibrary(libraryJSON(migrated)), migrated);
  assert.throws(() => parseLibrary(libraryJSON([{ ...cards[0], familiarity: { ...cards[0].familiarity, score: 101 } }])));
});

test('collecting video words leaves the practice queue unchanged until explicitly added', () => {
  let cards = saved();
  const originalId = cards[0].id;
  const nextToken = { surface: '単語', base: '単語', reading: 'たんご', entryIds: [] };
  cards = collectWord(cards, nextToken, { entries: {} }, cue, video, now);
  assert.equal(reviewQueue(cards, now).length, 1);
  assert.equal(reviewQueue(cards, now)[0].id, originalId);
  assert.equal(reviewCandidates(cards, now)[0].word, '単語');
  cards = collectWord(cards, nextToken, { entries: {} }, cue, video, now);
  assert.equal(reviewQueue(cards, now).length, 1);
  cards = addReviewWords(cards, 1, now);
  assert.equal(reviewQueue(cards, now).length, 2);
  cards = rateWord(cards, originalId, 'familiar', now);
  cards = collectWord(cards, token, vocabulary, cue, video, now);
  assert.equal(reviewQueue(cards, now).length, 1, 'Completed word stays completed');
});

test('a 50-word request selects exactly 50 distinct words and preserves an existing playlist when adding more', () => {
  const [fresh] = collectWord([], token, vocabulary, cue, video, now);
  const cards = Array.from({ length: 60 }, (_, i) => ({ ...fresh, id: `word-${String(i).padStart(2, '0')}` }));
  let selected = addReviewWords(cards, 50, now);
  assert.equal(reviewQueue(selected, now).length, 50);
  const originalIds = reviewQueue(selected, now).map(card => card.id);
  selected = rateWord(selected, originalIds[0], 'unfamiliar', now);
  const reordered = reviewQueue(selected, now).map(card => card.id);
  selected = addReviewWords(selected, 5, now);
  assert.deepEqual(reviewQueue(selected, now).slice(0, 50).map(card => card.id), reordered);
  assert.equal(reviewQueue(selected, now).length, 55);
  assert.equal(new Set(reviewQueue(selected, now).map(card => card.id)).size, 55);
  const completed = rateWord(selected, reviewQueue(selected, now)[0].id, 'familiar', now);
  assert.ok(!reviewCandidates(completed, now).some(card => card.completedOn === localDay(now)));
});
