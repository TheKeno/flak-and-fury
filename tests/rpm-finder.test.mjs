// The Sound Lab's rpm finder, on synthetic engines whose rpm is known.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRpm } from '../src/audio/rpm-finder.js';

const RATE = 44100;

// A firing pulse per cylinder: a damped ring, with a little noise. `amps` repeats over the cylinders
// (an uneven radial) and `tones` the ring pitch per cylinder; `sweep` ends the clip at another rpm.
function engine({ rpm, cylinders = 12, seconds = 3, amps = [1], tones = [320], sweep = null, noise = 0.05 }) {
  const out = new Float32Array(Math.round(seconds * RATE));
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  let t = 0;
  let n = 0;
  while (t < seconds) {
    const here = sweep ? rpm + (sweep - rpm) * (t / seconds) : rpm;
    const a = amps[n % amps.length];
    const at = Math.round(t * RATE);
    for (let i = 0; i < 0.012 * RATE && at + i < out.length; i++) {
      const s = i / RATE;
      out[at + i] += a * Math.exp(-s / 0.003) * Math.sin(2 * Math.PI * tones[n % tones.length] * s);
    }
    t += 120 / (here * cylinders);
    n++;
  }
  for (let i = 0; i < out.length; i++) out[i] += noise * rnd();
  return out;
}

const within = (got, want, tol) => assert.ok(Math.abs(got / want - 1) < tol, `${got} is not within ${tol * 100}% of ${want}`);

test('finds the rpm of an even V12 at idle, cruise and full', () => {
  for (const rpm of [800, 1800, 2800]) {
    const r = findRpm(engine({ rpm }), RATE, { cylinders: 12 });
    within(r.rpm, rpm, 0.015);
    assert.ok(r.conf > 0.5 && r.steadiness > 0.8, `${rpm}: conf ${r.conf} steadiness ${r.steadiness}`);
  }
});

test('finds the rpm of an uneven nine-cylinder radial', () => {
  const amps = [1, 0.6, 0.9, 0.5, 1, 0.7, 0.8, 0.55, 0.95];
  const r = findRpm(engine({ rpm: 1400, cylinders: 9, amps, tones: [320, 380, 440] }), RATE, { cylinders: 9, hint: 1300 });
  within(r.rpm, 1400, 0.02);
});

test('a rough rpm picks the octave', () => {
  const clip = engine({ rpm: 1800 });
  within(findRpm(clip, RATE, { cylinders: 12, hint: 1700 }).rpm, 1800, 0.015);
  // The half is a plausible repeat too; it is offered as an alternative.
  const alt = findRpm(clip, RATE, { cylinders: 12 }).alternatives;
  assert.ok(alt.some((a) => Math.abs(a.rpm / 900 - 1) < 0.02));
});

test('a sweep is reported as not steady', () => {
  const r = findRpm(engine({ rpm: 1200, sweep: 2400, seconds: 5 }), RATE, { cylinders: 12 });
  assert.ok(r.steadiness < 0.5, `steadiness ${r.steadiness}`);
  const rpms = r.track.filter((p) => p.conf > 0.4).map((p) => p.rpm);
  assert.ok(rpms[rpms.length - 1] > rpms[0] * 1.5);
});

test('silence and noise give no rpm', () => {
  assert.equal(findRpm(new Float32Array(RATE * 2), RATE).rpm, null);
  let seed = 7;
  const noise = Float32Array.from({ length: RATE * 2 }, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1);
  const r = findRpm(noise, RATE);
  assert.ok(r.rpm === null || r.conf < 0.5, `noise gave ${r.rpm} at ${r.conf}`);
});
