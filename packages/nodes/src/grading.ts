// Colour grading, as a colourist's tools do it: footage read from its
// camera's log or video curve into scene light, developed (white balance,
// exposure, tones, local contrast, haze, colour), its tones pushed toward
// colours on three wheels, each hue's colour moved, curves over the hues, a
// colour isolated and corrected alone, then mapped back to the screen.
// Each effect is one GLSL pass in floats; a layer's effects in a row pass
// their result to each other in half floats (gpu.ts), so a grade, its HSL,
// its curves and a LUT lose nothing between them. Their 8-bit result is
// dithered: a sky pushed hard stays smooth.

import { GAMUTS, gamutMatrix, glslMat3, SOURCES, type EffectType, type PathValue, type PropSchema } from '@tramme/core';

const W0: [number, number] = [0, 0];
const FLAT: PathValue = { v: [[0, 0.5], [1, 0.5]], closed: false };
const toRec709 = (g: keyof typeof GAMUTS) => glslMat3(gamutMatrix(GAMUTS[g], GAMUTS.rec709));

/** a colour wheel's colour (a vec2 of format 'wheel'): its hue at full saturation, neutral in brightness, times its amount */
export const WHEEL_GLSL = `vec3 wheelTint(vec2 w) {
  float k = min(length(w), 1.0);
  if (k <= 0.0) return vec3(0.0);
  float h = atan(w.y, w.x) / 6.2831853;
  vec3 c = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return (c - dot(c, vec3(0.2126, 0.7152, 0.0722))) * k;
}`;

