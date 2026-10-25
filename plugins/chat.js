// Conversations for short videos, and the notifications of their cold opens.
// A thread is written as a script ("A: …", a reply that takes thought pauses
// longer), timed by reading, bubbles entering on the kit's curves, a typing
// indicator before each incoming message, the thread scrolling to keep the
// last one in view. The look stays generic — the tokens' colours, no
// messaging app's. Its emoji come from the emoji pack, never the system font.

// ── the script ───────────────────────────────────────────────
/** a script into lines: "Zoé: ça va ?" names its sender, "[2.5s] yo" the time it lands */
export function parseScript(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    let m = /^\[([\d.,]+)\s*s?\]\s*(.*)$/.exec(line.trim());
    if (m) {
      const last = out[out.length - 1];
      if (last && last.at === undefined) { last.at = Number(m[1].replace(',', '.')); last.text = m[2] || last.text; }
      else out.push({ who: last?.who ?? '', text: m[2] ?? '', at: Number(m[1].replace(',', '.')) });
      continue;
    }
    m = /^([^:]{1,32}):\s*(.*)$/.exec(line);
    if (m) {
      const said = { who: m[1].trim(), text: m[2] };
      // a time after the name: "B: [2s] yo"
      const t = /^\[([\d.,]+)\s*s?\]\s*(.*)$/.exec(said.text);
      if (t) { said.at = Number(t[1].replace(',', '.')); said.text = t[2]; }
      out.push(said);
    }
    else if (out.length) out[out.length - 1].text += `\n${line}`;
  }
  return out;
}

/** how long a line stays readable, in seconds */
export function readingTime(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(0.9, words / 3.3 + 0.3);
}

/** the scroll after each message, keeping the last one in view */
export function scrollFor(heights, viewport) {
  let sum = 0;
  const tops = (heights ?? []).map((h) => { const t = sum; sum += h; return t; });
  return tops.map((top, i) => Math.max(0, top + (heights?.[i] ?? 0) - (viewport ?? 0)));
}

/** a reply that takes thought pauses longer before it types */
const typingFor = (line) => 0.4 + 0.18 * Math.min(2, String(line.text ?? '').split(/\s+/).filter(Boolean).length / 8);

/**
 * The thread's timeline, from its script: each line's start, its typing
 * window, its reading time, and the scroll after it (the pack's own pace —
 * the check reads the same numbers). `w` and `h` are the screen the bubbles
 * live in.
 */
export function timeline(script, w, h, size = 30) {
  const lines = parseScript(script);
  const wrap = (text) => Math.max(1, Math.ceil(String(text).length * size * 0.55 / Math.max(120, w * 0.6)));
  const heights = lines.map((l) => l.text.split('\n').reduce((n, seg) => n + wrap(seg), 0) * size * 1.4 + size * 1.2);
  const viewport = h - size * 2;
  const scrolls = scrollFor(heights, viewport);
  let t = 0.45;
  const items = lines.map((l, i) => {
    const typing = typingFor(l);
    const at = l.at ?? +(t + typing).toFixed(3);
    const read = readingTime(l.text);
    const until = +(Math.max(at + read, (lines[i + 1]?.at ?? at + read))).toFixed(3);
    const item = { ...l, i, typing: +typing.toFixed(3), at: +at.toFixed(3), read: +read.toFixed(3), until, height: +heights[i].toFixed(1), scroll: +scrolls[i].toFixed(1) };
    t = at + read;
    return item;
  });
  const end = items.length ? items[items.length - 1].until : 1;
  const scrollEnd = items.length ? scrolls[scrolls.length - 1] : 0;
  return { items, heights, viewport, scrollEnd, end };
}

// ── the thread node ──────────────────────────────────────────
const easeOutBack = (u) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };

function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) { out.push(line); line = word; }
      else line = next;
    }
    out.push(line);
  }
  return out;
}

