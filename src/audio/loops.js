// Continuous sounds attached to a moving thing: a falling bomb's whistle, a burning plane's fire.
// Each has update(where, ...) called every frame and stop() to fade it out.

const setT = (ctx, param, v, tc = 0.04) => param.setTargetAtTime(v, ctx.currentTime, tc);

function spatialChain(mixer) {
  const { ctx } = mixer;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const pan = ctx.createStereoPanner();
  const g = ctx.createGain();
  g.gain.value = 0;
  lp.connect(pan).connect(g).connect(mixer.buses.sfx);
  const send = ctx.createGain();
  send.gain.value = 0.25;
  g.connect(send).connect(mixer.reverbSend);
  return {
    input: lp,
    place(where, level) {
      setT(ctx, lp.frequency, where.cutoff);
      setT(ctx, pan.pan, where.pan);
      setT(ctx, g.gain, where.gain * level);
    },
    fade(then) {
      setT(ctx, g.gain, 0, 0.05);
      setTimeout(() => {
        g.disconnect();
        then?.();
      }, 400);
    },
  };
}

// The classic falling-bomb whistle: pitch slides down as the bomb gathers speed.
export function createBombWhistle(mixer) {
  const { ctx } = mixer;
  const chain = spatialChain(mixer);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const vib = ctx.createOscillator();
  vib.frequency.value = 6;
  const vibAmt = ctx.createGain();
  vibAmt.gain.value = 9;
  vib.connect(vibAmt).connect(osc.frequency);
  // A little air noise around the tone.
  const air = ctx.createBufferSource();
  air.buffer = mixer.noise;
  air.loop = true;
  const airBand = ctx.createBiquadFilter();
  airBand.type = 'bandpass';
  airBand.Q.value = 6;
  const airGain = ctx.createGain();
  airGain.gain.value = 0.35;
  air.connect(airBand).connect(airGain).connect(chain.input);
  osc.connect(chain.input);
  osc.start();
  vib.start();
  air.start(0, Math.random());
  const born = ctx.currentTime;
  return {
    update(where, fallSpeed) {
      const age = ctx.currentTime - born;
      const f = (1750 - 1150 * Math.min(1, age / 2.6)) * where.doppler;
      setT(ctx, osc.frequency, f);
      setT(ctx, airBand.frequency, f * 1.02);
      chain.place(where, 0.14 * Math.min(1, age / 0.5) * Math.min(1, fallSpeed / 60));
    },
    stop() {
      chain.fade(() => {
        osc.stop();
        vib.stop();
        air.stop();
      });
    },
  };
}

// Burning fuel: a low roar with random crackles.
export function createFire(mixer) {
  const { ctx } = mixer;
  const chain = spatialChain(mixer);
  const src = ctx.createBufferSource();
  src.buffer = mixer.noise;
  src.loop = true;
  const roar = ctx.createBiquadFilter();
  roar.type = 'lowpass';
  roar.frequency.value = 380;
  const crackBand = ctx.createBiquadFilter();
  crackBand.type = 'bandpass';
  crackBand.frequency.value = 1600;
  crackBand.Q.value = 0.8;
  const crackGain = ctx.createGain();
  src.connect(roar).connect(chain.input);
  src.connect(crackBand).connect(crackGain).connect(chain.input);
  src.start(0, Math.random());
  return {
    update(where, intensity) {
      setT(ctx, crackGain.gain, Math.random() < 0.3 ? 0.6 + Math.random() * 1.6 : 0.1, 0.006);
      chain.place(where, 0.45 * intensity);
    },
    stop() {
      chain.fade(() => src.stop());
    },
  };
}
