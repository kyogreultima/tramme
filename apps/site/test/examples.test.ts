import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY, IDS, examples } from '../src/lib/examples';

const VIDEOS = path.join(import.meta.dirname, '../src/videos');

describe('the examples the site shows', () => {
  it('are the repository\'s examples, each told once', () => {
    expect([...IDS].sort()).toEqual(Object.keys(examples).sort());
    expect(new Set(IDS).size).toBe(IDS.length);
  });

  it('each have a sentence, two colours for the placeholder and a poster', () => {
    for (const id of IDS) {
      const { tint, text } = COPY[id];
      expect(text.length, id).toBeGreaterThan(20);
      expect(tint, id).toHaveLength(2);
      for (const c of tint) expect(c, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(fs.existsSync(path.join(VIDEOS, `${id}.webp`)), `${id}: no poster in src/videos`).toBe(true);
    }
  });
});
