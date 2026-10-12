import { useEffect, useRef, useState } from 'react';
import { addReviewWords, addWordExamples, chooseWordReading, collectManualWord, collectWord, libraryJSON, parseLibrary, rateWord, removeWordExample, STORAGE_KEY, toggleStar } from './study.mjs';
import useCloudStudy from './useCloudStudy.jsx';
import { sameStudyData } from './study-sync.mjs';

export default function useStudyLibrary(normalize = cards => cards) {
  const [initial] = useState(() => {
    let text;
    try { text = window.localStorage.getItem(STORAGE_KEY); }
    catch { return { cards: [], pending: true, error: '瀏覽器無法儲存收藏；目前變更只保留到關閉頁面。請下載備份。' }; }
    try {
      const original = parseLibrary(text);
      const cards = normalize(original);
      return { cards, migrated: cards !== original, error: '' };
    }
    catch { return { cards: [], blocked: true, error: '無法讀取單字收藏。請保留原資料，或匯入備份。' }; }
  });
  const [cards, setCards] = useState(initial.cards);
  const [error, setError] = useState(initial.error);
  const [blocked, setBlocked] = useState(Boolean(initial.blocked));
  const pending = useRef(Boolean(initial.pending));
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const cloud = useCloudStudy({ cards, blocked, pending: pending.current,
    readLatest: () => pending.current ? cardsRef.current : normalize(parseLibrary(window.localStorage.getItem(STORAGE_KEY))),
    applyCloud: incoming => {
      const next = normalize(incoming);
      // Persist before updating the UI; failures never discard local edits.
      window.localStorage.setItem(STORAGE_KEY, libraryJSON(next));
      cardsRef.current = next; setCards(current => sameStudyData(current, next) ? current : next);
      pending.current = false; setError('');
    },
  });
  function change(update) {
    if (blocked) return;
    // Resolve edits against the latest persisted snapshot to keep other tabs' additions.
    let current = cards;
    if (!pending.current) {
      let text;
      try { text = window.localStorage.getItem(STORAGE_KEY); }
      catch { pending.current = true; }
      if (!pending.current) {
        try { current = parseLibrary(text); }
        catch { setBlocked(true); setError('無法讀取單字收藏。請保留原資料，或匯入備份。'); return; }
      }
    }
    const next = normalize(update(normalize(current)));
    try {
      window.localStorage.setItem(STORAGE_KEY, libraryJSON(next));
      pending.current = false;
      setError('');
    } catch { pending.current = true; setError('瀏覽器無法儲存收藏；目前變更只保留到關閉頁面。請下載備份。'); }
    setCards(next);
  }
  useEffect(() => {
    if (initial.migrated) change(current => current);
  }, []);
  useEffect(() => {
    function sync(event) {
      if (event.key !== STORAGE_KEY) return;
      try { setCards(normalize(parseLibrary(event.newValue))); setError(''); setBlocked(false); }
      catch { setError('其他頁面的單字資料無法讀取，請保留原資料。'); setBlocked(true); }
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return { cards, error, cloud,
    addManual: input => { if (blocked) throw new Error('目前收藏資料無法讀取，請先匯入可用備份。'); change(current => collectManualWord(current, input)); },
    addExamples: (id, examples) => change(current => addWordExamples(current, id, examples)),
    removeExample: (id, index) => change(current => removeWordExample(current, id, index)),
    collect: (...args) => change(current => collectWord(current, ...args)),
    toggle: id => change(current => toggleStar(current, id)),
    chooseReading: (id, detail) => change(current => chooseWordReading(current, id, detail)),
    rate: (id, rating, now) => change(current => rateWord(current, id, rating, now)),
    addReviews: (count, now) => change(current => addReviewWords(current, count, now)),
    restore(text) {
      const imported = normalize(parseLibrary(text));
      window.localStorage.setItem(STORAGE_KEY, libraryJSON(imported));
      pending.current = false; setCards(imported); setError(''); setBlocked(false);
    },
  };
}
