import React, { useEffect, useRef, useState } from 'react';
import { entryReadingDetails } from './vocabulary.mjs';
import { lookupStudyReadings } from './study-dictionary.mjs';
import { formatTime } from './transcript.mjs';
import useJapaneseSpeech from './useJapaneseSpeech.jsx';
import { DictionaryExamples, ExampleEditor, ExtraExamples } from './StudyExamples.jsx';
const defaultVocabulary = { cues: [], entries: {} };

export function WordText({ vocabulary = defaultVocabulary, cueIndex, fallback, onWord, isSaved = () => false }) {
  const tokens = vocabulary.cues[cueIndex]?.tokens;
  if (!tokens) return fallback;
  return tokens.map((token, index) => token.selectable
    ? <button key={index} className={`word-token ${isSaved(token) ? 'is-saved' : ''}`} type="button" aria-label={`Look up ${token.surface}`} onClick={event => { event.stopPropagation(); onWord(token, cueIndex); }}>{token.surface}</button>
    : <React.Fragment key={index}>{token.surface}</React.Fragment>);
}

export default function WordLookup({ vocabulary = defaultVocabulary, selection, card, cue, onClose, onReplay, ready, saved, onToggleStar, onChooseReading, onAddExamples, onRemoveExample }) {
  const dialog = useRef(null);
  const speech = useJapaneseSpeech();
  const [otherReadings, setOtherReadings] = useState(null);
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => { if (node.open) node.close(); };
  }, []);
  const token = selection.token || { surface: card.word, base: card.word, reading: card.reading };
  const knownDetails = selection.token
    ? (token.entryIds || []).map(id => vocabulary.entries[id]).filter(Boolean).flatMap(entry => entryReadingDetails(entry, token))
    : card.definitions;
  const lookupWord = token.dictionaryBase || token.base;
  const grammarOnly = Boolean(token.grammar || knownDetails.some(detail => detail.source === 'grammar'));
  useEffect(() => {
    let active = true;
    setOtherReadings(null);
    if (!grammarOnly) lookupStudyReadings(lookupWord).then(details => { if (active && details.length) setOtherReadings(details); }).catch(() => {});
    return () => { active = false; };
  }, [lookupWord, grammarOnly]);
  const details = [...knownDetails, ...(otherReadings || [])].filter((detail, index, all) =>
    all.findIndex(item => item.id === detail.id && item.reading === detail.reading) === index);
  const selectedReading = card?.dictionaryChoice?.reading || card?.reading || token.reading;
  const selectedEntry = card?.dictionaryChoice?.entryId || card?.definitions[0]?.id || details[0]?.id;
  const multipleReadings = new Set(details.map(detail => detail.reading)).size > 1;
  const spokenReading = card?.dictionaryChoice?.reading || token.reading || token.surface;
  return <dialog ref={dialog} className="word-dialog" aria-labelledby="word-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) { const bounds = dialog.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>
    <div className="word-dialog-heading"><span className="eyebrow">WORD LOOKUP · JAPANESE → ENGLISH</span><div className="word-dialog-actions"><button className="study-star" aria-label={saved ? `取消收藏 ${token.surface}` : `收藏 ${token.surface}`} aria-pressed={saved} onClick={onToggleStar}>{saved ? '★' : '☆'}</button><button className="word-close" aria-label="Close word lookup" onClick={onClose}>×</button></div></div>
    <h2 id="word-title" lang="ja">{token.surface}</h2>
    <div className="word-reading word-reading-audio"><span lang="ja">{spokenReading || '—'}</span>{speech.available && <button className="speech-button" aria-label="朗讀單字" onClick={() => speech.speak(spokenReading)}>♪ 聽讀音</button>}</div>
    {speech.error && <p role="status">{speech.error}</p>}
    <div className="word-base"><span>Dictionary form</span><strong lang="ja">{token.base}</strong>{token.base !== token.surface && <span className="word-inflected">{token.matchType === 'spelling-variant' ? 'Caption spelling variant' : token.matchType === 'potential' ? '可能形 · 可以／能夠' : 'Inflected form'}</span>}</div>
    <div className="word-definitions">
      {multipleReadings && <p className="word-reading-note">這個字有多種讀音，意思可能不同。請選擇這次想學的讀音，字卡與朗讀會使用你的選擇。</p>}
      {token.grammar && <section className="word-entry" aria-label="文法組合"><div className="word-entry-heading"><strong>文法組合</strong></div><p>{token.grammar.explanation}</p><p>{token.grammar.meaning}</p>{token.grammar.components?.length > 0 && <ol>{token.grammar.components.map((part, index) => <li key={index}><strong lang="ja">{part.surface}</strong><p>{part.meaning}</p></li>)}</ol>}</section>}
      {details.map((detail, index) => {
        return <section className="word-entry" key={`${detail.id}:${detail.reading}`} aria-label={detail.source === 'grammar' ? '文法組合' : `Dictionary entry ${index + 1}`}>
          <div className="word-entry-heading"><strong lang="ja">{detail.headword}</strong><span lang="ja">{detail.reading}</span>{detail.source === 'custom' && <small>自訂意思</small>}{details.length > 1 && <small>Entry {index + 1}</small>}</div>
          {multipleReadings && onChooseReading && !detail.source && <div className="word-reading-actions"><label><input type="radio" name="study-reading" aria-label={`學習 ${detail.headword}（${detail.reading}）`} checked={selectedEntry === detail.id && selectedReading === detail.reading} onChange={() => { speech.stop(); onChooseReading(detail); }} />收藏此讀音</label>{speech.available && <button className="speech-button" aria-label={`朗讀 ${detail.reading}`} onClick={() => speech.speak(detail.reading)}>♪ 聽讀音</button>}</div>}
          <ol>{detail.senses.map((sense, senseIndex) => <li key={senseIndex}><span className="word-pos">{(sense.partsOfSpeech || []).join(' · ')}</span><p>{sense.meanings.join('; ')}</p>{sense.notes?.length > 0 && <small>{sense.notes.join(' · ')}</small>}</li>)}</ol>
        </section>;
      })}
      {!details.length && !token.grammar && <div className="word-missing"><strong>No dictionary match found.</strong><p>{card?.source === 'manual' ? '這是自行加入的詞，尚未提供意思。' : 'This may be a name, a speech fragment, or an automatic-caption error.'}</p></div>}
    </div>
    {cue && <div className="word-context"><span className="eyebrow">FROM THIS PASSAGE · {formatTime(cue.start)}</span><p lang="ja">{cue.text}</p>{cue.english && <p className="word-context-translation" lang="en">{cue.english}</p>}{onReplay && <button onClick={onReplay} disabled={!ready}>↻ Replay passage</button>}</div>}
    <ExtraExamples examples={card?.extraExamples} speech={speech} onRemove={onRemoveExample} />
    <DictionaryExamples definitions={card?.dictionaryChoice ? card.definitions : details} word={card?.word || token.dictionaryBase || token.base} reading={card?.reading || details[0]?.reading || token.reading} speech={speech} exclude={card?.extraExamples} />
    {onAddExamples && <ExampleEditor onAdd={onAddExamples} />}
    <div className="word-source">Dictionary meanings, not a verified contextual translation.<br />JMdict © <a href="https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project" target="_blank" rel="noreferrer">EDRDG</a> · <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">CC BY-SA 4.0</a><a className="word-external" href={`https://jisho.org/search/${encodeURIComponent(token.base)}`} target="_blank" rel="noreferrer">Open in Jisho ↗</a></div>
  </dialog>;
}
