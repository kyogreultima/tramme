import { describe, expect, it } from 'vitest';
import { applyOps, type Composition, type TrammeDoc } from '@tramme/core';
import { fixOps, presetIssues, PUBLISH_PRESETS, type PublishPreset } from '../src/publish.ts';

const comp = (over: Partial<Composition> = {}): Composition => ({ name: 'Film', width: 1920, height: 1080, fps: 30, duration: 30, background: null, layers: {}, order: [], ...over });
const preset = (id: string) => PUBLISH_PRESETS.find((p) => p.id === id) as PublishPreset;
const codes = (c: Composition, id: string) => presetIssues(c, preset(id)).map((i) => i.code);
const doc = (c: Composition) => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main', compositions: { main: c } }) as TrammeDoc;

describe('the presets of a publication', () => {
  it('are named, one each for a vertical short, a square, a landscape film, a 4K master and a GIF', () => {
    expect(PUBLISH_PRESETS.map((p) => p.id)).toEqual(['short', 'square', 'landscape', 'master', 'gif']);
    expect(preset('short')).toMatchObject({ width: 1080, height: 1920, format: 'mp4', maxSeconds: 60 });
  });
});

describe('what stands between a film and a preset', () => {
  it('nothing, for a landscape film at the landscape preset', () => {
    expect(codes(comp({ sound: { loudness: -14 } }), 'landscape')).toEqual([]);
  });

  it('flags a 90 s film for a 60 s preset, the film cut to the limit as the fix', () => {
    const issues = presetIssues(comp({ width: 1080, height: 1920, duration: 90, sound: { loudness: -14 } }), preset('short'));
    expect(issues).toEqual([{ code: 'long', fix: 'trim', params: { seconds: 90, max: 60 } }]);
    const c = applyOps(doc(comp({ duration: 90 })), fixOps(comp({ duration: 90 }), 'main', preset('short'), 'trim')).doc.compositions.main;
    expect(c.duration).toBe(60);
  });

  it('reports an aspect mismatch, the vertical version by the assistant as the fix for a landscape film', () => {
    const issues = presetIssues(comp({ sound: { loudness: -14 } }), preset('short'));
    expect(issues.find((i) => i.code === 'aspect')).toEqual({ code: 'aspect', fix: 'vertical', params: { from: '16:9', to: '9:16' } });
  });

  it('an aspect mismatch of another kind is fixed by the size of the preset', () => {
    const issue = presetIssues(comp({ width: 1080, height: 1920, sound: { loudness: -14 } }), preset('landscape')).find((i) => i.code === 'aspect');
    expect(issue?.fix).toBe('size');
    const c = applyOps(doc(comp({ width: 1080, height: 1920 })), fixOps(comp({ width: 1080, height: 1920 }), 'main', preset('landscape'), 'size')).doc.compositions.main;
    expect([c.width, c.height]).toEqual([1920, 1080]);
  });

  it('reports a size that is not the preset\'s with the same proportions, and a frame rate', () => {
    expect(presetIssues(comp({ width: 1280, height: 720, fps: 24, sound: { loudness: -14 } }), preset('landscape')).map((i) => [i.code, i.fix])).toEqual([['size', 'size'], ['fps', 'fps']]);
  });

  it('reports a loudness other than the preset\'s, the target set as the fix', () => {
    const c = comp({ sound: { loudness: -23 } }), issues = presetIssues(c, preset('landscape'));
    expect(issues).toEqual([{ code: 'loudness', fix: 'loudness', params: { from: -23, to: -14 } }]);
    expect(applyOps(doc(c), fixOps(c, 'main', preset('landscape'), 'loudness')).doc.compositions.main.sound!.loudness).toBe(-14);
    expect(codes(comp(), 'landscape')).toContain('loudness');
  });

  it('all the fixes at once make a film that meets the preset', () => {
    let c = comp({ duration: 90 });
    for (const issue of presetIssues(c, preset('square'))) if (issue.fix && issue.fix !== 'vertical') c = applyOps(doc(c), fixOps(c, 'main', preset('square'), issue.fix)).doc.compositions.main;
    expect(presetIssues(c, preset('square'))).toEqual([]);
  });
});
