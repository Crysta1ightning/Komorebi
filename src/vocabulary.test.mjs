import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import kuromoji from 'kuromoji';
import { tokenizeText, lookupEntries } from '../scripts/vocabulary.mjs';
import { entryDetails } from './vocabulary.mjs';

const vocabulary = JSON.parse(await readFile(new URL('./data/vocabulary.json', import.meta.url), 'utf8'));
const fixturePath = new URL('../artifacts/TE2mcomyNH8/TE2mcomyNH8.ja.processed.json', import.meta.url);
const hasVideoFixture = existsSync(fixturePath);
const transcript = hasVideoFixture ? JSON.parse(await readFile(fixturePath, 'utf8')) : { cues: [] };
const fixtureTest = (name, fn) => test(name, { skip: !hasVideoFixture }, fn);

test('active video caption and vocabulary revisions stay synchronized', async t => {
  const active = JSON.parse(await readFile(new URL('./data/active-video.json', import.meta.url), 'utf8'));
  if (!active.id) { t.skip('No local video imported yet'); return; }
  const currentTranscript = JSON.parse(await readFile(new URL(`../${active.transcriptPath}`, import.meta.url), 'utf8'));
  const currentWords = JSON.parse(await readFile(new URL(`../${active.vocabularyPath}`, import.meta.url), 'utf8'));
  assert.deepEqual(currentWords.transcriptTexts, currentTranscript.cues.map(cue => cue.text));
  currentWords.cues.forEach((cue, index) => {
    assert.equal(cue.tokens.map(token => token.surface).join(''), currentTranscript.cues[index].text);
  });
});

fixtureTest('all word buttons preserve original caption text and resolve stored entries', () => {
  assert.equal(vocabulary.cues.length, transcript.cues.length);
  vocabulary.cues.forEach((cue, index) => {
    assert.equal(vocabulary.transcriptTexts[index], transcript.cues[index].text);
    assert.equal(cue.tokens.map(token => token.surface).join(''), transcript.cues[index].text);
    for (const token of cue.tokens.filter(token => token.selectable)) {
      for (const id of token.entryIds) {
        assert.ok(vocabulary.entries[id], `Missing entry ${id}`);
        assert.ok(entryDetails(vocabulary.entries[id], token).senses.length > 0, `No applicable sense for ${token.surface}`);
      }
    }
  });
});

fixtureTest('real transcript conjugations point to the eat dictionary entry', () => {
  const token = vocabulary.cues.flatMap(cue => cue.tokens).find(token => token.surface === '食べよう');
  assert.equal(token.base, '食べる');
  assert.equal(token.reading, 'たべよう');
  assert.ok(entryDetails(vocabulary.entries[token.entryIds[0]], token).senses.some(sense => sense.meanings.includes('to eat')));
});

test('conjugated suru nouns resolve their dictionary noun only when suru usage is supported', async () => {
  const tokenizer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error, value) => error ? reject(error) : resolve(value)));
  const tasting = { id: '1312490', kanji: [{ text: '試食', common: true }],
    kana: [{ text: 'ししょく', common: true }], sense: [{ partOfSpeech: ['n', 'vs', 'vt'] }] };
  const index = new Map([['試食', [tasting]]]);
  for (const text of ['これを試食しつつ', '試食しました。', '試食しない。', '試食する。']) {
    const tokens = tokenizeText(tokenizer, text, index);
    assert.equal(tokens.map(token => token.surface).join(''), text);
    const verb = tokens.find(token => token.base === '試食する');
    assert.ok(verb, `Suru form stays together: ${text}`);
    assert.equal(verb.dictionaryBase, '試食', 'Dictionary headword and reading stay consistent');
    assert.deepEqual(lookupEntries(verb, index).map(entry => entry.id), ['1312490']);
  }
  const token = { surface: '試食し', base: '試食する', pos: '名詞', reading: 'ししょくし' };
  const nounOnly = { ...tasting, sense: [{ partOfSpeech: ['n'] }] };
  assert.deepEqual(lookupEntries(token, new Map([['試食', [nounOnly]]])), [], 'Ordinary nouns are not assumed to be suru verbs');
  const explicitVerb = { ...tasting, id: 'explicit', kanji: [{ text: '試食する' }] };
  assert.deepEqual(lookupEntries(token, new Map([...index, ['試食する', [explicitVerb]]])).map(entry => entry.id), ['explicit'], 'An exact dictionary verb entry takes priority');
});