/** the GLSL every grading effect shares: transfer curves, gamuts, OKLab, the wheels' colour */
export const COLOUR_GLSL = `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow(max((c + 0.055) / 1.055, 0.0), vec3(2.4)), step(0.04045, c)); }
vec3 toScreen(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec4 straight(vec4 p) { return p.a > 0.0 ? vec4(p.rgb / p.a, p.a) : vec4(0.0); }
float legal(float v) { return (64.0 + 876.0 * v) / 1023.0; }
float slog3(float v) { float x = legal(v); return x >= 171.2102946929 / 1023.0 ? pow(10.0, (x * 1023.0 - 420.0) / 261.5) * 0.19 - 0.01 : (x * 1023.0 - 95.0) * 0.01125 / (171.2102946929 - 95.0); }
float vlog(float v) { float x = legal(v); return x < 0.181 ? (x - 0.125) / 5.6 : pow(10.0, (x - 0.598206) / 0.241514) - 0.00873; }
float logc3(float v) { float x = legal(v); return x > 0.149658 ? (pow(10.0, (x - 0.385537) / 0.24719) - 0.052272) / 5.555556 : (x - 0.092809) / 5.367655; }
float applelog(float p) { const float R0 = -0.05641088, c = 47.28711236; return p >= c * (0.01 - R0) * (0.01 - R0) ? exp2((p - 0.69336945) / 0.08550479) - 0.00964052 : p >= 0.0 ? sqrt(p / c) + R0 : R0; }
float clog3(float x) { return 0.9 * (x < 0.04076162 ? -(pow(10.0, (0.07623209 - x) / 0.42889912) - 1.0) / 14.98325 : x <= 0.105357102 ? (x - 0.073059361) / 2.3069815 : (pow(10.0, (x - 0.069886632) / 0.42889912) - 1.0) / 14.98325); }
float hlg(float x) { return (x <= 0.5 ? x * x / 3.0 : (exp((x - 0.55991073) / 0.17883277) + 0.28466892) / 12.0) * 3.7743; }
// the footage's picture (0..1 as written) in scene light, Rec.709 primaries; 0 is the screen's own (sRGB) curve
vec3 sceneLight(vec3 c, int source) {
  if (source == 1) return ${toRec709('sgamut3cine')} * vec3(slog3(c.r), slog3(c.g), slog3(c.b));
  if (source == 2) return ${toRec709('vgamut')} * vec3(vlog(c.r), vlog(c.g), vlog(c.b));
  if (source == 3) return ${toRec709('awg3')} * vec3(logc3(c.r), logc3(c.g), logc3(c.b));
  if (source == 4) return ${toRec709('rec2020')} * vec3(applelog(c.r), applelog(c.g), applelog(c.b));
  if (source == 5) return ${toRec709('cinema')} * vec3(clog3(c.r), clog3(c.g), clog3(c.b));
  if (source == 6) return ${toRec709('rec2020')} * vec3(hlg(c.r), hlg(c.g), hlg(c.b));
  return toLinear(c);
}
// scene light to the screen: a filmic shoulder (highlights roll off instead of clipping, 18 % grey near 0.2)
vec3 filmic(vec3 x) { x = max(x, 0.0) * 0.8; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 oklab(vec3 c) {
  vec3 lms = vec3(dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)), dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)), dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0));
  return vec3(dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)), dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)), dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
}
vec3 fromOklab(vec3 c) {
  vec3 l = vec3(c.x + 0.3963377774 * c.y + 0.2158037573 * c.z, c.x - 0.1055613458 * c.y - 0.0638541728 * c.z, c.x - 0.0894841775 * c.y - 1.2914855480 * c.z);
  l = l * l * l;
  return vec3(dot(l, vec3(4.0767416621, -3.3077115913, 0.2309699292)), dot(l, vec3(-1.2684380046, 2.6097574011, -0.3413193965)), dot(l, vec3(-0.0041960863, -0.7034186147, 1.7076147010)));
}
// lightness, chroma, hue (radians) and back
vec3 lch(vec3 lab) { return vec3(lab.x, length(lab.yz), atan(lab.z, lab.y)); }
vec3 fromLch(vec3 l) { return vec3(l.x, l.y * cos(l.z), l.y * sin(l.z)); }
${WHEEL_GLSL}
float wrapAngle(float a) { return mod(a + 3.14159265, 6.2831853) - 3.14159265; }
// the CIE xy of a daylight / blackbody temperature (Kim et al.)
vec2 kelvin(float T) {
  float t = 1.0 / T;
  float x = T <= 4000.0 ? -0.2661239e9 * t * t * t - 0.2343589e6 * t * t + 0.8776956e3 * t + 0.179910 : -3.0258469e9 * t * t * t + 2.1070379e6 * t * t + 0.2226347e3 * t + 0.240390;
  float y = T <= 2222.0 ? -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683
    : T <= 4000.0 ? -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867
    : 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
  return vec2(x, y);
}
// Bradford cone responses of a white given by xy
vec3 cones(vec2 xy) { vec3 X = vec3(xy.x / xy.y, 1.0, (1.0 - xy.x - xy.y) / xy.y); return mat3(0.8951, -0.7502, 0.0389, 0.2664, 1.7135, -0.0685, -0.1614, 0.0367, 1.0296) * X; }
// the white balance: the light the picture was taken under (warmer or cooler, greener or more magenta than daylight) adapted to daylight, the brightness kept
mat3 whiteBalance(float temperature, float tint) {
  vec2 ref = kelvin(6504.0), src = kelvin(6504.0 * exp2(temperature)) + vec2(0.0, tint * 0.025);
  vec3 g = cones(ref) / cones(src);
  mat3 B = mat3(0.8951, -0.7502, 0.0389, 0.2664, 1.7135, -0.0685, -0.1614, 0.0367, 1.0296);
  mat3 toXYZ = mat3(0.4124, 0.2126, 0.0193, 0.3576, 0.7152, 0.1192, 0.1805, 0.0722, 0.9505);
  mat3 m = inverse(toXYZ) * inverse(B) * mat3(g.x, 0.0, 0.0, 0.0, g.y, 0.0, 0.0, 0.0, g.z) * B * toXYZ;
  return m / dot(m * vec3(1.0), LUMA);
}
`;

const n = (label: string, group: string, extra: Partial<PropSchema[string]> = {}): PropSchema[string] =>
  ({ type: 'number', default: 0, min: -1, max: 1, step: 0.01, label, group, ...extra }) as PropSchema[string];

