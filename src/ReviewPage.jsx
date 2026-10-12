import React, { useEffect, useRef, useState } from 'react';
import useJapaneseSpeech from './useJapaneseSpeech.jsx';
import ManualWordForm from './ManualWordForm.jsx';
import { DictionaryExamples, ExtraExamples } from './StudyExamples.jsx';
import { formatTime } from './transcript.mjs';
import { familiarityScore, familiarityState, libraryJSON, localDay, reviewCandidates, reviewQueue } from './study.mjs';


export default function ReviewPage({ library, onWord, onListen, onExample, mobileView, onPracticeActive, onPracticeRemaining, mobileAddOpen, onMobileAddClose, exampleTranslation = example => example.english || '' }) {
  const { cards, toggle, rate, restore, addReviews } = library;
  const [now, setNow] = useState(() => new Date());
  const [face, setFace] = useState({ id: null, back: false });
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [reviewCount, setReviewCount] = useState('50');
  const upload = useRef(null);
  const practiceDialog = useRef(null);
  const answerLock = useRef(false);
  const speech = useJapaneseSpeech();
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = setInterval(tick, 60000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(interval); window.removeEventListener('focus', tick); };
  }, []);
  const starred = cards.filter(card => card.starred);
  const queue = reviewQueue(cards, now);
  const current = queue[0];
  const practiceActive = mobileView === 'review' && Boolean(current);
  useEffect(() => { onPracticeActive?.(practiceActive); }, [practiceActive, onPracticeActive]);
  useEffect(() => { onPracticeRemaining?.(queue.length); }, [queue.length, onPracticeRemaining]);
  useEffect(() => {
    const dialog = practiceDialog.current;
    if (!dialog) return;
    if (mobileAddOpen && !dialog.open) dialog.showModal();
    else if (!mobileAddOpen && dialog.open) dialog.close();
  }, [mobileAddOpen]);
  const back = current && face.id === current.id && face.back;
  const queuedIds = new Set(queue.map(card => card.id));
  const complete = starred.filter(card => card.completedOn === localDay(now)).length;
  const candidates = reviewCandidates(cards, now);
  const libraryWords = [...starred].sort((a, b) => familiarityScore(a, now) - familiarityScore(b, now));
  useEffect(() => { window.speechSynthesis?.cancel(); }, [current?.id, back]);

  function answer(rating) {
    if (!back || answerLock.current) return;
    answerLock.current = true;
    speech.stop(); rate(current.id, rating, new Date());
    setFace({ id: null, back: false }); setNow(new Date());
    setMessage(rating === 'familiar' ? '這個單字今天完成了。' : rating === 'ordinary' ? '已插入後 20 張的位置；不足時放到隊尾。' : '已插入後 10 張的位置；不足時放到隊尾。');
  }
  function addPractice(event) {
    event.preventDefault();
    const count = Number(reviewCount);
    if (!Number.isSafeInteger(count) || count < 1) { setMessage('請輸入大於 0 的整數。'); return; }
    const added = candidates.slice(0, count);
    addReviews(count, new Date());
    if (!mobileAddOpen) setFace({ id: null, back: false });
    setNow(new Date());
    setMessage(`已加入 ${added.length} 個熟悉度最低的單字，其中 ${added.filter(card => !card.reviews.length).length} 個是新單字。`);
    if (mobileAddOpen) onMobileAddClose?.();
  }
  function exportBackup() {
    const url = URL.createObjectURL(new Blob([libraryJSON(cards)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `komorebi-words-${localDay(now)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { restore(await file.text()); setMessage('已還原備份。'); }
    catch { setMessage('無法匯入這份備份，原收藏仍保留。'); }
    event.target.value = '';
  }

  return <main className={`review-view ${mobileView ? 'mobile-review' : ''} ${practiceActive ? 'practice-active' : ''}`}>
    <div className="page-intro"><div><div className="eyebrow">RECALL · REVEAL · REMEMBER</div><h1>留住每一次遇見的單字。</h1><p>先想意思與念法，再翻面確認。</p></div><div className="review-count"><strong>{queue.length}</strong><span>現在可複習</span></div></div>
    <div className="review-layout">
      <section className="review-session" aria-label="單字複習" hidden={mobileView === 'library'}>
        <form className="review-picker" onSubmit={addPractice} hidden={practiceActive || mobileAddOpen}>
          <label htmlFor="review-count-input">這次想練習幾個單字？</label>
          <div><input id="review-count-input" aria-label="加入複習的單字數量" type="number" min="1" step="1" required value={reviewCount} onChange={event => setReviewCount(event.target.value)} /><button type="submit" disabled={!candidates.length}>加入複習單字</button></div>
          <p>從熟悉度最低的單字開始，包含未練過的新單字。還有 {candidates.length} 個可加入；今天已完成的單字不會重複加入。</p>
        </form>
        <div className="review-session-heading"><span className="eyebrow">今日複習</span><span>{complete} 個今天已完成 · {queue.length} 個待複習</span></div>
        {message && <p className="review-message" role="status">{message}</p>}
        {current ? <>
          <div className={`flashcard ${back ? 'is-back' : 'is-front'}`} key={current.id}>
            <div className="flashcard-top">{back && <span>確認答案</span>}<button className="study-star" aria-label={`取消收藏 ${current.word}`} aria-pressed="true" onClick={() => { speech.stop(); toggle(current.id); }}>★</button></div>
            <h2 lang="ja">{current.word}</h2>
            {back ? <div className="flashcard-answer" tabIndex={mobileView ? 0 : undefined} aria-label="單字解釋與例句">
              <div className="review-reading"><span lang="ja">{current.reading || '暫無讀音'}</span>{speech.available && <button className="speech-button" aria-label="朗讀單字" onClick={() => speech.speak(current.reading || current.word)}>♪ 聽讀音</button>}</div>
              {current.surface !== current.word && <p className="review-surface">影片中：<span lang="ja">{current.surface}</span></p>}
              {current.definitions.length ? current.definitions.map(entry => <div className="review-definition" key={entry.id}>{entry.source === 'grammar' && <span>文法組合 · </span>}{entry.source === 'custom' && <span>自訂意思 · </span>}<span lang="ja">{entry.headword} · {entry.reading}</span><ol>{entry.senses.map((sense, index) => <li key={index}>{sense.meanings.join('; ')}</li>)}</ol></div>) : <p className="review-empty-meaning">尚未提供這個詞的意思。</p>}
              {current.examples.slice(-2).map(example => <div className="review-example" key={`${example.videoId}:${example.start}`}><span className="eyebrow">影片例句 · {formatTime(example.start)}</span><p lang="ja">{example.text}</p><p className="review-example-translation" lang="en">{exampleTranslation(example) || '英文翻譯尚未提供。'}</p><div>{speech.available && <button className="speech-button" aria-label="朗讀例句" onClick={() => speech.speak(example.text)}>♪ 聽例句</button>}{onExample && <button className="example-source" onClick={() => onExample(example)}>回到原影片 ↗</button>}</div></div>)}
              <ExtraExamples examples={current.extraExamples} speech={speech} />
              <DictionaryExamples definitions={current.definitions} word={current.word} reading={current.reading} speech={speech} exclude={current.extraExamples} />
              {!speech.available && <p className="voice-note">此裝置目前沒有可用的日文朗讀語音。</p>}
              {speech.error && <p role="status">{speech.error}</p>}
            </div> : null}
          </div>
          {back ? <div className="review-ratings" aria-label="記憶程度"><button className="rating-again" onClick={() => answer('unfamiliar')}>不熟悉<small>後 10 張再出現</small></button><button className="rating-hard" onClick={() => answer('ordinary')}>普通<small>後 20 張再出現</small></button><button className="rating-good" onClick={() => answer('familiar')}>熟悉<small>今天不再出現</small></button></div> : <button className="flip-button" onClick={() => { answerLock.current = false; setFace({ id: current.id, back: true }); }}>翻面看答案 <span>↻</span></button>}
          <p className="review-tip">普通：想得起來，但有點吃力。想不起意思或讀音，就選不熟悉。</p>
        </> : <div className="review-empty"><span className="empty-star">{starred.length ? '✓' : '☆'}</span><h2>{!starred.length ? '從一個好奇的單字開始。' : candidates.length ? '選一些單字，開始今天的練習。' : '今天的複習告一段落。'}</h2><p>{!starred.length ? '可自行新增單字、匯入備份，或同步電腦收藏。' : candidates.length ? '在上方輸入數量，加入熟悉度最低的單字。' : '明天可以再依熟悉度挑選單字。'}</p>{onListen && <button className="flip-button" onClick={onListen}>回去聽影片</button>}</div>}
      </section>
      <aside className="word-library" aria-label="單字收藏" hidden={mobileView === 'review'}>
        <div className="word-library-heading"><div><span className="eyebrow">YOUR WORDS</span><h2>單字收藏 <span>{starred.length}</span></h2></div><span className="library-star">★</span></div>
        <ManualWordForm library={library} />
        <label className="library-search"><span>搜尋收藏</span><input aria-label="搜尋收藏單字" value={query} onChange={event => setQuery(event.target.value)} placeholder="日文單字或讀音" /></label>
        <div className="saved-word-list">{libraryWords.filter(card => `${card.word} ${card.reading} ${card.surface}`.normalize('NFKC').includes(query.trim().normalize('NFKC'))).map(card => <div className="saved-word" key={card.id}><button className="saved-word-open" aria-label={`查看單字 ${card.word}`} onClick={() => { speech.stop(); onWord(card); }}><strong lang="ja">{card.word}</strong><span className="familiarity-score">熟悉度 {Math.round(familiarityScore(card, now))} / 100</span><small>{card.completedOn === localDay(now) ? '今天已完成' : queuedIds.has(card.id) ? '今日待練習' : '可加入複習'}</small><small>{familiarityState(card).lastPracticedAt ? `上次練習：${new Date(familiarityState(card).lastPracticedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '尚未練習'}</small></button><button className="study-star" aria-label={`取消收藏 ${card.word}`} aria-pressed="true" onClick={() => toggle(card.id)}>★</button></div>)}{!starred.length && <p className="library-empty">你點過的單字會出現在這裡。</p>}</div>
        <div className="library-storage"><p>{library.cloud?.session ? '收藏與進度同時保存在本地與雲端。還原後會與雲端合併；取消收藏請點星號。' : '收藏與進度儲存在這個瀏覽器。還原備份會替換目前收藏。'}</p><div><button onClick={exportBackup} disabled={!cards.length}>下載備份</button><button onClick={() => upload.current?.click()}>還原備份</button><input hidden ref={upload} type="file" accept="application/json,.json" onChange={importBackup} /></div></div>
      </aside>
    </div>
    {mobileView && <dialog className="mobile-practice-dialog" ref={practiceDialog} aria-labelledby="practice-dialog-title" onCancel={onMobileAddClose} onClose={onMobileAddClose}>
      <div className="practice-dialog-heading"><h2 id="practice-dialog-title">添加複習單字</h2><button aria-label="關閉添加單字視窗" onClick={onMobileAddClose}>×</button></div>
      <p className="practice-dialog-count" role="status">目前清單有 <strong>{queue.length}</strong> 個待複習單字。</p>
      <form className="review-picker" onSubmit={addPractice}>
        <label htmlFor="additional-review-count">要再加入幾個單字？</label>
        <div><input id="additional-review-count" aria-label="添加複習的單字數量" type="number" min="1" step="1" required value={reviewCount} onChange={event => setReviewCount(event.target.value)} /><button type="submit" disabled={!candidates.length}>加入並繼續</button></div>
        <p>還有 {candidates.length} 個可加入，依熟悉度由低到高挑選。已在清單中或今天已完成的單字不會重複加入。</p>
      </form>
    </dialog>}
    <p className="review-attribution">釋義：JMdict © EDRDG · <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> · 字典例句：Tatoeba contributors（CC BY 2.0） · 另有影片及自訂例句</p>
  </main>;
}
