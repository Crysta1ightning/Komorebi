import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import { entryDetails } from './vocabulary.mjs';

export const STORAGE_KEY = 'komorebi.study.v1';
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false, enable_short_term: false });
const ratings = { unfamiliar: Rating.Again, ordinary: Rating.Hard, familiar: Rating.Good };

export function localDay(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function nextDay(value) {
  const date = new Date(value);
  date.setHours(24, 0, 0, 0);
  return date;
}

function serialize(value) { return JSON.parse(JSON.stringify(value)); }

function emptyFamiliarity() {
  return { score: 0, halfLifeDays: 1, lastPracticedAt: null, day: null };
}

function decayedScore(state, now) {
  if (!state.lastPracticedAt) return 0;
  const days = Math.max(0, (new Date(now) - new Date(state.lastPracticedAt)) / 86400000);
  return state.score * 2 ** (-days / state.halfLifeDays);
}

function updateFamiliarity(state, rating, now, date = localDay(now)) {
  const day = state.day?.date === date ? { ...state.day } : {
    date, startingScore: decayedScore(state, now), startingHalfLife: state.halfLifeDays,
    unfamiliar: 0, ordinary: 0, familiar: 0,
  };
  day[rating]++;
  // Recompute from the day's starting state, rather than rewarding each retry.
  const quality = (rating === 'familiar' ? 90 : rating === 'ordinary' ? 55 : 15)
    / (1 + 0.9 * day.unfamiliar + 0.35 * day.ordinary);
  const score = Math.min(98, quality + 10, day.startingScore > 0
    ? 0.35 * day.startingScore + 0.65 * quality : quality);
  const halfLifeDays = quality >= 80 ? Math.min(60, Math.max(3, day.startingHalfLife * 1.6))
    : quality >= 55 ? Math.max(1.5, Math.min(7, day.startingHalfLife * 0.8))
      : Math.max(0.5, Math.min(1, day.startingHalfLife * 0.5));
  return { score, halfLifeDays, lastPracticedAt: now.toISOString(), day };
}

export function familiarityState(card) {
  if (card.familiarity) return card.familiarity;
  const names = { 1: 'unfamiliar', 2: 'ordinary', 3: 'familiar' };
  return card.reviews.reduce((state, review) => updateFamiliarity(state, names[review.rating], new Date(review.at), review.day || localDay(review.at)), emptyFamiliarity());
}

export function rebuildFamiliarity(reviews) {
  return familiarityState({ reviews });
}

export function familiarityScore(card, now = new Date()) {
  return decayedScore(familiarityState(card), now);
}

export function migrateFamiliarity(cards) {
  if (cards.every(card => card.familiarity)) return cards;
  return cards.map(card => card.familiarity ? card : { ...card, familiarity: familiarityState(card) });
}

export function reviewCandidates(cards, now = new Date()) {
  const active = new Set(reviewQueue(cards, now).map(card => card.id));
  return cards.filter(card => card.starred && card.completedOn !== localDay(now) && !active.has(card.id))
    .sort((a, b) => familiarityScore(a, now) - familiarityScore(b, now)
      || a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id));
}

export function addReviewWords(cards, count, now = new Date()) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Enter a positive whole number of words.');
  const queue = reviewQueue(cards, now);
  const chosen = reviewCandidates(cards, now).slice(0, count);
  const positions = new Map([...queue, ...chosen].map((card, position) => [card.id, position]));
  return cards.map(card => positions.has(card.id)
    ? { ...card, queueOrder: { day: localDay(now), position: positions.get(card.id) } } : card);
}

function validExtraExample(example) {
  return example && ['custom', 'dictionary'].includes(example.source)
    && typeof example.text === 'string' && Boolean(example.text.trim()) && example.text.length <= 2000
    && typeof example.english === 'string' && example.english.length <= 4000
    && (example.source !== 'dictionary' || /^\d+$/.test(example.sentenceId));
}

