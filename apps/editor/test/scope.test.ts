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
});
