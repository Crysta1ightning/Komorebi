// App-authored grammar notes, separate from JMdict senses. Rules use IPADIC
// morphology and adjacent tokens, not a list of sentences from one video.
const kana = text => text.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const excessive = token => token && (['すぎる', '過ぎる'].includes(token.basic_form)
  || (token.surface_form === 'すぎ' && token.pos_detail_1 === '接尾'));
const component = (surface, meaning) => ({ surface, meaning });
const adjacent = (raw, start, end) => raw.slice(start, end).every((token, index) => token.end === raw[start + index + 1].start);

function negativeExcess(raw, start) {
  const first = raw[start];
  const hasStem = first && ['動詞', '形容詞'].includes(first.pos)
    && ['未然形', '連用形', '連用テ接続'].includes(first.conjugated_form)
    && raw[start + 1]?.basic_form === 'ない' && ['助動詞', '形容詞'].includes(raw[start + 1]?.pos);
  const negativeStart = start + (hasStem ? 1 : 0);
  const [negative, suffix, excess] = raw.slice(negativeStart, negativeStart + 3);
  if (!negative || !suffix || !excess || !['ない', '無い'].includes(negative.basic_form)
    || suffix.surface_form !== 'さ' || suffix.pos_detail_1 !== '接尾' || !excessive(excess)) return null;
  return { last: negativeStart + 2, ...(hasStem ? { dictionaryBase: first.basic_form } : {}), grammar: {
    rule: 'negative-excess', base: `${hasStem ? first.surface_form : ''}なさすぎる`,
    reading: `${hasStem ? kana(first.reading || first.surface_form) : ''}なさすぎる`,
    meaning: hasStem ? 'far too little of the action or quality (negative + excessive; see the base word)'
      : 'to have far too little; to be severely lacking',
    explanation: hasStem ? `「${first.basic_form}」＋否定のない＋すぎる：原本動作或性質不足的程度過頭；搭配下方字典原義理解。`
      : 'ない（沒有）＋すぎる（太過）：太少、太缺乏。',
    components: [...(hasStem ? [component(first.surface_form, `${first.basic_form}的詞幹（原義見字典）`)] : []), component(negative.surface_form, 'ない的詞幹：沒有／否定'),
      component(suffix.surface_form, '連接ない與すぎる的形式'), component(excess.surface_form, 'すぎる：程度過頭')],
  } };
}

function lexicalExcess(raw, start) {
  const [stem, excess] = raw.slice(start, start + 2);
  if (!stem || !excess || !['動詞', '形容詞'].includes(stem.pos) || !excessive(excess)
    || !['連用形', 'ガル接続'].includes(stem.conjugated_form)
    || !(excess.pos_detail_1 === '非自立' || excess.pos_detail_1 === '接尾')) return null;
  return { last: start + 1, dictionaryBase: stem.basic_form, grammar: {
    rule: 'lexical-excess', base: `${stem.surface_form}すぎる`, reading: `${kana(stem.reading || stem.surface_form)}すぎる`,
    meaning: 'to do too much; to be excessively … (see the base word)',
    explanation: `「${stem.basic_form}」的詞幹＋すぎる：原本動作或性質的程度過頭；意思需搭配下方字典原義。`,
    components: [component(stem.surface_form, `${stem.basic_form}的詞幹（原義見字典）`), component(excess.surface_form, 'すぎる：太過、過量')],
  } };
}

const rules = [negativeExcess, lexicalExcess];
export function matchGrammar(raw, start) {
  for (const rule of rules) {
    const match = rule(raw, start);
    if (match && adjacent(raw, start, match.last)) return match;
  }
  return null;
}

export function attachAuxiliaryNotes(grammar, parts) {
  if (!grammar) return null;
  const auxiliaries = parts.filter(token => token.pos === '助動詞');
  const meanings = { 'ます': '禮貌形式', 'た': '過去／已完成（依上下文）', 'ない': '否定', 'です': '禮貌形式' };
  const components = [...grammar.components];
  for (const token of auxiliaries) {
    if (!components.some(item => item.surface === token.surface_form)) {
      components.push(component(token.surface_form, meanings[token.basic_form] || `助動詞：${token.basic_form}`));
    }
  }
  return { ...grammar, components };
}
