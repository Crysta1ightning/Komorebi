import { useEffect, useState } from 'react';

export default function useJapaneseSpeech() {
  const [voices, setVoices] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const speech = window.speechSynthesis;
    if (!speech || !window.SpeechSynthesisUtterance) return;
    const update = () => setVoices(speech.getVoices().filter(voice => /^ja(?:-|$)/i.test(voice.lang)));
    update(); speech.addEventListener?.('voiceschanged', update);
    return () => { speech.removeEventListener?.('voiceschanged', update); speech.cancel(); };
  }, []);
  return { available: voices.length > 0, error,
    stop: () => window.speechSynthesis?.cancel(),
    speak(text) {
      if (!voices.length) return;
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = 'ja-JP'; utterance.voice = voices[0]; utterance.rate = 0.85;
      utterance.onerror = event => { if (!['canceled', 'interrupted'].includes(event.error)) setError('朗讀失敗，請稍後重試。'); };
      setError(''); window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
    },
  };
}

