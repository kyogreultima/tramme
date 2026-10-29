// Free libraries: CC0 textures, environments and models (Poly Haven,
// ambientCG), licensed photos and clips (Pexels, Openverse). The tool
// searches them, shows a contact sheet, and keeps the chosen file under
// assets/stock/ with a record of where it came from and its licence, so the
// project stays self-contained and the credits can be written. Only what may
// be used, shown and changed: CC0, public domain, CC BY (credited) and the
// Pexels licence; never share-alike, no-derivatives or non-commercial.

import { pointer, type Op, type ToolContext, type ToolType } from '@tramme/core';
import { unzipSync } from 'fflate';
import { api, reach } from './api.ts';
import { alone, askUser } from './confirm.ts';
import { packGlb } from './glb.ts';
import { openverse } from './openverse.ts';
import { keepMedia, placeMedia, slugOf } from './media.ts';
import { freshId } from './model.ts';
import { sheetOf } from './review.ts';
import { t } from './i18n/index.ts';

export type StockKind = 'photo' | 'clip' | 'texture' | 'hdri' | 'model' | 'real';
export type StockLicense = 'CC0' | 'PDM' | 'CC BY' | 'Pexels';
export type StockSource = 'polyhaven' | 'ambientcg' | 'openverse' | 'pexels' | 'commons';

export interface StockFile { url: string; type: string; role?: 'color' | 'normal' | 'roughness' | 'model' | 'buffer' | 'env'; /** the name a model's glTF gives it */ name?: string }
export interface StockHit {
  id: string;
  source: StockSource;
  kind: StockKind;
  title: string;
  thumb: string;
  author: string;
  /** one of the licences allowed, or (a real logo or picture, kept with the user's yes) the licence as Commons states it */
  license: StockLicense | string;
  landing: string;
  files: StockFile[];
  size?: [number, number];
  seconds?: number;
}

/** the library as it was named to the user, and the time each search is given */
const WAIT = 8000;
const STOCK_DIR = 'assets/stock';

/** a licence as the libraries spell it, when it may be used, shown and changed (CC0, public domain, CC BY), else null */
export function allowedLicense(raw: string | undefined): StockLicense | null {
  const l = (raw ?? '').trim().toLowerCase();
  if (l === 'cc0' || l === 'cc0 1.0') return 'CC0';
  if (l === 'pdm' || l === 'public domain') return 'PDM';
  if (l === 'by' || l === 'cc by') return 'CC BY';
  return null;
}

export { openverse };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

// ── Poly Haven ───────────────────────────────────────────────
const PH = 'https://api.polyhaven.com';
const PH_TYPE = { texture: 'textures', hdri: 'hdris', model: 'models' } as const;
interface PhAsset { name: string; categories?: string[]; tags?: string[]; authors?: Record<string, string>; max_resolution?: [number, number] }
type PhFiles = Record<string, Record<string, Record<string, { url: string; include?: Record<string, { url: string }> }>> & { url?: string }>;

/** the first of these sizes a map is offered in, as its jpg */
const pickJpg = (group: PhFiles[string] | undefined) => ['2k', '1k'].map((s) => group?.[s]?.jpg).find(Boolean);

