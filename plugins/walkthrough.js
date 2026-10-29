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

function drawWindowBar(ctx, w, barH, title, font) {
  // a title bar and tabs, no address bar: the code pack's window shares the family
  ctx.fillStyle = '#12171D';
  ctx.beginPath(); ctx.roundRect(0, 0, w, barH, [barH * 0.35, barH * 0.35, 0, 0]); ctx.fill();
  const tabW = Math.min(w * 0.32, barH * 4.6);
  const tab = (x, label, active) => {
    ctx.fillStyle = active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.roundRect(x, barH * 0.16, tabW, barH * 0.84, [barH * 0.18, barH * 0.18, 0, 0]); ctx.fill();
    if (label) {
      ctx.fillStyle = active ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)';
      ctx.font = `500 ${Math.round(barH * 0.32)}px ${font ? `"${font}", ` : ''}system-ui, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(String(label).slice(0, 24), x + barH * 0.22, barH * 0.62, tabW - barH * 0.4);
    }
  };
  tab(barH * 0.55, title, true);
  tab(barH * 0.55 + tabW + barH * 0.08, '', false);
}

/**
 * The screen of a frame of this size, in the frame's local space (its centre is
 * the origin): its rectangle, its corner radius, and the numbers the drawing
 * needs (the inset of a phone's bezel, the height of a browser's bar, the
 * frame's own radius).
 */
export function screenOf({ size: [w, h], device }) {
  const isPhone = device === 'phone';
  const inset = isPhone ? w * 0.035 : 0, bar = isPhone ? 0 : h * 0.075;
  const frame = isPhone ? w * 0.09 : w * 0.02;
  return { x: -w / 2 + inset, y: -h / 2 + inset + bar, w: w - inset * 2, h: h - inset * 2 - bar, radius: frame * (isPhone ? 0.72 : 0.6), inset, bar, frame };
}

const device = {
  type: 'ui.device', title: 'Device', category: 'UI',
  ai: { when: 'a phone, browser or window frame around an interface: a screenshot in screen, scrolled slowly while the voice speaks (one layer per screen, cut between them), or an interface built in layers, laid with the device-screen tool', avoid: 'scrolling faster than the eye can follow; a screenshot wider than the frame\'s screen (it fits by width)' },
  props: {
    screen: { type: 'asset', assetType: 'image', default: null, nullable: true, label: 'Screenshot', animatable: false },
    device: { type: 'enum', default: 'phone', options: ['phone', 'browser', 'window'], label: 'Device', animatable: false },
    scroll: { type: 'number', default: 0, min: 0, max: 1, step: 0.001, label: 'Scroll', description: '0: the top of the screenshot; animate it for the pan' },
    url: { type: 'string', default: '', label: 'Address', animatable: false, description: 'browser: the address in the bar; window: the title in the bar' },
    bezel: { type: 'color', default: '#12171D', label: 'Frame', animatable: false },
    shadow: { type: 'bool', default: true, label: 'Shadow', animatable: false },
    size: { type: 'vec2', default: [560, 1120], label: 'Size', unit: 'px' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
    fill: { type: 'color', default: '#FFFFFF', label: 'Screen colour', animatable: false, description: 'the screen when there is no screenshot' },
    part: { type: 'enum', default: 'whole', options: ['whole', 'under', 'over'], label: 'Part', animatable: false, description: 'whole: the frame and its screenshot; under: the shadow, the frame and the screen; over: the notch or the bar, drawn over an interface built in layers' },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const part = p.part ?? 'whole', drawUnder = part !== 'over', drawOver = part !== 'under';
      let img = null;
      try { img = host.asset(p.screen); } catch { img = null; }
      const iw = img ? (img.naturalWidth || img.width) : 0, ih = img ? (img.naturalHeight || img.height) : 0;
      let family = '';
      if (p.font) { try { family = `"${host.asset(p.font)}", `; } catch { family = ''; } }
      const isPhone = p.device === 'phone';
      const { x: sx, y: sy, w: screenW, h: screenH, inset, bar: barH, frame: radius } = screenOf(p);

      if (drawUnder) {
        if (p.shadow) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = w * 0.08; ctx.shadowOffsetY = w * 0.02; ctx.fillStyle = p.bezel; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, radius); ctx.fill(); ctx.restore(); }
        else { ctx.fillStyle = p.bezel; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, radius); ctx.fill(); }
      }
      if (drawOver && !isPhone) (p.device === 'window' ? drawWindowBar : drawBrowserBar)(ctx, w, barH, p.url, family);
      // the screen: the screenshot fits the width, the scroll pans it; without one, its colour
      if (drawUnder) {
        ctx.save();
        ctx.beginPath(); ctx.roundRect(sx, sy, screenW, screenH, isPhone ? radius * 0.72 : [0, 0, radius * 0.6, radius * 0.6]); ctx.clip();
        if (iw && ih) {
          const scale = screenW / iw, total = ih * scale;
          const y = sy - Math.max(0, total - screenH) * clamp01(p.scroll);
          ctx.drawImage(img, sx, y, screenW, total);
        } else {
          ctx.fillStyle = p.fill;
          ctx.fillRect(sx, sy, screenW, screenH);
          if (part === 'whole') {
            ctx.fillStyle = 'rgba(128,128,128,0.25)';
            ctx.font = `500 ${Math.round(w * 0.05)}px ${family}system-ui, sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Drop a screenshot', sx + screenW / 2, sy + screenH / 2);
          }
        }
        ctx.restore();
      }
      // the notch of the phone, drawn over the screen
      if (drawOver && isPhone) { ctx.fillStyle = p.bezel; ctx.beginPath(); ctx.roundRect(-w * 0.14, -h / 2 + inset * 0.45, w * 0.28, w * 0.055, w * 0.03); ctx.fill(); }
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

