// Fit part to drawing (tools/edgefit.mjs) on synthetic pictures: a dark shape on a light sheet, drawn
// through an affine matrix so the same shape can be upright, rotated or mirrored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeMap, rayFit, fitPart, simplifyLine } from '../tools/edgefit.mjs';

const W = 360;
const H = 300;
// Matrices as the lab's matT(): pixel = [e + a*d + c*h, f + b*d + d*h]; 30 picture pixels per metre.
const TS = {
  upright: { a: 30, b: 0, c: 0, d: -30, e: 30, f: 150 },
  mirrored: { a: -30, b: 0, c: 0, d: -30, e: 330, f: 150 },
  rotated: { a: 0, b: 30, c: 30, d: 0, e: 150, f: 20 }, // d runs down, h to the right
  turned: { a: 21.2, b: 21.2, c: 21.2, d: -21.2, e: 60, f: 60 }, // 45 degrees
};

// Dark where inside(d, h) holds, light elsewhere, under the matrix T.
function picture(T, inside, w = W, h = H) {
  const det = T.a * T.d - T.b * T.c;
  const g = new Float32Array(w * h).fill(235);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - T.e;
      const dy = y + 0.5 - T.f;
      const d = (T.d * dx - T.c * dy) / det;
      const hh = (-T.b * dx + T.a * dy) / det;
      if (inside(d, hh)) g[y * w + x] = 60;
    }
  }
  return g;
}
const mapOf = (g) => edgeMap(g, W, H);
const tol = 1.5 / 30; // 1.5 picture pixels, in metres

test('edgeMap: a filled shape on a plain sheet has its silhouette as the strongest line', () => {
  const m = mapOf(picture(TS.upright, (d, h) => d > 1 && d < 6 && h > -1 && h < 1));
  const at = (x, y) => m.e[y * W + x];
  assert.ok(at(150, 150 - 30) >= 0.9, 'top edge (h = 1 at row 120)'); // d = 4 -> x 150
  assert.ok(at(150, 150) < 0.05, 'flat inside');
  assert.ok(at(250, 40) < 0.05, 'flat sheet');
});

test('rayFit finds an edge inside the window and none outside it', () => {
  const T = TS.upright;
  const m = mapOf(picture(T, (d, h) => d > 1 && d < 8 && h > -1 && h < 1));
  const at = (h0) => (t) => [T.e + T.a * 4 + T.c * (h0 + t), T.f + T.b * 4 + T.d * (h0 + t)];
  const r = rayFit(m, at(1.15), 0.3);
  assert.ok(r && Math.abs(r.t - -0.15) < tol, `found ${r?.t}`);
  assert.equal(rayFit(m, at(1.6), 0.3), null);
});

for (const [name, T] of Object.entries(TS)) {
  test(`fitPart (side view, ${name} drawing): station tops and bottoms move onto the drawn outline`, () => {
    const m = mapOf(picture(T, (d, h) => d > 0.5 && d < 7.5 && h > -0.5 && h < 0.7));
    const o = { fuselage: { stations: [[2, 0.85, -0.3, 0.4], [4, 0.8, -0.4, 0.4], [6, 0.9, -0.35, 0.4]] } };
    const r = fitPart(o, 'fuselage', 'side', T, m, { win: 0.3 });
    assert.equal(r.hits, 6);
    for (const row of o.fuselage.stations) {
      assert.ok(Math.abs(row[1] - 0.7) < tol, `top ${row[1]}`);
      assert.ok(Math.abs(row[2] - -0.5) < tol, `bottom ${row[2]}`);
    }
    assert.deepEqual(o.fuselage.stations.map((r) => r[0]), [2, 4, 6], 'station d stays');
  });

  test(`fitPart (plan view, ${name} drawing): wing edges move along d, z stays, tables stay sorted`, () => {
    // truth: leading edge d = 3 + z/4, trailing edge d = 5 + z/8, out to z = 4
    const m = mapOf(picture(T, (d, z) => z > 0 && z < 4 && d > 3 + z / 4 && d < 5 + z / 8));
    const o = {
      span: 8,
      wing: { le: [[0, 2.9], [2, 3.2], [3.8, 3.8]], te: [[0, 5.2], [2, 5.5], [3.8, 5.8]] },
    };
    fitPart(o, 'wing', 'plan', T, m, { win: 0.4 });
    const w = o.wing;
    assert.ok(Math.abs(w.le[1][1] - 3.5) < tol, `le at z 2: ${w.le[1][1]}`);
    assert.ok(Math.abs(w.te[1][1] - 5.25) < tol, `te at z 2: ${w.te[1][1]}`);
    assert.ok(Math.abs(w.le[2][1] - (3 + 3.8 / 4)) < tol, `le at tip: ${w.le[2][1]}`);
    assert.deepEqual(w.le.map((r) => r[0]), [0, 2, 3.8]);
    assert.equal(w.le.at(-1)[0], w.te.at(-1)[0], 'shared tip z');
    assert.equal(w.span, 3.8);
  });
}

