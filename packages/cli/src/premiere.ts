// tramme premiere <doc> [--out folder] [--comp id]: the film as a Premiere Pro
// timeline (packages/interop's premiere.ts says what goes where). In the
// folder: <name>.xml (File > Import in Premiere), media/ (the footage and the
// sounds, copied), clips/ (per scene, what is drawn under the footage and over
// it, ProRes 4444 with alpha) and <name>.srt (the captions). After Effects
// takes the same clips. The renders use a copy of the document with the other
// layers hidden, beside it so that its files resolve, removed after.

import fs from 'node:fs';
import path from 'node:path';
import { upgradeDoc, type TrammeDoc } from '@tramme/core';
import { zipFiles } from '@tramme/project';
import { captionCues, footageClips, footageSplit, soundClips, toSrt, toXmeml, type Timeline, type TimelineClip } from '@tramme/interop';
import { scenesOf } from '../../../apps/editor/src/scenes.ts';
import { launch, openDoc } from './browser.ts';
import { renderVideo } from './jobs.ts';
import { readConfig, resolveMountedPath, Server } from './server.ts';

/** an export's folder as one zip (what the renderer hands back), its paths relative to the folder */
export function zipFolder(dir: string, file: string) {
  const files = new Map<string, Uint8Array>();
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.set(path.relative(dir, p).split(path.sep).join('/'), new Uint8Array(fs.readFileSync(p))); } };
  walk(dir);
  fs.writeFileSync(file, zipFiles(files));
}

export interface PremiereOptions { out: string; comp?: string; verbose?: boolean; onProgress?: (line: string) => void }

/** a copy of the document drawing only these root layers (and, over the footage, no plate under them) */
function only(doc: TrammeDoc, compId: string, keep: string[], transparent: boolean): TrammeDoc {
  const copy = structuredClone(doc), comp = copy.compositions[compId];
  for (const id of comp.order) if (!keep.includes(id) && comp.layers[id]) comp.layers[id].visible = false;
  if (transparent) comp.background = null;
  return copy;
}

/** what the folder holds and how to open it, in both languages of the app */
const README = (xml: string, srt: boolean, notes: string[]) => [
  `Premiere Pro: File > Import > ${xml}. The sequence opens with the footage and sounds cut as in Tramme, and what is drawn under and over the footage as clips with alpha (clips/), one per scene.`,
  'If Premiere asks where a file is (the folder was moved), point to it in media/ or clips/: the others are found beside it.',
  `After Effects: import the clips of clips/ as footage.${srt ? ' The subtitles are in the .srt file.' : ''}`,
  ...(notes.length ? ['', 'Not carried:', ...notes.map((n) => `- ${n}`)] : []),
  '',
  `Premiere Pro : Fichier > Importer > ${xml}. La séquence s'ouvre avec les rushes et les sons coupés comme dans Tramme, et ce qui est dessiné sous et sur les rushes en clips avec transparence (clips/), un par scène.`,
  "Si Premiere demande où est un fichier (le dossier a été déplacé), désignez-le dans media/ ou clips/ : les autres sont retrouvés à côté.",
  `After Effects : importez les clips de clips/ comme métrage.${srt ? ' Les sous-titres sont dans le fichier .srt.' : ''}`,
  '',
].join('\r\n');

const safe = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'clip';