async function polyhaven(kind: 'texture' | 'hdri' | 'model', query: string, count: number, signal: AbortSignal): Promise<StockHit[]> {
  const list = await getJson<Record<string, PhAsset>>(`${PH}/assets?type=${PH_TYPE[kind]}`, signal);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (id: string, a: PhAsset) => words.reduce((n, w) => n + (id.includes(w) || a.name.toLowerCase().includes(w) ? 3 : 0) + (a.categories?.some((c) => c.includes(w)) ? 2 : 0) + (a.tags?.some((x) => x.includes(w)) ? 1 : 0), 0);
  const best = Object.entries(list).map(([id, a]) => ({ id, a, n: score(id, a) })).filter((x) => x.n > 0).sort((x, y) => y.n - x.n).slice(0, count);
  const hits = await Promise.all(best.map(async ({ id, a }): Promise<StockHit | null> => {
    const f = await getJson<PhFiles>(`${PH}/files/${id}`, signal).catch(() => null);
    if (!f) return null;
    const files: StockFile[] = [];
    if (kind === 'texture') {
      for (const [group, role] of [['Diffuse', 'color'], ['nor_gl', 'normal'], ['Rough', 'roughness']] as const) {
        const j = pickJpg(f[group]);
        if (j) files.push({ url: j.url, type: 'image/jpeg', role });
      }
    } else if (kind === 'hdri') {
      const tone = (f.tonemapped as unknown as { url?: string } | undefined)?.url;
      if (tone) files.push({ url: tone, type: 'image/jpeg', role: 'env' });
    } else {
      const g = (f.gltf?.['1k'] as unknown as { gltf?: { url: string; include?: Record<string, { url: string }> } } | undefined)?.gltf;
      if (g) {
        files.push({ url: g.url, type: 'model/gltf+json', role: 'model', name: `${id}.gltf` });
        for (const [name, x] of Object.entries(g.include ?? {})) if (name.endsWith('.bin')) files.push({ url: x.url, type: 'application/octet-stream', role: 'buffer', name });
      }
    }
    // a texture without its colour map, an environment without its picture, a model without its geometry is no hit
    if (!files.some((x) => x.role === (kind === 'texture' ? 'color' : kind === 'hdri' ? 'env' : 'model'))) return null;
    return {
      id, source: 'polyhaven', kind, title: a.name, thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`,
      author: Object.keys(a.authors ?? {}).join(', ') || 'Poly Haven', license: 'CC0', landing: `https://polyhaven.com/a/${id}`, files, ...(a.max_resolution ? { size: a.max_resolution } : {}),
    };
  }));
  return hits.filter((h): h is StockHit => !!h);
}

// ── ambientCG (through the server: it sends no CORS headers) ──
interface AcgAsset { assetId: string; displayName?: string; previewImage?: Record<string, string>; downloadFolders?: { default?: { downloadFiletypeCategories?: { zip?: { downloads?: { attribute: string; fileName: string }[] } } } } }

async function ambientcg(query: string, count: number, signal: AbortSignal): Promise<StockHit[]> {
  const r = await api.stockAmbient('search', { q: query, limit: String(count) }, signal);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const found = ((await r.json()) as { foundAssets?: AcgAsset[] }).foundAssets ?? [];
  return found.flatMap((a): StockHit[] => {
    const zip = a.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads?.find((d) => d.attribute === '1K-JPG');
    if (!zip) return [];
    return [{
      id: a.assetId, source: 'ambientcg', kind: 'texture', title: a.displayName ?? a.assetId, thumb: a.previewImage?.['256-PNG'] ?? '', author: 'ambientCG', license: 'CC0',
      landing: `https://ambientcg.com/view?id=${a.assetId}`, files: [{ url: `/api/stock/ambientcg/zip?${new URLSearchParams({ file: zip.fileName })}`, type: 'application/zip', role: 'color' }],
    }];
  });
}

// ── Openverse images ─────────────────────────────────────────
interface OvImage { id: string; title?: string; url?: string; thumbnail?: string; creator?: string; license?: string; foreign_landing_url?: string; width?: number; height?: number }

async function openverseImages(query: string, count: number, signal: AbortSignal): Promise<StockHit[]> {
  const found = await openverse('images', { q: query, license: 'cc0,pdm,by', page_size: String(Math.min(20, count * 2)) }, signal) as OvImage[];
  return found.flatMap((x): StockHit[] => {
    const license = allowedLicense(x.license);
    if (!license || !x.url) return [];
    return [{
      id: x.id, source: 'openverse', kind: 'photo', title: x.title || 'Untitled', thumb: x.thumbnail ?? x.url, author: x.creator || 'unknown author', license,
      landing: x.foreign_landing_url ?? x.url, files: [{ url: x.url, type: 'image/jpeg' }], ...(x.width && x.height ? { size: [x.width, x.height] as [number, number] } : {}),
    }];
  });
}

// ── Pexels (through the server: the user's key) ──────────────
interface PxPhoto { id: number; width: number; height: number; url: string; photographer?: string; alt?: string; src: { original: string; large2x?: string; large?: string; medium: string } }
interface PxVideo { id: number; width: number; height: number; url: string; image: string; duration: number; user?: { name?: string }; video_files: { link: string; width: number; file_type: string }[] }

