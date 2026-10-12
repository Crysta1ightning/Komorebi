import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export function transcriptHash(transcript) {
  return createHash('sha256').update(JSON.stringify(transcript.cues.map(({ start, end, text }) => ({ start, end, text })))).digest('hex');
}

export function buildTranslations(transcript, sentences) {
  if (sentences.japaneseSha256 !== transcriptHash(transcript)) throw new Error('Japanese captions changed: translate the new revision before rebuilding English.');
  const groups = sentences.groups;
  if (!Array.isArray(groups)) throw new Error('Missing English sentence groups');
  const cues = [];
  let next = 0;
  for (const [first, last, english] of groups) {
    if (first !== next || !Number.isInteger(first) || !Number.isInteger(last) || last < first
      || last >= transcript.cues.length || typeof english !== 'string' || !english.trim()) {
      throw new Error(`Invalid or incomplete translation group at cue ${next}`);
    }
    for (let index = first; index <= last; index++) {
      const cue = transcript.cues[index];
      cues.push({ start: cue.start, end: cue.end, japanese: cue.text, english,
        sentenceStart: first, sentenceEnd: last });
    }
    next = last + 1;
  }
  if (next !== transcript.cues.length) throw new Error('Translations must cover every Japanese cue');
  return { language: 'en', source: 'assistant-contextual-translation',
    basis: 'Active Japanese captions with surrounding context; uploaded English captions consulted for context.',
    timing: 'Exact Japanese cue timings; a complete English sentence can span multiple Japanese cues.', cues };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [transcriptPath, groupsPath, outputPath] = process.argv.slice(2);
  if (!outputPath) throw new Error('Usage: node scripts/build-translations.mjs TRANSCRIPT.json SENTENCES.json OUTPUT.json');
  const transcript = JSON.parse(await readFile(transcriptPath, 'utf8'));
  const groups = JSON.parse(await readFile(groupsPath, 'utf8'));
  const result = buildTranslations(transcript, groups);
  await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`Prepared English translations for ${result.cues.length} Japanese cues (${groups.groups.length} sentence groups).`);
}
