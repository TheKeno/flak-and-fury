// One live engine sound per aircraft, driven every frame from the simulation.
const STARTER_TIME = 1.1; // starter motor cranking before the engine catches
const CATCH_TIME = 1.4; // coughing and spluttering up to idle

export function createEngineVoice(mixer, engine) {
  const { ctx } = mixer;
  const node = new AudioWorkletNode(ctx, 'piston-engine', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      cylinders: engine.cylinders,
      layout: engine.layout,
      propBlades: engine.propBlades,
      gearRatio: engine.gearRatio,
    },
  });
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.8;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2400;
  presence.Q.value = 0.9;
  const panner = ctx.createStereoPanner();
  const out = ctx.createGain();
  out.gain.value = 0;
  node.connect(tone).connect(presence).connect(panner).connect(out).connect(mixer.buses.engine);
  const send = ctx.createGain();
  send.gain.value = 0.12;
  out.connect(send).connect(mixer.reverbSend);

  const params = node.parameters;
  const p = Object.fromEntries(['rpm', 'load', 'roughness', 'misfire', 'level'].map((n) => [n, params.get(n)]));
  const set = (param, v, tc = 0.04) => param.setTargetAtTime(v, ctx.currentTime, tc);
  let startAt = -Infinity;
  let running = false;

  return {
    // Plays the starter motor and the engine catching. The sim's rpm takes over afterwards.
    start() {
      startAt = ctx.currentTime;
      running = true;
      starterWhine(mixer, STARTER_TIME + 0.3);
    },
    stop() {
      running = false;
    },
    update({ rpm, load, roughness = 0.1, misfire = 0, gain = 1, pan = 0, cutoff = 18000, doppler = 1 }) {
      const t = ctx.currentTime - startAt;
      let level = running ? 1 : 0;
      if (t < STARTER_TIME) {
        level = 0;
      } else if (t < STARTER_TIME + CATCH_TIME) {
        const k = (t - STARTER_TIME) / CATCH_TIME;
        rpm = 260 + (rpm - 260) * k;
        misfire = Math.max(misfire, 0.65 * (1 - k));
        roughness = Math.max(roughness, 0.7 * (1 - k));
      }
      set(p.rpm, rpm * doppler);
      set(p.load, load);
      set(p.roughness, roughness);
      set(p.misfire, misfire, 0.01);
      set(p.level, 0.55);
      set(tone.frequency, Math.min(cutoff, 900 + load * 3800 + rpm * 0.9));
      set(presence.gain, -4 + load * 7);
      set(panner.pan, pan);
      set(out.gain, level * gain, running ? 0.05 : 0.02);
    },
    dispose() {
      out.disconnect();
      node.disconnect();
    },
  };
}

function starterWhine(mixer, dur) {
  const { ctx } = mixer;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(380, t + dur * 0.8);
  // The crank catches compression strokes: wobble the pitch.
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 7;
  const wobbleAmt = ctx.createGain();
  wobbleAmt.gain.value = 22;
  wobble.connect(wobbleAmt).connect(osc.frequency);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.1);
  g.gain.setValueAtTime(0.09, t + dur - 0.25);
  g.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(lp).connect(g).connect(mixer.buses.sfx);
  osc.start(t);
  wobble.start(t);
  osc.stop(t + dur + 0.05);
  wobble.stop(t + dur + 0.05);
}
