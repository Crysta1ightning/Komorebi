import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import kuromoji from 'kuromoji';
import { dictionaryIndex, tokenizeText, lookupEntries, compactEntry } from './vocabulary.mjs';

const dictionaryPath = process.argv[2];
if (!dictionaryPath) throw new Error('Usage: node scripts/build-vocabulary.mjs DICTIONARY_JSON [TRANSCRIPT_JSON OUTPUT_JSON]');
const active = JSON.parse(await readFile('src/data/active-video.json', 'utf8'));
const transcriptPath = process.argv[3] || active.transcriptPath;
const outputPath = process.argv[4] || active.vocabularyPath;
const dictionary = JSON.parse(await readFile(dictionaryPath, 'utf8'));
const transcript = JSON.parse(await readFile(transcriptPath, 'utf8'));
const tokenizer = await new Promise((resolve, reject) => {
  kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error, value) => error ? reject(error) : resolve(value));
});
const index = dictionaryIndex(dictionary);
const entries = {};
let total = 0;
let matched = 0;
const cues = transcript.cues.map(cue => ({
  tokens: tokenizeText(tokenizer, cue.text, index).map(token => {
    if (!token.selectable) return token;
    total++;
    const matches = lookupEntries(token, index);
    if (matches.length) matched++;
    for (const entry of matches) entries[entry.id] = compactEntry(entry, dictionary.tags);
    return { ...token, entryIds: matches.map(entry => entry.id) };
  }),
}));
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({
  source: 'JMdict (EDRDG), via jmdict-simplified',
  dictionaryDate: dictionary.dictDate,
  dictionaryVersion: dictionary.version,
  license: 'CC BY-SA 4.0',
  tokenizer: 'kuromoji/IPADIC',
  transcriptTexts: transcript.cues.map(cue => cue.text),
  cues, entries,
}, null, 2) + '\n');
console.log(`Prepared ${cues.length} cues; ${matched}/${total} selectable words have dictionary matches; ${Object.keys(entries).length} entries.`);
