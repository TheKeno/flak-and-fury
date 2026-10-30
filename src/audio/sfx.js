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
  gain *= variations.level ?? 1;
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

// Belly landing impact: a heavy crunch and the propeller blades hammering the ground.
export function bellyCrunch(mixer, where, speed) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.25);
  const v = Math.min(1, speed / 90);
  tone(mixer, dest, at, 0.35, { from: 85, to: 35, vol: 0.9 * v + 0.3 });
  noiseBurst(mixer, dest, at, 0.5, { from: 2500, to: 300, vol: 0.8 * v + 0.2 });
  for (let i = 0; i < 4; i++) noiseBurst(mixer, dest, at + 0.03 + i * 0.045, 0.05, { type: 'bandpass', from: 1500, to: 900, q: 3, vol: 0.5 });
  mixer.duck(0.4, 0.1, 0.6, at);
}

// Mid-air contact. Hard hits crunch; grazes screech and clang; a propeller chewing into a tail
// adds a rapid hammering.
export function midair(mixer, where, severity, taran) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.3);
  if (severity === 'hard') {
    tone(mixer, dest, at, 0.4, { from: 110, to: 40, vol: 1 });
    noiseBurst(mixer, dest, at, 0.6, { from: 3200, to: 400, vol: 0.9 });
    mixer.duck(0.5, 0.1, 0.8, at);
  } else {
    noiseBurst(mixer, dest, at, 0.35, { type: 'bandpass', from: 3400, to: 1800, q: 6, vol: 0.5, attack: 0.01 });
    tone(mixer, dest, at, 0.25, { from: 1300, to: 900, vol: 0.25, type: 'triangle' });
  }
  if (taran) {
    for (let i = 0; i < 7; i++) noiseBurst(mixer, dest, at + i * 0.035, 0.03, { type: 'bandpass', from: 1700, to: 1100, q: 4, vol: 0.6 });
  }
}

// Craning your head round in the cockpit: a soft creak of leather helmet and harness.
export function helmetCreak(mixer) {
  const at = mixer.now;
  const dest = mixer.buses.body;
  for (let i = 0; i < 5; i++) {
    noiseBurst(mixer, dest, at + i * 0.03 + Math.random() * 0.02, 0.05, { type: 'bandpass', from: 700 + Math.random() * 500, to: 500, q: 5, vol: 0.06 });
  }
  noiseBurst(mixer, dest, at, 0.25, { type: 'bandpass', from: 1400, to: 900, q: 1.2, vol: 0.03, attack: 0.08 });
}

// Cockpit warning horn: pulsing, impossible to ignore.
export function gearHorn(mixer) {
  const { ctx } = mixer;
  const at = mixer.now;
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = 520;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.07, at + 0.01);
  g.gain.setValueAtTime(0.07, at + 0.22);
  g.gain.linearRampToValueAtTime(0, at + 0.25);
  o.connect(lp).connect(g).connect(mixer.buses.body);
  o.start(at);
  o.stop(at + 0.3);
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

// Looping noise for sounds longer than the noise buffer: rumbles and crumbling.
function noiseLong(mixer, dest, at, dur, { type = 'lowpass', from = 800, to = 100, q = 0.7, vol = 1, attack = 0.05 }) {
  const { ctx } = mixer;
  const s = ctx.createBufferSource();
  s.buffer = mixer.noise;
  s.loop = true;
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
  s.start(at, Math.random() * 1.5);
  s.stop(at + dur + 0.05);
}

// A flak shell bursting: a sharp crack, a hollow whump and a dark puff of noise. Far off, only the
// whump rolls in, late (the travel delay) and mostly echo.
export function flakBurst(mixer, where) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.55);
  noiseBurst(mixer, dest, at, 0.05, { type: 'highpass', from: 2600, to: 1400, vol: 1.1 });
  tone(mixer, dest, at, 0.32, { from: 140, to: 42, vol: 0.9 });
  noiseBurst(mixer, dest, at, 0.7, { from: 1800, to: 140, vol: 0.8, attack: 0.006 });
  mixer.duck(0.3 * Math.min(1, where.gain * 2), 0.06, 0.4, at);
}

