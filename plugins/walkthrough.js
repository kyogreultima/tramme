// UI walkthrough: a phone or a browser window showing a screenshot, scrolled
// and walked through by a cursor that clicks. The `walkthrough` tool lays out
// a sequence of screens as cuts, each with its caption; the cursor is added
// and keyed by hand (or by the assistant) where the taps happen.

function drawBrowserBar(ctx, w, barH, url, font) {
  ctx.fillStyle = '#12171D';
  ctx.beginPath(); ctx.roundRect(0, 0, w, barH, [barH * 0.35, barH * 0.35, 0, 0]); ctx.fill();
  const dots = ['#FF5F57', '#FEBC2E', '#28C840'];
  dots.forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(barH * 0.5 + i * barH * 0.42, barH * 0.5, barH * 0.11, 0, Math.PI * 2); ctx.fill(); });
  if (url) {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.roundRect(w * 0.24, barH * 0.2, w * 0.52, barH * 0.6, barH * 0.3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `500 ${Math.round(barH * 0.4)}px ${font ? `"${font}", ` : ''}system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(url, w / 2, barH * 0.52);
  }
}

const device = {
  type: 'ui.device', title: 'Device', category: 'UI',
  ai: { when: 'showing a product: a screenshot in a phone or a browser frame, scrolled slowly while the voice speaks; one layer per screen, cut between them', avoid: 'scrolling faster than the eye can follow; a screenshot wider than the frame\'s screen (it fits by width)' },
  props: {
    screen: { type: 'asset', assetType: 'image', default: null, nullable: true, label: 'Screenshot', animatable: false },
    device: { type: 'enum', default: 'phone', options: ['phone', 'browser'], label: 'Device', animatable: false },
    scroll: { type: 'number', default: 0, min: 0, max: 1, step: 0.001, label: 'Scroll', description: '0: the top of the screenshot; animate it for the pan' },
    url: { type: 'string', default: '', label: 'Address', animatable: false, description: 'browser only: the address in the bar' },
    bezel: { type: 'color', default: '#12171D', label: 'Frame', animatable: false },
    shadow: { type: 'bool', default: true, label: 'Shadow', animatable: false },
    size: { type: 'vec2', default: [560, 1120], label: 'Size', unit: 'px' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      let img = null;
      try { img = host.asset(p.screen); } catch { img = null; }
      const iw = img ? (img.naturalWidth || img.width) : 0, ih = img ? (img.naturalHeight || img.height) : 0;
      if (!iw || !ih) return;
      let family = '';
      if (p.font) { try { family = `"${host.asset(p.font)}", `; } catch { family = ''; } }
      const isPhone = p.device === 'phone';
      const inset = isPhone ? w * 0.035 : 0, barH = isPhone ? 0 : h * 0.075;
      const screenW = w - inset * 2, screenH = h - inset * 2 - barH;
      const radius = isPhone ? w * 0.09 : w * 0.02;

      if (p.shadow) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = w * 0.08; ctx.shadowOffsetY = w * 0.02; ctx.fillStyle = p.bezel; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, radius); ctx.fill(); ctx.restore(); }
      else { ctx.fillStyle = p.bezel; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, radius); ctx.fill(); }

      if (!isPhone) drawBrowserBar(ctx, w, barH, p.url, family);
      // the screen: the screenshot fits the width, the scroll pans it
      const sx = -w / 2 + inset, sy = -h / 2 + inset + barH;
      ctx.save();
      ctx.beginPath(); ctx.roundRect(sx, sy, screenW, screenH, isPhone ? radius * 0.72 : [0, 0, radius * 0.6, radius * 0.6]); ctx.clip();
      if (iw && ih) {
        const scale = screenW / iw, total = ih * scale;
        const y = sy - Math.max(0, total - screenH) * clamp01(p.scroll);
        ctx.drawImage(img, sx, y, screenW, total);
      } else {
        ctx.fillStyle = 'rgba(128,128,128,0.25)';
        ctx.font = `500 ${Math.round(w * 0.05)}px ${family}system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Drop a screenshot', sx + screenW / 2, sy + screenH / 2);
      }
      ctx.restore();
      // the notch of the phone, drawn over the screenshot
      if (isPhone) { ctx.fillStyle = p.bezel; ctx.beginPath(); ctx.roundRect(-w * 0.14, -h / 2 + inset * 0.45, w * 0.28, w * 0.055, w * 0.03); ctx.fill(); }
    },
  },
};

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

