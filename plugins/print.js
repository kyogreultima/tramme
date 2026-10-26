// Print looks, as GLSL finishes and layer effects, computed on display
// values (converted from linear light inside the pass): halftone dots at an
// angle, two inks a little off register with paper grain, film grain, and a
// duotone. The presets stack them: risograph, newsprint, two-tone.

const srgb = `
  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
  vec3 toDisplay(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
  float phash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float pnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(phash(i), phash(i + vec2(1.0, 0.0)), u.x), mix(phash(i + vec2(0.0, 1.0)), phash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const halftone = {
  type: 'print.halftone', title: 'Halftone', category: 'Print',
  description: 'the picture as dots of ink, their size the darkness they stand for, at an angle like a press',
  stage: 'finish',
  ai: { when: 'a print look over a whole film or one scene: newsprint, a comic, a poster; the cell sets how coarse it reads, the angle the rosette it makes with the plate beside it', avoid: 'a cell under 3 px (the dots vanish and it reads as noise), a halftone over text (it eats the stems), two halftones fighting over one frame' },
  props: {
    cell: { type: 'number', default: 7, min: 1, max: 40, step: 0.5, unit: 'px', label: 'Cell' },
    angle: { type: 'number', default: 45, min: 0, max: 90, unit: '°', label: 'Angle' },
    ink: { type: 'color', default: '#101010', label: 'Ink' },
    strength: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'Strength' },
  },
  gl: {
    code: srgb + `
      vec4 effect(vec2 uv) {
        vec4 c = texture(uImage, uv);
        vec3 d = c.rgb / max(c.a, 1e-4); // linear
        float lum = sqrt(dot(d, vec3(0.2126, 0.7152, 0.0722))); // perceived
        float a = radians(u_angle);
        float cell = u_cell * uScale;
        // the frame in pixels, turned into the screen's grid
        vec2 px = uv * uRes;
        vec2 rot = vec2(px.x * cos(a) + px.y * sin(a), -px.x * sin(a) + px.y * cos(a));
        vec2 nearest = (floor(rot / cell) + 0.5) * cell;
        vec2 centre = vec2(nearest.x * cos(a) - nearest.y * sin(a), nearest.x * sin(a) + nearest.y * cos(a));
        float dist = length(px - centre) / (cell * 0.5);
        // the ink coverage asks a dot of this radius: the AM screen
        float want = 1.0 - lum;
        float r = sqrt(want * 1.6);
        vec3 ink = u_ink.rgb / max(u_ink.a, 1e-4); ink *= ink;
        vec3 paper = vec3(0.96) * vec3(0.96);
        vec3 printed = mix(paper, ink, step(dist, r * 1.414));
        vec3 outc = mix(d, printed, clamp(u_strength, 0.0, 1.0));
        return vec4(outc * c.a, c.a);
      }
    `,
  },
};

const riso = {
  type: 'print.riso', title: 'Riso', category: 'Print',
  description: 'two inks (A and B, the tokens welcome), each a little off register, over paper grain — the risograph look',
  stage: 'finish',
  ai: { when: 'a whole film or title card as a risograph: two honest inks over paper, the misregister doing the charm; pick inks that overlap into a third colour (blue and pink into purple)', avoid: 'more than two inks (it stops being riso), inks too close in colour (the misregister reads as blur), over busy footage (the grain fights it)' },
  props: {
    inkA: { type: 'color', default: '@accent', label: 'Ink A' },
    inkB: { type: 'color', default: '#F25022', label: 'Ink B' },
    misregister: { type: 'number', default: 3, min: 0, max: 20, step: 0.5, unit: 'px', label: 'Misregister' },
    grain: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.02, label: 'Grain' },
    strength: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'Strength' },
  },
  gl: {
    code: srgb + `
      vec4 effect(vec2 uv) {
        vec4 c = texture(uImage, uv);
        vec3 d = c.rgb / max(c.a, 1e-4); // linear
        vec2 off = u_misregister * uScale / uRes;
        vec3 i0 = u_inkA.rgb / max(u_inkA.a, 1e-4); i0 *= i0;
        vec3 i1 = u_inkB.rgb / max(u_inkB.a, 1e-4); i1 *= i1;
        // each ink's coverage sampled a little apart: the misregister
        float l0 = sqrt(dot(texture(uImage, uv + off).rgb, vec3(0.2126, 0.7152, 0.0722)));
        float l1 = sqrt(dot(texture(uImage, uv - off).rgb, vec3(0.2126, 0.7152, 0.0722)));
        // the ink multiplies into the paper where it covers
        vec3 paper = vec3(0.965, 0.955, 0.94) * vec3(0.965, 0.955, 0.94);
        vec3 printed = paper * mix(vec3(1.0), i0, clamp(1.0 - l0, 0.0, 1.0)) * mix(vec3(1.0), i1, clamp(1.0 - l1, 0.0, 1.0) * 0.92);
        // the paper grain, in the fibres
        float g = (pnoise(uv * uRes / (2.0 * uScale)) - 0.5) * u_grain * 0.14;
        printed += g;
        vec3 outc = mix(d, printed, clamp(u_strength, 0.0, 1.0));
        return vec4(outc * c.a, c.a);
      }
    `,
  },
};

const grain = {
  type: 'print.grain', title: 'Grain', category: 'Print',
  description: 'film grain over the picture, luma-sized: brighter places carry bigger grains',
  stage: 'finish',
  ai: { when: 'a texture over flat generated pictures (backgrounds, gradients) so they stop looking synthetic; on a whole film for the sense of one negative', avoid: 'an amount over 0.5 (noise, not grain), grain over crisp type (it shivers), a grain size that beats the picture\'s detail' },
  props: {
    amount: { type: 'number', default: 0.22, min: 0, max: 1, step: 0.02, label: 'Amount' },
    size: { type: 'number', default: 1.6, min: 0.5, max: 6, step: 0.1, unit: 'px', label: 'Size' },
  },
  gl: {
    code: srgb + `
      vec4 effect(vec2 uv) {
        vec4 c = texture(uImage, uv);
        vec3 d = c.rgb / max(c.a, 1e-4); // linear
        vec2 px = uv * uRes / max(0.5, u_size * uScale);
        float n = (pnoise(px) + pnoise(px + 13.7) - 1.0);
        // brighter places carry bigger grains
        float lum = sqrt(dot(d, vec3(0.2126, 0.7152, 0.0722)));
        vec3 outc = d + n * u_amount * (0.008 + 0.02 * lum);
        return vec4(outc * c.a, c.a);
      }
    `,
  },
};

const duotone = {
  type: 'print.duotone', title: 'Duotone', category: 'Print',
  description: 'the picture\'s light laid between two colours of the tokens: shadows in one, highlights in the other',
  stage: 'finish',
  ai: { when: 'a still, a cover, a title card carrying the brand\'s two colours; the picture keeps its shape and takes the palette', avoid: 'a duotone mid-film without a reason (it flattens the world), colours too close (it reads as a mis-developed photo), over footage nobody colour-graded first' },
  props: {
    dark: { type: 'color', default: '#101B2D', label: 'Shadows' },
    light: { type: 'color', default: '#F2E9DC', label: 'Highlights' },
    strength: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'Strength' },
  },
  gl: {
    code: srgb + `
      vec4 effect(vec2 uv) {
        vec4 c = texture(uImage, uv);
        vec3 d = c.rgb / max(c.a, 1e-4); // linear, unpremultiplied
        float lum = dot(d, vec3(0.2126, 0.7152, 0.0722));
        // the colours arrive as sRGB hex: to linear, like the frame under them
        vec3 dk = u_dark.rgb / max(u_dark.a, 1e-4); dk *= dk;
        vec3 lt = u_light.rgb / max(u_light.a, 1e-4); lt *= lt;
        vec3 toned = mix(dk, lt, smoothstep(0.0, 1.0, sqrt(lum)));
        vec3 outc = mix(d, toned, clamp(u_strength, 0.0, 1.0));
        return vec4(outc * c.a, c.a);
      }
    `,
  },
};

export const meta = { id: 'tramme/print', name: 'print', version: '1.0.0', description: 'Print looks: halftone, riso inks, grain and duotone — as GLSL passes and stacked presets', api: 1 };
export const effects = [halftone, riso, grain, duotone];
export const presets = [
  { name: 'risograph', title: 'Risograph', category: 'Print', description: 'two inks a little off register, over paper grain', effects: [{ type: 'print.riso', props: { inkA: '@accent', inkB: '#F25022', misregister: 3, grain: 0.35 } }] },
  { name: 'newsprint', title: 'Newsprint', category: 'Print', description: 'one black ink as halftone dots at 45°', effects: [{ type: 'print.halftone', props: { cell: 6, angle: 45, ink: '#14100C' } }, { type: 'print.grain', props: { amount: 0.16, size: 1 } }] },
  { name: 'two-tone', title: 'Two-tone', category: 'Print', description: 'the picture between two brand colours, with a whisper of grain', effects: [{ type: 'print.duotone', props: { dark: '#101B2D', light: '#F2E9DC' } }, { type: 'print.grain', props: { amount: 0.1, size: 1.4 } }] },
];
export const messages = {
  fr: {
    'Halftone': 'Trame', 'Riso': 'Riso', 'Grain': 'Grain', 'Duotone': 'Duoton', 'Risograph': 'Risographie', 'Newsprint': 'Papier journal', 'Two-tone': 'Deux tons',
    'Cell': 'Cellule', 'Angle': 'Angle', 'Ink': 'Encre', 'Strength': 'Force', 'Ink A': 'Encre A', 'Ink B': 'Encre B', 'Misregister': 'Mauvais repérage', 'Amount': 'Quantité',
    'Size': 'Taille', 'Shadows': 'Ombres', 'Highlights': 'Lumières',
    'the picture as dots of ink, their size the darkness they stand for, at an angle like a press': 'l’image en points d’encre, leur taille étant l’obscurité qu’ils remplacent, sous un angle comme une presse',
    'two inks (A and B, the tokens welcome), each a little off register, over paper grain — the risograph look': 'deux encres des tokens, chacune un peu à côté, sur du grain de papier — le look risographe',
    'film grain over the picture, luma-sized: brighter places carry bigger grains': 'du grain de film sur l’image, taillé à la luminance : les zones claires portent des grains plus gros',
    'the picture\'s light laid between two colours of the tokens: shadows in one, highlights in the other': 'la lumière de l’image étalée entre deux couleurs des tokens : les ombres dans l’une, les lumières dans l’autre',
    'a print look over a whole film or one scene: newsprint, a comic, a poster; the cell sets how coarse it reads, the angle the rosette it makes with the plate beside it': 'un look d’impression sur un film entier ou une scène : papier journal, bd, affiche ; la cellule dit le grain de lecture, l’angle la rosette qu’elle fait avec la plaque à côté',
    'a cell under 3 px (the dots vanish and it reads as noise), a halftone over text (it eats the stems), two halftones fighting over one frame': 'une cellule sous 3 px (les points disparaissent, cela se lit comme du bruit), une trame sur du texte (elle mange les déliés), deux trames qui se battent sur une image',
    'a whole film or title card as a risograph: two honest inks over paper, the misregister doing the charm; pick inks that overlap into a third colour (blue and pink into purple)': 'un film entier ou une carte-titre en risographe : deux encres honnêtes sur du papier, le mauvais repérage faisant le charme ; choisissez des encres qui se chevauchent en une troisième couleur (bleu et rose en violet)',
    'more than two inks (it stops being riso), inks too close in colour (the misregister reads as blur), over busy footage (the grain fights it)': 'plus de deux encres (ce n’est plus du riso), des encres trop proches en couleur (le mauvais repérage se lit comme du flou), sur des rushes chargés (le grain se bat)',
    'a texture over flat generated pictures (backgrounds, gradients) so they stop looking synthetic; on a whole film for the sense of one negative': 'une texture sur des images générées plates (fonds, dégradés) pour qu’elles arrêtent d’avoir l’air synthétiques ; sur un film entier pour le sentiment d’un même négatif',
    'an amount over 0.5 (noise, not grain), grain over crisp type (it shivers), a grain size that beats the picture\'s detail': 'une quantité au-delà de 0,5 (du bruit, pas du grain), du grain sur du texte net (il frissonne), une taille de grain qui domine le détail de l’image',
    'a still, a cover, a title card carrying the brand\'s two colours; the picture keeps its shape and takes the palette': 'un still, une pochette, une carte-titre qui porte les deux couleurs de la marque ; l’image garde sa forme et prend la palette',
    'a duotone mid-film without a reason (it flattens the world), colours too close (it reads as a mis-developed photo), over footage nobody colour-graded first': 'un duoton au milieu d’un film sans raison (ça aplatit le monde), des couleurs trop proches (ça se lit comme une photo mal développée), sur des rushes que personne n’a étalonnés',
    'two inks a little off register, over paper grain': 'deux encres un peu à côté, sur du grain de papier',
    'one black ink as halftone dots at 45°': 'une encre noire en points de trame à 45°',
    'the picture between two brand colours, with a whisper of grain': 'l’image entre deux couleurs de marque, avec un souffle de grain',
  },
};
