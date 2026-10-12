import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueAtTime, filterCues, formatTime } from './transcript.mjs';

const cues = [
  { start: 0.48, end: 4.12, text: '皆さん、こんにちは。' },
  { start: 4.12, end: 6.3, text: '昨日、寿司を食べました。' },
  { start: 8, end: 10, text: 'ＡＢＣ' },
];

test('synchronization handles boundaries, gaps, and ending', () => {
  assert.equal(cueAtTime(cues, 0), -1);
  assert.equal(cueAtTime(cues, 0.48), 0);
  assert.equal(cueAtTime(cues, 4.119), 0);
  assert.equal(cueAtTime(cues, 4.12), 1);
  assert.equal(cueAtTime(cues, 6.3), -1);
  assert.equal(cueAtTime(cues, 8), 2);
  assert.equal(cueAtTime(cues, 10), -1);
  assert.equal(cueAtTime([], 0), -1);
  assert.equal(cueAtTime(cues, 0, true), -1, 'Do not show a future caption before it starts');
  assert.equal(cueAtTime(cues, 6.3, true), 1, 'Hold the last caption when its interval ends');
  assert.equal(cueAtTime(cues, 7.5, true), 1, 'Keep it through the gap');
  assert.equal(cueAtTime(cues, 8, true), 2, 'Switch exactly when the next caption starts');
  assert.equal(cueAtTime(cues, 12, true), 2, 'Keep the final caption visible after it ends');
  assert.equal(cueAtTime(cues, 5, true), 1, 'Seeking backward selects the correct earlier caption');
  assert.equal(cueAtTime([], 10, true), -1);
});

test('search preserves original cue index for seeking', () => {
  assert.equal(filterCues(cues, ' 寿司 ')[0].index, 1);
  assert.equal(filterCues(cues, 'abc')[0].index, 2);
  assert.equal(filterCues(cues, '').length, 3);
});

test('playback clock uses readable timestamps', () => {
  assert.equal(formatTime(885), '14:45');
  assert.equal(formatTime(-1), '0:00');
  assert.equal(formatTime(NaN), '0:00');
});
