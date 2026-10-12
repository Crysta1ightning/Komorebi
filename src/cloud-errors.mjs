export function cloudErrorMessage(error) {
  const code = String(error?.code || '');
  if (code === 'PGRST202') return '找不到同步函式。請在 Supabase SQL Editor 執行完整 study-sync.sql，再按立即同步。';
  if (code === 'PGRST205' || code === '42P01') return '找不到單字資料表。請在 Supabase SQL Editor 執行完整 study-sync.sql。';
  if (code === '42501') return '資料庫權限不足。請重新執行完整 study-sync.sql，確認已登入，再按立即同步。';
  if (code === 'PGRST301' || code === 'PGRST303') return '登入已失效，請登出後重新登入。';
  if (code === 'email_not_confirmed') return '此 App 帳號的電子郵件尚未確認，請先完成確認再登入。';
  if (code === 'invalid_credentials') return '電子郵件或密碼不正確。請使用此 App 的帳號；Supabase Dashboard 登入帳號不會自動成為 App 帳號。';
  if (code === 'P0001' && error?.message === 'Study document exceeds limit') return '單字庫超過目前同步容量（10,000 詞或 5 MB）。本地資料已保留，請下載備份。';
  if (error?.name === 'QuotaExceededError') return '此裝置儲存空間不足，請先下載單字備份。';
  if (error?.message?.includes('綁定')) return error.message;
  if (error?.message === '另一台裝置正在更新，請稍後再同步。') return error.message;
  const suffix = /^[A-Za-z0-9_]{1,30}$/.test(code) ? `（錯誤代碼：${code}）` : '';
  return `同步未完成，本地資料已保留。請檢查連線，再按立即同步。${suffix}`;
}
