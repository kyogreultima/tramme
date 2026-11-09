// Frozen pre-chain graphs, for the step-3 PCM migration regression.
// Keep independent of audioEffectChain/voice presets under test.
export function legacyVoice(ctx: BaseAudioContext, voice: string, out: AudioNode): AudioNode {
  if (voice === 'echo') {
    const input = ctx.createGain(), output = ctx.createGain(), delay = ctx.createDelay(1), back = ctx.createGain(), wet = ctx.createGain();
    delay.delayTime.value = 0.28; back.gain.value = 0.38; wet.gain.value = 0.55;
    input.connect(output); input.connect(delay); delay.connect(back).connect(delay); delay.connect(wet).connect(output); output.connect(out);
    return input;
  }
  const looks: Record<string, [number, number, number, number]> = { telephone: [300, 3400, 3, 1.5], radio: [500, 5000, 4, 2.5], megaphone: [700, 3500, 8, 5] };
  const [low, high, push, drive] = looks[voice];
  const hp = ctx.createBiquadFilter(), peak = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), shape = ctx.createWaveShaper();
  hp.type = 'highpass'; hp.frequency.value = low;
  lp.type = 'lowpass'; lp.frequency.value = high;
  peak.type = 'peaking'; peak.frequency.value = Math.sqrt(low * high); peak.Q.value = 1.2; peak.gain.value = push;
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = 2 * i / (curve.length - 1) - 1; curve[i] = Math.tanh(drive * x) / Math.tanh(drive); }
  shape.curve = curve;
  hp.connect(peak).connect(lp).connect(shape).connect(out);
  return hp;
}