/**
 * The grade of a clip, as a photo developer and a video colour panel make it:
 * the footage's curve, white balance, exposure and the tones, local contrast
 * and haze, vibrance and saturation, then three colour wheels over the
 * shadows, mid tones and highlights.
 */
export const grade: EffectType = {
  type: 'fx.grade', title: 'Colour grading', category: 'Colour', stage: 'layer',
  description: 'develops a clip as a colourist does: its camera log read, white balance, exposure, highlights and shadows, clarity, haze, vibrance, then colour wheels over the shadows, mid tones and highlights',
  props: {
    source: { type: 'enum', default: 'rec709', options: [...SOURCES], label: 'Footage', group: 'Input', animatable: false, description: "how the clip was recorded: a camera's log is read into scene light and its highlights roll off on screen" },
    temperature: n('Temperature', 'White balance', { description: 'negative cools, positive warms' }),
    tint: n('Tint', 'White balance', { description: 'negative toward green, positive toward magenta' }),
    exposure: n('Exposure', 'Light', { min: -4, max: 4, description: 'in stops: +1 doubles the light' }),
    contrast: n('Contrast', 'Light'),
    highlights: n('Highlights', 'Light', { description: 'the bright parts, negative recovers them' }),
    shadows: n('Shadows', 'Light', { description: 'the dark parts, positive opens them' }),
    whites: n('Whites', 'Light', { description: 'where white sits' }),
    blacks: n('Blacks', 'Light', { description: 'where black sits' }),
    texture: n('Texture', 'Presence', { description: 'fine detail: skin, leaves, fabric' }),
    clarity: n('Clarity', 'Presence', { description: 'local contrast of the mid tones' }),
    dehaze: n('Dehaze', 'Presence', { description: 'takes a veil of haze out (negative adds one)' }),
    vibrance: n('Vibrance', 'Presence', { description: 'saturates the dull colours first and spares the skin' }),
    saturation: n('Saturation', 'Presence'),
    shadowsColor: { type: 'vec2', format: 'wheel', default: W0, label: 'Shadows', group: 'Colour wheels', description: 'the colour the shadows lean toward' },
    shadowsLevel: n('Shadows level', 'Colour wheels'),
    midtonesColor: { type: 'vec2', format: 'wheel', default: W0, label: 'Mid tones', group: 'Colour wheels', description: 'the colour the mid tones lean toward' },
    midtonesLevel: n('Mid tones level', 'Colour wheels'),
    highlightsColor: { type: 'vec2', format: 'wheel', default: W0, label: 'Highlights', group: 'Colour wheels', description: 'the colour the highlights lean toward' },
    highlightsLevel: n('Highlights level', 'Colour wheels'),
    globalColor: { type: 'vec2', format: 'wheel', default: W0, label: 'Global', group: 'Colour wheels', description: 'the colour the whole picture leans toward' },
    balance: n('Balance', 'Colour wheels', { description: 'moves the line between shadows and highlights' }),
    blending: n('Blending', 'Colour wheels', { min: 0, default: 0.5, description: 'how much the three ranges overlap' }),
    fade: n('Fade', 'Finish', { min: 0, description: 'lifts the blacks as a faded print' }),
    strength: n('Strength', 'Finish', { min: 0, default: 1, description: 'the grade mixed with the clip as it was' }),
  },
  gl: {
    dither: true,
    code: `${COLOUR_GLSL}
// stops from mid grey of a picture's brightness
float stopsOf(vec3 c) { return log2(max(dot(c, LUMA), 1e-5) / 0.18); }
vec4 effect(vec2 uv) {
  vec4 p = straight(texture(uImage, uv));
  if (p.a <= 0.0) return vec4(0.0);
  int source = int(u_source + 0.5);
  bool scene = source > 0;
  vec3 c = sceneLight(p.rgb, source);
  float L = stopsOf(c);
  // the neighbourhood, when a tool reads it: brightness averaged over a wide disc (edge-aware, so a bright window does not halo
  // the wall beside it), a small one for texture, and the darkest channel around (the haze's veil)
  float Lwide = L, Lfine = L, dark = min(c.r, min(c.g, c.b));
  bool local = u_clarity != 0.0 || u_texture != 0.0 || u_dehaze != 0.0 || u_highlights != 0.0 || u_shadows != 0.0;
  if (local) {
    float R = 0.03 * min(uRes.x, uRes.y), r = 0.004 * min(uRes.x, uRes.y);
    float sw = 1.0, sf = 1.0, wide = L, fine = L;
    for (int i = 1; i <= 24; i++) {
      float k = sqrt(float(i) / 24.0), a = float(i) * 2.39996323;
      vec2 d = vec2(cos(a), sin(a)) * k;
      vec3 s = sceneLight(straight(texture(uImage, uv + d * R / uRes)).rgb, source);
      float Ls = stopsOf(s), w = exp(-k * k * 2.0) * exp(-(Ls - L) * (Ls - L) / 4.5);
      wide += Ls * w; sw += w;
      dark = min(dark, min(s.r, min(s.g, s.b)));
      if (i <= 8) { float Lt = stopsOf(sceneLight(straight(texture(uImage, uv + d * r / uRes)).rgb, source)); fine += Lt; sf += 1.0; }
    }
    Lwide = wide / sw; Lfine = fine / sf;
  }
  // haze: the veil the darkest channel shows taken out (positive), or a light veil laid over (negative)
  if (u_dehaze > 0.0) { float t = max(1.0 - u_dehaze * 0.9 * clamp(dark, 0.0, 1.0), 0.2); c = (c - (1.0 - t)) / t; }
  else if (u_dehaze < 0.0) c = mix(c, vec3(0.6), -u_dehaze * 0.4);
  // white balance and exposure in scene light
  c = whiteBalance(u_temperature, u_tint) * c * exp2(u_exposure);
  L = stopsOf(c);
  float Lm = mix(L, Lwide + u_exposure, 0.5);
  // the tones, in stops: each range by a smooth mask over the brightness around the pixel; contrast around mid grey
  float d = u_contrast * 0.6 * clamp(L, -7.0, 5.0);
  d += u_blacks * 1.5 * (1.0 - smoothstep(-6.5, -2.5, Lm));
  d += u_shadows * 1.3 * smoothstep(-8.0, -4.0, Lm) * (1.0 - smoothstep(-2.5, 0.5, Lm));
  d += u_highlights * 1.2 * smoothstep(-0.5, 1.5, Lm) * (1.0 - smoothstep(scene ? 4.5 : 2.6, scene ? 6.0 : 4.0, Lm));
  d += u_whites * 1.0 * smoothstep(0.8, 2.47, Lm);
  // local contrast: the pixel against its neighbourhood, the mid tones most
  d += u_clarity * 0.8 * clamp(L - (Lwide + u_exposure), -2.0, 2.0) * (1.0 - smoothstep(1.5, 4.0, abs(L + 0.5)));
  d += u_texture * 1.2 * clamp(L - (Lfine + u_exposure), -1.0, 1.0);
  c *= exp2(d);
  // vibrance (the dull colours first, the skin spared) and saturation, around the brightness
  float Y = dot(c, LUMA), hi = max(c.r, max(c.g, c.b)), lo = min(c.r, min(c.g, c.b));
  float sat = hi > 1e-5 ? (hi - lo) / hi : 0.0;
  vec3 h = lch(oklab(max(c, 0.0)));
  float skin = exp(-pow(wrapAngle(h.z - 0.95) / 0.35, 2.0));
  float v = u_vibrance * (1.0 - sat) * (1.0 - sat) * (u_vibrance > 0.0 ? 1.0 - 0.7 * skin : 1.0);
  c = Y + (c - Y) * max(0.0, (1.0 + v * 1.5) * (1.0 + u_saturation));
  // the colour wheels: shadows, mid tones and highlights by the brightness (black at 0, white at 1), each a colour and a level, in stops
  float b = clamp((stopsOf(c) + 7.0) / 9.47, 0.0, 1.0);
  float w = mix(0.04, 0.3, clamp(u_blending, 0.0, 1.0)), c1 = 0.36 + u_balance * 0.2, c2 = 0.66 + u_balance * 0.2;
  float sh = 1.0 - smoothstep(c1 - w, c1 + w, b), hl = smoothstep(c2 - w, c2 + w, b), md = clamp(1.0 - sh - hl, 0.0, 1.0);
  vec3 tilt = (wheelTint(u_shadowsColor) + vec3(u_shadowsLevel)) * sh + (wheelTint(u_midtonesColor) + vec3(u_midtonesLevel)) * md
    + (wheelTint(u_highlightsColor) + vec3(u_highlightsLevel)) * hl + wheelTint(u_globalColor);
  c *= exp2(tilt * 1.2);
  // to the screen: log footage through a filmic shoulder, video as it is
  vec3 o = toScreen(scene ? filmic(c) : clamp(c, 0.0, 1.0));
  o = o * (1.0 - 0.12 * u_fade) + 0.1 * u_fade;
  o = mix(p.rgb, o, clamp(u_strength, 0.0, 1.0));
  return vec4(clamp(o, 0.0, 1.0) * p.a, p.a);
}`,
  },
};

