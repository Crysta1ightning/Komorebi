import React, { useEffect, useState } from 'react';
import { dictionaryExamples, parseExampleFile } from './study-dictionary.mjs';

export function ExampleEditor({ onAdd }) {
  const [text, setText] = useState('');
  const [english, setEnglish] = useState('');
  const [message, setMessage] = useState('');
  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('請上傳小於 1 MB 的例句檔。');
      const examples = parseExampleFile(await file.text(), file.name);
      onAdd(examples); setMessage(`已加入 ${examples.length} 個例句。`);
    } catch (error) { setMessage(error.message); }
    event.target.value = '';
  }
  return <details className="example-editor"><summary>新增／上傳例句</summary>
    <form onSubmit={event => { event.preventDefault(); try { onAdd([{ source: 'custom', text: text.trim(), english: english.trim() }]); setText(''); setEnglish(''); setMessage('已加入例句。'); } catch (error) { setMessage(error.message); } }}>
      <label>日文例句<textarea aria-label="自訂日文例句" required maxLength={2000} value={text} onChange={event => setText(event.target.value)} /></label>
      <label>英文翻譯（可留空）<textarea aria-label="自訂例句英文翻譯" maxLength={4000} value={english} onChange={event => setEnglish(event.target.value)} /></label>
      <button type="submit">加入例句</button>
    </form>
    <label className="example-upload">上傳例句檔<input type="file" aria-label="上傳例句檔" accept=".json,.tsv,.txt,application/json,text/plain" onChange={upload} /></label>
    <p>JSON：<code>{'[{"text":"毎日、日本語を勉強します。","english":"I study Japanese every day."}]'}</code><br />TSV／TXT：每行一個日文例句，英文以 Tab 分隔。加入目前這個單字。</p>
    {message && <p role="status">{message}</p>}
  </details>;
}

export function ExtraExamples({ examples = [], speech, onRemove }) {
  return examples.map((example, index) => <div className="review-example" key={`${example.text}:${index}`}>
    <span className="eyebrow">{example.source === 'dictionary' ? '字典例句 · Tatoeba' : '自訂例句'}</span>
    <p lang="ja">{example.text}</p><p className="review-example-translation" lang="en">{example.english || '尚未提供英文翻譯。'}</p>
    <div>{speech?.available && <button className="speech-button" onClick={() => speech.speak(example.text)}>♪ 聽例句</button>}
      {example.source === 'dictionary' && <a href={`https://tatoeba.org/en/sentences/show/${example.sentenceId}`} target="_blank" rel="noreferrer">Tatoeba 原文 ↗</a>}
      {onRemove && <button onClick={() => onRemove(index)} aria-label={`刪除例句 ${example.text}`}>刪除</button>}</div>
  </div>);
}

export function DictionaryExamples({ definitions, word, reading, speech, exclude = [] }) {
  const [state, setState] = useState({ examples: [], loading: true });
  const signature = JSON.stringify([definitions.map(entry => entry.id), word, reading]);
  useEffect(() => {
    let live = true;
    setState({ examples: [], loading: true });
    dictionaryExamples(definitions.map(entry => entry.id), word, reading)
      .then(examples => { if (live) setState({ examples, loading: false }); })
      .catch(() => { if (live) setState({ examples: [], loading: false, error: '字典例句暫時無法載入，請關閉後重新開啟。' }); });
    return () => { live = false; };
  }, [signature]);
  const examples = state.examples.filter(example => !exclude.some(item => item.text === example.text && item.english === example.english)).slice(0, 3);
  return <section className="dictionary-examples" aria-label="字典例句">
    {state.loading ? <p>正在查找字典例句…</p> : state.error ? <p role="status">{state.error}</p> : examples.length ? <ExtraExamples examples={examples} speech={speech} /> : !state.examples.length ? <p>這個詞的字典條目暫無例句，可以自行新增。</p> : null}
    {!!state.examples.length && <small>例句：Tatoeba contributors · <a href="https://creativecommons.org/licenses/by/2.0/fr/" target="_blank" rel="noreferrer">CC BY 2.0</a></small>}
  </section>;
}
