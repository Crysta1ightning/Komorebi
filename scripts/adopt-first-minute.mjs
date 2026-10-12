import { readFile, writeFile } from 'node:fs/promises';

const directory = 'artifacts/TE2mcomyNH8';
const original = JSON.parse(await readFile(`${directory}/TE2mcomyNH8.ja.json`, 'utf8'));
const raw = JSON.parse(await readFile(`${directory}/TE2mcomyNH8.ja-orig.json3`, 'utf8'));
const asr = JSON.parse(await readFile(`${directory}/first-minute/independent-asr.json`, 'utf8'));
const decisions = JSON.parse(await readFile(`${directory}/first-minute/adopted-corrections.json`, 'utf8'));
const cutoff = decisions.scope.end;
const applied = [];
const replacement = asr.segments.map(segment => {
  let text = segment.text.trim();
  for (const correction of decisions.corrections) {
    if (Math.abs(segment.start - correction.start) > 0.1) continue;
    if (!text.includes(correction.from)) throw new Error(`Correction no longer matches: ${correction.from}`);
    text = text.replace(correction.from, correction.to);
    applied.push(correction);
  }
  return { start: segment.start, end: Math.min(cutoff, segment.end), text };
});
if (applied.length !== decisions.corrections.length) throw new Error('Not all adopted corrections were applied');

// Keep any post-cutoff text inside the YT cue that straddles 60 seconds.
// Without word offsets, retaining the whole cue would duplicate 200円ぐらいの;
// dropping it would lose これを試食しつつ皆さん.
const boundary = [];
for (const cue of original.cues.filter(cue => cue.start < cutoff && cue.end > cutoff)) {
  const event = raw.events.find(event => event.tStartMs === Math.round(cue.start * 1000) && event.segs?.some(segment => segment.utf8?.trim()));
  if (!event) throw new Error('Missing raw timing for the boundary cue');
  const parts = event.segs.filter(segment => segment.utf8?.trim() && (event.tStartMs + (segment.tOffsetMs || 0)) / 1000 >= cutoff);
  if (parts.length) boundary.push({
    start: (event.tStartMs + (parts[0].tOffsetMs || 0)) / 1000,
    end: cue.end,
    text: parts.map(segment => segment.utf8).join('').trim(),
  });
}
const tail = original.cues.filter(cue => cue.start >= cutoff).map(cue => ({ start: cue.start, end: cue.end, text: cue.text }));
const cues = [...replacement, ...boundary, ...tail];
// Local boundary edits join adjacent cues without rewriting spoken text.
const merges = JSON.parse(await readFile(`${directory}/caption-boundary-merges.json`, 'utf8'));
for (const [firstStart, secondStart] of merges) {
  const index = cues.findIndex(cue => cue.start === firstStart);
  const first = cues[index];
  const second = cues[index + 1];
  if (!first || !second || second.start !== secondStart || first.end !== second.start) {
    throw new Error(`Caption merge no longer matches: ${firstStart}, ${secondStart}`);
  }
  cues.splice(index, 2, { start: first.start, end: second.end, text: first.text + second.text });
}
for (let i = 0; i < cues.length; i++) {
  const cue = cues[i];
  if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start || !cue.text) throw new Error(`Invalid cue ${i}`);
  if (i && cue.start < cues[i - 1].end) throw new Error(`Overlapping adopted cues ${i}`);
}

const processed = {
  language: 'ja', source: 'mixed-independent-asr-and-youtube',
  cues,
};
function timestamp(seconds, separator) {
  const value = Math.round(seconds * 1000);
  return `${String(Math.floor(value / 3600000)).padStart(2, '0')}:${String(Math.floor(value / 60000) % 60).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}${separator}${String(value % 1000).padStart(3, '0')}`;
}
const blocks = separator => cues.map((cue, index) => `${index + 1}\n${timestamp(cue.start, separator)} --> ${timestamp(cue.end, separator)}\n${cue.text}\n`).join('\n');
const prefix = `${directory}/TE2mcomyNH8.ja.processed`;
await writeFile(`${prefix}.json`, JSON.stringify(processed, null, 2) + '\n');
await writeFile(`${prefix}.srt`, blocks(','));
await writeFile(`${prefix}.vtt`, `WEBVTT\n\n${blocks('.')}`);
console.log(`Adopted ${replacement.length} ASR passages for 0–60s; preserved ${boundary.length} boundary cue and ${tail.length} subsequent YouTube cues. Total ${cues.length}.`);
