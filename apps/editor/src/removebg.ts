// Removing a picture's background: the U²-Net matte (the person, or the main
// subject) becomes the alpha of a PNG saved as a new image asset, and placed
// in the composition as its own layer — titles can pass behind it.

import { pointer, type Op, type ToolContext, type ToolType } from '@tramme/core';
import { canvas, loadImage } from './perception.ts';
import { keep, matteModel, matting } from './cutout.ts';
import { madeBy } from './models.ts';
import { freshId, isToolAsset, linkedTransform, mediaAssetsOf, siblingsOf } from './model.ts';
import { t } from './i18n/index.ts';

/**
 * A picture with its background cut out: the matte of the subject (or of a
 * person) becomes its alpha. `kept` is the share of the picture the subject
 * covers (0 to 1), which says when a cutout looks wrong.
 */
export async function cutoutBlob(source: Blob, subject: 'any' | 'person', progress?: (n: number, of: number, what: string) => void): Promise<{ blob: Blob; kept: number; width: number; height: number }> {
  const url = URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
    const { c, g } = canvas(width, height);
    g.drawImage(img, 0, 0, width, height);
    progress?.(1, 3, t('removebg.reading'));
    const matte = keep(await (await matting(subject))(c), null);
    progress?.(2, 3, t('removebg.reading'));
    const px = g.getImageData(0, 0, width, height);
    let opaque = 0;
    for (let i = 0; i < matte.length; i++) { px.data[i * 4 + 3] = matte[i]; if (matte[i] >= 128) opaque++; }
    g.putImageData(px, 0, 0);
    const blob = await new Promise<Blob>((done, fail) => c.toBlob((b) => (b ? done(b) : fail(new Error('the PNG could not be made'))), 'image/png'));
    return { blob, kept: opaque / matte.length, width, height };
  } finally { URL.revokeObjectURL(url); }
}

export const REMOVEBG_TOOLS: ToolType[] = [
  {
    name: 'remove-bg',
    title: 'Remove the background',
    description: 'cuts the background out of a picture: a PNG with transparency (the person or the main subject kept), added to the project',
    input: {
      type: 'object',
      properties: {
        image: { type: 'string', format: 'asset', assetType: 'image', title: 'Image' },
        subject: { type: 'string', enum: ['any', 'person'], title: 'Subject', description: 'the main subject, or a person only' },
        place: { type: 'boolean', title: 'Place it', description: 'add the cut picture to the composition as its own layer (yes by default)' },
      },
    },
    ai: { when: 'a picture whose background must go (a product, a person on a busy background): titles and graphics then pass behind the subject' },
    async run({ image: wanted, subject = 'any', place = true }, ctx: ToolContext) {
      const images = Object.entries(ctx.doc.assets).filter(([, a]) => a.type === 'image');
      const id = wanted ?? mediaAssetsOf(ctx.doc, ctx.compId, ctx.selection, ['image'])[0] ?? images.filter(([aid, a]) => !isToolAsset(aid, a)).at(-1)?.[0];
      if (!id) throw new Error('the project has no picture: bring one in first');
      const res = await fetch(ctx.assetUrl(id));
      if (!res.ok) throw new Error(`${id}: the picture could not be read (HTTP ${res.status})`);
      const { blob, width: iw, height: ih } = await cutoutBlob(await res.blob(), subject, ctx.progress);
      const path = await ctx.writeFile(`assets/cutout/${id}.png`, blob);
      const nid = `${id}-cut`.slice(0, 64);
      const had = !!ctx.doc.assets[nid];
      const ops: Op[] = [{ op: had ? 'replace' : 'add', path: pointer('assets', nid), value: { type: 'image', src: path, name: ctx.doc.assets[id].name ? `${ctx.doc.assets[id].name} cut out` : nid, madeBy: [madeBy(matteModel(subject))] } }];
      const comp = ctx.doc.compositions[ctx.compId];
      // run again, the layer that already shows the cut keeps showing it (its asset is replaced and reloaded): no second copy
      const shown = Object.keys(comp.layers).find((x) => comp.layers[x].type === 'image' && comp.layers[x].props?.image === nid);
      const over = place && !shown ? Object.keys(comp.layers).find((x) => comp.layers[x].type === 'image' && comp.layers[x].props?.image === id) : undefined;
      if (place && !shown) {
        const taken: Record<string, unknown> = { ...comp.layers };
        const lid = freshId(taken, nid);
        // the cut picture follows the layer the image sits in (its frame and transform, like the cutout's subject); without one it is centred
        const l = over ? comp.layers[over] : null;
        const k = Math.min(1, (comp.width * 0.92) / iw, (comp.height * 0.92) / ih);
        const transform = l
          ? linkedTransform(over!, l)
          : { position: [Math.round(comp.width / 2), Math.round(comp.height / 2)] };
        const props: Record<string, unknown> = l
          ? { image: nid, size: { $link: `${over}.size` }, fit: { $link: `${over}.fit` }, focus: { $link: `${over}.focus` }, zoom: { $link: `${over}.zoom` }, offset: { $link: `${over}.offset` }, ...(l.props?.box !== undefined ? { box: l.props.box } : {}), crop: { $link: `${over}.crop` } }
          : { image: nid, size: [Math.round(iw * k), Math.round(ih * k)], fit: 'contain' };
        const timing = l
          ? { ...(l.in !== undefined ? { in: l.in } : {}), ...(l.out !== undefined ? { out: l.out } : {}) }
          : { in: ctx.time };
        const layer = { type: 'image', name: ctx.doc.assets[id].name ? `${ctx.doc.assets[id].name} cut out` : nid, ...timing, transform, props };
        if (l) {
          const { path: where, list: was } = siblingsOf(comp, over!);
          const list = [...was];
          list.splice(list.indexOf(over!) + 1, 0, lid);
          ops.push(
            { op: 'add', path: pointer('compositions', ctx.compId, 'layers', lid), value: layer },
            { op: 'replace', path: pointer('compositions', ctx.compId, ...where), value: list },
          );
        } else {
          ops.push(
            { op: 'add', path: pointer('compositions', ctx.compId, 'layers', lid), value: layer },
            { op: 'replace', path: pointer('compositions', ctx.compId, 'order'), value: [...comp.order, lid] },
          );
        }
      }
      return {
        ops, reload: had ? [nid] : [], label: t('removebg.done', { name: ctx.doc.assets[id].name ?? id }),
        text: [
          `The background of "${id}" is cut out: the subject kept, saved as the image asset "${nid}" (${iw}×${ih}, transparent elsewhere).`,
          ...(shown ? [`The layer "${shown}" already shows it: it now shows the new cut.`] : place ? [over
            ? `Placed right above "${over}", following its frame and transform: titles put under it in the stack pass behind the subject.`
            : `Placed as its own layer at ${ctx.time.toFixed(2)} s, centred. Titles put under it in the stack pass behind the subject.`] : []),
          'Run it again to read the matte again (the model runs on the GPU, on the processor when it refuses). For a video, the cutout tool cuts every frame instead.',
        ].join('\n'),
        notice: t('removebg.done', { name: ctx.doc.assets[id].name ?? id }),
      };
    },
  },
];