const BANDS: [string, string, number][] = [
  ['red', 'Reds', 29], ['orange', 'Oranges', 58], ['yellow', 'Yellows', 105], ['green', 'Greens', 142],
  ['aqua', 'Aquas', 195], ['blue', 'Blues', 262], ['purple', 'Purples', 295], ['magenta', 'Magentas', 330],
];

/** eight colours, each its hue moved, its saturation and its brightness, as a photo developer's HSL panel */
export const hsl: EffectType = {
  type: 'fx.hsl', title: 'HSL', category: 'Colour', stage: 'layer',
  description: "each of eight colours (reds, oranges, yellows, greens, aquas, blues, purples, magentas) moved alone: its hue, its saturation, its brightness; the greys stay",
  props: Object.fromEntries(BANDS.flatMap(([id, title]) => [
    [`${id}Hue`, n('Hue', title, { description: 'turns this colour toward its neighbours' })],
    [`${id}Saturation`, n('Saturation', title)],
    [`${id}Luminance`, n('Luminance', title)],
  ])),
  gl: {
    dither: true,
    code: `${COLOUR_GLSL}
const float BANDS[9] = float[9](${[...BANDS.map((b) => b[2]), BANDS[0][2] + 360].map((d) => ((d * Math.PI) / 180).toFixed(5)).join(', ')});
vec4 effect(vec2 uv) {
  vec4 p = straight(texture(uImage, uv));
  if (p.a <= 0.0) return vec4(0.0);
  vec3 l = lch(oklab(toLinear(p.rgb)));
  float hue[8] = float[8](${BANDS.map(([id]) => `u_${id}Hue`).join(', ')});
  float sat[8] = float[8](${BANDS.map(([id]) => `u_${id}Saturation`).join(', ')});
  float lum[8] = float[8](${BANDS.map(([id]) => `u_${id}Luminance`).join(', ')});
  // each colour's share of this hue: a smooth hat from its neighbour's centre to the next one's, the shares adding to one
  float h = mod(l.z - BANDS[0], 6.2831853) + BANDS[0], dh = 0.0, ds = 0.0, dl = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = BANDS[i], b = BANDS[i + 1];
    if (h < a || h > b) continue;
    float t = (h - a) / (b - a), wa = 0.5 + 0.5 * cos(t * 3.14159265), wb = 1.0 - wa;
    int j = (i + 1) % 8;
    dh = hue[i] * wa + hue[j] * wb; ds = sat[i] * wa + sat[j] * wb; dl = lum[i] * wa + lum[j] * wb;
  }
  float chroma = smoothstep(0.0, 0.06, l.y);
  l.z += dh * 0.5 * chroma;
  l.y *= max(0.0, 1.0 + ds);
  l.x *= exp2(dl * 0.8 * chroma);
  vec3 o = toScreen(fromOklab(fromLch(l)));
  return vec4(clamp(o, 0.0, 1.0) * p.a, p.a);
}`,
  },
};

