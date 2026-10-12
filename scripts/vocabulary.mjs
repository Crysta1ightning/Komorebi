import { matchGrammar, attachAuxiliaryNotes } from './grammar.mjs';
import { potentialCandidates, matchesPotentialVerb } from '../src/japanese-inflections.mjs';

export function hiragana(text = '') {
  return text.replace(/[ァ-ヶ]/g, character => String.fromCharCode(character.charCodeAt(0) - 0x60));
}

// Explicit caption spelling variants. Do not globally remove small ッ:
// it changes real words such as カップ and バッグ.
const spellingVariants = new Map([['ナップキン', 'ナプキン']]);

function headwordFor(text, index) {
  if (index.has(text)) return text;
  const variant = spellingVariants.get(text);
  return variant && index.has(variant) ? variant : null;
}

function verbSuffix(token) {
  return token?.pos === '動詞' && token.pos_detail_1 === '接尾'
    && ['れる', 'られる', 'せる', 'させる'].includes(token.basic_form);
}

function suruNounEntries(token, index) {
  if (token.pos !== '名詞' || !token.base?.endsWith('する')) return [];
  return (index.get(token.base.slice(0, -2)) || []).filter(entry =>
    entry.sense.some(sense => sense.partOfSpeech.some(tag => /^vs(?:-|$)/.test(tag))));
}

export function dictionaryIndex(dictionary) {
  const index = new Map();
  for (const entry of dictionary.words) {
    for (const form of [...entry.kanji, ...entry.kana]) {
      const entries = index.get(form.text) || [];
      if (!entries.includes(entry)) entries.push(entry);
      index.set(form.text, entries);
    }
  }
  return index;
}

export function tokenizeText(tokenizer, text, index) {
  let rawOffset = 0;
  const raw = tokenizer.tokenize(text).map(token => {
    const start = text.indexOf(token.surface_form, rawOffset);
    if (start < rawOffset) throw new Error(`Could not locate token ${token.surface_form}`);
    rawOffset = start + token.surface_form.length;
    return { ...token, start, end: rawOffset };
  });
  const tokens = [];
  let offset = 0;
  for (let i = 0; i < raw.length; i++) {
    const first = raw[i];
    const match = matchGrammar(raw, i);
    let last = match?.last ?? i;
    let grammar = match?.grammar;
    // Prefer actual multi-token dictionary headwords, e.g. 皆さん or 恋愛相談.
    if (!grammar && first.pos !== '記号' && first.pos !== '助詞' && first.pos !== '助動詞') {
      for (let end = Math.min(i + 3, raw.length - 1); end > i; end--) {
        const parts = raw.slice(i, end + 1);
        if (parts.some(part => ['記号', '助詞', '助動詞'].includes(part.pos))) continue;
        // A dictionary noun must not swallow a predicate still being inflected:
        // 姿 + 見 + られ + たら is not the noun 姿見 (full-length mirror).
        const ending = raw[end];
        const following = raw[end + 1];
        if (['動詞', '形容詞'].includes(ending.pos) && ending.conjugated_form !== '基本形'
          && following && ending.end === following.start
          && (following.pos === '助動詞' || verbSuffix(following))) continue;
        if (headwordFor(parts.map(part => part.surface_form).join(''), index)) { last = end; break; }
      }
    }
    let base = grammar?.base || (last > i ? raw.slice(i, last + 1).map(t => t.surface_form).join('') : first.basic_form);
    if (!base || base === '*') base = first.surface_form;
    // A suru noun and its conjugated verb are a single selectable expression.
    if (first.pos === '名詞' && first.pos_detail_1 === 'サ変接続' && raw[last + 1]?.basic_form === 'する') {
      last++;
      base += 'する';
    }
    // Keep polite/past/negative auxiliaries attached to their lexical stem.
    if (grammar || ['動詞', '形容詞'].includes(first.pos) || base.endsWith('する')) {
      while ((raw[last + 1]?.pos === '助動詞' || verbSuffix(raw[last + 1])) && raw[last].end === raw[last + 1].start
        && !matchGrammar(raw, last + 1)) last++;
      // IPADIC separates te/de endings as conjunctive particles:
      // やっ + て, 飲ん + で, 食べなく + て. Keep the inflected form intact.
      const stem = raw[last];
      const ending = raw[last + 1];
      if (ending && stem.end === ending.start
        && ['動詞', '形容詞', '助動詞'].includes(stem.pos)
        && stem.conjugated_form?.startsWith('連用')
        && ending.pos === '助詞' && ending.pos_detail_1 === '接続助詞'
        && ['て', 'で'].includes(ending.surface_form)) last++;
      // IPADIC treats contracted ている/でいる as dependent verbs (てる/でる).
      // Attach them only to an adjacent continuative stem, never a free verb.
      const contracted = raw[last + 1];
      if (contracted && raw[last].end === contracted.start
        && raw[last].conjugated_form?.startsWith('連用')
        && contracted.pos === '動詞' && contracted.pos_detail_1 === '非自立'
        && ['てる', 'でる'].includes(contracted.basic_form)) {
        last++;
        while (raw[last + 1]?.pos === '助動詞' && raw[last].end === raw[last + 1].start) last++;
      }
    }
    const parts = raw.slice(i, last + 1);
    grammar = attachAuxiliaryNotes(grammar, parts);
    const surface = parts.map(part => part.surface_form).join('');
    const spellingHeadword = headwordFor(surface, index);
    const spellingVariant = spellingHeadword && spellingHeadword !== surface;
    if (spellingVariant) base = spellingHeadword;
    const reading = parts.every(part => part.reading && part.reading !== '*')
      ? hiragana(parts.map(part => part.reading).join('')) : '';
    // Preserve whitespace exactly rather than relying on Kuromoji positions.
    const start = text.indexOf(surface, offset);
    if (start < offset) throw new Error(`Could not locate token ${surface}`);
    if (start > offset) tokens.push({ surface: text.slice(offset, start), selectable: false });
    const token = { surface, base, reading, pos: first.pos, selectable: first.pos !== '記号' && /[\p{L}\p{N}]/u.test(surface), ...(spellingVariant ? { matchType: 'spelling-variant' } : {}), ...(grammar ? { grammar } : {}), ...(match?.dictionaryBase ? { dictionaryBase: match.dictionaryBase } : {}) };
    if (!grammar && first.pos === '動詞' && !index.has(base) && !index.has(surface)) {
      const verified = potentialCandidates(base).filter(candidate =>
        (index.get(candidate.base) || []).some(entry => matchesPotentialVerb(entry, candidate)));
      if (verified.length === 1) {
        token.base = verified[0].base;
        token.matchType = 'potential';
      }
    }
    if (!grammar && !token.dictionaryBase && !(index.get(base) || []).length
      && !(index.get(surface) || []).length && suruNounEntries(token, index).length) {
      token.dictionaryBase = base.slice(0, -2);
    }
    tokens.push(token);
    offset = start + surface.length;
    i = last;
  }
  if (offset < text.length) tokens.push({ surface: text.slice(offset), selectable: false });
  return tokens;
}

