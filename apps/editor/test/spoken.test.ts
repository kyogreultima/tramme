import { afterEach, describe, expect, it, vi } from 'vitest';

const hears = vi.fn(async () => true), transcribe = vi.fn(async (..._: unknown[]) => '');
vi.mock('../src/speech.ts', () => ({ serverHears: hears, transcribeSamples: transcribe }));
const { speechIn, talks } = await import('../src/spoken.ts');

afterEach(() => { hears.mockResolvedValue(true); transcribe.mockReset(); });

describe('a sound that should say nothing', () => {
  it('hears the prompt recited, accents and case aside', () => {
    expect(talks('Un riser cinématique qui monte en rythme', 'riser cinematique, monte en RYTHME', 6)).toBe(true);
    expect(talks('deep whoosh', 'a deep whoosh', 2)).toBe(true);
  });
  it('hears someone talking about something else', () => {
    expect(talks('welcome back everyone today we are going to look at our brand new product', 'calm piano', 6)).toBe(true);
  });
  it('leaves alone the few words Whisper writes over noise or music', () => {
    for (const heard of ['', 'Thank you.', 'Merci d’avoir regardé cette vidéo !', 'you you you you you you you you you you']) expect(talks(heard, 'deep cinematic boom', 8)).toBe(false);
  });
  it('asks the server only, and says nothing when nothing here hears or the check fails', async () => {
    transcribe.mockResolvedValueOnce('deep cinematic boom');
    expect(await speechIn(new Float32Array(16000), 'deep cinematic boom')).toBe('deep cinematic boom');
    expect(transcribe.mock.calls[0].slice(1)).toEqual(['server', { only: true }]);
    transcribe.mockRejectedValueOnce(new Error('offline'));
    expect(await speechIn(new Float32Array(16000), 'boom')).toBeNull();
    hears.mockResolvedValueOnce(false);
    expect(await speechIn(new Float32Array(16000), 'boom')).toBeNull();
    expect(transcribe).toHaveBeenCalledTimes(2);
  });
});