const cursor = {
  type: 'ui.cursor', title: 'Cursor', category: 'UI',
  ai: { when: 'showing where to tap or click on a walkthrough: key the position between steps, and the click from 0 to 1 and back at the moment of the tap', avoid: 'a cursor without a click for more than a few seconds (the viewer loses it)' },
  props: {
    pos: { type: 'vec2', default: [0, 0], label: 'Position' },
    click: { type: 'number', default: 0, min: 0, max: 1, step: 0.01, label: 'Click', description: '0 at rest; key it up and down at each tap: it draws the ripple' },
    color: { type: 'paint', default: '#FFFFFF', label: 'Cursor' },
    scale: { type: 'number', default: 1, min: 0.2, step: 0.05, unit: 'x', label: 'Scale' },
  },
  bounds(p) { return { x: p.pos[0] - 40, y: p.pos[1] - 40, w: 120, h: 140 }; },
  render: {
    canvas2d(ctx, p, host) {
      void host;
      const [x, y] = p.pos, s = p.scale;
      // the ripple first, under the pointer
      if (p.click > 0.01) {
        const ripple = clamp01(p.click);
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 1 - ripple;
        ctx.lineWidth = Math.max(2, 10 * s * (1 - ripple));
        ctx.beginPath(); ctx.arc(x + 14 * s, y + 14 * s, 14 * s + 66 * s * ripple, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // the classic pointer, tilted into place
      ctx.save();
      ctx.translate(x, y); ctx.scale(s, s);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 44); ctx.lineTo(11, 33); ctx.lineTo(19, 51); ctx.lineTo(28, 47); ctx.lineTo(20, 29); ctx.lineTo(34, 28);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    },
  },
};

const walkthrough = {
  name: 'walkthrough', title: 'Lay out a walkthrough',
  description: 'a sequence of screenshots in a phone or a browser frame, one composition, a cut per screen, each with an optional caption and a slow scroll',
  input: {
    type: 'object',
    properties: {
      screens: { type: 'array', title: 'Screens', description: 'the screenshots, in the order they are shown', items: { type: 'string', format: 'asset', assetType: 'image' } },
      device: { enum: ['phone', 'browser'], title: 'Device', description: 'phone by default' },
      seconds: { type: 'number', title: 'Seconds per screen', description: '2.5 by default' },
      captions: { type: 'array', title: 'Captions', description: 'one line per screen, said under it (same order)', items: { type: 'string' } },
    },
    required: ['screens'],
  },
  async run({ screens, device = 'phone', seconds = 2.5, captions }, ctx) {
    const ids = (screens ?? []).filter((s) => ctx.doc.assets[s]?.type === 'image');
    if (!ids.length) throw new Error('at least one image asset of the project is expected in screens');
    const [w, h] = device === 'phone' ? [1080, 1920] : [1920, 1080];
    const fps = ctx.doc.compositions[ctx.compId]?.fps ?? 30;
    const dur = +((ids.length * seconds) + 0.4).toFixed(3);
    const taken = { ...ctx.doc.compositions };
    let cid = `walkthrough-${device}`, k = 2;
    while (taken[cid]) cid = `walkthrough-${device}-${k++}`;
    taken[cid] = 1;
    const ops = [], order = [], layers = {};
    const fresh = (base) => { let id = base, n = 2; while (layers[id]) id = `${base}-${n++}`; layers[id] = 1; return id; };
    ids.forEach((asset, i) => {
      const id = fresh(`screen-${i + 1}`);
      const from = +(i * seconds).toFixed(3), to = +((i + 1) * seconds).toFixed(3);
      layers[id] = {
        type: 'ui.device', name: `Screen ${i + 1}`, in: from, out: to,
        transform: { position: [w / 2, h / 2] },
        props: { screen: asset, device, size: device === 'phone' ? [Math.round(w * 0.52), Math.round(w * 1.04)] : [Math.round(w * 0.5), Math.round(h * 0.62)] },
      };
      order.push(id);
      if (captions?.[i]) {
        const tid = fresh(`step-${i + 1}`);
        layers[tid] = { type: 'text', name: `Step ${i + 1}`, in: from + 0.15, out: to, transform: { position: [w / 2, Math.round(h * (device === 'phone' ? 0.88 : 0.9))] }, props: { text: String(captions[i]), size: Math.round(Math.min(w, h) * 0.045), weight: 700, align: 'center', color: '#FFFFFF' } };
        order.push(tid);
      }
    });
    const comp = { name: `Walkthrough · ${device}`, width: w, height: h, fps, duration: dur, layers, order };
    ops.push({ op: 'add', path: `/compositions/${cid}`, value: comp });
    return {
      ops, label: `Walkthrough · ${ids.length} screen(s)`,
      text: `${ids.length} screen(s) in a ${device} frame, ${seconds} s each (the composition "${comp.name}" is ${dur.toFixed(1)} s). Add a ui.cursor layer and key its position and click over the taps; the scroll of each screen is a property, animatable for a slow pan.`,
    };
  },
};

export const meta = { id: 'tramme/walkthrough', name: 'walkthrough', version: '1.0.0', description: 'A phone or browser frame for screenshots, a clicking cursor, and a tool that lays out the walkthrough', api: 1 };
export const nodes = [device, cursor];
export const tools = [walkthrough];
export const presets = [
  { name: 'ui-phone', title: 'Phone with screenshot', category: 'UI', description: 'a phone frame, its screen to fill', layer: { type: 'ui.device', name: 'Phone', props: { device: 'phone', size: [560, 1120] } } },
  { name: 'ui-browser', title: 'Browser with screenshot', category: 'UI', description: 'a browser window with its address bar', layer: { type: 'ui.device', name: 'Browser', props: { device: 'browser', size: [1100, 720], url: 'tramme.app' } } },
  { name: 'ui-cursor', title: 'Cursor', category: 'UI', description: 'a pointer with its click ripple', layer: { type: 'ui.cursor', name: 'Cursor', props: {} } },
];
export const messages = {
  fr: {
    'Device': 'Appareil', 'Cursor': 'Curseur', 'Screenshot': 'Capture', 'Scroll': 'Défilement', 'Address': 'Adresse',
    'Frame': 'Cadre', 'Shadow': 'Ombre', 'Size': 'Taille', 'Font': 'Police', 'Position': 'Position', 'Click': 'Clic',
    'Color': 'Couleur', 'Scale': 'Échelle', 'Lay out a walkthrough': 'Monter une visite guidée',
    '0: the top of the screenshot; animate it for the pan': '0 : le haut de la capture ; animez-le pour le panoramique',
    'browser only: the address in the bar': 'navigateur seulement : l\'adresse dans la barre',
    '0 at rest; key it up and down at each tap: it draws the ripple': '0 au repos ; keyframez-le en haut et en bas à chaque tap : il dessine l\'onde',
    'a sequence of screenshots in a phone or a browser frame, one composition, a cut per screen, each with an optional caption and a slow scroll': 'une suite de captures dans un cadre de téléphone ou de navigateur, une composition, une coupe par écran, chacune avec une légende optionnelle et un défilement lent',
    'Phone with screenshot': 'Téléphone avec capture',
    'a phone frame, its screen to fill': 'un cadre de téléphone, son écran à remplir',
    'Browser with screenshot': 'Navigateur avec capture',
    'a browser window with its address bar': 'une fenêtre de navigateur avec sa barre d\'adresse',
    'a pointer with its click ripple': 'un pointeur avec l\'onde de son clic',
  },
};