test('te and de forms stay attached to the inflected verb without swallowing following words', async () => {
  const tokenizer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error, value) => error ? reject(error) : resolve(value)));
  for (const [text, surface, base, reading] of [
    ['やってみよう', 'やって', 'やる', 'やって'],
    ['行ってください', '行って', '行く', 'いって'],
    ['飲んでいる', '飲んで', '飲む', 'のんで'],
    ['食べている', '食べて', '食べる', 'たべて'],
    ['食べなくて困る', '食べなくて', '食べる', 'たべなくて'],
    ['高くて困る', '高くて', '高い', 'たかくて'],
    ['勉強している', '勉強して', '勉強する', 'べんきょうして'],
  ]) {
    const tokens = tokenizeText(tokenizer, text, new Map());
    assert.equal(tokens.map(token => token.surface).join(''), text);
    const verb = tokens.find(token => token.surface === surface);
    assert.ok(verb, `Complete inflected form: ${text}`);
    assert.equal(verb.base, base);
    assert.equal(verb.reading, reading);
    assert.ok(tokens.length > 1, 'Following words remain independently selectable');
  }
  for (const text of ['やっ て', '飲ん で', '学校で遊ぶ', 'それでいい']) {
    const tokens = tokenizeText(tokenizer, text, new Map());
    assert.equal(tokens.map(token => token.surface).join(''), text);
    assert.ok(!tokens.some(token => ['やって', '飲んで', '学校で', 'それで'].includes(token.surface)), `Unrelated particles and spaces remain separate: ${text}`);
  }
});

test('missing godan potential forms resolve to verified dictionary verbs; exact entries win', async () => {
  const tokenizer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error, value) => error ? reject(error) : resolve(value)));
  const verb = (text, tag) => ({ id: text, kanji: [{ text }], kana: [], sense: [{ partOfSpeech: [tag] }] });
  const index = new Map([
    ['頼む', [verb('頼む', 'v5m')]], ['読む', [verb('読む', 'v5m')]],
    ['書く', [verb('書く', 'v5k')]], ['見える', [verb('見える', 'v1')]],
    ['見う', [verb('見う', 'v5u')]], ['食ぶ', [verb('食ぶ', 'v1')]],
  ]);
  for (const [text, base] of [['頼める', '頼む'], ['頼めない', '頼む'], ['頼めました', '頼む'], ['読める', '読む'], ['書ける', '書く']]) {
    const tokens = tokenizeText(tokenizer, text, index);
    assert.equal(tokens.map(token => token.surface).join(''), text);
    assert.equal(tokens[0].base, base);
    assert.equal(tokens[0].matchType, 'potential');
    assert.equal(lookupEntries(tokens[0], index)[0].id, base);
  }
  assert.equal(tokenizeText(tokenizer, '見える', index)[0].base, '見える');
  assert.notEqual(tokenizeText(tokenizer, '食べる', index)[0].base, '食ぶ', 'Candidate must have the matching godan class');
});

test('contracted teiru verbs form complete selectable words without crossing spaces or joining independent verbs', async () => {
  const tokenizer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error, value) => error ? reject(error) : resolve(value)));
  for (const [text, surface, base] of [
    ['毛羽立ってる。', '毛羽立ってる', '毛羽立つ'],
    ['毛羽立ってた。', '毛羽立ってた', '毛羽立つ'],
    ['食べてる。', '食べてる', '食べる'], ['読んでる。', '読んでる', '読む'],
  ]) {
    const tokens = tokenizeText(tokenizer, text, new Map());
    assert.equal(tokens.map(token => token.surface).join(''), text);
    assert.equal(tokens[0].surface, surface);
    assert.equal(tokens[0].base, base);
  }
  assert.ok(!tokenizeText(tokenizer, '毛羽立っ てる', new Map()).some(token => token.surface === '毛羽立ってる'));
  assert.equal(tokenizeText(tokenizer, '照る', new Map())[0].base, '照る');
});

fixtureTest('adopted napkin spelling resolves the napkin meaning', () => {
  const cueIndex = transcript.cues.findIndex(cue => cue.text.includes('ナプキン'));
  const tokens = vocabulary.cues[cueIndex].tokens;
  const napkin = tokens.find(token => token.surface === 'ナプキン');
  assert.ok(napkin, 'Napkin must be one selectable word');
  assert.equal(napkin.base, 'ナプキン');
  assert.equal(napkin.reading, 'なぷきん');
  assert.equal(napkin.matchType, undefined);
  assert.ok(napkin.entryIds.some(id => entryDetails(vocabulary.entries[id], napkin).senses.some(sense => sense.meanings.includes('(table) napkin'))));
  assert.ok(!tokens.some(token => ['ナップ', 'キン'].includes(token.surface)));
});

