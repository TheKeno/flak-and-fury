// The pilot's body: as consciousness fades the world goes muffled, the heart pounds and breathing gets heavy.
export function createBody(mixer) {
  const { ctx } = mixer;
  let nextBeat = 0;
  let nextBreath = 0;

  const ME = { dist: 0, pan: 0, gain: 1, cutoff: 18000, delay: 0, doppler: 1 };
  // Each sound's own way out, so its synth level works beside its recordings.
  const bodyBus = (id) => (mixer.recordings?.scoped(id) ?? mixer).buses.body;
  const recorded = (id, at, gain) => mixer.recordings?.trigger(id, ME, { gain, bus: 'body', offset: Math.max(0, at - ctx.currentTime) });

  function thump(t, freq, vol) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(bodyBus('sfx:heartbeat'));
    o.start(t);
    o.stop(t + 0.2);
  }

  function breath(t, dur, vol, inhale, id = 'sfx:breathing') {
    const s = ctx.createBufferSource();
    s.buffer = mixer.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(inhale ? 700 : 1100, t);
    bp.frequency.linearRampToValueAtTime(inhale ? 1300 : 600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(bp).connect(g).connect(bodyBus(id));
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  // One lub-dub. A recording is one beat, as loud as the synth's.
  function beat(t, vol) {
    recorded('sfx:heartbeat', t, vol);
    thump(t, 58, vol);
    thump(t + 0.16, 48, vol * 0.7);
  }

  // One breath in and out. A recording is the whole breath; the synth's level is far lower, so it's
  // scaled to reach full volume at the worst.
  function breathe(t, vol) {
    recorded('sfx:breathing', t, vol / 0.158);
    breath(t, 0.7, vol, true);
    breath(t + 0.85, 0.9, vol * 0.8, false);
  }

  return {
    beat: (vol = 0.7) => beat(ctx.currentTime, vol),
    breathe: (vol = 0.158) => breathe(ctx.currentTime, vol),
    // A sharp gasp when the pilot comes round.
    gasp() {
      recorded('sfx:gasp', ctx.currentTime, 1);
      breath(ctx.currentTime, 0.55, 0.22, true, 'sfx:gasp');
    },
    update(p) {
      const c = p && p.state !== 'dead' ? p.consciousness : 1;
      mixer.body.frequency.setTargetAtTime(280 + 19700 * Math.pow(c, 3), ctx.currentTime, 0.12);
      const now = ctx.currentTime;
      if (c < 0.8 && now >= nextBeat - 0.05) {
        const t = Math.max(now, nextBeat);
        const vol = 0.25 + (1 - c) * 0.6;
        beat(t, vol);
        const bpm = 72 + (1 - c) * 70;
        nextBeat = t + 60 / bpm;
      }
      if (c < 0.6 && now >= nextBreath - 0.05) {
        const t = Math.max(now, nextBreath);
        const vol = 0.05 + (0.6 - c) * 0.18;
        breathe(t, vol);
        nextBreath = t + 2.1 - (0.6 - c);
      }
    },
  };
}