async function pexels(kind: 'photo' | 'clip', query: string, count: number, signal: AbortSignal): Promise<StockHit[]> {
  const answer = await api.stockPexels(kind === 'photo' ? 'photos' : 'videos', query, count, signal) as { photos?: PxPhoto[]; videos?: PxVideo[] };
  if (kind === 'photo') {
    return (answer.photos ?? []).map((p): StockHit => ({
      id: String(p.id), source: 'pexels', kind: 'photo', title: p.alt || `Photo ${p.id}`, thumb: p.src.medium, author: p.photographer ?? 'unknown author', license: 'Pexels',
      landing: p.url, files: [{ url: p.src.large2x ?? p.src.large ?? p.src.original, type: 'image/jpeg' }], size: [p.width, p.height],
    }));
  }
  return (answer.videos ?? []).flatMap((v): StockHit[] => {
    // the widest mp4 up to full HD
    const file = v.video_files.filter((f) => f.file_type === 'video/mp4' && f.width <= 1920).sort((a, b) => b.width - a.width)[0];
    if (!file) return [];
    return [{ id: String(v.id), source: 'pexels', kind: 'clip', title: `Clip ${v.id}`, thumb: v.image, author: v.user?.name ?? 'unknown author', license: 'Pexels', landing: v.url, files: [{ url: file.link, type: 'video/mp4' }], size: [v.width, v.height], seconds: v.duration }];
  });
}

// ── the search ───────────────────────────────────────────────
type Library = (query: string, count: number, signal: AbortSignal) => Promise<StockHit[]>;
/** the libraries of each kind, the best first */
const LIBRARIES: Record<Exclude<StockKind, 'real'>, [StockSource, Library][]> = {
  texture: [['polyhaven', (q, n, s) => polyhaven('texture', q, n, s)], ['ambientcg', ambientcg]],
  hdri: [['polyhaven', (q, n, s) => polyhaven('hdri', q, n, s)]],
  model: [['polyhaven', (q, n, s) => polyhaven('model', q, n, s)]],
  photo: [['pexels', (q, n, s) => pexels('photo', q, n, s)], ['openverse', openverseImages]],
  clip: [['pexels', (q, n, s) => pexels('clip', q, n, s)]],
};

/** every library of a kind asked at once, each given 8 s; what answered, and the libraries that did not */
export async function searchStock(kind: Exclude<StockKind, 'real'>, query: string, count: number, signal: AbortSignal): Promise<{ hits: StockHit[]; failed: StockSource[] }> {
  const libraries = LIBRARIES[kind];
  const answers = await Promise.allSettled(libraries.map(([, ask]) => ask(query, count, AbortSignal.any([signal, AbortSignal.timeout(WAIT)]))));
  const failed = libraries.filter((_, i) => answers[i].status === 'rejected').map(([name]) => name);
  if (signal.aborted) throw new Error('stopped');
  const hits = answers.flatMap((a) => (a.status === 'fulfilled' ? a.value : [])).filter((h) => allowedLicense(h.license === 'Pexels' ? 'cc0' : h.license) !== null).slice(0, count);
  return { hits, failed };
}

// ── real logos and pictures, with the user's yes ─────────────
/** what the assistant wanted to fetch in a turn nobody was there to say yes to: listed to the user at the turn's end */
export const realWanted = new Set<string>();

