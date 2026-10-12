import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTranslations, transcriptHash } from '../scripts/build-translations.mjs';
import { translationsForTranscript } from './translations.mjs';

const transcript = { cues: [{ start: 0, end: 2, text: '家に食材がなさすぎて' },
  { start: 2, end: 4, text: 'アボカドを食べようとしています' }] };
const sentences = { japaneseSha256: transcriptHash(transcript),
  groups: [[0, 1, "I'm about to eat an avocado because I barely have any ingredients at home."]] };

test('whole-sentence translations cover every caption with exact Japanese timings', () => {
  const translations = buildTranslations(transcript, sentences);
  assert.equal(translations.cues.length, 2);
  assert.equal(translations.cues[0].english, translations.cues[1].english);
  assert.equal(translations.cues[1].start, 2);
  assert.equal(translationsForTranscript(transcript, translations).filter(Boolean).length, 2);
});

test('gaps, overlaps and stale Japanese cannot silently rebuild English', () => {
  for (const groups of [[[1, 1, 'Late start.']], [[0, 0, 'Incomplete.']],
    [[0, 1, 'Full.'], [1, 1, 'Duplicate.']], [[0, 2, 'Out of range.']], [[0, 1, '']]]) {
    assert.throws(() => buildTranslations(transcript, { ...sentences, groups }));
  }
  const changed = { cues: [{ ...transcript.cues[0], text: '食材がいっぱいある' }, transcript.cues[1]] };
  assert.throws(() => buildTranslations(changed, sentences), /Japanese captions changed/);
});

test('new caption revisions suppress stale translations for the entire sentence', () => {
  const translations = buildTranslations(transcript, sentences);
  const changed = { cues: [{ ...transcript.cues[0], text: '食材がいっぱいある' }, transcript.cues[1]] };
  assert.deepEqual(translationsForTranscript(changed, translations), ['', '']);
  const retimed = { cues: [transcript.cues[0], { ...transcript.cues[1], end: 5 }] };
  assert.deepEqual(translationsForTranscript(retimed, translations), ['', '']);
  assert.deepEqual(translationsForTranscript(transcript, null), ['', '']);
});

test('current video has a nonempty English sentence for every Japanese caption', async t => {
  const active = JSON.parse(await readFile(new URL('./data/active-video.json', import.meta.url)));
  if (!active.id) { t.skip('No local video imported yet'); return; }
  const japanese = JSON.parse(await readFile(new URL(`../${active.transcriptPath}`, import.meta.url)));
  const english = JSON.parse(await readFile(new URL(`../${active.translationPath}`, import.meta.url)));
  const aligned = translationsForTranscript(japanese, english);
  assert.equal(aligned.length, japanese.cues.length);
  assert.ok(aligned.every(text => text.trim()));
  assert.equal(aligned[0], english.cues[0].english);
  assert.equal(aligned.at(-1), english.cues.at(-1).english);
});
