// Fit part to drawing (Outline Lab, automatic first trace). Pure functions on grayscale arrays, so the
// tests can run them on synthetic images. The browser builds the grayscale array from the blueprint.
//
// An edge map (strength 0..1 per pixel) is searched along rays the outline already defines, cast in
// calibrated model space and mapped to picture pixels by the view's affine matrix T (the lab's matT():
// pixel = [e + a*d + c*h, f + b*d + d*h], for the plan view h is z). Tilted, rotated and mirrored
// drawings work because only T knows about the picture. The outline's own rules hold by construction:
// station d stays, tables stay sorted (fitPlanform / fitFin / splitFin put them right after).
import { fitPlanform, convertPlanform, convertFin, fitFin, splitFin } from './planform.mjs';

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const BODY = ['fuselage', 'spinner', 'spine', 'canopy', 'nacelle', 'gunTray', 'radiators'];
// What "Fit all parts" does: the parts the decision calls automatable or medium. Radiators, gun tray and
// the gear stay manual (nothing to see in the drawing, or hidden by other parts).
export const FIT_ALL = ['fuselage', 'spinner', 'canopy', 'nacelle', 'wing', 'tailplane', 'fin', 'fins'];

// ---------- Edge map ----------
// Strength from a lightly blurred Sobel, plus the outline of the foreground when the picture has a
// plain background (flood from the border): filled drawings like the camouflaged Czech sheet have little
// gradient inside but a clear silhouette. Result is a Float32Array in 0..1.
export function edgeMap(gray, w, h, { tol = 24 } = {}) {
  const blur = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += gray[yy * w + xx];
          n++;
        }
      }
      blur[y * w + x] = s / n;
    }
  }
  const mag = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = blur[i - w + 1] + 2 * blur[i + 1] + blur[i + w + 1] - blur[i - w - 1] - 2 * blur[i - 1] - blur[i + w - 1];
      const gy = blur[i + w - 1] + 2 * blur[i + w] + blur[i + w + 1] - blur[i - w - 1] - 2 * blur[i - w] - blur[i - w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > max) max = m;
    }
  }
  // Reference strength: the 99.5th percentile, but not under a third of the maximum, so a sparse line
  // drawing and a busy painted one both come out with their real edges near 1.
  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  if (max > 0) for (let i = 0; i < mag.length; i++) hist[Math.min(BINS - 1, Math.floor((mag[i] / max) * BINS))]++;
  let acc = 0;
  let p995 = max;
  for (let b = BINS - 1; b >= 0; b--) {
    acc += hist[b];
    if (acc > mag.length * 0.005) {
      p995 = ((b + 1) / BINS) * max;
      break;
    }
  }
  const ref = Math.max(p995, max / 3, 1e-6);
  for (let i = 0; i < mag.length; i++) mag[i] = Math.min(1, mag[i] / ref);
  const bg = floodBackground(gray, w, h, tol);
  if (bg) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (bg[i]) continue;
        if ((x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w])) mag[i] = 1;
      }
    }
  }
  return { w, h, e: mag };
}

// Pixels reachable from the border that match the border's typical grey, or null when the border is not
// plain (then the picture has no usable background to find a silhouette against).
export function floodBackground(gray, w, h, tol = 24) {
  const hist = new Uint32Array(256);
  let n = 0;
  const edge = (x, y) => {
    hist[Math.max(0, Math.min(255, Math.round(gray[y * w + x])))]++;
    n++;
  };
  for (let x = 0; x < w; x++) (edge(x, 0), edge(x, h - 1));
  for (let y = 1; y < h - 1; y++) (edge(0, y), edge(w - 1, y));
  let acc = 0;
  let level = 0;
  for (; level < 256; level++) {
    acc += hist[level];
    if (acc >= n / 2) break;
  }
  let near = 0;
  for (let l = Math.max(0, level - tol); l <= Math.min(255, level + tol); l++) near += hist[l];
  if (near < n * 0.8) return null;
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (!bg[i] && Math.abs(gray[i] - level) <= tol) {
      bg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) (push(x, 0), push(x, h - 1));
  for (let y = 0; y < h; y++) (push(0, y), push(w - 1, y));
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  let count = 0;
  for (let i = 0; i < bg.length; i++) count += bg[i];
  return count < bg.length * 0.2 ? null : bg; // a flood that found almost nothing says nothing
}

