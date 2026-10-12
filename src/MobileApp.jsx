import React, { useRef, useState } from 'react';
import ReviewPage from './ReviewPage.jsx';
import WordLookup from './WordLookup.jsx';
import CloudPanel from './CloudPanel.jsx';
import useStudyLibrary from './useStudyLibrary.jsx';
import { migrateFamiliarity } from './study.mjs';
import './mobile.css';

export default function MobileApp() {
  const library = useStudyLibrary(migrateFamiliarity);
  const [view, setView] = useState('review');
  const [selectedId, setSelectedId] = useState(null);
  const [practiceActive, setPracticeActive] = useState(false);
  const [practiceRemaining, setPracticeRemaining] = useState(0);
  const [addPracticeOpen, setAddPracticeOpen] = useState(false);
  const menu = useRef(null);
  const studying = view === 'review' && practiceActive;
  const selected = library.cards.find(card => card.id === selectedId);
  const count = library.cards.filter(card => card.starred).length;
  return <div className={`mobile-app ${studying ? 'is-studying' : ''}`}>
    <div className="mobile-toolbar"><details className="mobile-menu" ref={menu} onKeyDown={event => { if (event.key === 'Escape') { menu.current.open = false; menu.current.querySelector('summary').focus(); } }}>
      <summary aria-label="開啟學習選單"><span aria-hidden="true">☰</span></summary>
      <nav className="mobile-nav" aria-label="手機學習介面">{[['review', '↻', '複習'], ['library', '☆', '收藏'], ['sync', '☁', '同步']].map(([id, icon, label]) => <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => { setSelectedId(null); setView(id); menu.current.open = false; menu.current.querySelector('summary').focus(); }}><span className="mobile-nav-icon" aria-hidden="true">{icon}</span><span className="mobile-nav-label">{label}</span></button>)}</nav>
    </details><span className="mobile-view-label">{studying ? '' : view === 'review' ? '複習' : view === 'library' ? '單字收藏' : '雲端同步'}</span>{studying && <><span className="mobile-practice-remaining" role="status" aria-label={`本次複習剩餘 ${practiceRemaining} 個單字`}>剩餘 <strong>{practiceRemaining}</strong> 個</span><button className="mobile-add-practice" aria-label="添加複習單字" onClick={() => setAddPracticeOpen(true)}>＋</button></>}</div>
    {!studying && <header className="mobile-header"><a href="/" className="brand"><span className="brand-mark">木</span><span>komorebi<small>每天，記住一點日文。</small></span></a><span className="mobile-word-count">{count} 個單字</span></header>}
    {!studying && <div className="mobile-sync-status" role="status"><span className={library.cloud.busy ? 'sync-dot syncing' : 'sync-dot'} />{library.cloud.status}</div>}
    {library.error && <p className="study-storage-error" role="alert">{library.error}</p>}
    {view === 'sync' ? <main className="mobile-settings"><h1>同步與安裝</h1><CloudPanel cloud={library.cloud} expanded /><section className="mobile-install"><h2>加入 iPhone 主畫面</h2><p>用 Safari 開啟此網址，點「分享」→「加入主畫面」，開啟「作為網頁 App 開啟」。</p><p>先連線開啟一次。介面與已載入的字典例句可離線使用；新練習會在回到 App 並連線後同步。</p><p>收藏與進度也保存在這台裝置，請保留備份。日文朗讀使用裝置提供的語音，離線是否可用取決於已安裝的語音。</p></section></main>
      : <ReviewPage library={library} mobileView={view} onPracticeActive={setPracticeActive} onPracticeRemaining={setPracticeRemaining} mobileAddOpen={addPracticeOpen} onMobileAddClose={() => setAddPracticeOpen(false)} onWord={card => setSelectedId(card.id)} />}
    {selected && <WordLookup selection={{ cardId: selected.id }} card={selected} cue={selected.examples.at(-1)}
      saved={selected.starred} onToggleStar={() => library.toggle(selected.id)} onClose={() => setSelectedId(null)}
      onChooseReading={detail => library.chooseReading(selected.id, detail)}
      onAddExamples={examples => library.addExamples(selected.id, examples)} onRemoveExample={index => library.removeExample(selected.id, index)} />}
  </div>;
}
