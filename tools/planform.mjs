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

// Puts the tables in order of z, makes both end at the outermost z, and sets root (the model's bounding
// range of d) and span from them. Call when a drag ends, not during one (lines would jump).
export function fitPlanform(s, sort = true) {
  if (!s?.le || !s?.te) return;
  if (sort) {
    s.le.sort((a, b) => a[0] - b[0]);
    s.te.sort((a, b) => a[0] - b[0]);
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