const chatThread = {
  type: 'chat.thread', title: 'Chat thread', category: 'Chat',
  description: 'a conversation from a script: bubbles entering on the kit\'s curves, a typing indicator before each incoming message, the thread scrolling as it grows',
  ai: { when: 'a text-message story: twelve lines or fewer, timed by reading (the tool does it), in 9:16 mostly; the emoji in the lines come from the emoji pack', avoid: 'a real messaging app\'s look or name (the thread stays generic), more than a screenful of thread, lines nobody can finish reading, a typing indicator under 0.4 s' },
  props: {
    script: { type: 'string', default: 'A: are you seeing this?\nB: [2s] just landed 👀', label: 'Script', description: 'lines "Name: message"; "[2.5s]" when a line lands at a given time; the reading times the rest' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: '1: the thread over; key it to play it' },
    size: { type: 'number', default: 30, min: 10, unit: 'px', label: 'Type size' },
    ink: { type: 'paint', default: '@text', label: 'Text' },
    plate: { type: 'paint', default: '#101216', label: 'Screen' },
    mine: { type: 'paint', default: '@accent', label: 'Own bubble' },
    theirs: { type: 'paint', default: '#23272E', label: 'Their bubble' },
    sender: { type: 'bool', default: true, label: 'Names', description: 'the sender\'s name over their bubbles' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: (p, host) => ({ x: -host.width / 2, y: -host.height / 2, w: host.width, h: host.height }),
  render: {
    canvas2d(ctx, p, host) {
      const w = host.width, h = host.height;
      const size = p.size, lineH = size * 1.4;
      const family = p.font ? (() => { try { return `"${host.asset(p.font)}", `; } catch { return ''; } })() : '';
      ctx.font = `500 ${size}px ${family}system-ui, sans-serif`;
      const tl = timeline(p.script, w, h, size);
      tl.scrollAt = scrollAt(tl);
      const total = tl.end;
      const now = p.progress * total;
      // the screen
      ctx.fillStyle = p.plate;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(28, w * 0.04)); ctx.fill();
      const maxW = w * 0.68;
      const pad = size * 0.7;
      let y = -h / 2 + size - tl.scrollAt(now);
      for (const it of tl.items) {
        const rows = wrapText(ctx, it.text, maxW - pad * 2);
        const bh = rows.length * lineH + pad * 1.4;
        const mine = it.i % 2 === 1; // the second voice speaks from the owner's side
        const x = mine ? w / 2 - pad - maxW / 2 : -w / 2 + pad + maxW / 2;
        // the typing indicator before the message
        if (now > it.at - it.typing && now < it.at) {
          const u = Math.min(1, (now - (it.at - it.typing)) / 0.18);
          ctx.fillStyle = p.theirs;
          ctx.beginPath(); ctx.roundRect(x - maxW / 2, y, size * 2.2, size * 1.5, size * 0.7); ctx.fill();
          ctx.fillStyle = p.ink;
          ctx.globalAlpha = 0.6;
          for (let k = 0; k < 3; k++) {
            const bounce = Math.sin(((now * 6) + k) % (Math.PI * 2));
            ctx.beginPath(); ctx.arc(x - maxW / 2 + size * 0.55 + k * size * 0.55, y + size * 0.75 - bounce * size * 0.12, size * 0.1, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        if (now >= it.at) {
          // the bubble enters on a spring, the last one a beat after its typing stops
          const u = Math.min(1, (now - it.at) / 0.3);
          const s = easeOutBack(u);
          const push = it.i % 2 === 1 ? (1 - s) * size : -(1 - s) * size;
          ctx.fillStyle = mine ? p.mine : p.theirs;
          ctx.beginPath(); ctx.roundRect(x - maxW / 2, y, Math.max(size * 2, Math.min(maxW, Math.max(...rows.map((r) => ctx.measureText(r).width)) + pad * 2)), bh, size * 0.62); ctx.fill();
          ctx.fillStyle = mine ? p.plate : p.ink;
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          rows.forEach((row, r) => ctx.fillText(row, x - maxW / 2 + pad, y + pad * 0.7 + r * lineH + (1 - s) * size * 0.2 + push * 0));
          if (p.sender && !mine) {
            ctx.fillStyle = p.ink;
            ctx.globalAlpha = 0.55;
            ctx.font = `600 ${Math.round(size * 0.72)}px ${family}system-ui, sans-serif`;
            ctx.fillText(String(it.who), x - maxW / 2 + pad, y - size * 0.95);
            ctx.font = `500 ${size}px ${family}system-ui, sans-serif`;
            ctx.globalAlpha = 1;
          }
        }
        y += bh + 12;
      }
    },
  },
};

/** the scroll at now: eased between the scrolls the timeline computed */
const scrollAt = (tl) => (now) => {
  let at = 0;
  for (const it of tl.items) {
    const after = it.at + it.read * 0.7;
    if (now >= after) at = it.scroll;
    else if (now > after - 0.4) {
      const u = (now - (after - 0.4)) / 0.4;
      return at + (it.scroll - at) * (u * u * (3 - 2 * u));
    }
  }
  return at;
};

// ── the notice node ──────────────────────────────────────────
const chatNotice = {
  type: 'chat.notice', title: 'Notification', category: 'Chat',
  description: 'notifications that drop in and stack: a sender, a line, a time — the cold open of a story',
  ai: { when: 'a story that opens on what the phone says: two or three notifications, the hook among them, dropping in one after the other', avoid: 'a real app\'s look or name, more than three, a notification on screen for less than its reading time' },
  props: {
    items: { type: 'array', default: [{ who: 'Zoé', text: 'tu as vu ?' }], label: 'Notifications', description: 'a list of { who, text }', items: { type: 'object' } },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: '1: all shown; key it to drop them in' },
    size: { type: 'number', default: 30, min: 10, unit: 'px', label: 'Type size' },
    ink: { type: 'paint', default: '@text', label: 'Text' },
    plate: { type: 'paint', default: '#1B1F26', label: 'Card' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: (p, host) => ({ x: -host.width / 2, y: -host.height / 2, w: host.width, h: host.height }),
  render: {
    canvas2d(ctx, p, host) {
      const w = host.width, h = host.height, size = p.size;
      const family = p.font ? (() => { try { return `"${host.asset(p.font)}", `; } catch { return ''; } })() : '';
      const items = Array.isArray(p.items) ? p.items : [];
      const each = 0.7, at = (i) => i * each;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      items.forEach((it, i) => {
        const u = Math.min(1, Math.max(0, (p.progress - at(i)) / 0.35));
        if (u <= 0) return;
        const drop = (1 - easeOutBack(u)) * -h * 0.3;
        const cardW = Math.min(w * 0.86, w - 40), cardH = size * 3.1;
        const y = -h / 2 + size * 1.2 + i * (cardH + size * 0.5) + drop;
        ctx.fillStyle = p.plate;
        ctx.globalAlpha = Math.min(1, u * 1.4);
        ctx.beginPath(); ctx.roundRect(-cardW / 2, y, cardW, cardH, size * 0.9); ctx.fill();
        ctx.fillStyle = p.ink;
        ctx.font = `700 ${Math.round(size * 0.82)}px ${family}system-ui, sans-serif`;
        ctx.fillText(String(it.who ?? ''), -cardW / 2 + size, y + size * 0.55);
        ctx.font = `500 ${size}px ${family}system-ui, sans-serif`;
        ctx.globalAlpha = 0.85;
        ctx.fillText(String(it.text ?? '').slice(0, 60), -cardW / 2 + size, y + size * 1.7, cardW - size * 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.ink;
        ctx.globalAlpha = 0.45;
        ctx.font = `500 ${Math.round(size * 0.62)}px ${family}system-ui, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(i === 0 ? 'now' : `${i}m`, cardW / 2 - size, y + size * 0.6);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      });
    },
  },
};

// ── the tool ─────────────────────────────────────────────────
const chat = {
  name: 'chat', title: 'Play a conversation',
  description: 'a text-message story timed by reading: bubbles entering, typing indicators, the thread scrolling — in the walkthrough pack\'s phone, or full frame in 9:16',
  input: {
    type: 'object',
    properties: {
      script: { type: 'string', title: 'Script', description: 'lines "Name: message", one per line; "[2.5s]" when a line lands at a time' },
      inPhone: { type: 'boolean', title: 'In a phone', description: 'the thread inside the walkthrough pack\'s phone frame (default in 16:9, full frame in 9:16)' },
      seconds: { type: 'number', title: 'Seconds at most', description: 'the thread\'s reading time decides; a cap when given' },
    },
    required: ['script'],
  },
  ai: { when: 'a text-message story for a short video: write the script (names and lines, an emoji from the emoji pack where one lands), let the tool time it, then read it again — a line nobody finishes reading is cut', avoid: 'a real app\'s look, more than twelve lines, long paragraphs in bubbles, a thread in 16:9 when 9:16 is possible' },
  async run(a, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const portrait = comp.height > comp.width;
    const inPhone = a.inPhone ?? !portrait;
    const lines = parseScript(a.script ?? '');
    if (!lines.length) throw new Error('the script needs lines "Name: message"');
    // the thread's own screen: the phone's screen, or the whole composition
    const [w, h] = inPhone ? (portrait ? [Math.round(comp.width * 0.7), Math.round(comp.height * 0.62)] : [Math.round(comp.width * 0.32), Math.round(comp.width * 0.62)]) : [comp.width, comp.height];
    const size = Math.max(22, Math.round(Math.min(w, h) / (portrait ? 34 : 30)));
    const tl = timeline(a.script, w, h, size);
    const cap = a.seconds ? Math.min(tl.end, a.seconds) : tl.end;
    const seconds = Math.round((cap + 0.7) * 100) / 100;
    const tokens = ctx.doc.tokens ?? {};
    const colorOf = (name, fallback) => (tokens[name]?.type === 'color' ? `@${name}` : fallback);
    const r2 = (v) => Math.round(v * 100) / 100;
    const layers = {}, order = [];
    const cid = `chat-${Date.now().toString(36)}`;
    if (inPhone) {
      layers.phone = {
        type: 'ui.device', name: 'Phone', in: 0, out: seconds,
        transform: { position: [Math.round(comp.width / 2), Math.round(comp.height / 2)] },
        props: { device: 'phone', size: [Math.round(w * 1.12), Math.round(h * 1.14)] },
      };
      order.push('phone');
    }
    layers.thread = {
      type: 'chat.thread', name: 'Thread', in: 0, out: seconds,
      transform: { position: [Math.round(comp.width / 2), Math.round(comp.height / 2 + (inPhone ? h * 0.01 : 0))] },
      props: {
        script: a.script, size, plate: colorOf('plate', '#101216'), ink: colorOf('ink', colorOf('text', '#F4F5F7')),
        mine: colorOf('accent', '#2EC4B6'),
        progress: { $k: [{ t: 0.4, v: 0 }, { t: r2(0.4 + cap), v: 1 }] },
      },
    };
    order.push('thread');
    const ops = [{ op: 'add', path: `/compositions/${cid}`, value: { name: 'Chat', width: comp.width, height: comp.height, fps: comp.fps ?? 30, duration: seconds, background: comp.background, layers, order } }];
    const typing = tl.items.filter((i) => i.typing >= 0.4).length;
    return {
      ops, label: `Chat · ${lines.length} line(s)`,
      text: `${lines.length} lines timed by reading — ${seconds} s all told, ${typing} typing indicator(s) before the replies${cap < tl.end ? `, capped at ${a.seconds} s (the last lines may run past the composition: check them)` : ''}. ${inPhone ? 'The thread plays in the walkthrough pack\'s phone; ' : ''}each bubble is the layer's progress: move a line's time in the script, retime the whole on the layer.`,
    };
  },
};

// ── the check ────────────────────────────────────────────────
const chatReading = {
  name: 'chat-reading', title: 'Chat reading',
  description: 'a message pushed away before its reading time, a typing indicator under 0.4 s',
  run(ctx) {
    const out = [];
    for (const sample of ctx.samples) {
      for (const placed of sample.layers) {
        if (placed.node.type !== 'chat.thread' || placed.opacity < 0.5) continue;
        const name = placed.layer.name ?? placed.id;
        const tl = timeline(placed.props.script, ctx.comp.width, ctx.comp.height, Number(placed.props.size) || 30);
        // the thread's own pace, sped or slowed by the progress keys
        const prog = placed.props.progress;
        let rate = 1;
        if (prog && typeof prog === 'object' && Array.isArray(prog.$k) && prog.$k.length >= 2) {
          const span = Number(prog.$k.at(-1).t) - Number(prog.$k[0].t);
          if (span > 0.2) rate = tl.end / span;
        }
        for (const it of tl.items) {
          const onScreen = (it.until - it.at) / rate;
          if (onScreen < it.read * 0.92) out.push({ check: 'chat-reading', severity: 'warning', t: sample.t, message: `${name}: "${String(it.text).slice(0, 30)}" is gone after ${onScreen.toFixed(1)} s — reading it wants ${it.read.toFixed(1)} s; hold the thread longer or cut the line` });
          if (it.typing < 0.4) out.push({ check: 'chat-reading', severity: 'info', t: sample.t, message: `${name}: the typing indicator before "${String(it.text).slice(0, 30)}" is ${it.typing.toFixed(2)} s — under 0.4 s nobody reads it as typing` });
        }
      }
    }
    return out;
  },
};

export const meta = { id: 'tramme/chat', name: 'chat', version: '1.0.0', description: 'Conversations for short videos: a script timed by reading, bubbles entering, typing indicators, the thread scrolling; notifications for the cold open', api: 1 };
export const nodes = [chatThread, chatNotice];
export const tools = [chat];
export const checks = [chatReading];
export const messages = {
  fr: {
    'Chat thread': 'Fil de discussion', 'Notification': 'Notification', 'Play a conversation': 'Jouer une conversation', 'Chat reading': 'Lecture du fil',
    'Script': 'Script', 'Progress': 'Progression', 'Type size': 'Corps', 'Text': 'Texte', 'Screen': 'Écran', 'Own bubble': 'Bulle à soi',
    'Their bubble': 'Bulle aux autres', 'Names': 'Noms', 'Font': 'Police', 'In a phone': 'Dans un téléphone', 'Seconds at most': 'Secondes au plus',
    'Card': 'Carte', 'Notifications': 'Notifications',
    'lines "Name: message"; "[2.5s]" when a line lands at a given time; the reading times the rest': 'lignes « Nom : message » ; « [2,5 s] » quand une ligne tombe à un temps donné ; les temps de lecture pour le reste',
    '1: the thread over; key it to play it': '1 : le fil fini ; keyframez-le pour le jouer',
    'the sender\'s name over their bubbles': 'le nom de l’expéditeur au-dessus de ses bulles',
    'a conversation from a script: bubbles entering on the kit\'s curves, a typing indicator before each incoming message, the thread scrolling as it grows': 'une conversation depuis un script : des bulles qui entrent sur les courbes de la trousse, un indicateur de saisie avant chaque message qui arrive, le fil qui défile à mesure qu’il grandit',
    'a text-message story: twelve lines or fewer, timed by reading (the tool does it), in 9:16 mostly; the emoji in the lines come from the emoji pack': 'une histoire en messages : douze lignes ou moins, chronométrée à la lecture (l’outil le fait), en 9:16 le plus souvent ; les emoji des lignes viennent du pack emoji',
    'a real messaging app\'s look or name (the thread stays generic), more than a screenful of thread, lines nobody can finish reading, a typing indicator under 0.4 s': 'le look ou le nom d’une vraie appli de messages (le fil reste générique), plus d’un écran de fil, des lignes que personne ne finit de lire, un indicateur de saisie de moins de 0,4 s',
    'a list of { who, text }': 'une liste de { who, text }',
    '1: all shown; key it to drop them in': '1 : tout montré ; keyframez-les pour les faire tomber',
    'notifications that drop in and stack: a sender, a line, a time — the cold open of a story': 'des notifications qui tombent et s’empilent : un expéditeur, une ligne, un temps — le début à froid d’une histoire',
    'a story that opens on what the phone says: two or three notifications, the hook among them, dropping in one after the other': 'une histoire qui s’ouvre sur ce que dit le téléphone : deux ou trois notifications, l’accroche dedans, qui tombent l’une après l’autre',
    'a real app\'s look or name, more than three, a notification on screen for less than its reading time': 'le look ou le nom d’une vraie appli, plus de trois, une notification à l’écran moins de son temps de lecture',
    'lines "Name: message", one per line; "[2.5s]" when a line lands at a time': 'lignes « Nom : message », une par ligne ; « [2,5 s] » quand une ligne tombe à un temps',
    'the thread inside the walkthrough pack\'s phone frame (default in 16:9, full frame in 9:16)': 'le fil dans le téléphone du pack visite guidée (par défaut en 16:9, plein cadre en 9:16)',
    'the thread\'s reading time decides; a cap when given': 'c’est le temps de lecture du fil qui décide ; un plafond si donné',
    'a text-message story timed by reading: bubbles entering, typing indicators, the thread scrolling — in the walkthrough pack\'s phone, or full frame in 9:16': 'une histoire en messages chronométrée à la lecture : des bulles qui entrent, des indicateurs de saisie, le fil qui défile — dans le téléphone du pack visite guidée, ou plein cadre en 9:16',
    'a text-message story for a short video: write the script (names and lines, an emoji from the emoji pack where one lands), let the tool time it, then read it again — a line nobody finishes reading is cut': 'une histoire en messages pour une vidéo courte : écrivez le script (des noms et des lignes, un emoji du pack emoji là où il tombe), laissez l’outil le chronométrer, puis relisez — une ligne que personne ne finit se coupe',
    'a real app\'s look, more than twelve lines, long paragraphs in bubbles, a thread in 16:9 when 9:16 is possible': 'le look d’une vraie appli, plus de douze lignes, de longs paragraphes en bulles, un fil en 16:9 quand le 9:16 est possible',
    'a message pushed away before its reading time, a typing indicator under 0.4 s': 'un message chassé avant son temps de lecture, un indicateur de saisie de moins de 0,4 s',
  },
};
