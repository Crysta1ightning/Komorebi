import { entryDetails, entryReadingDetails } from './vocabulary.mjs';
import { potentialCandidates, matchesPotentialVerb } from './japanese-inflections.mjs';

export function dictionaryBucket(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 256;
}
const cache = new Map();
async function value(key) {
  const bucket = dictionaryBucket(key);
  if (!cache.has(bucket)) cache.set(bucket, fetch(`${import.meta.env?.BASE_URL || '/'}dictionary/${bucket}.json`)
    .then(response => { if (!response.ok) throw new Error('字典載入失敗，請稍後再試。'); return response.json(); })
    .catch(error => { cache.delete(bucket); throw error; }));
  return (await cache.get(bucket))[key];
}
export async function lookupStudyWord(word) {
  const text = word.trim().normalize('NFKC');
  async function entriesFor(term) {
    const ids = await value(`word:${term}`) || [];
    return (await Promise.all(ids.map(id => value(`id:${id}`)))).filter(Boolean);
  }
  let entries = await entriesFor(text);
  let lookupText = text;
  if (!entries.length) {
    for (const candidate of potentialCandidates(text)) {
      const matches = (await entriesFor(candidate.base)).filter(entry => matchesPotentialVerb(entry, candidate));
      if (matches.length) { entries = matches; lookupText = candidate.base; break; }
    }
  }
  return entries.map(entry => {
    const kana = entry.readings.find(reading => reading.text.normalize('NFKC') === lookupText);
    const headword = entry.headwords.find(word => word.normalize('NFKC') === lookupText)
      || entry.headwords.find(word => !kana || kana.appliesTo.includes('*') || kana.appliesTo.includes(word)) || lookupText;
    return { id: entry.id, ...entryDetails(entry, { base: headword, surface: text, reading: kana?.text }) };
  });
}
export async function dictionaryExamples(ids, word, reading) {
  const entries = await Promise.all(ids.filter(id => /^\d+$/.test(String(id))).map(id => value(`id:${id}`)));
  return uniqueExamples(entries.filter(Boolean).flatMap(entry => entryDetails(entry, { base: word, surface: word, reading }).senses.flatMap(sense => sense.examples || [])));
}

export async function lookupStudyReadings(word) {
  const text = word.trim().normalize('NFKC');
  const ids = await value(`word:${text}`) || [];
  const entries = await Promise.all(ids.map(id => value(`id:${id}`)));
  return entries.filter(Boolean).flatMap(entry => entryReadingDetails(entry, { base: text, surface: text }));
}
export function uniqueExamples(examples) {
  const seen = new Set();
  return examples.filter(example => { const key = JSON.stringify([example.text, example.english]); if (seen.has(key)) return false; seen.add(key); return true; });
}
export function parseExampleFile(text, filename) {
  let rows;
  if (/\.json$/i.test(filename)) {
    rows = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!Array.isArray(rows)) throw new Error('JSON 必須是一個陣列。');
  } else {
    rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim()).map(line => {
      const cells = line.split('\t');
      if (cells.length > 2) throw new Error('每行只接受日文與英文兩欄，以 Tab 分隔。');
      return { text: cells[0], english: cells[1] || '' };
    });
  }
  if (!rows.length || rows.length > 100) throw new Error('每次請提供 1–100 個例句。');
  if (rows.some(row => !row || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 2000 || (row.english !== undefined && (typeof row.english !== 'string' || row.english.length > 4000)))) throw new Error('每個例句需有 text（日文），可附 english（英文翻譯）。');
  return uniqueExamples(rows.map(row => ({ source: 'custom', text: row.text.trim(), english: (row.english || '').trim() })));
}