// Shrapnel striking your own plane: a scatter of ticks across the airframe, more for a closer burst.
export function shrapnel(mixer, voices, damage) {
  const n = 3 + Math.min(9, Math.round(damage / 2));
  for (let i = 0; i < n; i++) {
    const at = { dist: 0, pan: (Math.random() - 0.5) * 1.4, gain: 1, cutoff: 18000, delay: 0, doppler: 1 };
    play(mixer, voices.patter, at, { gain: 0.25 + Math.random() * 0.25, rate: 0.8 + Math.random() * 0.5, offset: Math.random() * 0.22, reverb: 0.02 });
  }
}

// Something on the ground giving way. kind picks the material: 'masonry' (buildings, depots: a deep
// rumble and long crumble of brick), 'metal' (radar masts, hangars: a groan and clanging), 'wood'
// (watchtowers, bridges: splintering cracks), 'canvas' (tents: a soft whump).
export function collapse(mixer, where, kind, size = 1) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.5);
  const { ctx } = mixer;
  if (kind === 'canvas') {
    noiseBurst(mixer, dest, at, 0.45, { from: 900, to: 160, vol: 0.6, attack: 0.03 });
    return;
  }
  tone(mixer, dest, at, 1.4 * size, { from: 58, to: 24, vol: 0.9 * size });
  noiseLong(mixer, dest, at, 2.4 * size, { from: kind === 'masonry' ? 900 : 1400, to: 90, vol: 0.9 * size, attack: 0.08 });
  // Debris: a trickle of small impacts that thins out.
  for (let i = 0; i < 16 * size; i++) {
    const t = at + 0.15 + Math.random() ** 1.6 * 2.2 * size;
    const f = kind === 'metal' ? 1800 + Math.random() * 2400 : 700 + Math.random() * 1600;
    noiseBurst(mixer, dest, t, kind === 'wood' ? 0.05 : 0.035, { type: 'bandpass', from: f, to: f * 0.7, q: kind === 'metal' ? 8 : 3, vol: 0.12 + Math.random() * 0.15 });
  }
  if (kind === 'metal') {
    // Steel bending: a slow, falling groan.
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, at + 0.1);
    o.frequency.exponentialRampToValueAtTime(70, at + 1.4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at + 0.1);
    g.gain.linearRampToValueAtTime(0.18, at + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 1.5);
    o.connect(bp).connect(g).connect(dest);
    o.start(at + 0.1);
    o.stop(at + 1.6);
  }
  if (kind === 'wood') {
    for (let i = 0; i < 5; i++) noiseBurst(mixer, dest, at + i * 0.07 + Math.random() * 0.05, 0.03, { type: 'highpass', from: 2200, to: 1500, vol: 0.5 });
  }
  mixer.duck(0.4 * Math.min(1, where.gain * 1.5), 0.2, 1.4, at);
}

// Heavy things dropping into a river.
export function splash(mixer, where) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.4);
  noiseBurst(mixer, dest, at, 0.6, { from: 2400, to: 300, vol: 0.7, attack: 0.01 });
  for (let i = 0; i < 6; i++) tone(mixer, dest, at + 0.1 + Math.random() * 0.6, 0.06, { from: 500 + Math.random() * 400, to: 900 + Math.random() * 500, vol: 0.08 });
}

// A fire put out: a long hiss of steam and smothered flame.
export function fireOut(mixer, where) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.15);
  noiseLong(mixer, dest, at, 1.6, { type: 'highpass', from: 2500, to: 5500, vol: 0.35, attack: 0.04 });
  noiseBurst(mixer, dest, at, 0.3, { from: 700, to: 200, vol: 0.3 });
}

// Engineers knocking the last planks into place.
export function hammering(mixer, where) {
  const at = mixer.now + where.delay;
  const dest = out(mixer, where, at, 0.3);
  for (let i = 0; i < 4; i++) {
    tone(mixer, dest, at + i * 0.28, 0.06, { from: 900, to: 500, vol: 0.25, type: 'triangle' });
    noiseBurst(mixer, dest, at + i * 0.28, 0.03, { type: 'bandpass', from: 1800, to: 1200, q: 3, vol: 0.25 });
  }
}

// Your radar set dying: the power supply winds down with a falling whine and a final clunk.
export function radarPowerDown(mixer) {
  const { ctx } = mixer;
  const at = mixer.now;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(1500, at);
  o.frequency.exponentialRampToValueAtTime(45, at + 1.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.06, at + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0005, at + 1.7);
  o.connect(g).connect(mixer.buses.ambience);
  o.start(at);
  o.stop(at + 1.8);
  noiseBurst(mixer, mixer.buses.ambience, at + 1.55, 0.08, { from: 600, to: 120, vol: 0.25 });
}
