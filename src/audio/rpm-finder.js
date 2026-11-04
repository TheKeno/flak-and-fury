// Suggests the rpm an engine clip was recorded at (Sound Lab). Pure analysis, no DOM or audio nodes.
// A four-stroke fires cylinders / 2 times per revolution, so the sound repeats at
// rpm / 60 * cylinders / 2 Hz. Short overlapping windows are scored by how well the sound repeats at
// that period and at its multiples (normalised autocorrelation), and the best candidate rpm wins.

const TARGET_RATE = 16000; // the low harmonics carry the pulse; no need for more
const MAX_LAG = 0.14; // s: the longest repeat looked at
const COMB = 4; // repeats checked per candidate
const WINDOW = 0.4; // s
const HOP = 0.2; // s
const STEP = 1.005; // candidate spacing: 0.5 %
const CONF_MIN = 0.4; // a window below this is not trusted
const STEADY = 0.03; // windows within 3 % of the median count as steady
const PEAK_KEEP = 0.9; // a higher candidate this close to the best wins: the true pulse, not a slower repeat

function decimate(x, rate) {
  const f = Math.max(1, Math.round(rate / TARGET_RATE));
  if (f === 1) return { x, rate };
  const out = new Float32Array(Math.floor(x.length / f));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < f; k++) s += x[i * f + k];
    out[i] = s / f;
  }
  return { x: out, rate: rate / f };
}

// The loudness shape of a window: firing pulses of different tone still land one period apart.
function envelope(seg, rate) {
  const w = Math.max(1, Math.round(0.0015 * rate));
  const out = new Float32Array(seg.length);
  let s = 0;
  for (let i = 0; i < seg.length; i++) {
    s += Math.abs(seg[i]);
    if (i >= w) s -= Math.abs(seg[i - w]);
    out[i] = s / w;
  }
  return out;
}

// Normalised autocorrelation of one window, lags 0..maxLag.
function nacf(seg, maxLag) {
  const n = seg.length;
  const m = n - maxLag;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += seg[i];
  mean /= n;
  const x = new Float32Array(n);
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    x[i] = seg[i] - mean;
    sq[i + 1] = sq[i] + x[i] * x[i];
  }
  const r = new Float32Array(maxLag + 1);
  const e1 = sq[m];
  if (e1 < 1e-9) return { r, rms: 0 };
  for (let tau = 0; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += x[i] * x[i + tau];
    r[tau] = s / Math.sqrt(e1 * (sq[m + tau] - sq[tau]) + 1e-20);
  }
  return { r, rms: Math.sqrt(e1 / m) };
}

const lagAt = (r, lag) => {
  const i = Math.floor(lag);
  if (i < 0 || i + 1 >= r.length) return 0;
  return r[i] + (r[i + 1] - r[i]) * (lag - i);
};

const periodOf = (rpm, cylinders, rate) => (120 / (rpm * cylinders)) * rate; // samples between firings

// How well one window repeats at this rpm's firing period and its multiples, 0 to 1.
function score(r, rpm, cylinders, rate) {
  const t = periodOf(rpm, cylinders, rate);
  const k = Math.min(COMB, Math.floor((r.length - 1) / t));
  if (k < 1) return 0;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.max(0, lagAt(r, i * t));
  return s / k;
}

// The waveform and the loudness shape each vote; whichever repeats better counts.
function bestScore(rs, rpm, cylinders, rate) {
  let best = { score: -1, r: rs[0] };
  for (const r of rs) {
    const s = score(r, rpm, cylinders, rate);
    if (s > best.score) best = { score: s, r };
  }
  return best;
}

// Moves a candidate to the exact peak of its longest repeat, which is the most precise.
function refine(r, rpm, cylinders, rate) {
  const t = periodOf(rpm, cylinders, rate);
  const k = Math.min(COMB, Math.floor((r.length - 1) / t));
  if (k < 1) return rpm;
  let best = Math.round(k * t);
  const lo = Math.max(1, Math.floor(k * t * 0.97));
  const hi = Math.min(r.length - 2, Math.ceil(k * t * 1.03));
  for (let l = lo; l <= hi; l++) if (r[l] > r[best]) best = l;
  best = Math.max(1, Math.min(r.length - 2, best));
  const a = r[best - 1], b = r[best], c = r[best + 1];
  const d = a - 2 * b + c;
  const lag = best + (d < 0 ? (0.5 * (a - c)) / d : 0);
  return (120 * rate * k) / (lag * cylinders);
}