// Bilinear edge strength at picture pixel coordinates (pixel i covers [i, i + 1)).
export function sampleMap(map, x, y) {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= map.w || yy >= map.h ? 0 : map.e[yy * map.w + xx]);
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}

// ---------- Ray search ----------
// Looks along a ray for the strongest edge near its start. `at(t)` maps t (metres from the template's
// point) to a picture pixel; the search runs over -win..win. Returns { t, e } or null when nothing
// is strong enough. A strong edge nearby beats a stronger one far away.
export function rayFit(map, at, win, { thr = 0.3, outward = 0, keep = 0.5 } = {}) {
  const p0 = at(0);
  const p1 = at(win);
  const ppm = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / win; // picture pixels per metre
  const n = Math.max(5, Math.ceil(2 * win * ppm) + 1);
  const es = [];
  for (let i = 0; i < n; i++) {
    const p = at(-win + (2 * win * i) / (n - 1));
    es.push(sampleMap(map, p[0], p[1]));
  }
  const found = [];
  for (let i = 1; i < n - 1; i++) {
    if (es[i] < thr || es[i] < es[i - 1] || es[i] <= es[i + 1]) continue;
    const t = -win + (2 * win * i) / (n - 1);
    found.push({ t, e: es[i], score: es[i] * (1 - 0.6 * Math.abs(t) / win) });
  }
  if (!found.length) return null;
  let best = found.reduce((a, b) => (b.score > a.score ? b : a));
  // A silhouette is the outermost edge: interior lines (panel lines, roundels, camouflage borders, a pale
  // patch) lie inside it. With `outward` (+1 or -1: the sign of t that leads away from the part's middle),
  // an edge further out wins if it is nearly as strong as the best one.
  if (outward) {
    const strong = found.filter((f) => f.e >= keep * best.e);
    best = strong.reduce((a, b) => (outward * b.t > outward * a.t ? b : a));
  }
  return { t: r4(best.t), e: best.e };
}

// One edge's worth of points: shifts[i] (null where nothing was found). A single point far off from the
// shifts on both sides is a stray edge (a rivet line, a label): drop it.
function despike(shifts, win) {
  return shifts.map((s, i) => {
    if (s === null) return s;
    const nb = [shifts[i - 1], shifts[i + 1]].filter((v) => v !== null && v !== undefined);
    if (nb.length < 2) return s;
    const mid = (nb[0] + nb[1]) / 2;
    return Math.abs(s - mid) > win * 0.6 && Math.abs(nb[0] - nb[1]) < win * 0.3 ? null : s;
  });
}


