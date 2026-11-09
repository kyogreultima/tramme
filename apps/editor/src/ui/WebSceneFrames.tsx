// A web scene without captured pictures, live in the viewport: its own document in a sandboxed
// iframe, laid over the canvas where the layer is (position, scale, rotation, opacity), seeked to
// the playhead with the layer's parameters. An iframe's pixels cannot be read back, so it is not
// composited with the layers around it: it sits over them, below the handles. Exports capture the
// scene instead (tramme render) and compose it with everything.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { layerMatrix, staticValue, type TrammeDoc } from '@tramme/core';
import type { EvaluatedLayer } from '@tramme/core';
import { SCENE_FRAME_SANDBOX } from '../webscene-frame.ts';
import { liveScenes, sceneDocument, sceneRevision } from '../webscene-preview.ts';
import { preview } from '../preview.ts';
import { t } from '../i18n/index.ts';
import { sceneFolder } from './SceneCode.tsx';

interface Props {
  doc: TrammeDoc;
  compId: string;
  now: number;
  scale: number;
  projectId: string | undefined;
  layerAt(id: string): EvaluatedLayer | null;
}

/** the layers to show: of the root stack (comp.order), visible, active at `now`, a folder of the project, and no pictures captured yet */
function shownLayers({ doc, compId, now, layerAt }: Props) {
  const comp = doc.compositions[compId], out: { id: string; folder: string; size: [number, number]; e: EvaluatedLayer }[] = [];
  for (const id of comp.order) {
    const layer = comp.layers[id];
    if (!layer || layer.type !== 'webscene' || layer.visible === false) continue;
    if (now < (layer.in ?? 0) || now >= (layer.out ?? comp.duration)) continue;
    const folder = sceneFolder(staticValue(layer.props?.folder));
    const frames = staticValue(layer.props?.frames);
    if (!folder || (Array.isArray(frames) && frames.length)) continue;
    const e = layerAt(id), size = e?.props.size as [number, number] | undefined;
    if (e && size && size[0] > 0 && size[1] > 0) out.push({ id, folder, size, e });
  }
  return out;
}

export function WebSceneFrames(props: Props) {
  if (!props.projectId) return null;
  const shown = shownLayers(props);
  if (!shown.length) return null;
  return (
    <div class="scene-frames" aria-hidden="true">
      {shown.map(({ id, folder, size, e }) => <SceneFrame key={id} projectId={props.projectId!} doc={props.doc} folder={folder} size={size} e={e} now={props.now} scale={props.scale} />)}
    </div>
  );
}

function SceneFrame({ projectId, doc, folder, size, e, now, scale }: { projectId: string; doc: TrammeDoc; folder: string; size: [number, number]; e: EvaluatedLayer; now: number; scale: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [built, setBuilt] = useState<{ srcdoc: string; duration: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');
  const revision = sceneRevision.value;
  // what the document is made of besides the scene's files: tokens and fonts
  const style = useMemo(() => JSON.stringify([doc.tokens, Object.values(doc.assets).filter((a) => a.type === 'font')]), [doc.tokens, doc.assets]);

  useEffect(() => {
    let live = true;
    setReady(false); setProblem('');
    sceneDocument(projectId, doc, folder).then((made) => { if (live) setBuilt(made); })
      .catch((error: Error) => { if (live) { setBuilt(null); setProblem(error.message); } });
    return () => { live = false; };
    // the document is rebuilt when the folder, its files or the style change, not at every edit of the project
  }, [projectId, folder, revision, style]);

  useEffect(() => {
    const heard = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      if (event.data.kind === 'ready') { setReady(true); setProblem(''); }
      else if (event.data.kind === 'error') setProblem(String(event.data.message).slice(0, 300));
    };
    addEventListener('message', heard);
    return () => removeEventListener('message', heard);
  }, []);

  useEffect(() => {
    if (!ready || problem) { liveScenes.delete(folder); preview.invalidate(); return; }
    liveScenes.add(folder);
    preview.invalidate();
    return () => { liveScenes.delete(folder); preview.invalidate(); };
  }, [ready, problem, folder]);

  // the playhead and the parameters, once per animation frame at most
  const params = JSON.stringify(e.props.$params ?? {});
  useEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => {
      frame.current?.contentWindow?.postMessage({ kind: 'seek', t: Math.min(now, built?.duration ?? now), params: JSON.parse(params) }, '*');
    });
    return () => cancelAnimationFrame(id);
  }, [ready, now, params, built]);

  const tr = e.transform, [w, h] = size;
  const [a, b, c, d, x, y] = layerMatrix(tr);
  const transform = `scale(${scale}) matrix(${a}, ${b}, ${c}, ${d}, ${x}, ${y}) translate(${-w / 2}px, ${-h / 2}px)`;
  return (
    <>
      {built && <iframe ref={frame} class="scene-frame" sandbox={SCENE_FRAME_SANDBOX} srcdoc={built.srcdoc} referrerpolicy="no-referrer" tabIndex={-1}
        title={t('viewport.sceneLive', { folder })} style={{ width: w, height: h, transform, opacity: ready ? tr.opacity : 0 }} />}
      {problem && <div class="scene-frame-problem" role="status">{t('viewport.sceneProblem', { folder, problem })}</div>}
    </>
  );
}
