// Planform helpers for the Outline Lab's plan view (top view). A wing or tailplane is either a formula
// (root, tip, round, ellipse) or edge tables le/te as [z, d]: z metres out from the centre line, d back
// from the reference nose point. kit().surfaceOf already builds a surface from the tables; these turn a
// formula into tables to drag, and keep root, span and the table order in step with the points.
import { kit } from './plane-models.mjs';

const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Samples the current shape of a wing or tailplane as edge tables (denser towards the tip, where the
// outline bends most). Both tables end at the same z.
export function samplePlanform(o, key, n = 12) {
  const s = o[key];
  const { surfaceOf, Y, M } = kit(o);
  const part = surfaceOf(s);
  const y = Y(s.at);
  const le = [];
  const te = [];
  for (let i = 0; i <= n; i++) {
    const z = r4(Math.sin((i / n) * Math.PI / 2) * s.span);
    const sh = part.shape([0, y, z * M]);
    const row = (x) => [z, r4((o.frame.x - x) / M)];
    const a = row(sh.le);
    const b = row(sh.te);
    if (!le.length || le.at(-1)[0] !== z) {
      le.push(a);
      te.push(b);
    }
  }
  return { le, te };
}

// Sorts rows by column `col`, but a row that is within `tol` of its neighbour is left where it is: two stations
// at (nearly) the same position along the part make a step in the outline, and which comes first is the
// owner's choice. Plain stable sort when tol is 0. Bubble passes: only real inversions (more than tol) swap.
export function sortNear(rows, col, tol = 0) {
  if (tol <= 0) return rows.sort((a, b) => a[col] - b[col]);
  for (let swapped = true; swapped; ) {
    swapped = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i - 1][col] > rows[i][col] + tol) {
        [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
        swapped = true;
      }
    }
  }
  return rows;
}

// Puts the tables in order of z (rows within tol of each other keep their places, see sortNear), makes both end at the outermost z, and sets root (the model's bounding
// range of d) and span from them. Call when a drag ends, not during one (lines would jump).
export function fitPlanform(s, sort = true, tol = 0) {
  if (!s?.le || !s?.te) return;
  if (sort) {
    sortNear(s.le, 0, tol);
    sortNear(s.te, 0, tol);
  }
  const zmax = Math.max(s.le.at(-1)[0], s.te.at(-1)[0]);
  s.le.at(-1)[0] = zmax;
  s.te.at(-1)[0] = zmax;
  const ds = [...s.le, ...s.te].map((r) => r[1]);
  s.span = r4(zmax);
  s.root = [r4(Math.min(...ds)), r4(Math.max(...ds))];
  delete s.tip;
  delete s.round;
  delete s.ellipse;
}

// A formula wing becomes tables, drawn the same.
export function convertPlanform(o, key) {
  const s = o[key];
  Object.assign(s, samplePlanform(o, key));
  fitPlanform(s);
}

export function sampleVertical(o, s) {
  const { surfaceOf, Y, M } = kit(o);
  const part = surfaceOf(s, true);
  const y0 = Y(s.at) + (s.from ?? 0) * M;
  const y1 = Y(s.at) + s.span * M;
  const le = [];
  const te = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const y = y0 + ((y1 - y0) * i) / N;
    const sh = part.shape([0, y, 0]);
    const h = (y - o.frame.y) / M;
    le.push([h, (o.frame.x - sh.le) / M]);
    te.push([h, (o.frame.x - sh.te) / M]);
  }
  return { le, te };
}

// A fin given as edge tables is drawn between `at` and `at + span` over the d range `root`. Dragging a
// point can leave those behind (the preview then shows a clipped fin), so keep them in step with the
// points. For a fin that is already consistent this changes nothing.
export function fitFin(s) {
  if (!s?.le || !s?.te) return;
  const hs = [...s.le, ...s.te].map((r) => r[0]);
  s.at = r4(Math.min(...hs));
  s.span = r4(Math.max(...hs) - s.at);
  s.root = [r4(Math.min(...s.le.map((r) => r[1]))), r4(Math.max(...s.te.map((r) => r[1])))];
}

// Puts a fin's points back in order: every point goes under the edge (front or back) it lies on, each edge
// in height order, with the topmost point shared. A point keeps its edge unless it is well over the middle.
export function splitFin(s) {
  const key = (r) => `${r[0]},${r[1]}`;
  const inTe = new Set(s.te.map(key));
  const shared = s.le.filter((r) => inTe.has(key(r)));
  const sk = new Set(shared.map(key));
  const own = new Map();
  for (const r of s.le) if (!sk.has(key(r))) own.set(r, 'le');
  for (const r of s.te) if (!sk.has(key(r))) own.set(r, 'te');
  const rest = [...own.keys()];
  const all = [...shared, ...rest];
  const n = all.length;
  // The fin's middle line (d against h, least squares). A point keeps the edge it is listed under
  // unless it lies well over on the other side of that line.
  const mh = all.reduce((a, r) => a + r[0], 0) / n;
  const md = all.reduce((a, r) => a + r[1], 0) / n;
  const sxx = all.reduce((a, r) => a + (r[0] - mh) ** 2, 0);
  const b = sxx > 1e-9 ? all.reduce((a, r) => a + (r[0] - mh) * (r[1] - md), 0) / sxx : 0;
  const side = (r) => r[1] - (md + b * (r[0] - mh));
  const margin = 0.1 * (Math.max(...all.map((r) => r[1])) - Math.min(...all.map((r) => r[1])));
  const sideOf = (r) => (own.get(r) === 'le' ? (side(r) > margin ? 'te' : 'le') : side(r) < -margin ? 'le' : 'te');
  let top = shared.reduce((t, r) => (!t || r[0] > t[0] ? r : t), null);
  const highest = all.reduce((t, r) => (r[0] > t[0] ? r : t), all[0]);
  const base = shared.filter((r) => r !== top);
  if (!top || highest[0] > top[0]) {
    top = highest;
    if (shared.includes(top)) base.splice(base.indexOf(top), 1);
    else rest.splice(rest.indexOf(top), 1);
  }
  const byH = (x, y) => x[0] - y[0];
  const le = [...base, ...rest.filter((r) => sideOf(r) === 'le')].sort(byH);
  const te = [...base, ...rest.filter((r) => sideOf(r) === 'te')].sort(byH);
  return { le: [...le, top], te: [...te, [...top]] };
}


// A formula fin becomes edge tables (every fourth sample), drawn almost the same; the tip point is shared.
export function convertFin(o, key) {
  const s = o[key];
  const { le, te } = sampleVertical(o, s);
  const thin = (rows) => rows.filter((_, i) => i % 4 === 0 || i === rows.length - 1).map((r) => [r4(r[0]), r4(r[1])]);
  s.le = thin(le);
  s.te = thin(te);
  s.te[s.te.length - 1] = [...s.le.at(-1)];
  delete s.round;
}