/** curves over the hues and the levels: a hue turned, saturated or brightened alone, the saturation by brightness or by saturation */
export const hueCurves: EffectType = {
  type: 'fx.huecurves', title: 'Hue curves', category: 'Colour', stage: 'layer',
  description: 'curves that move one colour range: hue against hue, hue against saturation, hue against brightness, brightness against saturation, saturation against saturation (0.5 leaves it as it is)',
  props: {
    hueHue: { type: 'path', format: 'hue-curve', default: FLAT, label: 'Hue vs hue', description: 'up turns a hue one way, down the other' },
    hueSaturation: { type: 'path', format: 'hue-curve', default: FLAT, label: 'Hue vs saturation', description: 'up saturates that hue, down greys it' },
    hueLuminance: { type: 'path', format: 'hue-curve', default: FLAT, label: 'Hue vs luminance', description: 'up brightens that hue, down darkens it' },
    luminanceSaturation: { type: 'path', format: 'curve', default: FLAT, label: 'Luminance vs saturation', description: 'the saturation of the shadows (left) to the highlights (right)' },
    saturationSaturation: { type: 'path', format: 'curve', default: FLAT, label: 'Saturation vs saturation', description: 'the saturation of the dull colours (left) to the vivid ones (right)' },
  },
  gl: {
    dither: true,
    code: `${COLOUR_GLSL}
float at(sampler2D curve, float x) { return texture(curve, vec2(clamp(x, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).r; }
vec4 effect(vec2 uv) {
  vec4 p = straight(texture(uImage, uv));
  if (p.a <= 0.0) return vec4(0.0);
  vec3 l = lch(oklab(toLinear(p.rgb)));
  float x = fract(l.z / 6.2831853), chroma = smoothstep(0.0, 0.06, l.y);
  float level = clamp(dot(toScreen(fromOklab(vec3(l.x, 0.0, 0.0))), LUMA), 0.0, 1.0);
  l.z += (at(u_hueHue, x) - 0.5) * 2.0944 * chroma;
  l.y *= 2.0 * at(u_hueSaturation, x) * 2.0 * at(u_luminanceSaturation, level) * 2.0 * at(u_saturationSaturation, l.y / 0.32);
  l.x *= exp2((at(u_hueLuminance, x) - 0.5) * 2.0 * chroma);
  vec3 o = toScreen(fromOklab(fromLch(l)));
  return vec4(clamp(o, 0.0, 1.0) * p.a, p.a);
}`,
  },
};

