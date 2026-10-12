import React, { useRef, useState } from 'react';
import { lookupStudyWord, uniqueExamples } from './study-dictionary.mjs';
import { ExampleEditor, ExtraExamples } from './StudyExamples.jsx';

export default function ManualWordForm({ library }) {
  const [word, setWord] = useState('');
  const [reading, setReading] = useState('');
  const [meaning, setMeaning] = useState('');
  const [examples, setExamples] = useState([]);
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  function changeWord(value) {
    request.current++; setBusy(false); setWord(value); setEntries([]); setSelected(''); setReading(''); setMeaning(''); setStatus('');
  }
  async function lookup(event) {
    event.preventDefault();
    const version = ++request.current;
    setBusy(true); setStatus('');
    try {
      const matches = await lookupStudyWord(word);
      if (version !== request.current) return;
      setEntries(matches); setSelected(matches[0]?.id || ''); setReading(matches[0]?.reading || '');
      setStatus(matches.length ? `找到 ${matches.length} 個字典條目。請確認要學的意思。` : '字典未收錄，可自行填寫讀音與意思。請使用字典原形查詢，例如「食べる」。');
    } catch (error) { if (version === request.current) setStatus(error.message); }
    finally { if (version === request.current) setBusy(false); }
  }
  function save() {
    try {
      const entry = entries.find(item => item.id === selected);
      library.addManual({ word: entry?.headword || word, reading,
        definitions: entry ? [entry] : meaning.trim() ? [{ id: 'custom', source: 'custom', headword: word.trim(), reading: reading.trim(), senses: [{ meanings: [meaning.trim()] }] }] : [], examples });
      setWord(''); setReading(''); setMeaning(''); setEntries([]); setSelected(''); setExamples([]); setStatus('已加入單字收藏。');
    } catch (error) { setStatus(error.message); }
  }
  return <details className="manual-word-panel"><summary>＋ 自己新增單字</summary>
    <form onSubmit={lookup}><label>日文單字<input aria-label="新增日文單字" required maxLength={100} value={word} onChange={event => changeWord(event.target.value)} placeholder="例如：食べる" /></label><button disabled={busy || !word.trim()} type="submit">{busy ? '查詢中…' : '查字典'}</button></form>
    {!!entries.length && <fieldset><legend>選擇字典意思</legend>{entries.map(entry => <label className="manual-entry" key={entry.id}><input type="radio" name="manual-entry" checked={selected === entry.id} onChange={() => { setSelected(entry.id); setReading(entry.reading); }} /><span><strong lang="ja">{entry.headword} · {entry.reading}</strong><br />{entry.senses.map(sense => sense.meanings.join('; ')).join(' / ')}</span></label>)}</fieldset>}
    <label>{entries.length ? '字典讀音' : '讀音（可留空）'}<input aria-label="新增單字讀音" readOnly={!!entries.length} maxLength={100} value={reading} onChange={event => setReading(event.target.value)} /></label>
    {!entries.length && <label>意思（可留空）<textarea aria-label="新增單字意思" maxLength={4000} value={meaning} onChange={event => setMeaning(event.target.value)} /></label>}
    <ExtraExamples examples={examples} onRemove={index => setExamples(current => current.filter((_, i) => i !== index))} />
    <ExampleEditor onAdd={added => { const next = uniqueExamples([...examples, ...added]); if (next.length > 100) throw new Error('最多可加入 100 個例句。'); setExamples(next); }} />
    <button type="button" disabled={!word.trim() || busy} onClick={save}>收藏這個單字</button>
    {status && <p role="status">{status}</p>}
  </details>;
}
