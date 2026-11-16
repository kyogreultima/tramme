// The prompter: the project's script (meta.script) written or pasted here,
// then said to the camera while it scrolls at the pace chosen. The recording
// (camera and microphone) joins the project's files, and the assistant's box
// is given the words that ask it to keep the takes of the script (takes.ts).
// Escape or closing during a take drops it: nothing is written.

import { pointer } from '@tramme/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { draft } from '../attachments.ts';
import { fileProject, sameFileProject } from '../files.ts';
import { t } from '../i18n/index.ts';
import { commit, S, toast } from '../state.ts';
import { Modal } from './controls.tsx';
import { Icon } from './icons.tsx';
import { importFiles } from './LeftPanel.tsx';

type Stage = 'write' | 'count' | 'record' | 'save';

/** the formats a browser records, the most widely read first */
const KINDS = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
const kindOf = () => KINDS.find((k) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(k)) ?? '';

/** the script kept with the project when it changed */
function keepScript(script: string) {
  const doc = S.doc.peek(), had = doc.meta.script;
  if ((had ?? '') === script) return;
  commit(t('prompter.keepScript'), [{ op: had === undefined ? 'add' : 'replace', path: pointer('meta', 'script'), value: script }]);
}

/** the button that opens the prompter: in the studio's bar and in the atelier's timeline */
export function PrompterButton({ size = '' }: { size?: '' | 'sm' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class={`icon-btn${size ? ` ${size}` : ''}${open ? ' on' : ''}`} title={t('prompter.open')} aria-label={t('prompter.open')} onClick={() => setOpen(true)}><Icon name="doc" /></button>
      {open && <Prompter onClose={() => setOpen(false)} />}
    </>
  );
}

export function Prompter({ onClose }: { onClose: () => void }) {
  const [script, setScript] = useState(String(S.doc.peek().meta.script ?? ''));
  const [stage, setStage] = useState<Stage>('write');
  const [count, setCount] = useState(3);
  const [speed, setSpeed] = useState(40);
  const camera = useRef<HTMLVideoElement>(null), roll = useRef<HTMLDivElement>(null);
  const live = useRef<{ stream: MediaStream; rec?: MediaRecorder; dropped?: boolean; frame?: number } | null>(null);
  const pace = useRef(speed);
  pace.current = speed;

  const release = () => {
    const l = live.current;
    if (!l) return;
    if (l.frame) cancelAnimationFrame(l.frame);
    for (const track of l.stream.getTracks()) track.stop();
    live.current = null;
  };
  useEffect(() => () => { if (live.current) { live.current.dropped = true; live.current.rec?.state === 'recording' && live.current.rec.stop(); } release(); }, []);

  const close = () => { if (live.current) live.current.dropped = true; live.current?.rec?.state === 'recording' && live.current.rec.stop(); release(); keepScript(script); onClose(); };

  const start = async () => {
    if (!script.trim()) { toast(t('prompter.noScript'), 'error'); return; }
    keepScript(script);
    const project = fileProject();
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch { toast(t('prompter.noCamera'), 'error'); return; }
    live.current = { stream };
    if (camera.current) { camera.current.srcObject = stream; void camera.current.play().catch(() => {}); }
    setStage('count');
    for (let n = 3; n > 0; n--) { setCount(n); await new Promise((r) => setTimeout(r, 1000)); if (!live.current) return; }
    const kind = kindOf(), chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, kind ? { mimeType: kind } : undefined);
    live.current.rec = rec;
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      // a take is dropped by Escape or closing (dropped set), or when the window is already gone
      const dropped = !live.current || !!live.current.dropped;
      release();
      if (dropped || !chunks.length || !sameFileProject(project)) { setStage('write'); return; }
      setStage('save');
      const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      try {
        await importFiles([new File([new Blob(chunks, { type: rec.mimeType })], `take-${stamp}.${ext}`, { type: rec.mimeType })]);
        if (!sameFileProject(project)) return;
        // the assistant's box, ready: it transcribes the take and keeps the script's
        draft.value = t('prompter.askTakes');
        onClose();
      } catch (e) { toast((e as Error).message, 'error'); setStage('write'); }
    };
    rec.start(1000);
    setStage('record');
    // the script scrolls at the pace chosen, from its top
    if (roll.current) roll.current.scrollTop = 0;
    let last = performance.now();
    const step = (now: number) => {
      const el = roll.current, l = live.current;
      if (!el || !l) return;
      el.scrollTop += (pace.current * (now - last)) / 1000;
      last = now;
      l.frame = requestAnimationFrame(step);
    };
    live.current.frame = requestAnimationFrame(step);
  };
  const stop = () => { live.current?.rec?.state === 'recording' && live.current.rec.stop(); };

  return (
    <Modal title={t('prompter.title')} onClose={close} wide>
      <div class={`prompter ${stage}`}>
        {stage === 'write' ? (
          <textarea class="prompter-script" value={script} placeholder={t('prompter.placeholder')} onInput={(e) => setScript((e.target as HTMLTextAreaElement).value)} />
        ) : (
          <div class="prompter-stage">
            <video ref={camera} class="prompter-camera" muted playsInline />
            <div class="prompter-roll" ref={roll}>{script.split('\n').map((line, i) => <p key={i}>{line || ' '}</p>)}<div class="prompter-tail" /></div>
            {stage === 'count' && <div class="prompter-count mono">{count}</div>}
          </div>
        )}
        <div class="prompter-bar">
          <label class="prompter-speed"><span class="faint">{t('prompter.speed')}</span><input type="range" min={10} max={120} value={speed} onInput={(e) => setSpeed(Number((e.target as HTMLInputElement).value))} /></label>
          <span class="grow" />
          {stage === 'write' && <button class="btn primary" onClick={() => { void start(); }}><Icon name="mic" />{t('prompter.record')}</button>}
          {stage === 'record' && <button class="btn primary" onClick={stop}><Icon name="stop" />{t('prompter.stop')}</button>}
          {stage === 'save' && <span class="faint"><Icon name="spinner" /> {t('prompter.saving')}</span>}
        </div>
      </div>
    </Modal>
  );
}
