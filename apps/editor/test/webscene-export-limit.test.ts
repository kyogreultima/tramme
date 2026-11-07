import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import { exportInBrowser } from '../src/webexport.ts';
import { prefs } from '../src/settings.ts';

describe('browser web scene export', () => {
  it('refuses visual export before opening a renderer', async () => {
    const doc = newProject({ name: 'Web scene', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.compositions.main.layers.scene = { type: 'webscene', props: { folder: 'scenes/main', frames: [], fps: 1, size: [64, 64] }, transform: {} } as never;
    doc.compositions.main.order = ['scene'];
    await expect(exportInBrowser(doc, 'https://tramme.test/project/document.tramme.json', 'png', {
      compId: 'main', registry: builtinRegistry(),
    })).rejects.toThrow(/bench\/web-scenes/);
  });

  it('refuses isolated vector export before evaluating an expression on the page', async () => {
    const doc = newProject({ name: 'Expression', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.compositions.main.layers.title = { type: 'text', props: { text: { $expr: '"hello"' } }, transform: {} } as never;
    doc.compositions.main.order = ['title'];
    const previous = prefs.peek();
    prefs.value = { ...previous, sandboxPreview: true };
    try {
      await expect(exportInBrowser(doc, 'https://tramme.test/project/document.tramme.json', 'svg', {
        compId: 'main', registry: builtinRegistry(),
      })).rejects.toThrow(/raster export/);
    } finally { prefs.value = previous; }
  });
});