/**
 * A secondary correction: a colour isolated by its hue, its saturation and
 * its brightness (picked with the dropper), the matte softened, then corrected
 * alone: skin warmed, a sky deepened, a shirt's colour changed.
 */
export const secondary: EffectType = {
  type: 'fx.secondary', title: 'Colour isolation', category: 'Colour', stage: 'layer',
  description: 'isolates a colour (a sky, a skin, a shirt: pick it with the dropper) by its hue, saturation and brightness, and corrects it alone: hue, saturation, exposure, warmth; or everything but it',
  props: {
    color: { type: 'color', default: '#D9906A', label: 'Colour', group: 'Selection', description: 'the colour to isolate: pick it on the picture' },
    hueRange: { type: 'number', default: 25, min: 1, max: 180, step: 1, unit: 'deg', label: 'Hue range', group: 'Selection', description: 'how far around its hue the selection reaches' },
    saturationRange: { type: 'number', default: 0.6, min: 0.01, max: 1, step: 0.01, label: 'Saturation range', group: 'Selection' },
    luminanceRange: { type: 'number', default: 0.6, min: 0.01, max: 1, step: 0.01, label: 'Luminance range', group: 'Selection' },
    softness: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, label: 'Softness', group: 'Selection', description: 'how gently the selection fades at its edges' },
    refine: { type: 'number', default: 2, min: 0, max: 30, step: 0.5, unit: 'px', label: 'Smooth matte', group: 'Selection', description: 'blurs the selection so it does not crawl' },
    invert: { type: 'bool', default: false, label: 'Invert', group: 'Selection', description: 'corrects everything but the colour' },
    view: { type: 'enum', default: 'result', options: ['result', 'matte', 'isolated'], label: 'View', group: 'Selection', animatable: false, description: 'the result, the selection in black and white, or the colour alone over grey' },
    hue: { type: 'number', default: 0, min: -180, max: 180, step: 1, unit: 'deg', label: 'Hue', group: 'Correction' },
    saturation: n('Saturation', 'Correction'),
    exposure: n('Exposure', 'Correction', { min: -3, max: 3, description: 'in stops' }),
    temperature: n('Temperature', 'Correction', { description: 'negative cools, positive warms' }),
    tint: n('Tint', 'Correction', { description: 'negative toward green, positive toward magenta' }),
  },
  gl: {
    dither: true,
    code: `${COLOUR_GLSL}
vec3 keyed;
// how much a colour belongs to the selection, 0 to 1
float selected(vec3 l) {
  float s = 0.05 + clamp(u_softness, 0.0, 1.0);
  float hr = radians(u_hueRange), dh = abs(wrapAngle(l.z - keyed.z));
  float byHue = keyed.y < 0.02 ? 1.0 : 1.0 - smoothstep(hr * (1.0 - s * 0.8), hr * (1.0 + s), dh);
  // greys have no hue to go by: they belong as much as the key's own chroma is low
  byHue = mix(1.0, byHue, smoothstep(0.0, 0.04, l.y));
  float byChroma = 1.0 - smoothstep(u_saturationRange * 0.32 * (1.0 - s * 0.8), u_saturationRange * 0.32 * (1.0 + s), abs(l.y - keyed.y));
  float byLevel = 1.0 - smoothstep(u_luminanceRange * 0.5 * (1.0 - s * 0.8), u_luminanceRange * 0.5 * (1.0 + s), abs(l.x - keyed.x));
  return byHue * byChroma * byLevel;
}
float matteAt(vec2 uv) { vec4 q = straight(texture(uImage, uv)); return q.a > 0.0 ? selected(lch(oklab(toLinear(q.rgb)))) : 0.0; }
vec4 effect(vec2 uv) {
  vec4 p = straight(texture(uImage, uv));
  if (p.a <= 0.0) return vec4(0.0);
  keyed = lch(oklab(toLinear(u_color.rgb)));
  vec3 lin = toLinear(p.rgb), l = lch(oklab(lin));
  float m = selected(l);
  float r = u_refine * uScale;
  if (r > 0.5) {
    float sum = m, ws = 1.0;
    for (int i = 1; i <= 12; i++) {
      float k = sqrt(float(i) / 12.0), a = float(i) * 2.39996323, w = exp(-k * k * 2.0);
      sum += matteAt(uv + vec2(cos(a), sin(a)) * k * r / uRes) * w; ws += w;
    }
    m = sum / ws;
  }
  if (u_invert > 0.5) m = 1.0 - m;
  int view = int(u_view + 0.5);
  if (view == 1) return vec4(vec3(m) * p.a, p.a);
  if (view == 2) { float g = dot(p.rgb, LUMA); return vec4(mix(vec3(g), p.rgb, m) * p.a, p.a); }
  vec3 c = l;
  c.z += radians(u_hue);
  c.y *= max(0.0, 1.0 + u_saturation);
  vec3 o = whiteBalance(u_temperature, u_tint) * fromOklab(fromLch(c)) * exp2(u_exposure);
  o = toScreen(mix(lin, o, m));
  return vec4(clamp(o, 0.0, 1.0) * p.a, p.a);
}`,
  },
};