fixtureTest('adopted minute joins the original tail without duplicated words or missing text', async () => {
  const original = JSON.parse(await readFile(new URL('../artifacts/TE2mcomyNH8/TE2mcomyNH8.ja.json', import.meta.url), 'utf8'));
  const adopted = transcript.cues.filter(cue => cue.start < 60);
  assert.equal(adopted.length, 20);
  assert.ok(adopted.some(cue => cue.text === '大家さんが特別に使っていいとのことで'));
  assert.ok(!adopted.some(cue => cue.text.includes('ナップキン')));
  assert.equal(transcript.cues.find(cue => cue.start >= 60).text, 'これを試食しつつ皆さん');
  const joined = transcript.cues.find(cue => cue.start === 62.44);
  assert.equal(joined.end, 68.04);
  assert.equal(joined.text, original.cues.filter(cue => cue.start === 62.44 || cue.start === 65.68).map(cue => cue.text).join(''));
  assert.ok(joined.text.includes('実はやったことない'));
  assert.ok(!transcript.cues.some(cue => cue.start === 65.68));
  const preserved = transcript.cues.filter(cue => cue.start >= 68.04).map(({ start, end, text }) => ({ start, end, text }));
  assert.deepEqual(preserved, original.cues.filter(cue => cue.start >= 68.04));
  transcript.cues.forEach((cue, index) => { if (index) assert.ok(cue.start >= transcript.cues[index - 1].end); });
  const token = vocabulary.cues[transcript.cues.indexOf(joined)].tokens.find(token => token.surface === '実は');
  assert.ok(token?.selectable && token.entryIds.length, 'The joined 実は has a complete dictionary lookup');
});

test('morphological tokenizer keeps polite past form together and punctuation inert', async () => {
  const tokenizer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error, value) => error ? reject(error) : resolve(value)));
  const text = '昨日、寿司を食べました。';
  const tokens = tokenizeText(tokenizer, text, new Map());
  assert.equal(tokens.map(token => token.surface).join(''), text);
  const verb = tokens.find(token => token.surface === '食べました');
  assert.equal(verb.base, '食べる');
  assert.equal(verb.reading, 'たべました');
  assert.equal(tokens.find(token => token.surface === '。').selectable, false);
  // Recombine dictionary-backed loanwords without dropping meaningful ッ.
  const index = new Map([['ナプキン', []], ['カップ', []]]);
  const loanwords = tokenizeText(tokenizer, 'ナップキンをカップに入れた。', index);
  assert.equal(loanwords[0].surface, 'ナップキン');
  assert.equal(loanwords[0].base, 'ナプキン');
  assert.equal(loanwords.find(token => token.surface === 'カップ').base, 'カップ');
  const separated = tokenizeText(tokenizer, 'ナップ キン', index);
  assert.equal(separated.map(token => token.surface).join(''), 'ナップ キン');
  assert.ok(!separated.some(token => token.surface === 'ナップキン'));
  assert.equal(lookupEntries({ surface: '未知語テスト', base: '未知語テスト', reading: '', pos: '名詞' }, new Map()).length, 0);
  for (const text of ['家に食材がなさすぎて', '時間がなさ過ぎる。', '良くなさすぎる。', '時間がなさすぎました。']) {
    const grouped = tokenizeText(tokenizer, text, new Map());
    assert.equal(grouped.map(token => token.surface).join(''), text);
    const expression = grouped.find(token => token.grammar);
    assert.ok(expression, `Negative excessive expression must be grouped: ${text}`);
    assert.equal(expression.base, text.startsWith('良く') ? '良くなさすぎる' : 'なさすぎる');
    assert.equal(expression.grammar.reading, text.startsWith('良く') ? 'よくなさすぎる' : 'なさすぎる');
    assert.ok(expression.grammar.explanation.includes(text.startsWith('良く') ? '否定' : '太缺乏'));
    assert.ok(!grouped.some(token => ['な', 'さ', 'すぎ'].includes(token.surface)));
  }
  for (const text of ['な さすぎ', 'なさ すぎ', 'なさそう。', '少なすぎる。', 'さすがですね。']) {
    const grouped = tokenizeText(tokenizer, text, new Map());
    assert.equal(grouped.map(token => token.surface).join(''), text);
    assert.ok(!grouped.some(token => token.grammar?.rule === 'negative-excess'), `Unrelated expression must not acquire this meaning: ${text}`);
  }
  for (const text of ['恋愛相談なんですね', '8万円なんですね', '学生なのですね', '静かなんです', '食べるんですね', '行かないんです']) {
    const grouped = tokenizeText(tokenizer, text, new Map());
    assert.equal(grouped.map(token => token.surface).join(''), text);
    assert.ok(!grouped.some(token => token.grammar), `Explanatory endings use ordinary tokenization: ${text}`);
    assert.ok(!grouped.some(token => ['なんですね', 'なのですね', 'なんです', 'んですね', 'んです'].includes(token.surface)));
  }
  for (const text of ['何ですか', 'なんですか', 'なんですね', 'なんで？', 'なんかありました', '学生な んですね', '学生なん ですね', '学生なん、ですね']) {
    const grouped = tokenizeText(tokenizer, text, new Map());
    assert.equal(grouped.map(token => token.surface).join(''), text);
    assert.ok(!grouped.some(token => token.grammar?.rule === 'explanatory-polite'), `Ambiguous or unrelated expression should remain unclassified: ${text}`);
  }
  for (const [text, base] of [['食べすぎました。', '食べる'], ['高すぎて', '高い'], ['少なすぎる', '少ない']]) {
    const grouped = tokenizeText(tokenizer, text, new Map());
    assert.equal(grouped.map(token => token.surface).join(''), text);
    const expression = grouped.find(token => token.grammar?.rule === 'lexical-excess');
    assert.ok(expression);
    assert.equal(expression.dictionaryBase, base);
    if (text.includes('ました')) {
      assert.equal(expression.surface, '食べすぎました');
      assert.ok(expression.grammar.components.some(part => part.meaning.includes('禮貌')));
      assert.ok(expression.grammar.components.some(part => part.meaning.includes('過去')));
    }
  }
  const negativeAction = tokenizeText(tokenizer, '食べなさすぎる。', new Map()).find(token => token.grammar);
  assert.equal(negativeAction.surface, '食べなさすぎる');
  assert.equal(negativeAction.dictionaryBase, '食べる');
  assert.ok(negativeAction.grammar.explanation.includes('不足'));
  const compoundIndex = new Map([['姿見', []], ['夢見る', []]]);
  const passive = tokenizeText(tokenizer, 'この姿見られたらちょっと恥ずかしい。', compoundIndex);
  assert.equal(passive.map(token => token.surface).join(''), 'この姿見られたらちょっと恥ずかしい。');
  assert.ok(passive.some(token => token.surface === '姿' && token.base === '姿'));
  assert.ok(!passive.some(token => token.surface === '姿見'));
  const seen = passive.find(token => token.surface === '見られたら');
  assert.equal(seen.base, '見る');
  assert.equal(seen.reading, 'みられたら');
  assert.ok(tokenizeText(tokenizer, '姿見を買った。', compoundIndex).some(token => token.surface === '姿見'));
  assert.ok(tokenizeText(tokenizer, '将来を夢見る。', compoundIndex).some(token => token.base === '夢見る'));
  for (const [text, surface, base] of [['先生に褒められました。', '褒められました', '褒める'],
    ['子供を寝させました。', '寝させました', '寝る']]) {
    const grouped = tokenizeText(tokenizer, text, new Map());
    assert.equal(grouped.map(token => token.surface).join(''), text);
    assert.equal(grouped.find(token => token.surface === surface)?.base, base);
  }
});

