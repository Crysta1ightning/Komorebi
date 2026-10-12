import React, { useState } from 'react';

export default function CloudPanel({ cloud, expanded }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  return <details className="cloud-panel" open={expanded || undefined}><summary><span>☁ 雲端同步</span><small role="status">{cloud.status}</small></summary>
    <p className="cloud-counts">此裝置：{cloud.localCount ?? 0} 個單字{cloud.cloudCount !== null && cloud.cloudCount !== undefined ? ` · 上次同步的雲端資料：${cloud.cloudCount} 個單字` : ''}</p>
    {cloud.configured ? cloud.session ? <div className="cloud-connected">
      <p>{cloud.session.user.email}</p>
      <p>{cloud.lastSync ? `上次同步：${cloud.lastSync.toLocaleTimeString('zh-TW')}` : '首次同步會合併本地與雲端收藏。'}</p>
      <div><button disabled={cloud.busy} onClick={cloud.sync}>立即同步</button><button disabled={cloud.busy} onClick={async () => { try { await cloud.logout(); } catch (error) { setMessage(error.message); } }}>登出</button></div>
    </div> : <form onSubmit={async event => { event.preventDefault(); setLoggingIn(true); setMessage(''); try { await cloud.login(email.trim(), password); setPassword(''); } catch (error) { setMessage(error.message); } finally { setLoggingIn(false); } }}>
      <p>電腦與手機登入同一帳號。登入後會合併目前收藏、例句與學習紀錄。</p>
      <label>電子郵件<input aria-label="同步帳號電子郵件" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>密碼<input aria-label="同步帳號密碼" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button disabled={loggingIn}>{loggingIn ? '登入中…' : '登入並同步'}</button>
    </form> : <p>先依 <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Supabase</a> 設定教學建立專案，填入專案網址與公開金鑰後重新建置。未設定時仍可使用本地複習與備份匯入。</p>}
    {message && <p role="alert">{message}</p>}
    <p className="cloud-note">連線時自動同步；離線時先保存在此裝置，回到 App 並連線後補同步。</p>
  </details>;
}
