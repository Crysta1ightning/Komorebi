import React, { useEffect, useMemo, useRef, useState } from 'react';
import { video as defaultVideo } from './data/active-video.js';
import { videos } from './data/video-collection.js';
import { cueAtTime, filterCues, formatTime } from './transcript.mjs';
import WordLookup, { WordText } from './WordLookup.jsx';
import ReviewPage from './ReviewPage.jsx';
import useStudyLibrary from './useStudyLibrary.jsx';
import CloudPanel from './CloudPanel.jsx';
import MobileApp from './MobileApp.jsx';
import { wordIdentity, refreshExamples, migrateFamiliarity } from './study.mjs';
import { translationsForTranscript } from './translations.mjs';

let apiPromise;

function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => reject(new Error('YouTube took too long to connect. Try local audio.')), 15000);
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timeout);
        resolve(window.YT);
      };
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Could not connect to YouTube. Try local audio.'));
      };
      document.head.appendChild(script);
    }).catch(error => { apiPromise = undefined; throw error; });
  }
  return apiPromise;
}

function Icon({ name, size = 20 }) {
  const paths = {
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    back: <><path d="m10 8-5 4 5 4M19 5v14M5 12h11" /></>,
    next: <><path d="m14 8 5 4-5 4M5 5v14M19 12H8" /></>,
    replay: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    arrow: <path d="m7 17 10-10M7 7h10v10" />,
    leaf: <><path d="M20 4C8 3 3 8 5 15c5 6 14 1 15-11Z" /><path d="m4 21 11-12" /></>,
    headphones: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function App({ initialVideoId }) {
  const [selection, setSelection] = useState(() => {
    let savedVideo;
    try { savedVideo = window.localStorage.getItem('komorebi.video'); } catch { /* Selection still works in memory. */ }
    return { id: initialVideoId || savedVideo || defaultVideo.id, start: 0, play: false };
  });
  const lesson = videos.find(item => item.video.id === selection.id) || videos[0];
  if (!lesson) return <MobileApp />;
  return <VideoApp key={`${lesson.video.id}:${selection.start}`} lesson={lesson} initialTime={selection.start} initialPlay={selection.play}
    onSelectVideo={(id, start = 0, play = false) => {
      try { window.localStorage.setItem('komorebi.video', id); } catch { /* Selection still works in memory. */ }
      setSelection({ id, start, play });
    }} />;
}

function VideoApp({ lesson, initialTime, initialPlay, onSelectVideo }) {
  const { transcript, vocabulary, translations, video, audioUrl } = lesson;
  const VIDEO_ID = video.id;
  const DURATION = video.duration;
  const cues = transcript.cues;
  const english = useMemo(() => translationsForTranscript(transcript, translations), [transcript, translations]);
  const normalizeStudy = cards => migrateFamiliarity(refreshExamples(cards, transcript, vocabulary, video, english));
  const [page, setPage] = useState('listen');
  const library = useStudyLibrary(normalizeStudy);
  const savedIds = useMemo(() => new Set(library.cards.filter(card => card.starred).map(card => card.id)), [library.cards]);
  const isSaved = token => savedIds.has(wordIdentity(token, vocabulary).id);
  const [mode, setMode] = useState('youtube');
  const [time, setTime] = useState(initialTime);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState(1);
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [loopIndex, setLoopIndex] = useState(null);
  const [wordSelection, setWordSelection] = useState(null);
  const player = useRef(null);
  const playerHost = useRef(null);
  const audio = useRef(null);
  const rows = useRef(new Map());
  const list = useRef(null);
  const timeRef = useRef(initialTime);
  const loopRef = useRef(null);
  const speedRef = useRef(1);
  const activeIndex = cueAtTime(cues, time, true);
  const visibleCues = useMemo(() => filterCues(cues, query), [query]);
  const currentCue = cues[activeIndex];
  loopRef.current = loopIndex;
  speedRef.current = speed;

  useEffect(() => {
    setReady(false);
    setPlaying(false);
    setError('');
    if (mode !== 'youtube') return;
    let cancelled = false;
    let instance;
    const mount = document.createElement('div');
    playerHost.current.replaceChildren(mount);
    loadYouTube().then(YT => {
      if (cancelled) return;
      instance = new YT.Player(mount, {
        width: '100%', height: '100%', videoId: VIDEO_ID,
        playerVars: { playsinline: 1, origin: window.location.origin, hl: 'ja', cc_load_policy: 0 },
        events: {
          onReady: event => {
            if (cancelled) return;
            player.current = event.target;
            event.target.getIframe().title = `Japanese conversation video from ${video.channel}`;
            if (timeRef.current > 0) event.target.seekTo(timeRef.current, true);
            event.target.setPlaybackRate(speedRef.current);
            if (initialPlay) event.target.playVideo();
            setReady(true);
          },
          onStateChange: event => { if (!cancelled) setPlaying(event.data === 1); },
          onPlaybackRateChange: event => { if (!cancelled) setSpeed(event.data); },
          onAutoplayBlocked: () => {
            if (!cancelled) setError('Press play inside the YouTube player to start playback.');
          },
          onError: event => {
            if (cancelled) return;
            setReady(false);
            setError(`YouTube playback is unavailable (code ${event.data}). Switch to local audio to keep studying.`);
          },
        },
      });
    }).catch(reason => { if (!cancelled) setError(reason.message); });
    return () => {
      cancelled = true;
      instance?.destroy();
      player.current = null;
    };
  }, [mode]);

  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(() => {
      const value = mode === 'youtube' ? player.current?.getCurrentTime?.() : audio.current?.currentTime;
      if (!Number.isFinite(value)) return;
      const loop = cues[loopRef.current];
      const isPlaying = mode === 'youtube' ? player.current?.getPlayerState?.() === 1 : !audio.current?.paused;
      if (loop && isPlaying && value >= loop.end) {
        if (mode === 'youtube') player.current.seekTo(loop.start, true);
        else audio.current.currentTime = loop.start;
        timeRef.current = loop.start;
        setTime(loop.start);
      } else {
        timeRef.current = value;
        setTime(value);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [ready, mode]);

  useEffect(() => {
    if (!follow || activeIndex < 0 || query.trim()) return;
    const row = rows.current.get(activeIndex);
    const container = list.current;
    if (!row || !container) return;
    const rowBounds = row.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    if (rowBounds.top < bounds.top || rowBounds.bottom > bounds.bottom) {
      container.scrollTo({ top: container.scrollTop + rowBounds.top - bounds.top - bounds.height / 3, behavior: 'smooth' });
    }
  }, [activeIndex, follow, query]);

  function playAudio() {
    audio.current?.play().catch(() => setError('Playback could not start. Try pressing play again.'));
  }

  function openWord(token, cueIndex) {
    if (ready) {
      if (mode === 'youtube') player.current?.pauseVideo();
      else audio.current?.pause();
    }
    setPlaying(false);
    library.collect(token, vocabulary, { ...cues[cueIndex], english: english[cueIndex] }, video);
    setWordSelection({ token, cueIndex });
  }

  function openSavedWord(card) {
    const example = card.examples.at(-1);
    const cueIndex = example?.videoId === VIDEO_ID
      ? cues.findIndex(cue => cue.start === example.start && cue.end === example.end && cue.text === example.text) : -1;
    const tokens = cueIndex >= 0 ? vocabulary.cues[cueIndex]?.tokens || [] : [];
    const token = tokens.find(token => token.selectable && wordIdentity(token, vocabulary).id === card.id)
      || tokens.find(token => token.selectable && (token.base === card.word || token.dictionaryBase === card.word));
    setWordSelection({ cardId: card.id, token, cueIndex, example });
  }

  function changePage(nextPage) {
    if (nextPage !== 'listen') {
      if (mode === 'youtube') player.current?.pauseVideo();
      else audio.current?.pause();
      setPlaying(false); setWordSelection(null);
    }
    setPage(nextPage);
  }

  function openExample(example) {
    if (example.videoId !== VIDEO_ID) {
      if (videos.some(item => item.video.id === example.videoId)) {
        onSelectVideo(example.videoId, example.start, true);
        return;
      }
      window.open(`https://www.youtube.com/watch?v=${example.videoId}&t=${Math.floor(example.start)}s`, '_blank', 'noopener,noreferrer');
      return;
    }
    setPage('listen'); seek(example.start, true);
  }

  function seek(value, shouldPlay = false, preserveLoop = false) {
    if (!ready) return;
    const target = Math.max(0, Math.min(DURATION, value));
    if (!preserveLoop) setLoopIndex(null);
    if (mode === 'youtube') {
      player.current.seekTo(target, true);
      if (shouldPlay) player.current.playVideo();
    } else {
      audio.current.currentTime = target;
      if (shouldPlay) playAudio();
    }
    timeRef.current = target;
    setTime(target);
  }

  function selectCue(index) {
    if (loopIndex !== null) setLoopIndex(index);
    seek(cues[index].start, true, true);
  }

  function togglePlay() {
    setError('');
    if (mode === 'youtube') playing ? player.current.pauseVideo() : player.current.playVideo();
    else playing ? audio.current.pause() : playAudio();
  }

  function changeSpeed(value) {
    if (mode === 'youtube') {
      const allowed = player.current.getAvailablePlaybackRates();
      if (!allowed.includes(value)) {
        setError('This playback speed is unavailable for this video.');
        return;
      }
      player.current.setPlaybackRate(value);
    } else audio.current.playbackRate = value;
    setSpeed(value);
  }

  const previous = activeIndex >= 0 ? activeIndex - 1 : cues.findLastIndex(cue => cue.start < time);
  const next = activeIndex >= 0 ? activeIndex + 1 : cues.findIndex(cue => cue.start > time);
  const selectedCard = wordSelection?.cardId ? library.cards.find(card => card.id === wordSelection.cardId) : null;

  return <div className="app">
    <header className="topbar">
      <a href="#" className="brand" aria-label="Komorebi home"><span className="brand-mark"><Icon name="leaf" size={25} /></span><span>komorebi<small>木漏れ日</small></span></a>
      <nav className="app-tabs" aria-label="學習介面"><button className={page === 'listen' ? 'selected' : ''} aria-current={page === 'listen' ? 'page' : undefined} onClick={() => changePage('listen')}>聽影片</button><button className={page === 'review' ? 'selected' : ''} aria-current={page === 'review' ? 'page' : undefined} onClick={() => changePage('review')}>單字複習 <span>{savedIds.size}</span></button><button className={page === 'collection' ? 'selected' : ''} aria-current={page === 'collection' ? 'page' : undefined} onClick={() => changePage('collection')}>影片收藏 <span>{videos.length}</span></button></nav>
      <span className="personal-pill"><span /> Personal library</span>
    </header>

    {library.error && <div className="study-storage-error" role="alert">{library.error}</div>}
    <CloudPanel cloud={library.cloud} />
    {page === 'review' && <ReviewPage library={library} onWord={openSavedWord} onListen={() => changePage('listen')} onExample={openExample} exampleTranslation={example => {
      if (example.videoId === VIDEO_ID) {
        const index = cues.findIndex(cue => cue.start === example.start && cue.end === example.end && cue.text === example.text);
        if (index >= 0) return english[index];
      }
      return example.english || '';
    }} />}
    {page === 'collection' && <main className="video-collection">
      <div className="page-intro"><div><div className="eyebrow">YOUR VIDEOS</div><h1>影片收藏</h1><p>選一支影片，繼續聽日文與收藏單字。</p></div></div>
      <div className="collection-grid">{videos.map(item => <button className="collection-video" key={item.video.id}
        aria-label={`學習影片 ${item.video.title}`} onClick={() => item.video.id === VIDEO_ID ? changePage('listen') : onSelectVideo(item.video.id)}>
        <img src={`https://i.ytimg.com/vi/${item.video.id}/hqdefault.jpg`} alt="" loading="lazy" />
        <div><strong lang="ja">{item.video.title}</strong><p>{item.video.channel} · {formatTime(item.video.duration)}</p>
          <small>{item.transcript.cues.length} 段字幕 · 日英翻譯 · 單字查詢{item.video.id === VIDEO_ID ? ' · 目前影片' : ''}</small></div>
      </button>)}</div>
    </main>}
    <main hidden={page !== 'listen'}>
      <div className="page-intro"><div><div className="eyebrow">LISTEN · NOTICE · REPEAT</div><h1>A little Japanese, every day.</h1><p>Slow down. Follow the words. Listen one more time.</p></div><div className="session-badge"><Icon name="headphones" /><span>Listening session<small>{videos.findIndex(item => item.video.id === VIDEO_ID) + 1} / {videos.length} videos</small></span></div></div>

      <div className="workspace">
        <section className="study-column" aria-label="Video and listening controls">
          <div className="video-card">
            <div className="video-heading"><span><span className="source-dot" /> {mode === 'youtube' ? 'YouTube video' : 'Downloaded Japanese audio'}</span><div className="source-switch" aria-label="Playback source"><button className={mode === 'youtube' ? 'selected' : ''} aria-pressed={mode === 'youtube'} onClick={() => setMode('youtube')}>Video</button><button className={mode === 'audio' ? 'selected' : ''} aria-pressed={mode === 'audio'} onClick={() => setMode('audio')}>Local audio</button></div></div>
            {mode === 'youtube' ? <div ref={playerHost} className="video-player" /> : <div className="audio-stage"><div className="audio-emblem"><Icon name="headphones" size={48} /></div><span className="eyebrow">ORIGINAL JAPANESE AUDIO</span><h2>Just you and the conversation.</h2><p>Your downloaded audio works without YouTube.</p><audio ref={audio} src={audioUrl} preload="metadata" onLoadedMetadata={() => { audio.current.currentTime = timeRef.current; audio.current.playbackRate = speedRef.current; setReady(true); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setReady(false); setError('The local audio could not be loaded in this browser.'); }} /></div>}
            <div className="video-info"><div><h2 lang="ja">{video.title}</h2><p><span lang="ja">{video.channel}</span><span>·</span>Everyday conversation<span>·</span>{formatTime(DURATION)}</p></div><a href={`https://www.youtube.com/watch?v=${VIDEO_ID}`} target="_blank" rel="noreferrer" aria-label="Open original video on YouTube"><Icon name="arrow" /></a></div>
          </div>

          {error && <div className="player-notice" role="alert">{error}</div>}
          {!ready && !error && <p className="loading-status" role="status">Connecting to {mode === 'youtube' ? 'YouTube' : 'local audio'}…</p>}

          <div className="caption-card">
            <div className="caption-heading"><span className="eyebrow">{currentCue ? 'NOW LISTENING' : 'JAPANESE CAPTIONS'}</span><span>{currentCue ? `${String(activeIndex + 1).padStart(3, '0')} / ${cues.length}` : 'Ready when you are'}</span></div>
            <div className="current-caption" lang="ja">{currentCue ? <WordText vocabulary={vocabulary} cueIndex={activeIndex} fallback={currentCue.text} onWord={openWord} isSaved={isSaved} /> : '再生して、聞いてみましょう。'}</div>
            {currentCue && <p className="current-translation" lang="en">{english[activeIndex] || 'English translation not yet available.'}</p>}
            <div className="caption-bottom"><span>{currentCue ? `${formatTime(currentCue.start)} — ${formatTime(currentCue.end)}` : 'Press play to follow the conversation'}</span><button className="replay-button" onClick={() => seek(currentCue.start, true, true)} disabled={!ready || !currentCue}><Icon name="replay" size={16} /> Replay passage</button></div>
          </div>

          <div className="transport">
            <div className="timeline"><span>{formatTime(time)}</span><input type="range" aria-label="Playback position" min="0" max={DURATION} step="0.1" value={time} disabled={!ready} onChange={event => seek(Number(event.target.value))} style={{ '--progress': `${time / DURATION * 100}%` }} /><span>{formatTime(DURATION)}</span></div>
            <div className="transport-controls"><div className="speed-control"><label htmlFor="speed">Speed</label><select id="speed" value={speed} disabled={!ready} onChange={event => changeSpeed(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{value}×</option>)}</select></div><div className="main-controls"><button className="icon-button" aria-label="Previous passage" disabled={!ready || previous < 0} onClick={() => selectCue(previous)}><Icon name="back" /></button><button className="play-button" aria-label={playing ? 'Pause' : 'Play'} disabled={!ready} onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} size={24} /></button><button className="icon-button" aria-label="Next passage" disabled={!ready || next < 0 || next >= cues.length} onClick={() => selectCue(next)}><Icon name="next" /></button></div><button className={`loop-button ${loopIndex !== null ? 'enabled' : ''}`} aria-pressed={loopIndex !== null} disabled={!ready || (activeIndex < 0 && loopIndex === null)} onClick={() => setLoopIndex(loopIndex !== null ? null : activeIndex)}><Icon name="replay" size={16} /> Loop</button></div>
          </div>
          <div className="learning-note"><span className="note-mark">あ</span><p><strong>Tap a word. Keep the context.</strong> Click a Japanese word for its reading and English meanings. Click a timestamp to replay the passage.</p></div>
        </section>

        <aside className="transcript-panel" aria-label="Japanese transcript">
          <div className="transcript-heading"><div><span className="eyebrow">READ ALONG</span><h2>Transcript <span>{cues.length}</span></h2></div><span className="language-tag">日本語</span></div>
          <div className="transcript-tools"><label className="search-box"><Icon name="search" size={17} /><input aria-label="Search Japanese transcript" placeholder="Find a word or phrase…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Clear search" onClick={() => setQuery('')}>×</button>}</label><div className="follow-row"><span>{query.trim() ? `${visibleCues.length} matching passages` : 'Click any passage to replay'}</span><label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /><span>Auto-follow</span></label></div></div>
          <div className="transcript-list" ref={list} tabIndex="0" aria-label="Scrollable transcript">
            {visibleCues.map(cue => <div key={cue.index} ref={node => { if (node) rows.current.set(cue.index, node); else rows.current.delete(cue.index); }} className={`transcript-row ${cue.index === activeIndex ? 'active' : ''}`} aria-current={cue.index === activeIndex ? 'true' : undefined} onClick={() => selectCue(cue.index)}><button className="row-time" aria-label={`Play passage at ${formatTime(cue.start)}`} disabled={!ready} onClick={event => { event.stopPropagation(); selectCue(cue.index); }}>{formatTime(cue.start)}</button><div className="row-bilingual"><span className="row-text" lang="ja"><WordText vocabulary={vocabulary} cueIndex={cue.index} fallback={cue.text} onWord={openWord} isSaved={isSaved} /></span><p className="row-translation" lang="en">{english[cue.index] || 'English translation not yet available.'}</p></div><button className="row-play" aria-label={`Replay passage at ${formatTime(cue.start)}`} disabled={!ready} onClick={event => { event.stopPropagation(); selectCue(cue.index); }}><Icon name="play" size={14} /></button></div>)}
            {!visibleCues.length && <div className="empty-search"><Icon name="search" size={26} /><h3>No matching passages</h3><p>Try a shorter Japanese word or clear your search.</p><button onClick={() => setQuery('')}>Clear search</button></div>}
          </div>
          <div className="transcript-footer"><span className="caption-dot" /><span>{transcript.source === 'independent-asr-llm-compared' ? 'Compared Japanese captions' : time < 60 ? 'Compared Japanese ASR captions' : 'YouTube automatic captions'} <small>{transcript.source === 'independent-asr-llm-compared' ? 'Automatically adopted after contextual comparison' : time < 60 ? 'First minute · adopted after comparison' : 'Beyond 1:00 · original automatic captions'}</small></span></div>
        </aside>
      </div>
      <footer className="page-footer"><span>Small moments. A little more understanding.</span><span>木漏れ日 <span className="footer-dot">·</span> Personal listening prototype</span></footer>
    </main>
    {wordSelection && (!wordSelection.cardId || selectedCard) && <WordLookup vocabulary={vocabulary} selection={wordSelection} card={selectedCard || library.cards.find(card => card.id === wordIdentity(wordSelection.token, vocabulary).id)}
      cue={wordSelection.cardId ? wordSelection.example : { ...cues[wordSelection.cueIndex], english: english[wordSelection.cueIndex] }}
      ready={wordSelection.example?.videoId && wordSelection.example.videoId !== VIDEO_ID ? true : ready}
      saved={wordSelection.cardId ? selectedCard.starred : isSaved(wordSelection.token)}
      onToggleStar={() => library.toggle(wordSelection.cardId || wordIdentity(wordSelection.token, vocabulary).id)}
      onChooseReading={detail => library.chooseReading(wordSelection.cardId || wordIdentity(wordSelection.token, vocabulary).id, detail)}
      onAddExamples={examples => library.addExamples(wordSelection.cardId || wordIdentity(wordSelection.token, vocabulary).id, examples)}
      onRemoveExample={index => library.removeExample(wordSelection.cardId || wordIdentity(wordSelection.token, vocabulary).id, index)}
      onClose={() => setWordSelection(null)} onReplay={() => {
        if (wordSelection.cardId) openExample(wordSelection.example);
        else selectCue(wordSelection.cueIndex);
        setWordSelection(null);
      }} />}
  </div>;
}
