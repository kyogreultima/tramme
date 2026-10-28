import { describe, expect, it } from 'vitest';
import { chapterList, chaptersOf, ffmetadata, type Marker } from '../src/index.ts';

const markers: Marker[] = [
  { id: 'm2', t: 30, kind: 'chapter', label: 'The reveal' },
  { id: 'm0', t: 0, kind: 'chapter', label: 'Intro' },
  { id: 'm1', t: 12.5, kind: 'scene', label: 'not a chapter' },
  { id: 'm3', t: 75, kind: 'chapter' },
];

describe('chapters', () => {
  it('are the markers of kind chapter, in time order, named by their label or their id', () => {
    expect(chaptersOf(markers)).toEqual([{ t: 0, title: 'Intro' }, { t: 30, title: 'The reveal' }, { t: 75, title: 'm3' }]);
    expect(chaptersOf(undefined)).toEqual([]);
  });

  it('of a span: the ones inside it, their times counted from its start', () => {
    expect(chaptersOf(markers, 20, 80)).toEqual([{ t: 10, title: 'The reveal' }, { t: 55, title: 'm3' }]);
  });

  it('read as a list of times for a video site: minutes and seconds, hours when needed', () => {
    expect(chapterList(chaptersOf(markers))).toBe('0:00 Intro\n0:30 The reveal\n1:15 m3');
    expect(chapterList([{ t: 3725, title: 'Late' }])).toBe('1:02:05 Late');
  });

  it('written for ffmpeg: each chapter ends where the next begins, the last at the end of the film', () => {
    expect(ffmetadata(chaptersOf(markers), 90)).toBe(
      ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=30000\ntitle=Intro\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=30000\nEND=75000\ntitle=The reveal\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=75000\nEND=90000\ntitle=m3\n',
    );
  });

  it('keeps a title with a character ffmpeg reads as syntax safe', () => {
    expect(ffmetadata([{ t: 0, title: 'A=B;C#D\\E' }], 1)).toContain('title=A\\=B\\;C\\#D\\\\E');
  });
});