export function lookupEntries(token, index) {
  // Grammar constructions get their own notes, not unrelated dictionary homonyms.
  if (token.grammar && !token.dictionaryBase) return [];
  let matches = index.get(token.dictionaryBase || token.base) || index.get(token.surface) || [];
  if (token.base?.endsWith('する') && token.dictionaryBase === token.base.slice(0, -2)) {
    matches = suruNounEntries(token, index);
  }
  // JMdict commonly stores suru verbs under the noun (試食), while the
  // tokenizer keeps the conjugated noun + する together (試食し → 試食する).
  // Only fall back to nouns explicitly tagged as supporting suru conjugation.
  if (!matches.length) matches = suruNounEntries(token, index);
  // Match the known pronunciation when possible; do not substitute unrelated
  // kanji with the same pronunciation if the headword itself is missing.
  // A tokenizer reading is a guess; retain other readings instead of hiding them.
  const score = entry => {
    const tags = entry.sense.flatMap(sense => sense.partOfSpeech);
    const posMatch = token.pos === '助詞' ? tags.includes('prt')
      : token.pos === '動詞' ? tags.some(tag => /^v/.test(tag))
      : token.pos === '形容詞' ? tags.some(tag => /^adj/.test(tag))
      : token.pos === '名詞' ? tags.includes('n') : false;
    const readingMatch = entry.kana.some(kana => hiragana(kana.text) === token.reading);
    return (readingMatch ? 100 : 0) + (posMatch ? 10 : 0) + ([...entry.kanji, ...entry.kana].some(form => form.common) ? 1 : 0);
  };
  return [...matches].sort((a, b) => score(b) - score(a)).slice(0, 5);
}

export function compactEntry(entry, tags) {
  return {
    id: entry.id,
    headwords: entry.kanji.map(form => form.text),
    readings: entry.kana.map(form => ({ text: form.text, appliesTo: form.appliesToKanji })),
    senses: entry.sense.map(sense => ({
      meanings: sense.gloss.filter(gloss => gloss.lang === 'eng').map(gloss => gloss.text),
      partsOfSpeech: sense.partOfSpeech.map(tag => tags[tag] || tag),
      appliesToKanji: sense.appliesToKanji,
      appliesToKana: sense.appliesToKana,
      notes: [...sense.misc.map(tag => tags[tag] || tag), ...sense.info],
      ...(sense.examples?.length ? { examples: sense.examples.map(example => ({
        source: 'dictionary', sentenceId: String(example.source.value),
        text: example.sentences.find(sentence => sentence.lang === 'jpn')?.text || '',
        english: example.sentences.find(sentence => sentence.lang === 'eng')?.text || '',
      })).filter(example => example.text && example.english) } : {}),
    })),
  };
}
