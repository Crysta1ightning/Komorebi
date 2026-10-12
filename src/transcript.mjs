export function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

// Half-open intervals select the new caption at a shared boundary. Holding
// keeps the latest started caption visible through gaps and after the last cue.
export function cueAtTime(cues, time, holdLast = false) {
  let left = 0;
  let right = cues.length - 1;
  let candidate = -1;
  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    if (cues[middle].start <= time) {
      candidate = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }
  return candidate >= 0 && (holdLast || time < cues[candidate].end) ? candidate : -1;
}

export function filterCues(cues, query) {
  const normalized = query.trim().normalize('NFKC').toLocaleLowerCase();
  return cues.map((cue, index) => ({ ...cue, index })).filter(cue =>
    !normalized || cue.text.normalize('NFKC').toLocaleLowerCase().includes(normalized)
  );
}
