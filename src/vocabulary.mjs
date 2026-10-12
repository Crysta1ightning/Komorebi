// JMdict senses can apply only to particular spellings or readings.
export function entryDetails(entry, token) {
  const base = token.dictionaryBase || token.base;
  const headword = entry.headwords.includes(base) ? base
    : entry.headwords.includes(token.surface) ? token.surface : null;
  const readings = entry.readings.filter(reading => !headword || reading.appliesTo.includes('*') || reading.appliesTo.includes(headword));
  const exactReading = readings.find(reading => reading.text === token.reading);
  const reading = exactReading?.text || readings[0]?.text || '';
  const senses = entry.senses.filter(sense =>
    (!headword || sense.appliesToKanji.includes('*') || sense.appliesToKanji.includes(headword)) &&
    (!reading || sense.appliesToKana.includes('*') || sense.appliesToKana.includes(reading))
  );
  return { headword: headword || base, reading, senses };
}

export function entryReadingDetails(entry, token) {
  const headword = entryDetails(entry, token).headword;
  return entry.readings.filter(reading => reading.appliesTo.includes('*') || reading.appliesTo.includes(headword))
    .map(reading => ({ id: entry.id, ...entryDetails(entry, { ...token, reading: reading.text }) }))
    .filter(detail => detail.senses.length);
}