export function addWordExamples(cards, id, examples) {
  if (!Array.isArray(examples) || examples.some(example => !validExtraExample(example))) throw new Error('例句格式不正確。');
  return cards.map(card => {
    if (card.id !== id) return card;
    const seen = new Set();
    const extraExamples = [...(card.extraExamples || []), ...examples].filter(example => {
      const key = JSON.stringify([example.text, example.english]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (extraExamples.length > 100) throw new Error('每個單字最多保留 100 個自訂例句。');
    return { ...card, extraExamples };
  });
}

export function removeWordExample(cards, id, index) {
  return cards.map(card => card.id === id ? { ...card, extraExamples: (card.extraExamples || []).filter((_, i) => i !== index) } : card);
}

export function collectManualWord(cards, input, now = new Date()) {
  const word = input.word?.trim().normalize('NFKC');
  const reading = (input.reading || '').trim().normalize('NFKC');
  if (!word || word.length > 100 || reading.length > 100) throw new Error('請輸入單字，最多 100 個字。');
  const id = JSON.stringify([word, reading]);
  const old = cards.find(card => card.id === id);
  const definitions = input.definitions || [];
  let next = old ? cards.map(card => card.id === id ? { ...card, starred: true,
    definitions: card.dictionaryChoice ? card.definitions : definitions.length ? definitions : card.definitions } : card)
    : [...cards, { id, word, reading, surface: word, source: 'manual', starred: true, definitions,
      examples: [], extraExamples: [], addedAt: now.toISOString(), completedOn: null,
      schedule: serialize(createEmptyCard(now)), reviews: [], familiarity: emptyFamiliarity() }];
  next = addWordExamples(next, id, input.examples || []);
  // Apply the same backup validation to manual entries before changing storage.
  parseLibrary(libraryJSON(next));
  return next;
}

export function wordIdentity(token, vocabulary) {
  if (token.grammar) return { id: JSON.stringify([token.grammar.base, token.grammar.reading]),
    word: token.grammar.base, reading: token.grammar.reading };
  const entry = vocabulary.entries[token.entryIds?.[0]];
  const detail = entry ? entryDetails(entry, token) : null;
  const word = detail?.headword || token.base || token.surface;
  const reading = detail?.reading || token.reading || '';
  return { id: JSON.stringify([word.normalize('NFKC'), reading.normalize('NFKC')]), word, reading };
}

export function collectWord(cards, token, vocabulary, cue, video, now = new Date()) {
  const identity = wordIdentity(token, vocabulary);
  const entries = (token.entryIds || []).map(id => vocabulary.entries[id]).filter(Boolean);
  const definitions = entries.map(entry => ({ id: entry.id, ...entryDetails(entry, token) }))
    .filter(detail => detail.reading === identity.reading);
  if (token.grammar) definitions.unshift({ id: `grammar:${token.grammar.base}`, source: 'grammar',
    headword: token.grammar.base, reading: token.grammar.reading,
    senses: [{ meanings: [token.grammar.meaning, token.grammar.explanation,
      ...(token.grammar.components || []).map(part => `${part.surface}：${part.meaning}`)] }] });
  const example = { videoId: video.id, title: video.title, start: cue.start, end: cue.end, text: cue.text,
    english: typeof cue.english === 'string' ? cue.english : '' };
  const old = cards.find(card => card.id === identity.id);
  if (old) {
    const exists = old.examples.some(item => item.videoId === video.id && item.start === cue.start);
    return cards.map(card => card.id !== identity.id ? card : { ...card, starred: true,
      definitions: card.dictionaryChoice ? card.definitions : definitions.length ? definitions : card.definitions,
      examples: exists ? card.examples.map(item => item.videoId === video.id && item.start === cue.start ? example : item) : [...card.examples, example].slice(-5) });
  }
  return [...cards, { ...identity, surface: token.surface, starred: true, definitions,
    examples: [example], addedAt: now.toISOString(), completedOn: null,
    schedule: serialize(createEmptyCard(now)), reviews: [], familiarity: emptyFamiliarity() }];
}

export function refreshExamples(cards, transcript, vocabulary, video, english = []) {
  const current = transcript.cues.map((cue, index) => ({ cue, index,
    words: vocabulary.cues[index]?.tokens.filter(token => token.selectable).map(token => ({
      id: wordIdentity(token, vocabulary).id, base: token.base, dictionaryBase: token.dictionaryBase,
    })) || [] }));
  let changed = false;
  const updated = cards.map(card => {
    const candidates = current.filter(item => item.words.some(word =>
      word.id === card.id || word.base === card.word || word.dictionaryBase === card.word));
    const examples = [];
    const seen = new Set();
    for (const old of card.examples) {
      let example = old;
      if (old.videoId === video.id) {
        const exact = current.find(({ cue }) => cue.start === old.start && cue.end === old.end && cue.text === old.text);
        // Locate the same occurrence by time AND the saved word; indices can
        // change after resegmentation. Distinct occurrences remain separate.
        const match = exact || candidates.map(item => ({ ...item,
          overlap: Math.min(old.end, item.cue.end) - Math.max(old.start, item.cue.start) }))
          .filter(item => item.overlap > 0)
          .sort((a, b) => b.overlap - a.overlap || Math.abs(a.cue.start - old.start) - Math.abs(b.cue.start - old.start))[0];
        if (match) example = { ...old, title: video.title, start: match.cue.start, end: match.cue.end,
          text: match.cue.text, english: english[match.index] || '' };
      }
      const key = JSON.stringify([example.videoId, example.start, example.end, example.text]);
      if (!seen.has(key)) { seen.add(key); examples.push(example); }
    }
    if (JSON.stringify(examples) === JSON.stringify(card.examples)) return card;
    changed = true;
    return { ...card, examples };
  });
  return changed ? updated : cards;
}

export function toggleStar(cards, id) {
  return cards.map(card => card.id === id ? { ...card, starred: !card.starred } : card);
}

export function chooseWordReading(cards, id, detail) {
  if (!detail || typeof detail.id !== 'string' || typeof detail.reading !== 'string' || !detail.reading
    || typeof detail.headword !== 'string' || !Array.isArray(detail.senses) || !detail.senses.length) throw new Error('讀音資料無效。');
  const next = cards.map(card => card.id === id ? { ...card, starred: true, reading: detail.reading,
    definitions: [detail], dictionaryChoice: { entryId: detail.id, reading: detail.reading } } : card);
  parseLibrary(libraryJSON(next));
  return next;
}

export function rateWord(cards, id, rating, now = new Date()) {
  if (!Object.hasOwn(ratings, rating)) throw new Error('Unknown review rating');
  const queue = reviewQueue(cards, now);
  if (queue[0]?.id !== id) return cards;
  const remaining = queue.slice(1).map(card => card.id);
  if (rating !== 'familiar') remaining.splice(Math.min(rating === 'unfamiliar' ? 10 : 20, remaining.length), 0, id);
  const positions = new Map(remaining.map((wordId, index) => [wordId, index]));
  const day = localDay(now);
  return cards.map(original => {
    const card = positions.has(original.id) ? { ...original, queueOrder: { day, position: positions.get(original.id) } } : original;
    if (card.id !== id || !card.starred) return card;
    const input = { ...card.schedule, due: new Date(card.schedule.due),
      last_review: card.schedule.last_review ? new Date(card.schedule.last_review) : undefined };
    const result = scheduler.next(input, now, ratings[rating]);
    const due = rating === 'familiar'
      ? new Date(Math.max(result.card.due.getTime(), nextDay(now).getTime()))
      : now;
    return { ...card, schedule: serialize({ ...result.card, due }),
      completedOn: rating === 'familiar' ? localDay(now) : null,
      queueOrder: rating === 'familiar' ? { day, position: queue[0].queueOrder.position } : card.queueOrder,
      familiarity: updateFamiliarity(familiarityState(card), rating, now),
      reviews: [...card.reviews, { id: globalThis.crypto.randomUUID(), at: now.toISOString(), day, rating: ratings[rating] }] };
  });
}

export function reviewQueue(cards, now = new Date()) {
  const day = localDay(now);
  const position = card => card.queueOrder?.day === day ? card.queueOrder.position : Infinity;
  return cards.filter(card => card.starred && card.completedOn !== day && card.queueOrder?.day === day)
    .sort((a, b) => (position(a) === position(b) ? 0 : position(a) - position(b))
    || new Date(a.schedule.due) - new Date(b.schedule.due) || a.addedAt.localeCompare(b.addedAt));
}

function validFamiliarity(state) {
  if (!state || !Number.isFinite(state.score) || state.score < 0 || state.score > 100
    || !Number.isFinite(state.halfLifeDays) || state.halfLifeDays < 0.5 || state.halfLifeDays > 60) return false;
  if (state.lastPracticedAt === null) return state.score === 0 && state.day === null;
  if (typeof state.lastPracticedAt !== 'string' || !Number.isFinite(Date.parse(state.lastPracticedAt))) return false;
  const day = state.day;
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day.date)
    && Number.isFinite(day.startingScore) && day.startingScore >= 0 && day.startingScore <= 100
    && Number.isFinite(day.startingHalfLife) && day.startingHalfLife >= 0.5 && day.startingHalfLife <= 60
    && ['unfamiliar', 'ordinary', 'familiar'].every(key => Number.isSafeInteger(day[key]) && day[key] >= 0);
}

export function parseLibrary(text) {
  if (!text) return [];
  const data = JSON.parse(text);
  if (data.version !== 1 || !Array.isArray(data.cards)) throw new Error('Unsupported study backup');
  const ids = new Set();
  for (const card of data.cards) {
    if (!card || typeof card.id !== 'string' || ids.has(card.id) || typeof card.word !== 'string' || !card.word
      || typeof card.reading !== 'string' || typeof card.surface !== 'string'
      || (card.completedOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(card.completedOn))
      || typeof card.starred !== 'boolean' || !Array.isArray(card.definitions)
      || (card.familiarity !== undefined && !validFamiliarity(card.familiarity))
      || (card.queueOrder != null && (!/^\d{4}-\d{2}-\d{2}$/.test(card.queueOrder.day)
        || !Number.isSafeInteger(card.queueOrder.position) || card.queueOrder.position < 0))
      || !Array.isArray(card.examples) || !Array.isArray(card.reviews)
      || (card.dictionaryChoice !== undefined && (!card.dictionaryChoice
        || typeof card.dictionaryChoice.entryId !== 'string' || typeof card.dictionaryChoice.reading !== 'string'
        || card.dictionaryChoice.reading !== card.reading
        || !card.definitions.some(entry => entry.id === card.dictionaryChoice.entryId && entry.reading === card.reading)))
      || (card.extraExamples !== undefined && (!Array.isArray(card.extraExamples)
        || card.extraExamples.length > 100 || card.extraExamples.some(example => !validExtraExample(example))))
      || !Number.isFinite(Date.parse(card.addedAt)) || !Number.isFinite(Date.parse(card.schedule?.due))
      || !Number.isFinite(card.schedule?.stability) || !Number.isFinite(card.schedule?.difficulty)
      || !Number.isFinite(card.schedule?.reps) || !Number.isFinite(card.schedule?.lapses)
      || ['stability', 'difficulty', 'reps', 'lapses', 'elapsed_days', 'scheduled_days', 'learning_steps']
        .some(field => !Number.isFinite(card.schedule?.[field]) || card.schedule[field] < 0)
      || card.schedule.difficulty > 10
      || ![0, 1, 2, 3].includes(card.schedule?.state)
      || (card.schedule?.last_review && !Number.isFinite(Date.parse(card.schedule.last_review)))
      || card.examples.some(example => !example || typeof example.text !== 'string' || typeof example.title !== 'string'
        || (example.english !== undefined && typeof example.english !== 'string')
        || !/^[\w-]{11}$/.test(example.videoId) || !Number.isFinite(example.start) || example.start < 0
        || !Number.isFinite(example.end) || example.end <= example.start)
      || card.reviews.some(review => !review || !Number.isFinite(Date.parse(review.at)) || ![1, 2, 3].includes(review.rating)
        || (review.id !== undefined && (typeof review.id !== 'string' || !review.id || review.id.length > 100))
        || (review.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(review.day)))
      || card.definitions.some(entry => !entry || typeof entry.headword !== 'string' || typeof entry.reading !== 'string'
        || !Array.isArray(entry.senses) || entry.senses.some(sense => !sense || !Array.isArray(sense.meanings)
          || sense.meanings.some(text => typeof text !== 'string')))) {
      throw new Error('Invalid study backup');
    }
    ids.add(card.id);
  }
  return data.cards;
}

export function libraryJSON(cards) { return JSON.stringify({ version: 1, cards }, null, 2); }
