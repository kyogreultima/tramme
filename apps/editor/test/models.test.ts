import { describe, expect, it } from 'vitest';
import { cachePrefix, defaultModel, HUB_PREFIX, isHubId, madeBy, MODEL_TASKS, MODELS, modelsFor, resolveModel } from '../src/models.ts';

describe('the models of the editor', () => {
  it('have a default per task, the one each tool ran before the settings', () => {
    expect(MODEL_TASKS.map((t) => defaultModel(t).id)).toEqual(['u2net-human-seg', 'u2netp', 'yolos-tiny', 'depth-anything-v2-small', 'whisper-small', 'silero-vad', 'face-landmarker']);
    // the voice detector and the face landmarker could not be fetched where they were written: tried on a device first (docs/roadmap-loop/to-validate.md); its tool falls back on the energy of the sound
    for (const t of MODEL_TASKS) if (t !== 'vad' && t !== 'face') expect(defaultModel(t).checked, t).toBe(true);
  });

  it('only offer defaults a commercial project may use', () => {
    for (const t of MODEL_TASKS) expect(defaultModel(t).commercial, t).toBe(true);
    // the others say when they may not
    expect(MODELS.find((m) => m.id === 'depth-anything-v2-base')?.commercial).toBe(false);
  });

  it('are known by a unique id, each with the adapter of its task', () => {
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
    for (const m of modelsFor('cutout-any')) expect(m.adapter.kind).toBe('matte');
    for (const m of modelsFor('depth')) expect(m.adapter).toMatchObject({ kind: 'pipeline', pipeline: 'depth-estimation' });
  });

  it('read a choice: a known model, a model hub id for a pipeline task, the default otherwise', () => {
    expect(resolveModel('depth', 'depth-anything-small').id).toBe('depth-anything-small');
    expect(resolveModel('depth', undefined).id).toBe('depth-anything-v2-small');
    expect(resolveModel('depth', 'whisper-small').id).toBe('depth-anything-v2-small');
    const hub = resolveModel('detection', `${HUB_PREFIX}someone/detr-tiny`);
    expect(hub).toMatchObject({ source: 'someone/detr-tiny', commercial: null, checked: false, adapter: { pipeline: 'object-detection' } });
    // a matte needs its adapter: no hub id there
    expect(resolveModel('cutout-any', `${HUB_PREFIX}someone/matte`).id).toBe('u2netp');
    expect(resolveModel('detection', `${HUB_PREFIX}not an id`).id).toBe('yolos-tiny');
  });

  it('tell a model hub id', () => {
    expect(isHubId('Xenova/whisper-tiny')).toBe(true);
    expect(isHubId('onnx-community/depth-anything-v2-small')).toBe(true);
    expect(isHubId('whisper')).toBe(false);
    expect(isHubId('a/b/c')).toBe(false);
    expect(isHubId('https://x/y')).toBe(false);
  });

  it('name what made an asset, model and version', () => {
    expect(madeBy(defaultModel('cutout-person'))).toBe('u2net-human-seg@f5c523ea3d391bf2f366ba98a84b280b6bd23c61');
    expect(madeBy(defaultModel('depth'))).toBe('depth-anything-v2-small@main');
  });

  it('know where their files are kept in the cache', () => {
    expect(cachePrefix(defaultModel('cutout-any'))).toMatch(/^https:\/\/huggingface\.co\/BritishWerewolf\/U-2-Netp\/resolve\//);
    expect(cachePrefix(defaultModel('detection'))).toBe('https://huggingface.co/Xenova/yolos-tiny/resolve/');
  });
});
