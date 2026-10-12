import { readFile, writeFile } from 'node:fs/promises';

const [input, outputPrefix] = process.argv.slice(2);
if (!input || !outputPrefix) {
  throw new Error('Usage: node scripts/normalize-captions.mjs INPUT.json3 OUTPUT_PREFIX');
}

const raw = JSON.parse(await readFile(input, 'utf8'));
// YouTube's rolling captions overlap. Retain text events, dropping window
// instructions and newline-only events, then end each cue at the next cue.
const events = raw.events.filter(event =>
  event.segs?.some(segment => segment.utf8?.trim())
);
const cues = events.map((event, index) => {
  const start = event.tStartMs / 1000;
  const originalEnd = (event.tStartMs + event.dDurationMs) / 1000;
  const nextStart = events[index + 1]?.tStartMs / 1000;
  return {
    start,
    end: Number.isFinite(nextStart) ? Math.min(originalEnd, nextStart) : originalEnd,
    text: event.segs.map(segment => segment.utf8 ?? '').join('').trim(),
  };
});
for (const cue of cues) {
  if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start) {
    throw new Error(`Invalid cue: ${JSON.stringify(cue)}`);
  }
}

function timestamp(seconds, separator) {
  const ms = Math.round(seconds * 1000);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000) % 60;
  const secs = Math.floor(ms / 1000) % 60;
  return `${[hours, minutes, secs].map(n => String(n).padStart(2, '0')).join(':')}${separator}${String(ms % 1000).padStart(3, '0')}`;
}

const blocks = separator => cues.map((cue, index) =>
  `${index + 1}\n${timestamp(cue.start, separator)} --> ${timestamp(cue.end, separator)}\n${cue.text}\n`
).join('\n');

await writeFile(`${outputPrefix}.json`, JSON.stringify({
  language: 'ja',
  source: 'youtube-automatic-captions',
  reviewed: false,
  timing: 'caption-chunks; overlapping display intervals shortened',
  cues,
}, null, 2) + '\n');
await writeFile(`${outputPrefix}.srt`, blocks(','));
await writeFile(`${outputPrefix}.vtt`, `WEBVTT\n\n${blocks('.')}`);
console.log(`Exported ${cues.length} unreviewed Japanese cues to JSON, SRT and VTT.`);