const stripTags = (html: string | undefined) => (html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

interface CommonsPage { title: string; imageinfo?: { url: string; thumburl?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }[] }

/** the first file of Wikimedia Commons for a name, as a hit (its licence as Commons states it: the user has said yes to the brand or the person) */
async function commons(what: string, signal: AbortSignal): Promise<StockHit | null> {
  const params = new URLSearchParams({ action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: what, gsrlimit: '5', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1280', format: 'json', origin: '*' });
  const answer = await getJson<{ query?: { pages?: Record<string, CommonsPage> } }>(`https://commons.wikimedia.org/w/api.php?${params}`, AbortSignal.any([signal, AbortSignal.timeout(WAIT)]));
  for (const [id, page] of Object.entries(answer.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const meta = info.extmetadata ?? {};
    const url = info.thumburl ?? info.url;
    return {
      id, source: 'commons', kind: 'real', title: page.title.replace(/^File:/, ''), thumb: url, author: stripTags(meta.Artist?.value) || 'unknown author',
      license: stripTags(meta.LicenseShortName?.value) || 'licence unknown', landing: info.descriptionurl ?? url, files: [{ url, type: 'image/png' }],
    };
  }
  return null;
}

// ── keeping a hit ────────────────────────────────────────────
/** hits seen in this session, by `source:id` (what the tool's `use` names) */
const seen = new Map<string, StockHit>();
const keyOf = (h: StockHit) => `${h.source}:${h.id}`;

async function fetchFile(url: string, signal: AbortSignal): Promise<Response> {
  const r = await (url.startsWith('/api/') ? reach(url, { signal }) : fetch(url, { signal }));
  if (!r.ok) throw new Error(`${url.split('/').pop()?.split('?')[0]}: HTTP ${r.status}`);
  return r;
}

/** the colour map of an ambientCG material, out of its zip */
function colorOfZip(zip: ArrayBuffer): Blob {
  const files = unzipSync(new Uint8Array(zip));
  const name = Object.keys(files).find((n) => /_Color\.(jpe?g|png)$/i.test(n));
  if (!name) throw new Error('the material has no colour map');
  return new Blob([files[name] as Uint8Array<ArrayBuffer>], { type: /\.png$/i.test(name) ? 'image/png' : 'image/jpeg' });
}

interface Placement { at?: number; duration?: number; background?: boolean; name?: string; /** a real logo or picture: what it stands for, and that the user said yes */ real?: string }

/** the hit kept in the project: its file, its record, its asset and (but an environment) its layer */
async function keepHit(ctx: ToolContext, hit: StockHit, where: Placement): Promise<{ ops: Op[]; text: string; reload?: string[]; image?: Blob }> {
  const slug = slugOf(where.name ?? `stock-${hit.source}-${hit.id}`);
  const c = ctx.doc.compositions[ctx.compId];
  const isVideo = hit.kind === 'clip', isModel = hit.kind === 'model';
  const asset = `${isModel ? 'model-' : isVideo ? 'video-' : 'image-'}${slug}`.slice(0, 64);
  if (ctx.doc.assets[asset]) return { ops: [], text: `"${hit.title}" is already in the project as ${asset}: nothing was fetched again.` };
  const main = hit.files.find((f) => f.role === 'model' || f.role === 'env' || f.role === 'color') ?? hit.files[0];
  const record: Record<string, unknown> = { source: hit.source, id: hit.id, kind: hit.kind, title: hit.title, author: hit.author, license: hit.license, landing: hit.landing, url: main.url, ...(hit.kind === 'hdri' ? { env: true } : {}), ...(where.real ? { what: where.real, permission: 'the user said yes' } : {}) };
  const at = where.at ?? 0;
  if (isModel) {
    const gltf = await (await fetchFile(main.url, ctx.signal)).json() as object;
    const buffers: Record<string, ArrayBuffer> = {};
    for (const f of hit.files.filter((x) => x.role === 'buffer')) buffers[f.name!] = await (await fetchFile(f.url, ctx.signal)).arrayBuffer();
    const src = await ctx.writeFile(`${STOCK_DIR}/${slug}.glb`, new Blob([packGlb(gltf, buffers)], { type: 'model/gltf-binary' }));
    await ctx.writeFile(`${STOCK_DIR}/${slug}.json`, JSON.stringify(record, null, 1));
    const lid = freshId({ ...c.layers }, asset);
    const len = Math.max(0.5, Math.min(where.duration ?? 5, c.duration - at));
    return {
      ops: [
        { op: 'add', path: pointer('assets', asset), value: { type: 'model', src, name: hit.title } },
        { op: 'add', path: pointer('compositions', ctx.compId, 'layers', lid), value: { type: 'model.3d', name: hit.title, in: at, out: +(at + len).toFixed(3), props: { source: asset } } },
        { op: 'add', path: pointer('compositions', ctx.compId, 'order', '-'), value: lid },
      ],
      text: `Model "${hit.title}" (${hit.license}, ${hit.author}) kept as ${asset} (${src}), geometry and base colours, placed as layer ${lid}. Its record is beside it.`,
    };
  }
  let blob = await (await fetchFile(main.url, ctx.signal)).blob();
  if (main.type === 'application/zip') blob = colorOfZip(await blob.arrayBuffer());
  else if (!blob.type || blob.type === 'application/octet-stream') blob = new Blob([blob], { type: main.type });
  const kind = isVideo ? 'video' : 'image';
  const kept = await keepMedia(ctx, kind, where.name ?? `stock-${hit.source}-${hit.id}`, blob, record, STOCK_DIR);
  const base = `${hit.title} (${hit.license}, ${hit.author}) kept as ${kept.asset} (${kept.src}), its record beside it.`;
  // an environment is an image the 3D layers light themselves with: it is not placed
  if (hit.kind === 'hdri') return { ops: kept.ops, reload: kept.reload, text: `Environment ${base} It is not placed in the frame; a 3D layer reads it as its light.`, image: blob };
  const out = Math.min(c.duration, at + (where.duration ?? (isVideo ? hit.seconds : undefined) ?? c.duration));
  // a logo or a real picture is shown whole at half the frame's shorter side; anything else fills the frame
  const box = Math.round(Math.min(c.width, c.height) * 0.5);
  const placed = placeMedia(ctx, kind, kept.asset, hit.title, { fit: where.real ? 'contain' : 'cover', at, out, background: where.background ?? false, ...(where.real ? { size: [box, box] as [number, number] } : {}) });
  return { ops: [...kept.ops, ...placed.ops], reload: kept.reload, text: `${isVideo ? 'Clip' : hit.kind === 'texture' ? 'Texture' : 'Photo'} ${base} Placed as layer ${placed.layer} from ${at.toFixed(2)} s.`, image: blob };
}

interface Input { kind: StockKind; query?: string; what?: string; count?: number; use?: string; at?: number; duration?: number; background?: boolean; name?: string }

const describe = (h: StockHit) => `- ${keyOf(h)} · ${h.title} · ${h.author} · ${h.license}${h.size ? ` · ${h.size[0]}×${h.size[1]}` : ''}${h.seconds ? ` · ${h.seconds} s` : ''}`;

/** a real brand's logo, a real person or product: only with the user's yes, and never in a turn left alone */
async function real(a: Input, ctx: ToolContext) {
  const what = a.what?.trim();
  if (!what) throw new Error('say what to fetch (what): the brand, the person or the product, as the user would name it');
  if (!await askUser(t('stock.realTitle'), t('stock.realText', { what }), t('stock.realYes'))) {
    if (alone()) {
      realWanted.add(what);
      return { ops: [], text: `Not fetched: ${what} needs the user's yes, and nobody is there to give it. Nothing was fetched. A wordmark set in the film's type stands for a logo, and a picture made for the film (generate-image with object) stands for a real one. The end of the turn lists "${what}" for the user, who can ask for it.` };
    }
    return { ops: [], text: `The user said no to fetching ${what}: nothing was fetched. Set the name in the film's type instead, and make a picture for the film.` };
  }
  const hit = await commons(what, ctx.signal).catch((e) => { throw new Error(`Wikimedia Commons did not answer (${(e as Error).message}): set the name in the film's type instead`); });
  if (!hit) return { ops: [], text: `Nothing on Wikimedia Commons for "${what}". Set the name in the film's type, and make a picture for the film.` };
  const kept = await keepHit(ctx, hit, { ...a, real: what });
  return { ops: kept.ops, label: t('stock.kept', { title: hit.title }), text: `${kept.text} Licence as Commons states it: ${hit.license}; the user said yes, and the record says so. Credit it (credits).`, notice: t('stock.kept', { title: hit.title }) };
}

const stock: ToolType<Input> = {
  name: 'stock', title: 'Free libraries', description: 'searches the free libraries (Poly Haven and ambientCG textures, environments and models; Pexels and Openverse photos; Pexels clips), shows a contact sheet, and keeps the chosen file in the project with its licence and credit',
  input: {
    type: 'object',
    properties: {
      kind: { enum: ['photo', 'clip', 'texture', 'hdri', 'model', 'real'], title: 'Kind', description: "photo, clip (footage), texture (a tileable material), hdri (an environment that lights a 3D object), model (a 3D object), real (the logo of a real brand, a real person or a real product: asks the user, who must say yes; alone, nothing is fetched)" },
      what: { type: 'string', title: 'What', description: 'with real: the brand, the person or the product, as the user would name it ("the Revolut logo")' },
      query: { type: 'string', title: 'Search', description: 'two or three words in English: "ramen bowl", "worn concrete", "city night timelapse"' },
      count: { type: 'integer', minimum: 1, maximum: 8, title: 'How many', description: '6 by default' },
      use: { type: 'string', title: 'Keep', description: 'a result of the last search ("polyhaven:concrete_floor_02"): kept in the project and placed' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 0.1, title: 'Length (s)' },
      background: { type: 'boolean', title: 'In the background', description: 'a picture or texture under the other layers' },
      name: { type: 'string', title: 'Name', description: 'of the file, lower case' },
    },
    required: ['kind'],
  },
  ai: {
    when: 'the film needs a texture, an environment for a 3D object, a model, a photo or a clip the project lacks: search here before generating, look at the sheet, keep the best with use. What is kept is credited (use_tool "credits" before the export)',
    avoid: "a photo of a real brand's product or of a real person (that is the real kind, with the user's yes); a library photo where an object made in the film's style fits better; more than one search per need",
  },
  async run(a, ctx) {
    if (a.kind === 'real') return real(a, ctx);
    if (a.use) {
      let hit = seen.get(a.use) ?? [...seen.values()].find((h) => h.id === a.use && h.kind === a.kind);
      if (!hit && a.query) { await searchStock(a.kind as Exclude<StockKind, 'real'>, a.query, a.count ?? 6, ctx.signal).then((r) => r.hits.forEach((h) => seen.set(keyOf(h), h))); hit = seen.get(a.use); }
      if (!hit) throw new Error(`no result "${a.use}" in this session's searches: search again (query), then keep one by its id`);
      const kept = await keepHit(ctx, hit, a);
      return { ops: kept.ops, ...(kept.reload?.length ? { reload: kept.reload } : {}), label: t('stock.kept', { title: hit.title }), text: kept.text, notice: t('stock.kept', { title: hit.title }) };
    }
    if (!a.query?.trim()) throw new Error('say what to look for (query), or the result to keep (use)');
    const { hits, failed } = await searchStock(a.kind as Exclude<StockKind, 'real'>, a.query, Math.min(8, a.count ?? 6), ctx.signal);
    hits.forEach((h) => seen.set(keyOf(h), h));
    const down = failed.length ? `${failed.join(', ')} did not answer${hits.length ? ' (the others did)' : ''}.` : '';
    if (!hits.length) return { ops: [], text: `Nothing for "${a.query}" in the licences allowed (CC0, public domain, CC BY, Pexels).${down ? ` ${down}` : ''} Try other words${failed.length ? ' or later' : ''}, have one made (generate-image with object), or draw it with the engine (surface).`, notice: t('stock.nothing') };
    const images = await Promise.all(hits.map(async (h) => {
      try { return await createImageBitmap(await (await fetch(h.thumb)).blob()); } catch { return null; }
    }));
    const cells = hits.flatMap((h, i) => (images[i] ? [{ image: images[i]!, label: h.id.slice(0, 18) }] : []));
    const url = cells.length ? sheetOf(cells, 240, 180, Math.min(4, cells.length)) : null;
    for (const b of images) b?.close();
    return {
      ops: [], label: t('stock.found', { n: hits.length }),
      text: [`${hits.length} for "${a.query}":`, ...hits.map(describe), ...(down ? [down] : []), 'Look at the sheet, then keep one with stock { kind, use: "<source:id>" }: it is saved in the project with its licence and credited by the credits tool.'].join('\n'),
      ...(url ? { images: [{ url, caption: t('stock.sheet') }] } : {}),
      notice: t('stock.found', { n: hits.length }),
    };
  },
};

export const STOCK_TOOLS: ToolType[] = [stock as unknown as ToolType];
