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
const listen = await import('../src/listen.ts');
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
  // no server in the tests: Automatic is the downloaded model unless a test says otherwise
  vi.spyOn(speech, 'serverHears').mockResolvedValue(false);
  vi.spyOn(listen, 'canListen').mockResolvedValue(false);
});
afterEach(async () => { await act(async () => { render(null, host); }); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); recording.value = null; });

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

describe('a live dictation (on the server)', () => {
  /** a microphone whose processor is fed by the test: feed(seconds, loud) pushes that much sound */
  function liveMicrophone() {
    fakeMicrophone();
    let processor: { onaudioprocess: ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null } | null = null;
    vi.stubGlobal('AudioContext', class {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() { return { fftSize: 0, getByteTimeDomainData() {} }; }
      createScriptProcessor() { processor = { onaudioprocess: null, connect() {}, disconnect() {} } as never; return processor; }
      get destination() { return {}; }
      close() { return Promise.resolve(); }
    });
    return (seconds: number, loud = true) => {
      for (let i = 0; i < Math.round((seconds * 16000) / 4000); i++) processor!.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(4000).fill(loud ? 0.2 : 0) } });
    };
  }

  it('shows words while the live connection is still opening', async () => {
    vi.useFakeTimers();
    setPrefs({ dictation: 'server' });
    vi.spyOn(listen, 'canListen').mockResolvedValue(true);
    let opened!: (stream: Awaited<ReturnType<typeof listen.openListening>>) => void;
    vi.spyOn(listen, 'openListening').mockImplementation(() => new Promise((resolve) => { opened = resolve; }));
    vi.spyOn(speech, 'transcribeSamples').mockResolvedValue('early words');
    const feed = liveMicrophone();
    await dictation.startDictation();
    feed(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(dictation.liveText.value).toBe('early words');
    opened({ send: vi.fn(), finish: async () => {}, drop: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    dictation.cancelDictation();
    vi.useRealTimers();
  });

  it('without a stream, shows the words of the passage every second, keeps a long one that ends on a pause, and sends only the rest at the end', async () => {
    vi.useFakeTimers();
    setPrefs({ dictation: 'server' });
    vi.spyOn(listen, 'canListen').mockResolvedValue(false);
    const sent: number[] = [];
    vi.spyOn(speech, 'transcribeSamples').mockImplementation(async (s) => { sent.push(s.length / 16000); return `w${sent.length}`; });
    const feed = liveMicrophone();
    await dictation.startDictation();
    await vi.advanceTimersByTimeAsync(0);
    feed(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([2]);
    expect(dictation.liveText.value).toBe('w1');
    // 21 s said, ending on a pause: kept as said
    feed(18.6); feed(0.4, false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.at(-1)).toBe(21);
    expect(dictation.liveText.value).toBe('w2');
    // a few more words, then the user stops: only those go
    feed(3);
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();
    expect(await dictation.stopDictation()).toBe('w2 w3');
    expect(sent.at(-1)).toBe(3);
    expect(dictation.liveText.value).toBe('');
  });

  it('streams to the server where it listens: what was said while it opened goes first, the words show as they come, the last ones at the end', async () => {
    setPrefs({ dictation: 'server' });
    vi.spyOn(listen, 'canListen').mockResolvedValue(true);
    const sent: number[] = [];
    let say!: (h: { text: string; final: boolean; end: number }) => void;
    let open!: () => void;
    const finish = vi.fn(async () => { say({ text: 'the end.', final: true, end: 3 }); });
    vi.spyOn(listen, 'openListening').mockImplementation((onHeard) => new Promise((resolve) => {
      say = onHeard;
      open = () => resolve({ send: (pcm) => { sent.push(pcm.length); }, finish, drop: vi.fn() });
    }));
    const whisper = vi.spyOn(speech, 'transcribeSamples').mockResolvedValue('whisper');
    const feed = liveMicrophone();
    await dictation.startDictation();
    // the user speaks before the stream is open: kept, then sent first
    feed(1);
    open();
    await vi.waitFor(() => expect(sent).toEqual([16000]));
    feed(0.25);
    expect(sent.at(-1)).toBe(4000);
    say({ text: 'Hello', final: false, end: 1 });
    expect(dictation.liveText.value).toBe('Hello');
    say({ text: 'Hello everyone.', final: true, end: 1.2 });
    say({ text: 'Today', final: false, end: 2 });
    expect(dictation.liveText.value).toBe('Hello everyone. Today');
    expect(await dictation.stopDictation()).toBe('Hello everyone. the end.');
    expect(finish).toHaveBeenCalledOnce();
    expect(whisper).not.toHaveBeenCalled();
  });

  it('Automatic hears live when the server transcribes, else on the downloaded model', async () => {
    const hears = vi.spyOn(speech, 'serverHears').mockResolvedValue(true);
    setPrefs({ dictation: 'auto' });
    expect(await dictation.dictationSource()).toBe('server');
    hears.mockResolvedValue(false);
    expect(await dictation.dictationSource()).toBe('local');
    setPrefs({ dictation: 'companion' });
    expect(await dictation.dictationSource()).toBe('companion');
  });
});
