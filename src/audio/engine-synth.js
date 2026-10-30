// One live engine sound per aircraft, driven every frame from the simulation.
const STARTER_TIME = 1.1; // starter motor cranking before the engine catches
const CATCH_TIME = 1.4; // coughing and spluttering up to idle

// build: the sound build from data/sound.json; count: engines on the plane, slightly detuned against
// each other so a twin beats like a twin.
// recId: where its recorded clips are in the sound data.
export function createEngineVoice(mixer, engine, build, count = 1, recId = null) {
  const { ctx } = mixer;
  let synth = build.synth;
  const nodes = Array.from({ length: Math.min(4, count) }, () => new AudioWorkletNode(ctx, 'piston-engine', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      cylinders: engine.cylinders,
      voice: synth,
      propBlades: engine.propBlades,
      gearRatio: engine.gearRatio,
    },
  }));
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
  const synthLevel = ctx.createGain();
  for (const node of nodes) node.connect(synthLevel);
  synthLevel.connect(tone);
  tone.connect(presence).connect(panner).connect(out).connect(mixer.buses.engine);
  const clips = mixer.recordings?.createClips(recId, count, build.synth.detune, panner);
  const send = ctx.createGain();
  send.gain.value = synth.reverb;
  out.connect(send).connect(mixer.reverbSend);

  const params = nodes.map((node) => Object.fromEntries(['rpm', 'load', 'roughness', 'misfire', 'level'].map((n) => [n, node.parameters.get(n)])));
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
      params.forEach((p, i) => {
        set(p.rpm, rpm * doppler * (1 + synth.detune * (i - (params.length - 1) / 2)));
        set(p.load, load);
        set(p.roughness, roughness);
        set(p.misfire, misfire, 0.01);
        set(p.level, synth.level / Math.sqrt(params.length));
      });
      set(tone.frequency, Math.min(cutoff, synth.toneBase + load * synth.toneLoad + rpm * synth.toneRpm));
      set(presence.gain, synth.presenceBase + load * synth.presenceLoad);
      synthLevel.gain.value = mixer.recordings?.synthLevel(recId) ?? 1;
      clips?.update({ rpm, load, misfire, doppler });
      set(panner.pan, pan);
      set(out.gain, level * gain, running ? 0.05 : 0.02);
    },
    // The Sound Lab's sliders: new numbers while it plays.
    setSynth(next) {
      synth = next;
      send.gain.value = synth.reverb;
      for (const node of nodes) node.port.postMessage(synth);
    },
    dispose() {
      clips?.stop();
      out.disconnect();
      for (const node of nodes) node.disconnect();
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
