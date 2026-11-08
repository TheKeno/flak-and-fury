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
  let clips = mixer.recordings?.createClips(recId, count, build.synth.detune, panner);
  const send = ctx.createGain();
  send.gain.value = synth.reverb;
  out.connect(send).connect(mixer.reverbSend);

  const params = nodes.map((node) => Object.fromEntries(['rpm', 'load', 'roughness', 'misfire', 'level'].map((n) => [n, node.parameters.get(n)])));
  const set = (param, v, tc = 0.04) => param.setTargetAtTime(v, ctx.currentTime, tc);
  let startAt = -Infinity;
  let running = false;
  let startClip = null; // a recorded start-up, when the build has one
  let cutClip = null; // a recorded cut-out (the engine dying), likewise
  // Its own way out: the engine's out is still closed while it plays.
  const startPan = ctx.createStereoPanner();
  const startOut = ctx.createGain();
  startPan.connect(startOut).connect(mixer.buses.engine);
  startOut.connect(send);

  return {
    // Plays the starter motor and the engine catching. The sim's rpm takes over afterwards.
    start() {
      startAt = ctx.currentTime;
      running = true;
      startClip?.stop();
      startClip = mixer.recordings?.playStartup(recId, startPan) ?? null;
      if (!startClip && (mixer.recordings?.synthLevel(recId) ?? 1) > 0) starterWhine(mixer, STARTER_TIME + 0.3);
    },
    stop() {
      running = false;
      startClip?.stop();
      startClip = null;
    },
    // The engine dies (fuel gone, fire, overheating): the recorded cut-out, or a bang and a few coughs.
    // The synth falls to a windmilling prop by itself (the sim stops the engine), so this is only the event.
    cutOut() {
      cutClip?.stop();
      cutClip = mixer.recordings?.playCutout(recId, startPan) ?? null;
      if (!cutClip && (mixer.recordings?.synthLevel(recId) ?? 1) > 0) enginePop(mixer, startPan);
    },
    update({ rpm, load, roughness = 0.1, misfire = 0, gain = 1, pan = 0, cutoff = 18000, doppler = 1 }) {
      const t = ctx.currentTime - startAt;
      let level = running ? 1 : 0;
      if (startClip) {
        // The running engine stays silent until the recording says it has caught.
        if (t < startClip.caught) level = 0;
      } else if (t < STARTER_TIME) {
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
      set(startPan.pan, pan);
      set(startOut.gain, gain);
      set(out.gain, level * gain, startClip && t < startClip.caught + startClip.fade ? Math.max(0.05, startClip.fade / 3) : running ? 0.05 : 0.02);
    },
    // The Sound Lab added or changed recorded clips.
    refreshClips() {
      clips?.stop();
      clips = mixer.recordings?.createClips(recId, count, synth.detune, panner);
    },
    // The Sound Lab's sliders: new numbers while it plays.
    setSynth(next) {
      synth = next;
      send.gain.value = synth.reverb;
      for (const node of nodes) node.port.postMessage(synth);
    },
    dispose() {
      startClip?.stop();
      cutClip?.stop();
      startOut.disconnect();
      clips?.stop();
      out.disconnect();
      for (const node of nodes) node.disconnect();
    },
  };
}

// A stand-in cut-out: a dull bang and two weaker coughs, low-passed noise.
function enginePop(mixer, dest) {
  const { ctx } = mixer;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.9);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(700, t);
  lp.frequency.exponentialRampToValueAtTime(120, t + 0.8);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  for (const [at, level, decay] of [[0, 0.5, 0.18], [0.3, 0.25, 0.12], [0.62, 0.14, 0.1]]) {
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.linearRampToValueAtTime(level, t + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + decay);
  }
  src.connect(lp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + 0.9);
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