/** the frame's proportions when only its height is given: a phone's 1:2, a browser's 1100:720 */
const FRAME_RATIO = { phone: 0.5, browser: 1100 / 720, window: 1100 / 720 };
const FRAME_NAME = { phone: 'Phone', browser: 'Browser', window: 'Window' };

const deviceScreen = {
  name: 'device-screen', title: 'Frame for an interface built in layers',
  description: 'a phone, browser or window frame whose screen holds layers you build: the frame under and over an empty content group that the screen clips',
  input: {
    type: 'object',
    properties: {
      device: { enum: ['phone', 'browser', 'window'], title: 'Device', description: 'phone by default' },
      height: { type: 'number', minimum: 100, title: 'Height (px)', description: '86 % of the composition by default' },
      name: { type: 'string', title: 'Name', description: 'the group\'s name; the device\'s by default' },
      at: { type: 'number', minimum: 0, title: 'Starts at (s)' },
      duration: { type: 'number', minimum: 0.1, title: 'Lasts (s)' },
    },
  },
  ai: { when: 'an interface drawn in layers (rows, cards, buttons, prices) inside a phone, a browser or a window; build the layers in the content group it returns and the screen clips them', avoid: 'a screenshot of the interface exists (ui.device with screen shows it as it is)' },
  async run({ device = 'phone', height, name, at, duration }, ctx) {
    const cid = ctx.compId, comp = ctx.doc.compositions[cid];
    if (!comp) throw new Error(`unknown composition: ${cid}`);
    const label = String(name || FRAME_NAME[device] || 'Device');
    const h = Math.round(height ?? comp.height * 0.86), w = Math.round(h * FRAME_RATIO[device]);
    const s = screenOf({ size: [w, h], device });
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    // a browser's clip reaches up under its bar, which is drawn over the content, so the screen's top corners are never cut into the interface
    const reach = device === 'phone' ? 0 : s.radius;
    const fresh = (base) => { let id = base, n = 2; while (comp.layers[id] || ids.includes(id)) id = `${base}-${n++}`; ids.push(id); return id; };
    const ids = [];
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device';
    const gid = fresh(key), under = fresh(`${key}-frame`), clipId = fresh(`${key}-screen`), content = fresh(`${key}-content`), over = fresh(`${key}-over`);
    const timing = { ...(at !== undefined ? { in: +at.toFixed(3) } : {}), ...(duration !== undefined ? { out: +((at ?? 0) + duration).toFixed(3) } : {}) };
    const frame = (part) => ({ type: 'ui.device', name: `${label} · ${part}`, props: { device, size: [w, h], part } });
    const layers = {
      [gid]: { type: 'group', name: label, ...timing, transform: { position: [Math.round(comp.width / 2), Math.round(comp.height / 2)] }, children: [under, clipId, content, over] },
      [under]: frame('under'),
      [clipId]: { type: 'shape.rect', name: `${label} · screen`, visible: false, transform: { position: [cx, cy - reach / 2] }, props: { size: [s.w, s.h + reach], radius: s.radius } },
      [content]: { type: 'group', name: `${label} · content`, clip: clipId, transform: { position: [cx, cy] }, children: [] },
      [over]: frame('over'),
    };
    const ops = [
      ...Object.entries(layers).map(([id, value]) => ({ op: 'add', path: `/compositions/${cid}/layers/${id}`, value })),
      { op: 'add', path: `/compositions/${cid}/order/-`, value: gid },
    ];
    return {
      ops, label: `${label} · frame`,
      text: `${label}: a ${device} frame ${w} x ${h} px, centred in the composition. Build the interface in the group "${label} · content" (add layers to its children): its screen is ${Math.round(s.w)} x ${Math.round(s.h)} px, clips what goes past it, and layers built there use the screen's centre as their origin (x from ${-Math.round(s.w / 2)} to ${Math.round(s.w / 2)}, y from ${-Math.round(s.h / 2)} to ${Math.round(s.h / 2)}). Move or animate the whole "${label}" group to push in on a detail; a ui.cursor layer goes over it, in the composition.`,
    };
  },
};

