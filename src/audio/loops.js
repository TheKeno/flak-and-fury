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

// Metal scraping along the ground on the belly: grinding noise with screeches, louder with speed.
export function createScrape(mixer) {
  const { ctx } = mixer;
  const chain = spatialChain(mixer);
  const src = ctx.createBufferSource();
  src.buffer = mixer.noise;
  src.loop = true;
  const grind = ctx.createBiquadFilter();
  grind.type = 'bandpass';
  grind.frequency.value = 700;
  grind.Q.value = 0.9;
  const screech = ctx.createBiquadFilter();
  screech.type = 'bandpass';
  screech.Q.value = 14;
  const screechGain = ctx.createGain();
  src.connect(grind).connect(chain.input);
  src.connect(screech).connect(screechGain).connect(chain.input);
  src.start(0, Math.random());
  return {
    update(where, speed) {
      const v = Math.min(1, speed / 80);
      setT(ctx, grind.frequency, 400 + v * 900, 0.05);
      setT(ctx, screech.frequency, 2200 + Math.random() * 1600, 0.02);
      setT(ctx, screechGain.gain, Math.random() < 0.2 ? 1.5 * v : 0.2 * v, 0.01);
      chain.place(where, 1.1 * v);
    },
    stop() {
      chain.fade(() => src.stop());
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

// A tank: a deep, lumpy engine note with the squeal and clatter of its tracks while it moves.
export function createTankEngine(mixer, build) {
  const { ctx } = mixer;
  let synth = build.synth;
  const chain = spatialChain(mixer);
  const engine = ctx.createOscillator();
  engine.type = 'sawtooth';
  engine.frequency.value = (synth.engineIdle + synth.engineMove) / 2;
  const lumpy = ctx.createOscillator(); // firing pulses make the note uneven
  lumpy.frequency.value = (synth.lumpyIdle + synth.lumpyMove) / 2;
  const lumpyAmt = ctx.createGain();
  lumpyAmt.gain.value = synth.lumpyAmt;
  const engineGain = ctx.createGain();
  engineGain.gain.value = synth.engineLevel;
  lumpy.connect(lumpyAmt).connect(engineGain.gain);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = synth.engineLp;
  engine.connect(lp).connect(engineGain).connect(chain.input);
  // Tracks: band-passed noise chopped by a square wave into clanks.
  const src = ctx.createBufferSource();
  src.buffer = mixer.noise;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = synth.trackFreq;
  band.Q.value = synth.trackQ;
  const chop = ctx.createOscillator();
  chop.type = 'square';
  chop.frequency.value = synth.chop;
  const chopAmt = ctx.createGain();
  chopAmt.gain.value = synth.chopAmt;
  const trackGain = ctx.createGain();
  trackGain.gain.value = 0;
  chop.connect(chopAmt).connect(trackGain.gain);
  src.connect(band).connect(trackGain).connect(chain.input);
  for (const n of [engine, lumpy, chop]) n.start();
  src.start(0, Math.random());
  return {
    update(where, moving) {
      setT(ctx, engine.frequency, moving ? synth.engineMove : synth.engineIdle, 0.4);
      setT(ctx, lumpy.frequency, moving ? synth.lumpyMove : synth.lumpyIdle, 0.4);
      setT(ctx, trackGain.gain, moving ? synth.trackLevel : 0, 0.3);
      chain.place(where, synth.level);
    },
    // The Sound Lab's sliders: new numbers while it plays.
    setSynth(next) {
      synth = next;
      lumpyAmt.gain.value = synth.lumpyAmt;
      engineGain.gain.value = synth.engineLevel;
      lp.frequency.value = synth.engineLp;
      band.frequency.value = synth.trackFreq;
      band.Q.value = synth.trackQ;
      chop.frequency.value = synth.chop;
      chopAmt.gain.value = synth.chopAmt;
    },
    stop() {
      chain.fade(() => {
        for (const n of [engine, lumpy, chop, src]) n.stop();
      });
    },
  };
}

// Radar static: the hiss and crackle of a failing scope, in the cockpit rather than out in the world.
export function createRadarStatic(mixer) {
  const { ctx } = mixer;
  const src = ctx.createBufferSource();
  src.buffer = mixer.noise;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 3200;
  band.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(band).connect(g).connect(mixer.buses.ambience);
  src.start(0, Math.random());
  return {
    // level 0..1: how loud; crackle comes and goes on top.
    update(level) {
      setT(ctx, g.gain, level * (Math.random() < 0.15 ? 0.09 : 0.035), 0.01);
    },
    stop() {
      setT(ctx, g.gain, 0, 0.05);
      setTimeout(() => src.stop(), 400);
    },
  };
}
