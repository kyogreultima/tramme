// Listening to one sound at a time in a panel (a voice's sample, a sound of
// the library): starting another stops the one playing.

import { useEffect, useRef, useState } from 'preact/hooks';

/** one sound listened to at a time: play(key, url) starts it, or stops it when it is the one playing */
export function useListen() {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const stop = () => { audio.current?.pause(); setPlaying(null); };
  const play = (key: string, url: string) => {
    audio.current?.pause();
    if (playing === key) { setPlaying(null); return; }
    const a = new Audio(url);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(key);
  };
  return { playing, play, stop };
}