/**
 * Film: halation (the red glow a bright edge bleeds into the emulsion), a
 * soft bloom, and grain that lives in the mid tones, as the stock shows it.
 */
export const film: EffectType = {
  type: 'fx.film', title: 'Film look', category: 'Colour', stage: 'layer',
  description: 'the look of film: the red glow around bright edges (halation), a soft bloom, and grain that lives in the mid tones and changes every frame',
  props: {
    halation: { type: 'number', default: 0.4, min: 0, max: 2, step: 0.01, label: 'Halation', description: 'the red glow bright edges bleed' },
    bloom: { type: 'number', default: 0.15, min: 0, max: 2, step: 0.01, label: 'Bloom' },
    radius: { type: 'number', default: 18, min: 1, max: 80, step: 0.5, unit: 'px', label: 'Radius' },
    threshold: { type: 'number', default: 0.7, min: 0, max: 1, step: 0.01, label: 'Threshold', description: 'how bright a part must be to glow' },
    grain: { type: 'number', default: 0.35, min: 0, max: 2, step: 0.01, label: 'Grain' },
    grainSize: { type: 'number', default: 1.5, min: 0.5, max: 6, step: 0.1, unit: 'px', label: 'Grain size' },
  },
  gl: {
    dither: true,
    code: `${COLOUR_GLSL}
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
vec4 effect(vec2 uv) {
  vec4 p = straight(texture(uImage, uv));
  if (p.a <= 0.0) return vec4(0.0);
  vec3 lin = toLinear(p.rgb);
  // the bright parts around, gathered on a disc
  vec3 glow = vec3(0.0); float ws = 0.0;
  float R = u_radius * uScale, th = toLinear(vec3(u_threshold)).r;
  for (int i = 1; i <= 32; i++) {
    float k = sqrt(float(i) / 32.0), a = float(i) * 2.39996323, w = exp(-k * k * 3.0);
    vec4 s = straight(texture(uImage, uv + vec2(cos(a), sin(a)) * k * R / uRes));
    vec3 sl = toLinear(s.rgb) * s.a;
    glow += max(sl - th, 0.0) / max(1.0 - th, 0.05) * w; ws += w;
  }
  glow /= ws;
  float g = dot(glow, LUMA);
  lin += vec3(1.0, 0.25, 0.08) * g * u_halation + glow * u_bloom;
  // grain: strongest in the mid tones, a new pattern each frame
  float frame = floor(uTime * 24.0);
  vec2 q = uv * uRes / max(u_grainSize * uScale, 0.5);
  float gr = noise(q + frame * 17.31) + noise(q * 2.1 - frame * 9.7) * 0.5 - 0.75;
  float Y = dot(toScreen(lin), LUMA);
  vec3 o = toScreen(lin) + gr * u_grain * 0.12 * (1.0 - abs(2.0 * Y - 1.0));
  return vec4(clamp(o, 0.0, 1.0) * p.a, p.a);
}`,
  },
};

