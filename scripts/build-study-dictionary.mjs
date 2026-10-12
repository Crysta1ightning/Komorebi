import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { compactEntry } from './vocabulary.mjs';
import { dictionaryBucket } from '../src/study-dictionary.mjs';

const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/build-study-dictionary.mjs JMDICT_EXAMPLES_JSON');
const data = JSON.parse(await readFile(path, 'utf8'));
const buckets = Array.from({ length: 256 }, () => ({}));
let withExamples = 0;
for (const word of data.words) {
  const entry = compactEntry(word, data.tags);
  if (entry.senses.some(sense => sense.examples?.length)) withExamples++;
  const idKey = `id:${entry.id}`;
  buckets[dictionaryBucket(idKey)][idKey] = entry;
  for (const text of new Set([...word.kanji, ...word.kana].map(form => form.text.normalize('NFKC')))) {
    const key = `word:${text}`;
    (buckets[dictionaryBucket(key)][key] ||= []).push(entry.id);
  }
}
await mkdir('public/dictionary', { recursive: true });
for (let i = 0; i < buckets.length; i++) await writeFile(`public/dictionary/${i}.json`, JSON.stringify(buckets[i]));
await writeFile('public/dictionary/metadata.json', JSON.stringify({ source: 'JMdict with examples (EDRDG), via jmdict-simplified', date: data.dictDate, words: data.words.length, withExamples, dictionaryLicense: 'CC BY-SA 4.0', examplesSource: 'Tatoeba', examplesLicense: 'CC BY 2.0', upstream: 'https://github.com/scriptin/jmdict-simplified' }, null, 2));
console.log(`${data.words.length} dictionary entries; ${withExamples} entries with bilingual examples; 256 local shards.`);