fixtureTest('1:10 caption looks up appearance and being seen, not a mirror', () => {
  const index = transcript.cues.findIndex(cue => cue.start === 70.68);
  const tokens = vocabulary.cues[index].tokens;
  assert.ok(!tokens.some(token => token.surface === '姿見'));
  const appearance = tokens.find(token => token.surface === '姿');
  const seen = tokens.find(token => token.surface === '見られたら');
  assert.equal(seen.base, '見る');
  assert.ok(appearance.entryIds.length);
  assert.ok(seen.entryIds.some(id => entryDetails(vocabulary.entries[id], seen).senses.some(sense => sense.meanings.includes('to see'))));
});

fixtureTest('active caption exposes なさすぎ as one meaningful selectable expression', () => {
  const index = transcript.cues.findIndex(cue => cue.text.includes('なさすぎ'));
  const token = vocabulary.cues[index].tokens.find(token => token.surface === 'なさすぎ');
  assert.ok(token?.selectable);
  assert.equal(token.base, 'なさすぎる');
  assert.equal(token.reading, 'なさすぎ');
  assert.ok(token.grammar.meaning.includes('far too little'));
});

fixtureTest('active noun endings no longer receive explanatory grammar grouping', () => {
  for (const text of ['恋愛相談なんですね', '8万円なんですね']) {
    const index = transcript.cues.findIndex(cue => cue.text.includes(text));
    const tokens = vocabulary.cues[index].tokens;
    assert.ok(!tokens.some(token => token.surface === 'なんですね' || token.grammar?.rule === 'explanatory-polite'));
    assert.equal(tokens.map(token => token.surface).join(''), transcript.cues[index].text);
  }
});

test('dictionary restrictions exclude senses belonging to other spellings', () => {
  const entry = {
    headwords: ['生', '性'],
    readings: [{ text: 'せい', appliesTo: ['*'] }],
    senses: [
      { meanings: ['life'], appliesToKanji: ['生'], appliesToKana: ['*'] },
      { meanings: ['nature'], appliesToKanji: ['性'], appliesToKana: ['*'] },
    ],
  };
  assert.deepEqual(entryDetails(entry, { base: '生', surface: '生', reading: 'せい' }).senses.map(sense => sense.meanings[0]), ['life']);
});
