// How a layer sounds, the same on audio layers and on the sound of videos:
// its gain (animated for fades and ducking), fades, filters and reverb. Read
// by audioClips (@tramme/core) and mixed by the one mixer of @tramme/render.

import type { PropSchema } from '@tramme/core';

const group = 'Sound';

export const SOUND_PROPS: PropSchema = {
  gain: { type: 'number', default: 0, step: 0.5, unit: 'dB', label: 'Volume', group, description: 'animate it for a fade or to duck the sound under a voice' },
  fadeIn: { type: 'number', default: 0, min: 0, step: 0.05, unit: 's', label: 'Fade in', group, animatable: false },
  fadeOut: { type: 'number', default: 0, min: 0, step: 0.05, unit: 's', label: 'Fade out', group, animatable: false },
  lowCut: { type: 'number', default: 0, min: 0, max: 20000, step: 10, label: 'Low cut', group, description: 'Hz: removes the sound under it (rumble, a thinner sound); 0 for none; animate it to thin a music out before a hit (a build)' },
  highCut: { type: 'number', default: 0, min: 0, max: 20000, step: 100, label: 'High cut', group, animatable: false, description: 'Hz: removes the sound over it (muffled, far away); 0 for none' },
  eqLow: { type: 'number', default: 0, min: -24, max: 12, step: 0.5, unit: 'dB', label: 'Low', group, animatable: false, description: 'warms the bass, or thins it out (a voice\'s rumble lives there); 0 leaves it as recorded' },
  eqMid: { type: 'number', default: 0, min: -24, max: 12, step: 0.5, unit: 'dB', label: 'Mid', group, animatable: false, description: 'pushes or dips the ear\'s band around the mid frequency: presence, or a nasality tamed' },
  eqMidFreq: { type: 'number', default: 1000, min: 200, max: 8000, step: 50, label: 'Mid at', group, animatable: false, description: 'Hz: where the mid bell acts' },
  eqHigh: { type: 'number', default: 0, min: -24, max: 12, step: 0.5, unit: 'dB', label: 'High', group, animatable: false, description: 'air and brightness over, or the hiss tamed under; 0 leaves it as recorded' },
  compress: { type: 'number', default: 0, min: 0, max: 1, step: 0.05, label: 'Compress', group, animatable: false, description: 'how hard the loud moments are brought down (a voice kept level, a hero that never jumps out): 0 leaves the dynamics as recorded, 1 is radio-announcer tight' },
  reverb: { type: 'number', default: 0, min: 0, max: 1, step: 0.05, label: 'Reverb', group, animatable: false, description: 'share of room sound, 0 (dry) to 1' },
  voice: { type: 'enum', default: 'none', options: ['none', 'pitch', 'robot', 'telephone', 'radio', 'megaphone', 'echo'], label: 'Voice', group, animatable: false, description: 'an effect on the sound: its pitch moved (semitones), a robot, a telephone, a radio, a megaphone, an echo' },
  semitones: { type: 'number', default: 0, min: -12, max: 12, step: 0.5, label: 'Semitones', group, animatable: false, description: 'the pitch moved, its length kept (the pitch voice)' },
  clean: { type: 'number', default: 0, min: 0, max: 1, step: 0.05, label: 'Clean voice', group, animatable: false, description: 'how much of the voice cleaned by the denoise tool plays instead of the recorded one: 0 the original, 1 all cleaned (a voice sounds dead there), 0.8 to 0.9 keeps it alive' },
};

/** an audio layer's place in the mix: its bus, its weight, what it underlines in the picture (the sound checks read them) */
export const MIX_PROPS: PropSchema = {
  role: { type: 'enum', default: 'effect', options: ['effect', 'music', 'voice', 'ambience'], label: 'Role', group, animatable: false, description: 'effects share the room of the composition; music and ambience are the bed under the voice' },
  weight: { type: 'enum', default: 'support', options: ['support', 'hero'], label: 'Weight', group, animatable: false, description: 'hero: one of the few moments the film is built around (a logo, a reveal), louder over the bed; support: the others' },
  visual: { type: 'enum', default: 'none', options: ['none', 'cut', 'move', 'land', 'appear'], label: 'Underlines', group, animatable: false, description: 'what it marks in the picture: a cut, a move at its fastest, a landing, an appearance (the checks look for it there)' },
};

/** an audio layer's own: its playback speed, the pitch with it */
export const RATE_PROP: PropSchema = {
  keepPitch: { type: 'bool', default: false, label: 'Keep the pitch', group, animatable: false, description: 'at another speed (or along a speed curve), the voice keeps its pitch' },
  rate: { type: 'number', default: 1, min: -4, max: 4, step: 0.05, unit: 'x', label: 'Speed', group, integral: 'rateElapsed', description: 'playback speed, the pitch with it: under 1 lower and longer, over 1 higher and shorter; 0 holds the frame, under 0 plays backwards. Animated, it ramps (a speed curve): the file runs at the integral of the speed' },
};
