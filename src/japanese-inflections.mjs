// Candidate generation is only a fallback. An exact dictionary entry wins,
// and each candidate must be verified against the dictionary's verb class.
const godan = [
  ['える', 'う', 'v5u', 'u'], ['ける', 'く', 'v5k', 'ku'],
  ['げる', 'ぐ', 'v5g', 'gu'], ['せる', 'す', 'v5s', 'su'],
  ['てる', 'つ', 'v5t', 'tsu'], ['ねる', 'ぬ', 'v5n', 'nu'],
  ['べる', 'ぶ', 'v5b', 'bu'], ['める', 'む', 'v5m', 'mu'],
  ['れる', 'る', 'v5r', 'ru'],
];

export function potentialCandidates(text) {
  return godan.filter(([ending]) => text.endsWith(ending) && text.length > ending.length)
    .map(([ending, original, verbType, romanEnding]) => ({
      base: text.slice(0, -ending.length) + original, verbType, romanEnding,
    }));
}

export function matchesPotentialVerb(entry, candidate) {
  const tags = (entry.sense || entry.senses || []).flatMap(sense => sense.partOfSpeech || sense.partsOfSpeech || []);
  return tags.some(tag => tag === candidate.verbType || tag.startsWith(`${candidate.verbType}-`)
    || tag === `Godan verb with '${candidate.romanEnding}' ending`
    || (candidate.verbType === 'v5k' && tag === 'Godan verb - Iku/Yuku special class'));
}