export const meta = { id: 'tramme/walkthrough', name: 'walkthrough', version: '1.2.0', description: 'A phone or browser frame for screenshots, a clicking cursor, and a tool that lays out the walkthrough', api: 1 };
export const nodes = [device, cursor];
export const tools = [walkthrough, deviceScreen];
export const presets = [
  { name: 'ui-phone', title: 'Phone with screenshot', category: 'UI', description: 'a phone frame, its screen to fill', layer: { type: 'ui.device', name: 'Phone', props: { device: 'phone', size: [560, 1120] } } },
  { name: 'ui-browser', title: 'Browser with screenshot', category: 'UI', description: 'a browser window with its address bar', layer: { type: 'ui.device', name: 'Browser', props: { device: 'browser', size: [1100, 720], url: 'tramme.app' } } },
  { name: 'ui-cursor', title: 'Cursor', category: 'UI', description: 'a pointer with its click ripple', layer: { type: 'ui.cursor', name: 'Cursor', props: {} } },
];
export const messages = {
  fr: {
    "Screens": "Écrans",
    "the screenshots, in the order they are shown": "les captures, dans l’ordre où elles sont montrées",
    "phone by default": "téléphone par défaut",
    "Seconds per screen": "Secondes par écran",
    "2.5 by default": "2,5 par défaut",
    "Captions": "Légendes",
    "one line per screen, said under it (same order)": "une ligne par écran, dite dessous (même ordre)",
    'Device': 'Appareil', 'Cursor': 'Curseur', 'Screenshot': 'Capture', 'Scroll': 'Défilement', 'Address': 'Adresse',
    'Frame': 'Cadre', 'Shadow': 'Ombre', 'Size': 'Taille', 'Font': 'Police', 'Position': 'Position', 'Click': 'Clic',
    'Color': 'Couleur', 'Scale': 'Échelle', 'Lay out a walkthrough': 'Monter une visite guidée',
    '0: the top of the screenshot; animate it for the pan': '0 : le haut de la capture ; animez-le pour le panoramique',
    'browser only: the address in the bar': 'navigateur seulement : l\'adresse dans la barre',
    'browser: the address in the bar; window: the title in the bar': 'navigateur : l\'adresse dans la barre ; fenêtre : le titre dans la barre',
    '0 at rest; key it up and down at each tap: it draws the ripple': '0 au repos ; keyframez-le en haut et en bas à chaque tap : il dessine l\'onde',
    'a sequence of screenshots in a phone or a browser frame, one composition, a cut per screen, each with an optional caption and a slow scroll': 'une suite de captures dans un cadre de téléphone ou de navigateur, une composition, une coupe par écran, chacune avec une légende optionnelle et un défilement lent',
    'Frame for an interface built in layers': 'Cadre pour une interface construite en calques',
    'a phone, browser or window frame whose screen holds layers you build: the frame under and over an empty content group that the screen clips': 'un cadre de téléphone, de navigateur ou de fenêtre dont l\'écran porte les calques que vous construisez : le cadre dessous et dessus un groupe de contenu vide que l\'écran découpe',
    'Height (px)': 'Hauteur (px)', 'Starts at (s)': 'Début (s)', 'Lasts (s)': 'Durée (s)', 'Name': 'Nom',
    '86 % of the composition by default': '86 % de la composition par défaut',
    'the group\'s name; the device\'s by default': 'le nom du groupe ; celui de l\'appareil par défaut',
    'Screen colour': 'Couleur de l\'écran', 'Part': 'Partie',
    'the screen when there is no screenshot': 'l\'écran quand il n\'y a pas de capture',
    'whole: the frame and its screenshot; under: the shadow, the frame and the screen; over: the notch or the bar, drawn over an interface built in layers': 'whole : le cadre et sa capture ; under : l\'ombre, le cadre et l\'écran ; over : l\'encoche ou la barre, dessinée par-dessus une interface construite en calques',
    'Phone with screenshot': 'Téléphone avec capture',
    'a phone frame, its screen to fill': 'un cadre de téléphone, son écran à remplir',
    'Browser with screenshot': 'Navigateur avec capture',
    'a browser window with its address bar': 'une fenêtre de navigateur avec sa barre d\'adresse',
    'a pointer with its click ripple': 'un pointeur avec l\'onde de son clic',
  },
};
