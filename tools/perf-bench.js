// Frame-cost bench for the browser console (perf work, notes/perf-findings.md): with a match running,
//   await import('/tools/perf-bench.js'); __bench('cloud', 2340, 800)
// renders the scene at a fixed free-look camera many times and gives CPU ms, draw calls and painted
// megapixels per profiler section (prof.mark in the renderer). Calls and pixels stand for the GPU's share,
// which a hidden or throttled browser pane cannot time.
import { prof } from '../src/ui/perfstats.js';
const g = __game, w = g.world, R = g.renderer;
// Count draw calls and painted pixels per profiler section (the GPU's share, independent of a hidden pane).
if (!window.__counted) {
  window.__counted = true;
  window.__dc = { calls: 0, px: 0 };
  const P = CanvasRenderingContext2D.prototype;
  for (const name of ['fillRect', 'drawImage', 'fill', 'stroke', 'fillText', 'clearRect', 'putImageData']) {
    const orig = P[name];
    P[name] = function (...a) {
      if (!window.__countOn) return orig.apply(this, a);
      const d = window.__dc;
      d.calls++;
      if (name === 'fillRect' || name === 'clearRect') d.px += Math.abs(a[2] * a[3]) * Math.abs(this.getTransform().a * this.getTransform().d);
      else if (name === 'drawImage') {
        const t = this.getTransform();
        const k = Math.abs(t.a * t.d);
        d.px += (a.length >= 9 ? Math.abs(a[7] * a[8]) : a.length >= 5 ? Math.abs(a[3] * a[4]) : a[0].width * a[0].height) * k;
      }
      return orig.apply(this, a);
    };
  }
  const mark = prof.mark.bind(prof);
  window.__secDC = new Map();
  prof.mark = function (name) {
    if (this.on) {
      const s = window.__secDC.get(name) ?? { calls: 0, px: 0 };
      s.calls += window.__dc.calls; s.px += window.__dc.px;
      window.__secDC.set(name, s);
    }
    window.__dc = { calls: 0, px: 0 };
    mark(name);
  };
}
window.__bench = function (name, x, y, { n = 120, setup = () => {}, undo = () => {}, count = false } = {}) {
  setup();
  const opts = { showHelp: false, look: null, free: { x, y, zoom: 1, speed: 1 }, paused: false, bombView: false };
  prof.on = true;
  for (let i = 0; i < 10; i++) { prof.begin(); R.render(g.player, 1 / 60, opts); }
  prof.sections.clear(); window.__secDC.clear();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { prof.begin(); R.render(g.player, 1 / 60, opts); }
  const total = (performance.now() - t0) / n;
  const times = new Map(prof.sections); prof.sections.clear(); window.__secDC.clear();
  window.__countOn = true;
  for (let i = 0; i < 20; i++) { prof.begin(); R.render(g.player, 1 / 60, opts); }
  window.__countOn = false;
  const out = { name, total: +total.toFixed(2) };
  for (const [k, v] of times) {
    const dc = window.__secDC.get(k) ?? { calls: 0, px: 0 };
    if (v / n >= 0.01 || dc.calls / 20 >= 5) out[k] = `${(v / n).toFixed(2)}ms ${Math.round(dc.calls / 20)}c ${(dc.px / 20 / 1e6).toFixed(2)}Mpx`;
  }
  prof.sections.clear(); prof.on = false; undo();
  return out;
};

// The standard set: ground war, the cloud layer, rain, night, and all three; weather switched on only for the run.
window.__scenes = function () {
  const c = w.cloud;
  const keep = { rain: c?.rain ?? 0, night: w.rules.night };
  const set = (rain, night) => () => { if (c) c.rain = rain; w.rules.night = night; };
  const back = set(keep.rain, keep.night);
  const x = w.terrain.width / 2;
  return [
    __bench('ground', x, 120, { setup: set(0, false), undo: back }),
    __bench('cloud', x, 800, { setup: set(0, false), undo: back }),
    __bench('rain', x, 650, { setup: set(1, false), undo: back }),
    __bench('night', x, 150, { setup: set(0, true), undo: back }),
    __bench('all', x, 700, { setup: set(1, true), undo: back }),
  ];
};
// The screen after one render of a scene, as a data URL, and how many pixels two such shots differ in.
window.__shot = function (x, y, skips = []) {
  for (const k of skips) R.skip.add(k);
  const opts = { showHelp: false, look: null, free: { x, y, zoom: 1, speed: 1 }, paused: true, bombView: false };
  R.render(g.player, 0, opts);
  for (const k of skips) R.skip.delete(k);
  const cv = document.getElementById('screen');
  return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
};
window.__diff = function (a, b) {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 6) n++;
  return { differ: n, of: a.data.length / 4 };
};