/** a vignette on the layer's picture: its edges darkened (or lightened), round or following the frame */
export const vignette: EffectType = {
  type: 'fx.vignette', title: 'Vignette', category: 'Colour', stage: 'layer',
  description: "darkens the edges of the clip's picture to bring the eye to the centre (negative lightens them)",
  props: {
    amount: { type: 'number', default: 0.35, min: -1, max: 1, step: 0.01, label: 'Amount' },
    midpoint: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, label: 'Midpoint', description: 'how far in it starts' },
    roundness: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, label: 'Roundness', description: '0 follows the frame, 1 is a circle' },
    feather: { type: 'number', default: 0.5, min: 0.01, max: 1, step: 0.01, label: 'Feather' },
  },
  gl: {
    dither: true,
    code: `${COLOUR_GLSL}
vec4 effect(vec2 uv) {
  vec4 p = straight(texture(uImage, uv));
  if (p.a <= 0.0) return vec4(0.0);
  vec2 d = (uv - 0.5) * 2.0;
  float aspect = uRes.x / uRes.y;
  d.x *= mix(1.0, aspect, u_roundness);
  float r = length(d) / mix(1.0, aspect, u_roundness * 0.5);
  float start = mix(1.3, 0.1, u_midpoint);
  float v = smoothstep(start, start + u_feather * 1.2, r);
  vec3 lin = toLinear(p.rgb);
  lin = u_amount >= 0.0 ? lin * (1.0 - v * u_amount) : mix(lin, vec3(1.0), v * -u_amount);
  return vec4(clamp(toScreen(lin), 0.0, 1.0) * p.a, p.a);
}`,
  },
};

export const GRADING = [grade, hsl, hueCurves, secondary, film, vignette];