// ---------- Station placement ----------
// Douglas-Peucker on [x, y] points sorted by x: indices to keep so every dropped point lies within tol
// (in y) of the straight line between its kept neighbours. The model interpolates stations linearly, so
// this is exactly the error the finished outline will have.
export function simplifyLine(pts, tol) {
  const keep = new Set([0, pts.length - 1]);
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let wd = tol;
    for (let i = a + 1; i < b; i++) {
      const t = (pts[i][0] - pts[a][0]) / (pts[b][0] - pts[a][0] || 1);
      const dev = Math.abs(pts[i][1] - (pts[a][1] + (pts[b][1] - pts[a][1]) * t));
      if (dev > wd) {
        wd = dev;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep.add(worst);
      stack.push([a, worst], [worst, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

const lerpRows = (rows, d, j) => {
  if (d <= rows[0][0]) return rows[0][j];
  for (let i = 1; i < rows.length; i++) {
    if (d <= rows[i][0]) {
      const t = (d - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0] || 1);
      return rows[i - 1][j] + (rows[i][j] - rows[i - 1][j]) * t;
    }
  }
  return rows.at(-1)[j];
};
const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];

// Fills the gaps in a list of shifts (null = no edge) from the nearest found ones; all null stays null.
function fillGaps(sh) {
  const idx = sh.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (!idx.length) return null;
  return sh.map((v, i) => {
    if (v !== null) return v;
    const before = idx.filter((k) => k < i).at(-1);
    const after = idx.find((k) => k > i);
    if (before === undefined) return sh[after];
    if (after === undefined) return sh[before];
    return sh[before] + ((sh[after] - sh[before]) * (i - before)) / (after - before);
  });
}

// Side view: samples the top and bottom profile every `tol` metres between the part's first and last
// station, fits each sample to the drawing, simplifies both profiles and puts a station at the union of
// their break points (top and bottom share one d). Half widths are carried over from the old stations
// (the plan view fits them later). Returns the same { hits, total } plus the station counts.
function replaceStations(o, key, T, map, win, tol) {
  const s = o[key];
  const rows = s.stations;
  const before = rows.length;
  const d0 = rows[0][0];
  const d1 = rows.at(-1)[0];
  const n = Math.max(2, Math.ceil((d1 - d0) / tol));
  const ds = Array.from({ length: n + 1 }, (_, i) => r4(d0 + ((d1 - d0) * i) / n));
  const wantBottom = key !== 'canopy' && key !== 'spine';
  const sym = rows.every((r) => Math.abs(r[1] + r[2]) < 1e-9);
  let hits = 0;
  const shifts = (col) =>
    ds.map((d) => {
      const h = lerpRows(rows, d, col);
      const r = rayFit(map, (t) => apply(T, d, h + t), win, { outward: col === 1 ? 1 : -1 });
      if (r) hits++;
      return r ? r.t : null;
    });
  const smooth = (sh) => {
    const f = sh && fillGaps(sh);
    if (!f) return f;
    // Median (kills a stray edge), then a short average (picture noise of a pixel or two must not become stations).
    const m = f.map((_, i) => median(f.slice(Math.max(0, i - 3), i + 4)));
    return m.map((_, i) => {
      const w = m.slice(Math.max(0, i - 2), i + 3);
      return w.reduce((a, b) => a + b, 0) / w.length;
    });
  };
  const top = smooth(shifts(1));
  const bot = wantBottom ? smooth(shifts(2)) : null;
  const total = ds.length * (wantBottom ? 2 : 1);
  if (!top && !bot) return { hits: 0, total, before, after: before };
  const tp = ds.map((d, i) => [d, lerpRows(rows, d, 1) + (top?.[i] ?? 0)]);
  const bp = ds.map((d, i) => [d, lerpRows(rows, d, 2) + (bot?.[i] ?? 0)]);
  if (sym) {
    ds.forEach((_, i) => {
      const hh = Math.max(0.01, (tp[i][1] - bp[i][1]) / 2);
      tp[i][1] = hh;
      bp[i][1] = -hh;
    });
  }
  const idx = [...new Set([...simplifyLine(tp, tol), ...(wantBottom || sym ? simplifyLine(bp, tol) : [])])].sort((a, b) => a - b);
  s.stations = idx.map((i) => [ds[i], r4(tp[i][1]), r4(bp[i][1]), r4(lerpRows(rows, ds[i], 3))]);
  return { hits, total, before, after: s.stations.length };
}

// ---------- Fitting a part ----------
// Every function returns how many points found an edge ({ hits, total }), the template-over-drawing check:
// when hardly any point does, the calibration (or the sheet's turn) is wrong, not the template.
const apply = (T, d, h) => [T.e + T.a * d + T.c * h, T.f + T.b * d + T.d * h];

function fitStations(o, key, mode, T, map, win) {
  const s = o[key];
  const rows = s.stations;
  const side = mode === 'side';
  const sym = rows.every((r) => Math.abs(r[1] + r[2]) < 1e-9);
  const z0 = s.z ?? 0;
  let hits = 0;
  let total = 0;
  const find = (d, h, dir, outward) => {
    total++;
    const r = rayFit(map, (t) => apply(T, d + dir[0] * t, h + dir[1] * t), win, { outward });
    if (r) hits++;
    return r ? r.t : null;
  };
  if (side) {
    const wantBottom = key !== 'canopy' && key !== 'spine';
    const top = despike(rows.map((r) => find(r[0], r[1], [0, 1], 1)), win);
    const bottom = wantBottom ? despike(rows.map((r) => find(r[0], r[2], [0, 1], -1)), win) : rows.map(() => null);
    rows.forEach((r, i) => {
      const nt = r[1] + (top[i] ?? 0);
      const nb = r[2] + (bottom[i] ?? 0);
      if (sym) {
        const hh = r4(Math.max(0.01, (nt - nb) / 2));
        r[1] = hh;
        r[2] = -hh;
      } else {
        r[1] = r4(nt);
        r[2] = r4(wantBottom ? Math.min(nb, nt) : nb);
      }
    });
  } else {
    const w = despike(rows.map((r) => find(r[0], z0 + r[3], [0, 1], 1)), win);
    rows.forEach((r, i) => {
      r[3] = r4(Math.max(0, r[3] + (w[i] ?? 0)));
    });
  }
  return { hits, total };
}

function fitSurface(o, key, T, map, win) {
  if (!o[key].le) convertPlanform(o, key);
  const s = o[key];
  let hits = 0;
  let total = 0;
  for (const edge of ['le', 'te']) {
    const rows = s[edge];
    // Skip the root point (on the centre line, hidden in the fuselage); the tip row too is searched.
    const found = rows.map((r, i) => {
      if (i === 0) return null;
      total++;
      const f = rayFit(map, (t) => apply(T, r[1] + t, r[0]), win, { outward: edge === 'le' ? -1 : 1 });
      if (f) hits++;
      return f ? f.t : null;
    });
    despike(found, win).forEach((t, i) => {
      if (t !== null) rows[i][1] = r4(rows[i][1] + t);
    });
  }
  fitPlanform(s);
  return { hits, total };
}

function fitFinPart(o, key, T, map, win) {
  if (!o[key].le) convertFin(o, key);
  const s = o[key];
  let hits = 0;
  let total = 0;
  const last = s.le.length - 1;
  let tipShift = null;
  for (const edge of ['le', 'te']) {
    const rows = s[edge];
    const found = rows.map((r, i) => {
      if (i === rows.length - 1 && edge === 'te') return null; // the tip is shared: fitted with the leading edge
      total++;
      const f = rayFit(map, (t) => apply(T, r[1] + t, r[0]), win, { outward: edge === 'le' ? -1 : 1 });
      if (f) hits++;
      return f ? f.t : null;
    });
    despike(found, win).forEach((t, i) => {
      if (t === null) return;
      rows[i][1] = r4(rows[i][1] + t);
      if (edge === 'le' && i === last) tipShift = rows[i][1];
    });
  }
  s.te[s.te.length - 1] = [...s.le[last]];
  Object.assign(s, splitFin(s));
  fitFin(s);
  return { hits, total, tipShift };
}

// Fits one part of `o` (changed in place: pass a copy) to the edge map. Side view: station tops and
// bottoms along h, fin edges along d; plan and underside view: half widths along z, wing and tailplane
// edges along d. `replace` (side view, body parts) also re-places the stations: see replaceStations; tol is
// then the simplification tolerance in metres (half a sprite pixel). Parts with nothing to fit in this view do nothing. T maps model (d, h|z) to the map's pixels.
export function fitPart(o, key, mode, T, map, { win = 0.3, replace = false, tol = 0.05 } = {}) {
  if (!o[key]) return { hits: 0, total: 0 };
  if (BODY.includes(key)) return replace && mode === 'side' ? replaceStations(o, key, T, map, win, tol) : fitStations(o, key, mode, T, map, win);
  if (mode === 'side') return key === 'fin' || key === 'fins' ? fitFinPart(o, key, T, map, win) : { hits: 0, total: 0 };
  if (key === 'wing' || key === 'tailplane') return fitSurface(o, key, T, map, win);
  return { hits: 0, total: 0 };
}
