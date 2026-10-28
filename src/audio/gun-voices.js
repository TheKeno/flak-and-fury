// Pre-renders short one-shot sounds into AudioBuffers (several random variations each), so rapid-fire
// guns cost one buffer playback per shot. Recorded CC0 layers can later be blended in on top.
//
// A shot is: a supersonic crack (bright noise), the body thump of the gas (pitch-dropping sine),
// a gassy tail (low noise) and the mechanical clack of the action.
const GUNS = {
  rifle: { dur: 0.09, crack: 0.9, crackT: 0.0035, body: 0.45, bodyF: 190, bodyT: 0.012, tail: 0.3, tailT: 0.025, mech: 0.25, mechF: 3400 },
  heavy: { dur: 0.16, crack: 1.0, crackT: 0.005, body: 0.9, bodyF: 115, bodyT: 0.024, tail: 0.5, tailT: 0.045, mech: 0.3, mechF: 2500 },
  cannon20: { dur: 0.32, crack: 1.0, crackT: 0.006, body: 1.25, bodyF: 78, bodyT: 0.055, tail: 0.75, tailT: 0.09, mech: 0.35, mechF: 1800 },
  cannon30: { dur: 0.5, crack: 0.55, crackT: 0.008, body: 1.7, bodyF: 52, bodyT: 0.11, tail: 0.9, tailT: 0.15, mech: 0.22, mechF: 1200 },
};

function render(ctx, dur, fn) {
  const len = Math.ceil(dur * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  fn(d, ctx.sampleRate);
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak; // normalise; mix level is set at playback
  return buf;
}

function shot(ctx, v) {
  return render(ctx, v.dur, (d, sr) => {
    let lp = 0;
    let prevN = 0;
    const jitter = 0.9 + Math.random() * 0.2;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const n = Math.random() * 2 - 1;
      const crack = (n - prevN) * 0.5 * v.crack * Math.exp(-t / v.crackT); // differentiated noise = bright
      prevN = n;
      lp += (n - lp) * 0.06;
      const tail = lp * 3 * v.tail * Math.exp(-t / v.tailT);
      const f = v.bodyF * jitter * (1 - Math.min(0.5, t * 4));
      const body = Math.sin(2 * Math.PI * f * t) * v.body * Math.exp(-t / v.bodyT);
      const mt = t - 0.004;
      const mech = mt > 0 ? Math.sin(2 * Math.PI * v.mechF * mt) * v.mech * Math.exp(-mt / 0.004) : 0;
      d[i] = Math.tanh((crack + tail + body + mech) * 1.6);
    }
  });
}

// Bullet striking an airframe: a ringing metallic clank.
function clank(ctx) {
  return render(ctx, 0.12, (d, sr) => {
    const f1 = 1500 + Math.random() * 900;
    const f2 = f1 * (1.47 + Math.random() * 0.2);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const ring = (Math.sin(2 * Math.PI * f1 * t) + 0.6 * Math.sin(2 * Math.PI * f2 * t)) * Math.exp(-t / 0.03);
      const hit = (Math.random() * 2 - 1) * Math.exp(-t / 0.004);
      d[i] = ring * 0.7 + hit;
    }
  });
}

// Being hit yourself: a heavy thunk through the airframe.
function thunk(ctx) {
  return render(ctx, 0.2, (d, sr) => {
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      lp += ((Math.random() * 2 - 1) - lp) * 0.15;
      const body = Math.sin(2 * Math.PI * (320 - t * 900) * t) * Math.exp(-t / 0.035);
      d[i] = Math.tanh((body + lp * 2.5 * Math.exp(-t / 0.02)) * 2);
    }
  });
}

// A round passing close by: the sharp snap of its shock wave.
function snap(ctx) {
  return render(ctx, 0.05, (d, sr) => {
    let prev = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const n = Math.random() * 2 - 1;
      d[i] = (n - prev) * Math.exp(-t / 0.003) + Math.sin(2 * Math.PI * 2600 * t) * 0.3 * Math.exp(-t / 0.01);
      prev = n;
    }
  });
}

// Bullet into soil: a dull puff.
function thud(ctx) {
  return render(ctx, 0.07, (d, sr) => {
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      lp += ((Math.random() * 2 - 1) - lp) * 0.08;
      d[i] = lp * Math.exp(-t / 0.015);
    }
  });
}

// Mechanical clunk: bomb shackles releasing, or an empty gun's dry click.
function clunk(ctx, freq, decay) {
  return render(ctx, decay * 5, (d, sr) => {
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] = (Math.sin(2 * Math.PI * freq * t) * 0.8 + (Math.random() * 2 - 1) * 0.5) * Math.exp(-t / decay);
    }
  });
}

export function buildVoices(ctx) {
  const variations = (make, n = 4) => Array.from({ length: n }, make);
  const voices = {};
  for (const [name, v] of Object.entries(GUNS)) voices[name] = variations(() => shot(ctx, v));
  voices.clank = variations(() => clank(ctx));
  voices.thunk = variations(() => thunk(ctx), 3);
  voices.snap = variations(() => snap(ctx), 3);
  voices.thud = variations(() => thud(ctx), 3);
  voices.release = variations(() => clunk(ctx, 140, 0.03), 2);
  voices.click = variations(() => clunk(ctx, 2200, 0.004), 2);
  return voices;
}