test('fitPart (plan view): half widths move along z', () => {
  const T = TS.mirrored;
  const m = mapOf(picture(T, (d, z) => d > 0.5 && d < 7 && Math.abs(z) < 0.9));
  const o = { fuselage: { stations: [[2, 0.5, -0.5, 0.7], [4, 0.5, -0.5, 1.1]] } };
  fitPart(o, 'fuselage', 'plan', T, m, { win: 0.3 });
  for (const r of o.fuselage.stations) assert.ok(Math.abs(r[3] - 0.9) < tol, `width ${r[3]}`);
});

test('fitPart leaves points alone where the drawing has no edge (wrong calibration shows as few hits)', () => {
  const T = TS.upright;
  const m = mapOf(picture(T, (d, h) => d > 1 && d < 3 && h > -0.2 && h < 0.2));
  const o = { fuselage: { stations: [[5, 0.9, -0.9, 0.5], [6, 0.9, -0.9, 0.5]] } };
  const r = fitPart(o, 'fuselage', 'side', T, m, { win: 0.3 });
  assert.equal(r.hits, 0);
  assert.deepEqual(o.fuselage.stations, [[5, 0.9, -0.9, 0.5], [6, 0.9, -0.9, 0.5]]);
});

test('simplifyLine keeps the ends and the corners of a polyline, within the tolerance', () => {
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push([i * 0.1, i < 20 ? 0 : (i - 20) * 0.05]); // flat, then a slope: one corner
  const keep = simplifyLine(pts, 0.02);
  assert.deepEqual(keep, [0, 20, 40]);
  assert.deepEqual(simplifyLine([[0, 0], [1, 0.5], [2, 0]], 0.6), [0, 2]);
});

for (const [name, T] of Object.entries(TS)) {
  test(`fitPart with re-placed stations (${name} drawing): fewer stations, same profile`, () => {
    // truth: top h = 0.5 up to d 3, then falling to 0.1 by d 5; bottom flat at -0.5
    const top = (d) => (d < 3 ? 0.5 : Math.max(0.1, 0.5 - (d - 3) * 0.2));
    const m = mapOf(picture(T, (d, h) => d > 1 && d < 6.5 && h > -0.5 && h < top(d)));
    const rows = [];
    for (let d = 1.5; d <= 6; d += 0.5) rows.push([d, top(d) + 0.1, -0.4, 0.3]);
    const o = { fuselage: { stations: rows } };
    const r = fitPart(o, 'fuselage', 'side', T, m, { win: 0.3, replace: true, tol: 0.05 });
    const st = o.fuselage.stations;
    assert.equal(r.before, 10);
    assert.ok(st.length < 10 && st.length >= 3, `${st.length} stations`);
    assert.equal(st[0][0], 1.5);
    assert.equal(st.at(-1)[0], 6);
    for (const [d, t, b, w] of st) {
      assert.ok(Math.abs(t - top(d)) < 0.09, `top ${t} at ${d}`);
      assert.ok(Math.abs(b - -0.5) < tol * 2, `bottom ${b}`);
      assert.equal(w, 0.3);
    }
  });
}

test('the outermost strong edge wins over a nearer interior line (a pale patch inside the body)', () => {
  const T = TS.upright;
  const m = mapOf(picture(T, (d, h) => d > 1 && d < 7 && h > -0.5 && h < 0.5 && !(h > 0.22 && h < 0.34 && d > 3 && d < 5)));
  const o = { fuselage: { stations: [[3.5, 0.36, -0.5, 0.4], [4.5, 0.36, -0.5, 0.4]] } };
  fitPart(o, 'fuselage', 'side', T, m, { win: 0.3 });
  for (const r of o.fuselage.stations) assert.ok(Math.abs(r[1] - 0.5) < tol, `top ${r[1]} should be the silhouette, not the patch`);
});
