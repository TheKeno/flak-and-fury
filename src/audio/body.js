// The pilot's body: as consciousness fades the world goes muffled, the heart pounds and breathing gets heavy.
export function createBody(mixer) {
  const { ctx } = mixer;
  let nextBeat = 0;
  let nextBreath = 0;

  function thump(t, freq, vol) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(mixer.buses.body);
    o.start(t);
    o.stop(t + 0.2);
  }

  function breath(t, dur, vol, inhale) {
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
    s.connect(bp).connect(g).connect(mixer.buses.body);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  return {
    // A sharp gasp when the pilot comes round.
    gasp() {
      breath(ctx.currentTime, 0.55, 0.22, true);
    },
    update(p) {
      const c = p && p.state !== 'dead' ? p.consciousness : 1;
      mixer.body.frequency.setTargetAtTime(280 + 19700 * Math.pow(c, 3), ctx.currentTime, 0.12);
      const now = ctx.currentTime;
      if (c < 0.8 && now >= nextBeat - 0.05) {
        const t = Math.max(now, nextBeat);
        const vol = 0.25 + (1 - c) * 0.6;
        thump(t, 58, vol);
        thump(t + 0.16, 48, vol * 0.7);
        const bpm = 72 + (1 - c) * 70;
        nextBeat = t + 60 / bpm;
      }
      if (c < 0.6 && now >= nextBreath - 0.05) {
        const t = Math.max(now, nextBreath);
        const vol = 0.05 + (0.6 - c) * 0.18;
        breath(t, 0.7, vol, true);
        breath(t + 0.85, 0.9, vol * 0.8, false);
        nextBreath = t + 2.1 - (0.6 - c);
      }
    },
  };
}
