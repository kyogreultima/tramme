// Localization: captions and shorts in another language. The model does the
// translating (it is the one thing here that needs a mind); the tools do the
// rest — `localize` cuts the transcript into sentences and hands them over,
// `localize-apply` lays the translation back over the original timing (each
// target word spread evenly across the sentence it translates, the standard
// subtitle trick) and duplicates the compositions that caption it.

/** the transcript grouped into sentences: [s, e, text], the unit the model translates */
export function sentencesOf(t) {
  const out = [];
  let cur = null;
  for (const w of t.words) {
    if (!cur) cur = { s: w.s, e: w.e, text: w.w };
    else { cur.e = w.e; cur.text += ` ${w.w}`; }
    if (/[.!?…]$/.test(w.w)) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.map((l) => ({ s: +l.s.toFixed(3), e: +l.e.toFixed(3), text: l.text }));
}

/** the translated transcript: each line's words spread evenly over the line it translates */
export function retimed(source, translations) {
  const words = [];
  translations.forEach((text, i) => {
    const line = source[i];
    if (!line) return;
    const parts = String(text).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) parts.push('·');
    const span = Math.max(0.3, line.e - line.s), per = span / parts.length;
    parts.forEach((wd, k) => words.push({ w: wd, s: +(line.s + k * per).toFixed(3), e: +(line.s + (k + 1) * per - 0.02).toFixed(3) }));
  });
  const end = words.length ? words[words.length - 1].e : source[source.length - 1]?.e ?? 0;
  return { version: 1, duration: +Math.max(end, source[source.length - 1]?.e ?? 0).toFixed(3), language: 'xx', words };
}

const localize = {
  name: 'localize', title: 'Prepare a translation',
  description: 'cuts a transcript into numbered sentences for the model to translate: the answer says what to hand back to localize-apply',
  input: {
    type: 'object',
    properties: {
      transcript: { type: 'string', format: 'asset', assetType: 'json', title: 'Transcript' },
      languages: { type: 'array', title: 'Languages', description: 'the target languages, by name ("French", "es"…)', items: { type: 'string' } },
    },
    required: ['transcript', 'languages'],
  },
  async run({ transcript, languages }, ctx) {
    if (!ctx.doc.assets[transcript]) throw new Error(`${transcript}: a transcript asset of the project is expected`);
    const t = await ctx.transcript(transcript);
    const lines = sentencesOf(t);
    if (!lines.length) throw new Error('the transcript has no words');
    const path = await ctx.writeFile(`assets/i18n/${transcript}-source.json`, JSON.stringify({ transcript, lines }, null, 1));
    const langs = (languages ?? []).map((l) => String(l)).filter(Boolean);
    return {
      text: [
        `The transcript is ${lines.length} sentence(s), kept at ${path}.`,
        `Translate them into ${langs.join(', ') || 'the asked language'}: answer with, for each language, a JSON array of ${lines.length} strings — sentence ${i + 1} of the array is the translation of:\n${lines.map((l, i) => `${i + 1}. [${l.s.toFixed(1)}–${l.e.toFixed(1)}] ${l.text}`).join('\n')}`,
        `Keep the sentences' order and count. Then call localize-apply once per language with transcript: "${transcript}", the language, and its array as lines: the tool retimes the words over the original timing and duplicates the compositions that caption this transcript.`,
      ].join('\n'),
    };
  },
};

