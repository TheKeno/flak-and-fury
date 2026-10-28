// Ground crew at work: ratchet and hammer for repairs, a glugging fuel hose, ammunition belts and
// boxes for rearming. One per plane being serviced; update() each frame with the current job.
import * as sfx from './sfx.js';

export function createCrew(mixer, voices) {
  const { ctx } = mixer;
  let next = 0; // when the next one-shot is due (audio clock)
  let hose = null;

  // Fuel hose: low gurgling noise with random glugs.
  function startHose() {
    const src = ctx.createBufferSource();
    src.buffer = mixer.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 260;
    band.Q.value = 3;
    const glug = ctx.createGain();
    glug.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const out = ctx.createGain();
    out.gain.value = 0;
    src.connect(band).connect(glug).connect(pan).connect(out).connect(mixer.buses.sfx);
    src.start(0, Math.random());
    return { src, band, glug, pan, out };
  }
  function stopHose() {
    if (!hose) return;
    const h = hose;
    hose = null;
    h.out.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    setTimeout(() => h.src.stop(), 600);
  }

  return {
    update(job, where) {
      const now = ctx.currentTime;
      if (job === 'refuel') {
        if (!hose) hose = startHose();
        hose.pan.pan.setTargetAtTime(where.pan, now, 0.05);
        hose.out.gain.setTargetAtTime(where.gain * 1.4, now, 0.1);
        hose.glug.gain.setTargetAtTime(Math.random() < 0.25 ? 0.4 + Math.random() : 0.12, now, 0.015);
        hose.band.frequency.setTargetAtTime(200 + Math.random() * 180, now, 0.03);
      } else stopHose();

      if (now < next) return;
      if (job === 'repair') {
        // A burst of ratchet clicks, now and then a hammer blow.
        const n = 5 + Math.floor(Math.random() * 6);
        for (let i = 0; i < n; i++) sfx.play(mixer, voices.click, where, { gain: 0.35, rate: 0.55, offset: i * 0.07 });
        if (Math.random() < 0.4) sfx.play(mixer, voices.clank, where, { gain: 0.5, rate: 0.55, offset: n * 0.07 + 0.2 });
        next = now + n * 0.07 + 0.5 + Math.random() * 0.6;
      } else if (job === 'rearm') {
        // Belts rattling into the ammunition bays, then a box knocked shut.
        for (let i = 0; i < 6; i++) sfx.play(mixer, voices.clank, where, { gain: 0.18, rate: 1.6 + Math.random() * 0.3, offset: i * 0.05 });
        if (Math.random() < 0.5) sfx.play(mixer, voices.thunk, where, { gain: 0.4, rate: 1.3, offset: 0.4 });
        next = now + 0.7 + Math.random() * 0.5;
      }
    },
    stop: stopHose,
  };
}
