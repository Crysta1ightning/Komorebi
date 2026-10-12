import React from 'react';
import { createRoot } from 'react-dom/client';
import MobileApp from './MobileApp.jsx';
import './styles.css';
import './mobile.css';

createRoot(document.getElementById('root')).render(<MobileApp />);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/mobile-sw.js').catch(() => {
      const note = document.createElement('p');
      note.className = 'pwa-error'; note.setAttribute('role', 'status');
      note.textContent = '離線介面尚未快取，請連線使用並重新開啟。';
      document.body.append(note);
    });
  });
}