// Power near one frequency (Hann window), with a little slack either side for the rpm not being exact.
function tonePower(seg, rate, hz) {
  const n = seg.length;
  let best = 0;
  for (const f of [hz * 0.985, hz, hz * 1.015]) {
    const w = (2 * Math.PI * f) / rate;
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const v = seg[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
      re += v * Math.cos(w * i);
      im += v * Math.sin(w * i);
    }
    best = Math.max(best, re * re + im * im);
  }
  return best;
}

// A V12's banks sound a little different, so the sound repeats best every second firing and the
// autocorrelation lands an octave low. The giveaway: its odd harmonics are missing.
function missingOdd(segs, rpm, cylinders, rate) {
  const f = (rpm * cylinders) / 120;
  let odd = 0, even = 0;
  for (const seg of segs) {
    for (let k = 1; k <= 8 && k * f < Math.min(2000, rate * 0.45); k++) {
      if (k % 2) odd += tonePower(seg, rate, k * f);
      else even += tonePower(seg, rate, k * f);
    }
  }
  return even > odd * 4;
}

function median(a) {
  const s = [...a].sort((p, q) => p - q);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

// samples: mono Float32Array; hint (optional): a rough rpm by ear, which picks the octave.
export function findRpm(samples, sampleRate, { cylinders = 12, hint = 0, minRpm = 250, maxRpm = 4500 } = {}) {
  const { x, rate } = decimate(samples, sampleRate);
  const lo = hint > 0 ? Math.max(minRpm, hint * 0.6) : minRpm;
  const hi = hint > 0 ? Math.min(maxRpm, hint * 1.7) : maxRpm;
  const grid = [];
  for (let rpm = lo; rpm <= hi; rpm *= STEP) grid.push(rpm);
  const maxLag = Math.round(MAX_LAG * rate);
  const size = Math.round(WINDOW * rate);
  const hop = Math.round(HOP * rate);
  const duration = x.length / rate;
  const track = [];
  const starts = [];
  const lags = [];
  for (let start = 0; start + size <= x.length; start += hop) {
    const seg = x.subarray(start, start + size);
    const { r: wave, rms } = nacf(seg, maxLag);
    const rs = [wave, nacf(envelope(seg, rate), maxLag).r];
    const t = (start + size / 2) / rate;
    lags.push(rs);
    if (rms < 1e-6) {
      track.push({ t, rpm: null, conf: 0 });
      continue;
    }
    const scores = grid.map((rpm) => bestScore(rs, rpm, cylinders, rate).score);
    const top = Math.max(...scores);
    // The highest peak close to the best: a slower candidate repeats whenever the true one does.
    let pick = -1;
    for (let i = scores.length - 1; i > 0; i--) {
      if (scores[i] >= top * PEAK_KEEP && scores[i] >= scores[i - 1] && (i === scores.length - 1 || scores[i] >= scores[i + 1])) {
        pick = i;
        break;
      }
    }
    if (pick < 0) pick = scores.indexOf(top);
    starts.push(start);
    track.push({ t, rpm: refine(bestScore(rs, grid[pick], cylinders, rate).r, grid[pick], cylinders, rate), conf: Math.min(1, scores[pick]) });
  }
  const good = track.filter((p) => p.conf >= CONF_MIN);
  if (!good.length) return { track, rpm: null, conf: 0, steadiness: 0, alternatives: [], duration };
  const mid = median(good.map((p) => p.rpm));
  const steady = good.filter((p) => Math.abs(p.rpm / mid - 1) < STEADY);
  let rpm = median(steady.map((p) => p.rpm));
  if (hint <= 0) {
    const segs = track.map((p, i) => (steady.includes(p) ? x.subarray(starts[i], starts[i] + size) : null)).filter(Boolean);
    for (let n = 0; n < 2 && rpm * 2 <= maxRpm && missingOdd(segs, rpm, cylinders, rate); n++) rpm *= 2;
  }
  const alternatives = [rpm / 2, rpm * 2, rpm / 3, rpm * 3].filter((a) => a >= minRpm && a <= maxRpm).map((a) => {
    const idx = track.map((p, i) => (steady.includes(p) ? i : -1)).filter((i) => i >= 0);
    return { rpm: a, score: idx.reduce((s, i) => s + bestScore(lags[i], a, cylinders, rate).score, 0) / idx.length };
  });
  return {
    track, rpm,
    conf: steady.reduce((s, p) => s + p.conf, 0) / steady.length,
    steadiness: steady.length / track.length,
    alternatives, duration,
  };
}
