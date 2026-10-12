// Match both wording and timing. Never display an earlier video's or revision's
// English next to newly transcribed Japanese merely because its index matches.
export function translationsForTranscript(transcript, translations) {
  if (!translations?.cues) return transcript.cues.map(() => '');
  const matches = index => {
    const cue = transcript.cues[index];
    const translation = translations.cues[index];
    return cue && translation && translation.japanese === cue.text
      && translation.start === cue.start && translation.end === cue.end
      && typeof translation.english === 'string' && translation.english.trim();
  };
  return transcript.cues.map((cue, index) => {
    const translation = translations.cues[index];
    if (!matches(index) || !Number.isInteger(translation.sentenceStart) || !Number.isInteger(translation.sentenceEnd)
      || translation.sentenceStart < 0 || translation.sentenceStart > index || translation.sentenceEnd < index
      || translation.sentenceEnd >= transcript.cues.length) return '';
    for (let member = translation.sentenceStart; member <= translation.sentenceEnd; member++) {
      if (!matches(member)) return '';
    }
    return translation.english;
  });
}
