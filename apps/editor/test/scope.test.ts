// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Op, TrammeDoc } from '@tramme/core';

await import('../src/ai/index.ts'); // first: the engine and the runner import each other
const { outOfScope, ToolRunner } = await import('../src/ai/tools.ts');
const { S, load } = await import('../src/state.ts');
const { newProject } = await import('@tramme/project');

const SCOPE = { comp: 'price', root: 'main', tokens: [] as string[] };
function film() {
  const project = newProject({ name: 'T', width: 640, height: 360, fps: 30, duration: 10 });
  const doc = project.doc as TrammeDoc;
  doc.compositions.price = { name: 'Price', width: 640, height: 360, fps: 30, duration: 4, layers: {}, order: [] } as never;
  doc.compositions.intro = { name: 'Intro', width: 640, height: 360, fps: 30, duration: 4, layers: {}, order: [] } as never;
  doc.assets.brief = { type: 'json', src: 'assets/brief.json' } as never;
  doc.assets['film-plan'] = { type: 'json', src: 'assets/film-plan.json' } as never;
  doc.tokens.accent = { type: 'color', value: '#fff' };
  return { doc, project };
}
const why = (op: Op) => outOfScope(op, SCOPE, film().doc);

describe('what a scene builder may change', () => {
  it('shows the rejection reason before a plugin claims its changes succeeded', async () => {
    const { doc, project } = film();
    load(doc, project.manifest, 'http://localhost/api/projects/p/files/document.tramme.json', '');
    S.registry.peek().use({ tools: [{
      name: 'rejected-device', description: 'Regression fixture',
      run: async () => ({ text: 'Device built successfully. ' + 'Details. '.repeat(40), ops: [{ op: 'replace', path: '/compositions/main/order', value: [] }] }),
    }] }, 'test');
    const runner = new ToolRunner();
    runner.scope = SCOPE;
    const out = await runner.run('use_tool', { name: 'rejected-device', input: {} });
    expect(out.isError).toBe(true);
    expect(out.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/^operation refused/) });
    expect(runner.pending).toBeNull();
    runner.dispose();
  });

  it('its own composition and its takes, with all that is under them', () => {
    expect(why({ op: 'add', path: '/compositions/price/layers/title', value: {} })).toBeNull();
    expect(why({ op: 'add', path: '/compositions/price~0take2', value: {} })).toBeNull();
    expect(why({ op: 'replace', path: '/compositions/price/markers', value: [] })).toBeNull();
  });

  it('nothing in another composition, and nothing in the root', () => {
    expect(why({ op: 'replace', path: '/compositions/main/order', value: [] })).toMatch(/main/);
    expect(why({ op: 'add', path: '/compositions/intro/layers/x', value: {} })).toMatch(/intro/);
    expect(why({ op: 'remove', path: '/compositions' })).not.toBeNull();
  });

  it('new assets and tokens, never an existing one, and the plan\'s record', () => {
    expect(why({ op: 'add', path: '/tokens/accent2', value: {} })).toBeNull();
    expect(why({ op: 'add', path: '/assets/pic', value: {} })).toBeNull();
    expect(why({ op: 'replace', path: '/tokens/accent', value: {} })).toMatch(/accent/);
    expect(why({ op: 'remove', path: '/assets/brief' })).toMatch(/brief/);
    expect(why({ op: 'replace', path: '/assets/film-plan', value: {} })).toBeNull();
  });

  it('a plugin added, and nothing else of the document', () => {
    expect(why({ op: 'add', path: '/plugins/-', value: 'x' })).toBeNull();
    expect(why({ op: 'replace', path: '/root', value: 'price' })).not.toBeNull();
  });

  it('a runner with a scope refuses a proposal holding one refused operation, and applies none', async () => {
    const { doc, project } = film();
    load(doc, project.manifest, 'http://localhost/api/projects/test/files/document.json', '');
    const runner = new ToolRunner();
    runner.scope = SCOPE;
    const ops = [
      { op: 'add', path: '/compositions/price/layers/a', value: { type: 'shape.rect' } },
      { op: 'replace', path: '/compositions/main/order', value: [] },
      { op: 'add', path: '/compositions/price/order/-', value: 'a' },
    ];
    const out = await runner.run('propose_changes', { label: 'x', ops });
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out.content)).toContain('main');
    expect(runner.pending).toBeNull();
    // no scope: as today
    runner.scope = null;
    const ok = await runner.run('propose_changes', { label: 'x', ops: [ops[0], ops[2]] });
    expect(ok.isError, JSON.stringify(ok.content)).toBeFalsy();
    expect(S.doc.peek().compositions.price).toBeTruthy();
  });

  it("a scene builder's discard drops its own changes only: the director's root and the scenes built before stay proposed", async () => {
    const { doc, project } = film();
    load(doc, project.manifest, 'http://localhost/api/projects/test/files/document.json', '');
    const runner = new ToolRunner();
    // the director lays the root (changes not applied yet: they wait in the proposal), and an earlier scene is built
    const root = await runner.run('propose_changes', { label: 'root', ops: [{ op: 'add', path: '/compositions/main/layers/s1', value: { type: 'comp', props: { comp: 'price' } } }, { op: 'add', path: '/compositions/main/order/-', value: 's1' }] });
    expect(root.isError, JSON.stringify(root.content)).toBeFalsy();
    runner.scope = { comp: 'intro', root: 'main', tokens: [] };
    await runner.run('propose_changes', { label: 'intro', ops: [{ op: 'add', path: '/compositions/intro/layers/a', value: { type: 'shape.rect' } }, { op: 'add', path: '/compositions/intro/order/-', value: 'a' }] });
    runner.scope = SCOPE;
    await runner.run('propose_changes', { label: 'price', ops: [{ op: 'add', path: '/compositions/price/layers/b', value: { type: 'shape.rect' } }, { op: 'add', path: '/compositions/price/order/-', value: 'b' }] });
    const out = await runner.run('discard_proposal', {});
    expect(out.isError).toBeFalsy();
    const live = runner.liveDoc();
    expect(live.compositions.main.layers.s1).toBeTruthy();
    expect(live.compositions.intro.layers.a).toBeTruthy();
    expect(live.compositions.price.layers.b).toBeUndefined();
    // and the user's decision (applied or set aside) ends what a later discard could go back to
    runner.clear();
    runner.scope = SCOPE;
    await runner.run('propose_changes', { label: 'price', ops: [{ op: 'add', path: '/compositions/price/layers/c', value: { type: 'shape.rect' } }, { op: 'add', path: '/compositions/price/order/-', value: 'c' }] });
    await runner.run('discard_proposal', {});
    expect(runner.pending).toBeNull();
    runner.dispose();
  });

  it("a scene builder's tools work on its composition: a tool's layers land there, and values are read there", async () => {
    const { doc, project } = film();
    doc.compositions.price.layers.dot = { type: 'shape.ellipse', transform: { position: { $k: [{ t: 0, v: [0, 0] }, { t: 1, v: [100, 0] }] } } } as never;
    doc.compositions.price.order = ['dot'];
    load(doc, project.manifest, 'http://localhost/api/projects/p/files/document.tramme.json', '');
    const seen: string[] = [];
    S.registry.peek().use({ tools: [{
      name: 'place-here', description: 'Regression fixture: places a layer in the composition it is given',
      run: async (_input: unknown, ctx: { compId: string }) => { seen.push(ctx.compId); return { text: 'placed', ops: [{ op: 'add', path: `/compositions/${ctx.compId}/layers/placed`, value: { type: 'shape.rect' } }, { op: 'add', path: `/compositions/${ctx.compId}/order/-`, value: 'placed' }] }; },
    }] }, 'test');
    const runner = new ToolRunner();
    runner.scope = SCOPE;
    const out = await runner.run('use_tool', { name: 'place-here', input: {} });
    expect(out.isError, JSON.stringify(out.content)).toBeFalsy();
    expect(seen).toEqual(['price']);
    expect(runner.liveDoc().compositions.price.layers.placed).toBeTruthy();
    const value = await runner.run('evaluate', { address: 'dot.transform.position', t: 1 });
    expect(value.isError, JSON.stringify(value.content)).toBeFalsy();
    expect(JSON.parse((value.content[0] as { text: string }).text)).toEqual([100, 0]);
    runner.dispose();
  });
});
