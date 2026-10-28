// The audio graph every sound goes through:
//
//   engine ┐
//   sfx    ┼─> body (pilot muffle) ─> master ─> limiter ─> speakers
//   ambience┤          ▲
//   music  ┘   reverb ─┘   (sfx/engine send into the reverb)
//
// "body" is a low-pass that closes as the pilot blacks out.
// levels: { master, engine, sfx, ambience, music } — a live object (the tuning panel edits it);
// call mixer.applyLevels() after changing it. master 1.0 = full loudness.
const FULL_MASTER = 0.9;

export async function createMixer(levels) {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  limiter.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = FULL_MASTER * levels.master;
  master.connect(limiter);

  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 20000;
  body.Q.value = 0.5;
  body.connect(master);

  const bus = (gain) => {
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(body);
    return g;
  };
  const buses = {
    engine: bus(levels.engine),
    sfx: bus(levels.sfx),
    ambience: bus(levels.ambience),
    music: bus(levels.music),
  };
  // The pilot's own body (heartbeat, breathing) bypasses the muffle.
  buses.body = ctx.createGain();
  buses.body.connect(master);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 2.4, 3.2);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.35;
  reverb.connect(reverbReturn).connect(body);
  const reverbSend = ctx.createGain();
  reverbSend.connect(reverb);

  let noise = null;
  const mixer = {
    ctx,
    buses,
    body,
    reverbSend,
    get now() {
      return ctx.currentTime;
    },
    // Shared 2-second white-noise buffer for anything that needs noise.
    get noise() {
      if (!noise) {
        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      return noise;
    },
    // Big sounds briefly push the engine and ambience down so they punch through.
    duck(depth = 0.5, hold = 0.1, release = 0.8, at = ctx.currentTime) {
      for (const name of ['engine', 'ambience']) {
        const g = buses[name].gain;
        const base = levels[name];
        g.cancelScheduledValues(at);
        g.setTargetAtTime(base * (1 - depth), at, 0.01);
        g.setTargetAtTime(base, at + hold, release / 3);
      }
    },
    setMuted(muted) {
      mixer.muted = muted;
      mixer.applyLevels();
    },
    muted: false,
    applyLevels() {
      master.gain.setTargetAtTime(mixer.muted ? 0 : FULL_MASTER * levels.master, ctx.currentTime, 0.05);
      for (const name of ['engine', 'sfx', 'ambience', 'music']) buses[name].gain.setTargetAtTime(levels[name], ctx.currentTime, 0.05);
    },
  };
  return mixer;
}

// Synthetic outdoor reverb: a few early reflections (hills, ground) plus a long diffuse tail.
function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.02 ? t / 0.02 : 1) * 0.5;
    }
    for (const ms of [37, 71, 118, 190]) {
      const i = Math.floor((ms + ch * 9) * ctx.sampleRate / 1000);
      if (i < len) d[i] += 0.45 * (1 - ms / 400);
    }
  }
  return buf;
}
