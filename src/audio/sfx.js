// One-shot sound effects. Synthesized for now; recorded CC0 layers get mixed in here later.
// Every effect takes a `where` from spatialize() so distance, pan and travel delay are applied.

function out(mixer, where, at, reverbAmount = 0.3) {
  const { ctx } = mixer;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = where.cutoff;
  const pan = ctx.createStereoPanner();
  pan.pan.value = where.pan;
  const g = ctx.createGain();
  g.gain.value = where.gain;
  lp.connect(pan).connect(g).connect(mixer.buses.sfx);
  const send = ctx.createGain();
  // Far-away sounds are mostly reverb.
  send.gain.value = where.gain * (reverbAmount + Math.min(0.6, where.dist / 1500));
  g.connect(send).connect(mixer.reverbSend);
  return lp;
}

function noiseBurst(mixer, dest, at, dur, { type = 'lowpass', from = 4000, to = 200, q = 0.7, vol = 1, attack = 0.003 }) {
  const { ctx } = mixer;
  const s = ctx.createBufferSource();
  s.buffer = mixer.noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, at);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
  s.connect(f).connect(g).connect(dest);
  s.start(at, Math.random() * 1.2);
  s.stop(at + dur + 0.05);
}

function tone(mixer, dest, at, dur, { from, to, vol = 1, type = 'sine' }) {
  const { ctx } = mixer;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
  o.connect(g).connect(dest);
  o.start(at);
  o.stop(at + dur + 0.05);
}

// Plays one of a voice's pre-rendered variations, placed in space.
export function play(mixer, variations, where, { gain = 1, rate = 1, reverb = 0.15, bus = 'sfx', offset = 0 } = {}) {
  const { ctx } = mixer;
  const at = mixer.now + where.delay + offset;
  const src = ctx.createBufferSource();
  src.buffer = variations[Math.floor(Math.random() * variations.length)];
  src.playbackRate.value = rate * (0.95 + Math.random() * 0.1) * (where.doppler ?? 1);
  if (bus === 'sfx') {
    src.connect(out(mixer, { ...where, gain: where.gain * gain }, at, reverb));
  } else {
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(mixer.buses[bus]);
  }
  src.start(at);
}

export function explosion(mixer, where, size = 1) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.45);
  // Close explosions have a sharp crack; distance strips it away (the lowpass does the rest).
  noiseBurst(mixer, dest, at, 0.08, { type: 'highpass', from: 1800, to: 900, vol: 0.9 * size });
  noiseBurst(mixer, dest, at, 1.9 * size, { from: 3500, to: 90, vol: 1.3 * size, attack: 0.004 });
  tone(mixer, dest, at, 0.7, { from: 75, to: 26, vol: 1.1 * size });
  // Debris pattering down afterwards.
  for (let i = 0; i < 8; i++) {
    const t = at + 0.25 + Math.random() * 1.4;
    noiseBurst(mixer, dest, t, 0.04, { type: 'bandpass', from: 2500 + Math.random() * 2500, to: 1500, q: 4, vol: 0.18 });
  }
  mixer.duck(0.6 * Math.min(1, where.gain * 1.5), 0.15, 1.2, at);
}

export function touchdown(mixer, where, speed) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.1);
  const v = Math.min(1, speed / 90);
  tone(mixer, dest, at, 0.12, { from: 95, to: 50, vol: 0.6 * v + 0.15 });
  noiseBurst(mixer, dest, at, 0.12, { type: 'bandpass', from: 2400, to: 1600, q: 3, vol: 0.35 * v });
  noiseBurst(mixer, dest, at + 0.18, 0.08, { type: 'bandpass', from: 2200, to: 1500, q: 3, vol: 0.2 * v });
}

// Landing gear moving: a hydraulic pump whine with hiss. Raising, the pump works harder and the pitch
// climbs; lowering, gravity helps and it sags.
export function gearMotor(mixer, where, dur, down) {
  const { ctx } = mixer;
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.05);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(down ? 210 : 150, at);
  osc.frequency.linearRampToValueAtTime(down ? 160 : 235, at + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 650;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.11, at + 0.12);
  g.gain.setValueAtTime(0.11, at + dur - 0.15);
  g.gain.linearRampToValueAtTime(0, at + dur);
  osc.connect(lp).connect(g).connect(dest);
  osc.start(at);
  osc.stop(at + dur + 0.05);
  noiseBurst(mixer, dest, at, dur, { type: 'bandpass', from: 2400, to: 1800, q: 2, vol: 0.06, attack: 0.15 });
}

// Fuel catching fire: a soft whoomph.
export function ignite(mixer, where) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.2);
  noiseBurst(mixer, dest, at, 0.6, { from: 300, to: 1400, vol: 0.5, attack: 0.12 });
}

export function rollWhoosh(mixer, where) {
  const at = mixer.now;
  const dest = out(mixer, where, at, 0.05);
  noiseBurst(mixer, dest, at, 0.4, { type: 'bandpass', from: 500, to: 1600, q: 1.5, vol: 0.18, attack: 0.15 });
}
