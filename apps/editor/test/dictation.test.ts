// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

const dictation = await import('../src/dictation.ts');
const { MicButton } = await import('../src/ui/MicButton.tsx');
const speech = await import('../src/speech.ts');
const cache = await import('../src/model-cache.ts');
const confirm = await import('../src/confirm.ts');
const state = await import('../src/state.ts');
const { prefs, setPrefs, DEFAULT_PREFERENCES } = await import('../src/settings.ts');
const { insertAtCursor, recording } = dictation;

describe('insertAtCursor', () => {
  it('puts one space between words when needed', () => {
    expect(insertAtCursor('hello', 5, 5, 'world')).toEqual({ value: 'hello world', caret: 11 });
    expect(insertAtCursor('hello ', 6, 6, 'world')).toEqual({ value: 'hello world', caret: 11 });
    expect(insertAtCursor('', 0, 0, 'hi')).toEqual({ value: 'hi', caret: 2 });
  });
  it('writes where the cursor is, and replaces a selection', () => {
    expect(insertAtCursor('say hello now', 4, 9, 'goodbye')).toEqual({ value: 'say goodbye now', caret: 11 });
    expect(insertAtCursor('ab', 1, 1, 'X')).toEqual({ value: 'a X b', caret: 3 });
  });
});

const samples = new Float32Array(16000 * 2);
let host: HTMLElement;

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  setPrefs({ ...DEFAULT_PREFERENCES });
  vi.spyOn(state, 'toast').mockImplementation(() => {});
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); recording.value = null; });

/** a microphone and a recorder that record nothing, enough for start and stop */
function fakeMicrophone() {
  const track = { stop: vi.fn() };
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
  vi.stubGlobal('MediaRecorder', class {
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {}
    stop() { this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.(); }
  });
  vi.stubGlobal('AudioContext', class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData() {} }; }
    close() { return Promise.resolve(); }
  });
  return track;
}

describe('dictation', () => {
  it('a refused microphone says so and writes nothing', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => { throw new DOMException('no', 'NotAllowedError'); }) } });
    const onText = vi.fn();
    await act(() => { render(h(MicButton, { onText }), host); });
    await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(state.toast).toHaveBeenCalled());
    expect(recording.value).toBeNull();
    expect(onText).not.toHaveBeenCalled();
    // the button is at rest again
    expect(host.querySelector('button.on')).toBeNull();
  });

  it('a missing microphone says so too', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    await dictation.startDictation();
    expect(state.toast).toHaveBeenCalled();
    expect(recording.value).toBeNull();
  });

  it('a tap writes nothing', async () => {
    const track = fakeMicrophone();
    const transcribe = vi.spyOn(speech, 'transcribeSamples').mockResolvedValue('hello');
    await dictation.startDictation();
    expect(recording.value).not.toBeNull();
    expect(await dictation.stopDictation()).toBe('');
    expect(transcribe).not.toHaveBeenCalled();
    expect(recording.value).toBeNull();
    // the microphone is let go
    expect(track.stop).toHaveBeenCalled();
  });

  it('a cancelled recording writes nothing and lets the microphone go', async () => {
    const track = fakeMicrophone();
    await dictation.startDictation();
    dictation.cancelDictation();
    expect(recording.value).toBeNull();
    expect(track.stop).toHaveBeenCalled();
    expect(await dictation.stopDictation()).toBe('');
  });

  it('an empty transcription writes nothing', async () => {
    vi.spyOn(speech, 'transcribeSamples').mockResolvedValue('  ');
    setPrefs({ dictation: 'server' });
    expect(await dictation.transcribeDictation(samples)).toBe('');
  });

  it('the downloaded model is offered before its first download', async () => {
    vi.spyOn(cache, 'cachedFiles').mockResolvedValue([]);
    const ask = vi.spyOn(confirm, 'confirmWith').mockResolvedValue(false);
    const transcribe = vi.spyOn(speech, 'transcribeSamples').mockResolvedValue('hello');
    expect(await dictation.transcribeDictation(samples)).toBe('');
    expect(ask).toHaveBeenCalledOnce();
    // Whisper base, the lighter suggestion, with its size
    expect(ask.mock.calls[0].join(' ')).toMatch(/Whisper base/);
    expect(ask.mock.calls[0].join(' ')).toMatch(/80 MB/);
    expect(transcribe).not.toHaveBeenCalled();
    // accepted: the model is kept as the transcription model and the words come
    ask.mockResolvedValue(true);
    expect(await dictation.transcribeDictation(samples)).toBe('hello');
    expect(prefs.value.models.transcription).toBe('whisper-base');
    // on the processor (the size offered is the one downloaded), its download told as it goes
    const opts = transcribe.mock.calls.at(-1)![2]!;
    expect(transcribe.mock.calls.at(-1)!.slice(0, 2)).toEqual([samples, 'local']);
    expect(opts.local?.cpu).toBe(true);
  });

  it('tells the download of the model as it goes, and forgets it after', async () => {
    vi.spyOn(cache, 'cachedFiles').mockResolvedValue([{ url: 'https://huggingface.co/Xenova/whisper-small/resolve/main/config.json', bytes: 10 }]);
    let seen: unknown = null;
    vi.spyOn(speech, 'transcribeSamples').mockImplementation(async (_s, _src, opts) => { opts?.local?.progress?.(25, 100); seen = dictation.modelLoad.value; return 'hello'; });
    expect(await dictation.transcribeDictation(samples)).toBe('hello');
    expect(seen).toEqual({ loaded: 25, total: 100 });
    expect(dictation.modelLoad.value).toBeNull();
  });

  it('a second click while the microphone opens does not open it twice', async () => {
    fakeMicrophone();
    let open!: () => void;
    const gum = vi.fn(() => new Promise((resolve) => { open = () => resolve({ getTracks: () => [{ stop() {} }] }); }));
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: gum } });
    const first = dictation.startDictation(), second = dictation.startDictation();
    open();
    await Promise.all([first, second]);
    expect(gum).toHaveBeenCalledOnce();
    dictation.cancelDictation();
  });

  it('a model already here is not offered again', async () => {
    const files = [{ url: 'https://huggingface.co/Xenova/whisper-small/resolve/main/config.json', bytes: 10 }];
    vi.spyOn(cache, 'cachedFiles').mockResolvedValue(files);
    const ask = vi.spyOn(confirm, 'confirmWith');
    vi.spyOn(speech, 'transcribeSamples').mockResolvedValue('hello');
    expect(await dictation.transcribeDictation(samples)).toBe('hello');
    expect(ask).not.toHaveBeenCalled();
  });

  it('the setting picks the source', async () => {
    const transcribe = vi.spyOn(speech, 'transcribeSamples').mockResolvedValue('hello');
    const ask = vi.spyOn(confirm, 'confirmWith');
    setPrefs({ dictation: 'server' });
    await dictation.transcribeDictation(samples);
    expect(transcribe).toHaveBeenLastCalledWith(samples, 'server');
    setPrefs({ dictation: 'companion' });
    await dictation.transcribeDictation(samples);
    expect(transcribe).toHaveBeenLastCalledWith(samples, 'companion');
    // no download offered when the model is not the source
    expect(ask).not.toHaveBeenCalled();
  });
});