const localizeApply = {
  name: 'localize-apply', title: 'Apply a translation',
  description: 'a translated array of sentences becomes a transcript asset retimed over the original, and the compositions captioning the original are duplicated for the language',
  input: {
    type: 'object',
    properties: {
      transcript: { type: 'string', format: 'asset', assetType: 'json', title: 'Transcript' },
      lang: { type: 'string', title: 'Language', description: 'its code or name ("fr", "French")' },
      lines: { type: 'array', title: 'Translated sentences', description: 'one string per sentence, in the order localize gave', items: { type: 'string' } },
    },
    required: ['transcript', 'lang', 'lines'],
  },
  async run({ transcript, lang, lines }, ctx) {
    if (!ctx.doc.assets[transcript]) throw new Error(`${transcript}: a transcript asset of the project is expected`);
    const t = await ctx.transcript(transcript);
    const source = sentencesOf(t);
    const list = (lines ?? []).map(String);
    if (list.length !== source.length) throw new Error(`${list.length} sentence(s) given for ${source.length} expected: keep the order and count of what localize handed over`);
    const code = String(lang).trim().slice(0, 8).toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'xx';
    const retimedDoc = retimed(source, list);
    retimedDoc.language = code;
    const path = await ctx.writeFile(`assets/transcripts/${transcript.slice(0, 48)}-${code}.json`, JSON.stringify(retimedDoc));
    const ops = [];
    const assetId = `${transcript.slice(0, 48)}-${code}`.replace(/[^a-z0-9-]/g, '-');
    ops.push({ op: 'add', path: `/assets/${assetId}`, value: { type: 'json', src: path, name: `Transcript · ${lang}` } });
    // the compositions that caption the original are duplicated for the language
    let made = 0;
    for (const [cid, c] of Object.entries(ctx.doc.compositions)) {
      const captions = Object.values(c.layers).filter((l) => l.type === 'captions' && l.props?.transcript === transcript);
      if (!captions.length) continue;
      const copy = JSON.parse(JSON.stringify(c));
      copy.name = `${c.name} · ${lang}`;
      for (const l of Object.values(copy.layers)) if (l.type === 'captions' && l.props?.transcript === transcript) l.props.transcript = assetId;
      const taken = { ...ctx.doc.compositions, ...Object.fromEntries(ops.filter((o) => o.path?.startsWith('/compositions/')).map((o) => [o.path.split('/').pop(), 1])) };
      let nid = `${cid}-${code}`, k = 2;
      while (taken[nid]) nid = `${cid}-${code}-${k++}`;
      ops.push({ op: 'add', path: `/compositions/${nid}`, value: copy });
      made++;
    }
    return {
      ops, label: `${lang} captions`,
      text: made
        ? `The transcript in ${lang} is written (${path}); ${made} composition(s) duplicated with their captions reading it — check one (check, after switching to it): a language that runs longer may need the captions' size one step smaller.`
        : `The transcript in ${lang} is written (${path}); no composition captions "${transcript}" yet — add a captions layer reading the new asset (${assetId}).`,
    };
  },
};

export const meta = { id: 'tramme/localize', name: 'localize', version: '1.0.0', description: 'Captions and shorts in other languages: the model translates, the tools retime and duplicate', api: 1 };
export const tools = [localize, localizeApply];
export const messages = {
  fr: {
    "the target languages, by name (\"French\", \"es\"…)": "les langues cibles, par leur nom (« French », « es »…)",
    "its code or name (\"fr\", \"French\")": "son code ou son nom (« fr », « French »)",
    "one string per sentence, in the order localize gave": "une chaîne par phrase, dans l’ordre donné par localize",
    'Prepare a translation': 'Préparer une traduction', 'Apply a translation': 'Appliquer une traduction',
    'Transcript': 'Transcription', 'Languages': 'Langues', 'Language': 'Langue', 'Translated sentences': 'Phrases traduites',
    'cuts a transcript into numbered sentences for the model to translate: the answer says what to hand back to localize-apply': 'découpe une transcription en phrases numérotées pour que le modèle les traduise : la réponse dit quoi rendre à localize-apply',
    'a translated array of sentences becomes a transcript asset retimed over the original, and the compositions captioning the original are duplicated for the language': 'une liste de phrases traduites devient un actif de transcription recalé sur l\'original, et les compositions qui sous-titrent l\'original sont dupliquées pour la langue',
  },
};