export async function premiereExport(docFile: string, opts: PremiereOptions): Promise<{ xml: string; warnings: string[] }> {
  const file = path.resolve(docFile), dir = path.dirname(file), cfg = readConfig(file);
  const doc = upgradeDoc(JSON.parse(fs.readFileSync(file, 'utf8')));
  const compId = opts.comp ?? doc.root, comp = doc.compositions[compId];
  if (!comp) throw new Error(`unknown composition: ${compId}`);
  const out = path.resolve(opts.out), say = opts.onProgress ?? ((l: string) => console.log(l));
  fs.mkdirSync(path.join(out, 'media'), { recursive: true });
  fs.mkdirSync(path.join(out, 'clips'), { recursive: true });
  const warnings: string[] = [];

  // the files of the footage and sounds, copied beside the timeline (the XML names them by their place there)
  const copied = new Map<string, string>();
  const sourceOf = (asset: string) => {
    const src = String(doc.assets[asset]?.src ?? '');
    return src.startsWith('/') ? resolveMountedPath(cfg, src) : path.resolve(dir, src);
  };
  const fileOf = (asset: string) => {
    let to = copied.get(asset);
    if (to) return to;
    const from = sourceOf(asset);
    if (!from || !fs.existsSync(from)) throw new Error(`the file of the asset "${asset}" is missing: ${doc.assets[asset]?.src}`);
    to = path.join(out, 'media', `${copied.size + 1}-${safe(path.basename(from))}`);
    fs.copyFileSync(from, to);
    copied.set(asset, to);
    return to;
  };

  if (Object.values(comp.layers).some((l) => (l as { type: string }).type === 'webscene')) warnings.push('web scenes are not captured for this export: render the film once first');
  const split = footageSplit(doc, compId);
  const footage = footageClips(doc, compId, fileOf);
  const sound = soundClips(doc, compId, fileOf);
  warnings.push(...footage.warnings, ...sound.warnings);

  // what is drawn, under the footage and over it, rendered scene by scene
  const scenes = scenesOf(doc, compId, 'Opening');
  const layersOf: [kind: 'under' | 'over', ids: string[], transparent: boolean][] = [
    ['under', split.below, false],
    ['over', split.above, split.footage.length > 0],
  ];
  const drawn: TimelineClip[][] = [];
  for (const [kind, ids, transparent] of layersOf) {
    if (!ids.length) { drawn.push([]); continue; }
    const temp = path.join(dir, `.premiere-${kind}-${process.pid}.tramme.json`);
    fs.writeFileSync(temp, JSON.stringify(only(doc, compId, ids, transparent)));
    const server = new Server(readConfig(temp));
    const clips: TimelineClip[] = [];
    try {
      const port = await server.start();
      const { browser, page } = await launch({ quiet: !opts.verbose });
      try {
        const docUrl = '/project/' + encodeURIComponent(path.basename(temp));
        await openDoc(page, port, docUrl, compId);
        for (const [i, s] of scenes.entries()) {
          const to = path.join(out, 'clips', `${String(i + 1).padStart(2, '0')}-${safe(s.name)}-${kind}.mov`);
          say(`  ${kind === 'under' ? 'under' : 'over'} the footage, scene ${i + 1}/${scenes.length}: ${s.name}`);
          await renderVideo(server, page, { docUrl, doc, compId, format: 'mov', from: s.from, to: s.to, mute: true, out: to, pages: 1 });
          clips.push({ name: `${s.name} (${kind === 'under' ? 'under' : 'over'})`, file: to, at: s.from, offset: 0, duration: s.to - s.from, kind: 'video' });
        }
      } finally { await browser.close(); }
    } finally { server.close(); fs.rmSync(temp, { force: true }); }
    drawn.push(clips);
  }

  const name = comp.name || 'Tramme';
  const timeline: Timeline = {
    name, width: comp.width, height: comp.height, fps: comp.fps, duration: comp.duration,
    // bottom to top: what is under the footage, the footage, what is over it
    video: [drawn[0], footage.clips, drawn[1]].filter((t) => t.length),
    audio: sound.tracks,
  };
  const xml = path.join(out, `${safe(name)}.xml`);
  fs.writeFileSync(xml, toXmeml(timeline));
  const cues = captionCues(doc, compId, (asset) => { const f = sourceOf(asset); return f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; });
  if (cues.length) fs.writeFileSync(path.join(out, `${safe(name)}.srt`), toSrt(cues));
  fs.writeFileSync(path.join(out, 'README.txt'), README(path.basename(xml), cues.length > 0, warnings));
  return { xml, warnings };
}
