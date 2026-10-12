import { readFile, writeFile } from 'node:fs/promises';

const dictionaryPath = process.argv[2];
if (!dictionaryPath) throw new Error('Usage: node scripts/audit-experiment-vocabulary.mjs PATH_TO_JMDICT_JSON');
const directory = 'artifacts/TE2mcomyNH8/first-minute';
const dictionary = JSON.parse(await readFile(dictionaryPath, 'utf8'));
const youtube = JSON.parse(await readFile(`${directory}/youtube-0-60.json`, 'utf8'));
const independent = JSON.parse(await readFile(`${directory}/independent-asr.json`, 'utf8'));
const forms = new Map();
for (const entry of dictionary.words) {
  for (const form of [...entry.kanji, ...entry.kana]) {
    if (!/^[ァ-ヺー・]+$/u.test(form.text)) continue;
    if (!forms.has(form.text) || form.common) forms.set(form.text, {
      text: form.text, common: form.common, id: entry.id,
      meanings: entry.sense.flatMap(sense => sense.gloss.filter(gloss => gloss.lang === 'eng').map(gloss => gloss.text)).slice(0, 4),
    });
  }
}

function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const reports = {};
function candidatesFor(term) {
  return [...forms.values()].filter(form => form.text.length >= 2 && withinOneEdit(term, form.text));
}

function inspectSpan(span) {
  if (forms.has(span)) return [];
  const candidates = candidatesFor(span);
  if (candidates.length) return [{ text: span, candidates }];
  // Try known compound prefixes before treating the remaining string as
  // unknown. This exposes ナップキン in ペーパーナップキン without first
  // accepting the unrelated prefix ナップ (nap) and losing the whole word.
  for (let cut = span.length - 1; cut >= 2; cut--) {
    if (forms.has(span.slice(0, cut))) return inspectSpan(span.slice(cut));
  }
  return [{ text: span, candidates: [] }];
}

for (const [name, segments, otherSegments] of [
  ['youtube', youtube.segments, independent.segments],
  ['independent_asr', independent.segments, youtube.segments],
]) {
  const text = segments.map(segment => segment.text).join('');
  const otherText = otherSegments.map(segment => segment.text).join('');
  const terms = [...new Set(text.match(/[ァ-ヺー]+/gu) || [])];
  reports[name] = terms.flatMap(span => inspectSpan(span).map(({ text, candidates }) => ({
    text, originalSpan: span,
    classification: 'no-exact-katakana-headword; not necessarily an error',
    candidates: candidates
      .map(form => ({ ...form, foundInOtherTranscript: otherText.includes(form.text) }))
      .sort((a, b) => Number(b.foundInOtherTranscript) - Number(a.foundInOtherTranscript) || Number(b.common) - Number(a.common))
      .slice(0, 5),
    auto_corrected: false,
  })));
}

await writeFile(`${directory}/dictionary-audit.json`, JSON.stringify({
  dictionaryDate: dictionary.dictDate,
  method: 'Contiguous katakana spans; exact headwords and known compound prefixes; edit-distance-at-most-one candidates before splitting unknown remainders; no context disambiguation.',
  allSuggestionsNeedReview: true, reports,
}, null, 2) + '\n');
const lines = ['# 字典輔助檢查', '',
  '只檢查連續片假名字串。找不到完整字典詞條不代表錯字：可能是人名、組合詞或口語。',
  '候選只根據一個字元以內的增刪替換、常用詞標記及另一份稿是否出現排序，不會自動改字幕。',
  '', '資料來源：JMdict © EDRDG，CC BY-SA 4.0；https://www.edrdg.org/edrdg/licence.html', '',
];
for (const [name, terms] of Object.entries(reports)) {
  lines.push(`## ${name}`, '', '| 可疑字串 | 字典候選 | 另一份稿有出現 |', '|---|---|---|');
  for (const term of terms) {
    lines.push(`| ${term.text} | ${term.candidates.map(candidate => `${candidate.text} (${candidate.meanings.join('; ')})`).join(' / ') || '無近似候選'} | ${term.candidates.filter(candidate => candidate.foundInOtherTranscript).map(candidate => candidate.text).join(' / ') || '無'} |`);
  }
  lines.push('');
}
await writeFile(`${directory}/dictionary-audit.md`, lines.join('\n') + '\n');
console.log(JSON.stringify(reports, null, 2));
