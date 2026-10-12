import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { cardsFrom, exchangeStudy, mergeLibraries, sameStudyData } from './study-sync.mjs';
import { libraryJSON, parseLibrary } from './study.mjs';
import { cloudErrorMessage } from './cloud-errors.mjs';

const env = import.meta.env || {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
let client, configError = '';
if (url && key) {
  try {
    if (!/^https:\/\//.test(url) || key.startsWith('sb_secret_')) throw new Error('請設定 HTTPS 專案網址及 publishable／anon key。');
    client = createClient(url, key);
  } catch { configError = 'Supabase 設定無效，請檢查專案網址與公開金鑰。'; }
}
const OWNER_KEY = 'komorebi.cloud.owner';
const checkpointKey = user => `komorebi.cloud.checkpoint.${user}`;

export default function useCloudStudy({ cards, readLatest, applyCloud, blocked, pending }) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(configError || (client ? '登入後可同步收藏與進度。' : '尚未設定雲端；目前使用本地收藏。'));
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [cloudCount, setCloudCount] = useState(null);
  const current = useRef({});
  const running = useRef(false);
  const alive = useRef(true);
  current.current = { session, readLatest, applyCloud, blocked, pending };

  async function sync() {
    const state = current.current;
    if (!client || !state.session || running.current || state.blocked) return;
    if (state.pending) { setStatus('請先保存本地資料或下載備份，尚未同步。'); return; }
    if (window.navigator.onLine === false) { setStatus('目前離線，連線後會補同步。'); return; }
    const user = state.session.user.id;
    running.current = true; setBusy(true); setStatus('正在同步…');
    try {
      const owner = window.localStorage.getItem(OWNER_KEY);
      if (owner && owner !== user) throw new Error('此瀏覽器收藏已綁定另一個帳號，請登入原帳號。');
      window.localStorage.setItem(OWNER_KEY, user);
      const stored = window.localStorage.getItem(checkpointKey(user));
      const base = stored ? parseLibrary(stored) : [];
      const active = () => alive.current && current.current.session?.user.id === user;
      await exchangeStudy({ base,
        readLocal: () => { if (!active()) throw new Error('同步已停止。'); return current.current.readLatest(); },
        readRemote: async () => {
          const { data, error } = await client.from('study_libraries').select('document,revision').eq('user_id', user).maybeSingle();
          if (error) throw error;
          return data || { revision: 0, document: { version: 1, cards: [] } };
        },
        compareAndSwap: async (revision, document) => {
          if (!active()) throw new Error('同步已停止。');
          const { data, error } = await client.rpc('sync_study_library', { expected_revision: revision, next_document: document });
          if (error) throw error;
          cardsFrom(data.document); return data;
        },
        commit: ({ cloud, localAtSend }) => {
          if (!active()) return;
          const latest = current.current.readLatest();
          // Edits made while the request was in flight stay local and are sent next.
          const merged = mergeLibraries(localAtSend, latest, cloud);
          current.current.applyCloud(merged);
          window.localStorage.setItem(checkpointKey(user), libraryJSON(cloud));
          setLastSync(new Date());
          setCloudCount(cloud.length);
          setStatus(!merged.length && !cloud.length ? '目前沒有單字可同步。請開啟原本的收藏，或匯入備份。' : sameStudyData(merged, cloud) ? '已同步' : '新增變更等待同步。');
        },
      });
    } catch (error) {
      if (alive.current) setStatus(cloudErrorMessage(error));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    if (!client) return () => { alive.current = false; };
    client.auth.getSession().then(({ data, error }) => {
      if (!alive.current) return;
      if (error) setStatus('登入狀態無法讀取，請重新登入。');
      else setSession(data.session);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => { if (alive.current) setSession(next); });
    return () => { alive.current = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(sync, 900);
    return () => clearTimeout(timer);
  }, [cards, session]);
  useEffect(() => {
    const wake = () => { if (document.visibilityState !== 'hidden') sync(); };
    window.addEventListener('online', wake); window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    const timer = setInterval(wake, 30000);
    return () => { clearInterval(timer); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  }, []);

  return { configured: Boolean(client), session, status, busy, lastSync, cloudCount, localCount: cards.length, sync,
    async login(email, password) {
      if (!client) throw new Error('請先設定 Supabase。');
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.code ? cloudErrorMessage(error) : '登入失敗，請確認電子郵件、密碼與帳號啟用狀態。');
    },
    async logout() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw new Error('登出未完成，請稍後重試。');
      setCloudCount(null); setLastSync(null);
      setStatus('已登出，收藏仍保留在本地。');
    },
  };
}
