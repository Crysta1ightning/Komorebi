import { libraryJSON, localDay, parseLibrary, rebuildFamiliarity } from './study.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
export const sameStudyData = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const equal = sameStudyData;
const reviewKey = review => review.id || `legacy:${review.at}:${review.rating}`;
const exampleKey = example => JSON.stringify([example.videoId, example.start, example.end, example.text, example.english || '']);
const extraKey = example => JSON.stringify([example.text, example.english]);

function mergeItems(base = [], local = [], remote = [], key) {
  const localKeys = new Set(local.map(key));
  const removed = new Set(base.filter(item => !localKeys.has(key(item))).map(key));
  const items = new Map(remote.filter(item => !removed.has(key(item))).map(item => [key(item), item]));
  const remoteKeys = new Set(remote.map(key));
  const remoteRemoved = new Set(base.filter(item => !remoteKeys.has(key(item))).map(key));
  for (const item of local) if (!remoteRemoved.has(key(item))) items.set(key(item), item);
  return [...items.values()];
}

// Three-way merge against the last acknowledged cloud snapshot. Both devices'
// new review events survive, while an unchanged local field cannot overwrite
// a remote change (including unstars and custom-example deletion).
export function mergeLibraries(base, local, remote) {
  const byId = cards => new Map(cards.map(card => [card.id, card]));
  const baseline = byId(base), mine = byId(local), theirs = byId(remote);
  const output = [];
  for (const id of new Set([...theirs.keys(), ...mine.keys()])) {
    const a = mine.get(id), b = theirs.get(id), previous = baseline.get(id);
    if (!a || !b) { output.push(a || b); continue; }
    const merged = { ...b };
    for (const key of ['word', 'surface', 'source', 'starred', 'queueOrder']) {
      if (previous && !equal(a[key], previous[key])) merged[key] = a[key];
      else if (b[key] === undefined) merged[key] = a[key];
    }
    // A reading and its meanings are one choice. Do not combine one device's
    // pronunciation with the other device's dictionary selection.
    const readingFields = ['reading', 'definitions', 'dictionaryChoice'];
    const locallyChosen = previous && (!equal(a.dictionaryChoice, previous.dictionaryChoice)
      || !equal(a.reading, previous.reading));
    const localDefinitionsChanged = previous && !equal(a.definitions, previous.definitions)
      && equal(b.dictionaryChoice, previous.dictionaryChoice);
    const readingSource = locallyChosen || localDefinitionsChanged || b.reading === undefined ? a : b;
    for (const key of readingFields) {
      if (readingSource[key] === undefined) delete merged[key];
      else merged[key] = readingSource[key];
    }
    merged.addedAt = a.addedAt < b.addedAt ? a.addedAt : b.addedAt;
    const events = new Map();
    for (const event of [...b.reviews, ...a.reviews]) events.set(reviewKey(event), event);
    merged.reviews = [...events.values()].sort((x, y) => x.at.localeCompare(y.at) || reviewKey(x).localeCompare(reviewKey(y)));
    const latest = merged.reviews.at(-1);
    const progress = equal(merged.reviews, a.reviews) ? a : equal(merged.reviews, b.reviews) ? b : null;
    if (progress) {
      merged.familiarity = progress.familiarity || rebuildFamiliarity(progress.reviews);
      merged.completedOn = progress.completedOn;
      merged.schedule = progress.schedule;
    } else {
      merged.familiarity = rebuildFamiliarity(merged.reviews);
      merged.completedOn = latest?.rating === 3 ? latest.day || localDay(latest.at) : null;
      // FSRS is retained for compatibility; familiarity controls admission.
      merged.schedule = (a.reviews.at(-1)?.at > (b.reviews.at(-1)?.at || '') ? a : b).schedule;
    }
    merged.examples = mergeItems(previous?.examples, a.examples, b.examples, exampleKey);
    if (a.extraExamples || b.extraExamples) merged.extraExamples = mergeItems(previous?.extraExamples, a.extraExamples, b.extraExamples, extraKey);
    output.push(merged);
  }
  // Invalid or oversized remote documents never replace a usable local copy.
  return parseLibrary(libraryJSON(output));
}

export function documentFor(cards) { return JSON.parse(libraryJSON(cards)); }
export function cardsFrom(document) { return parseLibrary(JSON.stringify(document || { version: 1, cards: [] })); }

// Compare-and-swap avoids the last writer silently replacing another device.
// Retry from the same baseline so new cloud edits are merged, not discarded.
export async function exchangeStudy({ base, readLocal, readRemote, compareAndSwap, commit, attempts = 5 }) {
  let remote = await readRemote();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const local = readLocal();
    const remoteCards = cardsFrom(remote.document);
    const merged = mergeLibraries(base, local, remoteCards);
    if (equal(merged, remoteCards)) {
      await commit({ cloud: merged, localAtSend: local, revision: remote.revision });
      return;
    }
    const result = await compareAndSwap(remote.revision, documentFor(merged));
    if (result.applied) {
      await commit({ cloud: cardsFrom(result.document), localAtSend: local, revision: result.revision });
      return;
    }
    remote = result;
  }
  throw new Error('另一台裝置正在更新，請稍後再同步。');
}
