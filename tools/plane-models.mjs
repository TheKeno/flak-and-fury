// Simple 3D plane models, ray-cast to palette-keyed pixel art (used by make-sprites.mjs).
//
// A model is a handful of solid parts. Each part has a field (negative inside, roughly the distance to
// its surface, so its gradient is the surface normal) and a material that picks the palette key from
// the hit point. Model space is in sprite pixels (2 per world unit) with the origin at the sprite
// pivot: x towards the nose, y up, z out of the screen in the side view.
//
// Paint keys (B S W base tones, U 1 underside tones, N 2 nose tones, M marking) are swapped for the
// plane's paint at load time, so one model serves every paint scheme. Upper surfaces take the base
// colour, lower surfaces the underside colour, split along the fuselage sides.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((c) => c / l);
};

// Light from above, a little from the front and from the camera side (in screen space).
const LIGHT = norm([0.3, 0.8, 0.55]);

// Linear interpolation in a table of stations [[x, ...values]] sorted by x.
function interp(stations, x) {
  for (let i = 1; i < stations.length; i++) {
    if (x <= stations[i][0]) {
      const a = stations[i - 1];
      const b = stations[i];
      const k = (x - a[0]) / (b[0] - a[0] || 1);
      return a.map((v, j) => lerp(v, b[j], k));
    }
  }
  return stations.at(-1);
}

// ----- Part shapes -----

// Fuselage, canopy or spinner: stations [x, top, bottom, half width], superelliptic sections
// (n = 2 round, higher = flatter sides).
export function body(stations, n = 2) {
  const x0 = stations[0][0];
  const x1 = stations.at(-1)[0];
  const ys = stations.flatMap((s) => [s[1], s[2]]);
  const hw = Math.max(...stations.map((s) => s[3]));
  return {
    box: [[x0, Math.min(...ys), -hw], [x1, Math.max(...ys), hw]],
    field([x, y, z]) {
      const s = interp(stations, clamp(x, x0, x1));
      const ry = Math.max(0.05, (s[1] - s[2]) / 2);
      const rz = Math.max(0.05, s[3]);
      const yc = (s[1] + s[2]) / 2;
      const e = ((Math.abs(y - yc) / ry) ** n + (Math.abs(z) / rz) ** n) ** (1 / n) - 1;
      return Math.max(e * Math.min(ry, rz), x0 - x, x - x1);
    },
  };
}

// Wing, tailplane or fin. root/tip: [leading edge x, trailing edge x]; span runs along |z| (both
// sides) or, for a fin, up from y = at. rise: dihedral (tan); thick: half thickness at the root;
// round: share of the span over which the tip rounds off.
export function surface({ root, tip, span, at = 0, rise = 0, thick = 1, round = 0.3, vertical = false, from = 0 }) {
  const xs = [...root, ...tip];
  const box = vertical
    ? [[Math.min(...xs), at + from, -thick], [Math.max(...xs), at + span, thick]]
    : [[Math.min(...xs), at - thick - 0.5, -span], [Math.max(...xs), at + span * rise + thick + 0.5, span]];
  const shape = (p) => {
    const s = vertical ? p[1] - at : Math.abs(p[2]);
    const k = clamp(s / span, 0, 1);
    let le = lerp(root[0], tip[0], k);
    let te = lerp(root[1], tip[1], k);
    const r0 = 1 - round;
    if (round > 0 && k > r0) {
      const f = Math.sqrt(Math.max(0, 1 - ((k - r0) / round) ** 2));
      const q = le + (te - le) * 0.4;
      le = q + (le - q) * f;
      te = q + (te - q) * f;
    }
    const chord = Math.max(0.01, le - te);
    const u = clamp((le - p[0]) / chord, 0, 1);
    const h = thick * Math.max(0.2, 2.6 * Math.sqrt(u) * (1 - u)) * (1 - 0.45 * k);
    const t = vertical ? p[2] : p[1] - at - s * rise;
    return { s, k, u, le, te, d: Math.max(Math.abs(t) - h, p[0] - le, te - p[0], s - span, from - s) };
  };
  return { box, shape, field: (p) => shape(p).d };
}

export function box(c, half, { mirror = false } = {}) {
  const zmax = mirror ? Math.abs(c[2]) + half[2] : null;
  return {
    box: mirror ? [[c[0] - half[0], c[1] - half[1], -zmax], [c[0] + half[0], c[1] + half[1], zmax]] : [c.map((v, i) => v - half[i]), c.map((v, i) => v + half[i])],
    field: ([x, y, z]) => Math.max(Math.abs(x - c[0]) - half[0], Math.abs(y - c[1]) - half[1], Math.abs((mirror ? Math.abs(z) : z) - c[2]) - half[2]),
  };
}

export function sphere(c, r) {
  return { box: [c.map((v) => v - r), c.map((v) => v + r)], field: (p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r };
}

// Wheel with its axle along z, mirrored to both sides when z != 0.
export function wheel(c, r, width) {
  const zmax = Math.abs(c[2]) + width;
  return {
    box: [[c[0] - r, c[1] - r, -zmax], [c[0] + r, c[1] + r, zmax]],
    field: ([x, y, z]) => Math.max(Math.hypot(x - c[0], y - c[1]) - r, Math.abs(Math.abs(z) - Math.abs(c[2])) - width),
  };
}

// Round strut from a to b, mirrored to both sides.
export function strut(a, b, r) {
  const lo = a.map((v, i) => Math.min(v, b[i]) - r);
  const hi = a.map((v, i) => Math.max(v, b[i]) + r);
  const zmax = Math.max(Math.abs(lo[2]), Math.abs(hi[2]));
  const ab = b.map((v, i) => v - a[i]);
  const len2 = ab.reduce((s, v) => s + v * v, 0) || 1;
  return {
    box: [[lo[0], lo[1], -zmax], [hi[0], hi[1], zmax]],
    field([x, y, z]) {
      const p = [x, y, Math.sign(a[2] || 1) * Math.abs(z)];
      const t = clamp(p.reduce((s, v, i) => s + (v - a[i]) * ab[i], 0) / len2, 0, 1);
      return Math.hypot(...p.map((v, i) => v - (a[i] + ab[i] * t))) - r;
    },
  };
}

// ----- Materials -----
// A material returns { kind, dark } for a hit: kind picks the tone ramp, dark steps it darker
// (panel lines, hinge lines).

const TONES = {
  paint: ['B', 'S', 'W'],
  under: ['U', '1', '1'],
  nose: ['N', '2', '2'],
  glass: ['c', 'C', 'C'],
  pilot: ['P', 'p', 'p'],
  metal: ['i', 'I', 'I'],
  tyre: ['e', 'e', 'o'],
  dark: ['e', 'e', 'e'],
  frame: ['o', 'o', 'o'],
  marking: ['M', 'M', 'M'],
  white: ['x', 'x', '4'],
};

function toneIndex(kind, light) {
  if (kind === 'glass') return light > 0.8 ? 0 : 1;
  if (kind === 'under') return light > 0.15 ? 0 : 1;
  if (kind === 'pilot') return light > 0.7 ? 0 : 1;
  return light > 0.5 ? 0 : light > 0.15 ? 1 : 2;
}

// Balkenkreuz: black cross on a white border. Returns 'marking', 'white' or null.
export function cross(du, dv, size = 1) {
  const a = Math.abs(du) / size;
  const b = Math.abs(dv) / size;
  if ((a <= 0.55 && b <= 1.6) || (b <= 0.55 && a <= 1.6)) return 'marking';
  if (a <= 2.5 && b <= 2.5 && !(a > 1.5 && b > 1.5)) return 'white';
  return null;
}
export const roundel = (du, dv, size = 1) => (Math.hypot(du, dv) <= 2.5 * size ? 'marking' : null);

// ----- Poses -----
// A pose maps model points to view space: view = M · (model - origin) + offset. View x right, y up,
// z towards the camera; the anchor (screen origin of the frame) is view (0, 0).

const rotX = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const rotY = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rotZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const apply = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const applyT = (M, v) => [0, 1, 2].map((j) => M[0][j] * v[0] + M[1][j] * v[1] + M[2][j] * v[2]);

export function pose(M, origin = [0, 0, 0], offset = [0, 0, 0]) {
  return {
    M,
    toView: (p) => apply(M, p.map((v, i) => v - origin[i])).map((v, i) => v + offset[i]),
    toModel: (v) => applyT(M, v.map((c, i) => c - offset[i])).map((c, i) => c + origin[i]),
    dirToView: (d) => apply(M, d),
    dirToModel: (d) => applyT(M, d),
  };
}

// Rolled about the fuselage axis: 0 = side view, PI/2 = top towards the camera, PI = upside down.
export const rollPose = (phi) => pose(rotX(phi));

// Standing on the gear (tail down by pitch), turned by yaw about the vertical axis through the main
// wheels' contact point: yaw PI/2 swings the nose away from the camera. bank tips the plane over
// sideways onto the far main wheel (and, enough of it, onto that wingtip).
export function groundPose(model, yaw, pitch, bank = 0) {
  const contact = model.attach.mainContact;
  let M = rotZ(pitch);
  let offset = [0, 0, 0];
  if (bank) {
    // Tip about the far wheel: rotate about an axis along the fuselage through that wheel's contact.
    const w = [0, 0, -model.attach.track];
    const B = rotX(-bank);
    M = mul(B, M);
    offset = w.map((v, i) => v - apply(B, w)[i]);
  }
  const Y = rotY(yaw);
  return pose(mul(Y, M), contact, apply(Y, offset));
}

// ----- Ray casting -----

function rayBox(o, d, [lo, hi]) {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const a = lo[i] - 0.3;
    const b = hi[i] + 0.3;
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < a || o[i] > b) return null;
      continue;
    }
    let ta = (a - o[i]) / d[i];
    let tb = (b - o[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  return t0 <= t1 ? [t0, t1] : null;
}

const STEP = 0.1;
function march(part, o, d) {
  const span = rayBox(o, d, part.box);
  if (!span) return null;
  const at = (t) => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  let prev = span[0];
  if (part.field(at(prev)) < 0) return prev;
  for (let t = span[0] + STEP; t <= span[1] + STEP; t += STEP) {
    if (part.field(at(t)) < 0) {
      let a = prev;
      let b = t;
      for (let i = 0; i < 8; i++) {
        const m = (a + b) / 2;
        if (part.field(at(m)) < 0) b = m;
        else a = m;
      }
      return b;
    }
    prev = t;
  }
  return null;
}

function normalAt(part, p) {
  const e = 0.06;
  const f = (dx, dy, dz) => part.field([p[0] + dx, p[1] + dy, p[2] + dz]);
  return norm([f(e, 0, 0) - f(-e, 0, 0), f(0, e, 0) - f(0, -e, 0), f(0, 0, e) - f(0, 0, -e)]);
}

// Renders a model in a pose into a w x h grid of palette keys, the anchor at pixel (ax, ay).
// opts.gear: include the landing gear. Returns rows of keys.
export function render(model, ps, w, h, [ax, ay], { gear = true } = {}) {
  const parts = model.parts.filter((p) => gear || !p.gear);
  const kinds = Array.from({ length: h }, () => Array(w).fill(null));
  const shade = Array.from({ length: h }, () => Array(w).fill(0));
  const depth = Array.from({ length: h }, () => Array(w).fill(-Infinity));
  const owner = Array.from({ length: h }, () => Array(w).fill(null));
  const dir = ps.dirToModel([0, 0, -1]);
  const Z = 80;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const o = ps.toModel([col - ax, ay - row, Z]);
      let best = null;
      let solid = null; // nearest hit that isn't glass, to see the pilot through the canopy
      for (const part of parts) {
        const t = march(part, o, dir);
        if (t == null) continue;
        if (!best || t < best.t) best = { part, t };
        if (!part.glass && (!solid || t < solid.t)) solid = { part, t };
      }
      if (!best) continue;
      const hit = best.part.glass && solid?.part.pilot ? solid : best;
      const p = o.map((v, i) => v + dir[i] * hit.t);
      const n = normalAt(hit.part, p);
      const vn = ps.dirToView(n);
      const light = vn.reduce((s, v, i) => s + v * LIGHT[i], 0);
      const m = hit.part.material(p, n, vn);
      kinds[row][col] = m.kind;
      shade[row][col] = toneIndex(m.kind, light) + (m.dark ?? 0);
      depth[row][col] = Z - hit.t;
      owner[row][col] = hit.part;
    }
  }
  // Crisp outline round the silhouette. Where a part passes in front of another, the one behind
  // takes its darkest tone instead: black lines there would swamp a sprite this small. A part only two
  // pixels thin (a wing seen edge-on) keeps its colour on the upper (or left) pixel, or it would be all
  // outline.
  const filled = (r, c) => r >= 0 && c >= 0 && r < h && c < w && kinds[r][c] !== null;
  const keys = kinds.map((row, r) =>
    row.map((kind, c) => {
      if (kind === null) return '.';
      let i = shade[r][c];
      const thinTop = filled(r + 1, c) && !filled(r + 2, c);
      const thinLeft = filled(r, c + 1) && !filled(r, c + 2);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!filled(r + dr, c + dc)) {
          if ((dr === -1 && thinTop) || (dc === -1 && thinLeft)) continue;
          return 'o';
        }
        const nearer = depth[r + dr][c + dc] - depth[r][c];
        if ((owner[r + dr][c + dc] !== owner[r][c] && nearer > 2.2 && !owner[r][c].glass) || nearer > 6) i = 2;
      }
      return TONES[kind][Math.min(2, i)];
    }),
  );
  return keys.map((r) => r.join(''));
}

// Where a model point lands in a frame (pixel offsets from the anchor, y down) and its depth.
export function project(ps, p) {
  const v = ps.toView(p);
  return [v[0], -v[1], v[2]];
}

// The far wingtip touches the ground at this bank (rad) in a ground pose.
export function tipBank(model, yaw, pitch) {
  const tip = model.attach.wingTipR;
  for (let b = 0; b < 1.4; b += 0.002) {
    if (groundPose(model, yaw, pitch, b).toView(tip)[1] <= 0) return b;
  }
  return 1.4;
}

// ----- The planes -----

// The fuselage and the lower half of its sides take the underside colour below `split`.
function fuselageMat(split, decals) {
  return (p, n) => {
    for (const d of decals) {
      const m = d(p, n);
      if (m) return m;
    }
    return { kind: p[1] < split ? 'under' : 'paint' };
  };
}
const side = (n) => Math.abs(n[2]) > 0.35;

// Shared gear: main wheels match the renderer's gear (3.5, -3.6) units, tail wheel (-10.5, -1.6).
function gear(track, legTop) {
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.45 ? 'metal' : 'tyre' });
  return [
    { ...strut(legTop, [7, -7.2, track], 0.55), material: metal, gear: true },
    { ...wheel([7, -7.2, track], 2.8, 0.7), material: tyre([7, -7.2], 2.8), gear: true },
    { ...strut([-20, -1, 0], [-21, -3.2, 0], 0.5), material: metal, gear: true },
    { ...wheel([-21, -3.2, 0], 1.6, 0.5), material: tyre([-21, -3.2], 1.6), gear: true },
  ];
}

// Messerschmitt Bf 109 F: long nose, pointed spinner, angular framed canopy, rounded fin and wingtips,
// narrow splayed gear, chin oil cooler, radiator baths under the wings, Balkenkreuz.
function bf109() {
  const split = -1.4;
  const fuselage = body(
    [
      [-24, 1.4, 0.2, 0.3],
      [-22, 2.6, -1.3, 0.9],
      [-17, 3.5, -2.5, 1.4],
      [-10, 3.6, -3.4, 1.9],
      [-3, 4.0, -3.6, 2.2],
      [10, 4.0, -3.6, 2.3],
      [13, 3.7, -3.4, 2.2],
      [18, 3.4, -2.7, 2.0],
      [20.5, 2.5, -1.9, 1.7],
    ],
    2.3,
  );
  const fuselageDecals = [
    (p, n) => (side(n) && Math.abs(p[0] + 4) < 0.5 && p[1] > -3 ? { kind: p[1] < split ? 'under' : 'paint', dark: 1 } : null), // cockpit rear
    (p, n) => (side(n) && Math.abs(p[0] - 10) < 0.5 && p[1] > -3 ? { kind: p[1] < split ? 'under' : 'paint', dark: 1 } : null), // firewall
    (p, n) => (side(n) && Math.abs(p[1] - 1) < 0.5 && [11, 14, 17].some((x) => p[0] >= x - 0.5 && p[0] < x + 1.5) ? { kind: 'dark' } : null), // exhausts
    (p, n) => (side(n) && Math.abs(p[1] - 2) < 0.5 && p[0] >= 7.5 && p[0] < 9.5 ? { kind: 'dark' } : null), // supercharger intake
    (p, n) => {
      const k = side(n) && cross(p[0] + 8, p[1] - 0);
      return k ? { kind: k } : null;
    },
  ];
  const wing = surface({ root: [9, -4], tip: [5, 0], span: 24.8, at: -3.3, rise: 0.114, thick: 1, round: 0.25 });
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && cross(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 17, 1.1);
    if (k) return { kind: k };
    const hinge = s.k > 0.4 && Math.abs(s.u - 0.74) < 0.06; // aileron and flap line
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  const tailplane = surface({ root: [-13, -24], tip: [-16, -22], span: 7.5, at: 2.4, thick: 0.6, round: 0.45 });
  const fin = surface({ root: [-14, -24.5], tip: [-19, -23], span: 7, at: 2.5, from: -1.5, thick: 0.6, round: 0.6, vertical: true });
  const canopy = body(
    [
      [-2.5, 4.6, 2.5, 1.3],
      [-1, 6.6, 2.5, 1.6],
      [5, 7.4, 2.5, 1.7],
      [8, 7.1, 2.5, 1.6],
      [10, 4.4, 2.5, 1.5],
    ],
    3,
  );
  const plain = (kind) => () => ({ kind });
  const parts = [
    { ...fuselage, material: fuselageMat(split, fuselageDecals) },
    { ...body([[20.2, 2.4, -1.8, 1.8], [22, 2.0, -1.3, 1.5], [23.4, 1.1, -0.5, 0.8], [24.6, 0.4, 0.2, 0.1]], 2), material: plain('nose') }, // spinner
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: (p) => ({ kind: 'paint', dark: Math.abs(p[0] + 18.5) < 0.45 && p[1] > 3.5 ? 1 : 0 }) }, // rudder hinge
    { ...canopy, glass: true, material: (p) => ({ kind: [4, 7].some((x) => Math.abs(p[0] - x) < 0.45) ? 'frame' : 'glass' }) },
    { ...sphere([1.5, 4.6, 0], 1.5), pilot: true, material: plain('pilot') },
    { ...box([15.5, -3.8, 0], [2.6, 0.9, 1.4]), material: (p) => ({ kind: p[0] > 17.6 ? 'dark' : 'under' }) }, // oil cooler
    { ...box([0.5, -3.6, 7.5], [2.4, 0.7, 1.6], { mirror: true }), material: (p) => ({ kind: 'under', dark: p[0] < -1.3 ? 1 : 0 }) }, // radiators
    ...gear(5.2, [6, -3.6, 3.6]),
  ];
  return {
    parts,
    attach: {
      exhaust: [14, 1, 2.2],
      wingRootL: [2.5, -3.3, 2.3],
      wingRootR: [2.5, -3.3, -2.3],
      wingTipL: [2, -0.6, 24.6],
      wingTipR: [2, -0.6, -24.6],
      propHub: [24.6, 0.3, 0],
      mainContact: [7, -10, 0],
      track: 5.2,
    },
  };
}

// Generic inline fighter: big swept fin, bubble canopy, broad semi-elliptical wings, round spinner,
// wide-track gear, roundels.
function fighter() {
  const split = -1.2;
  const fuselage = body(
    [
      [-24, 2.0, -0.4, 0.4],
      [-23, 2.6, -1.4, 0.8],
      [-16, 3.5, -3.0, 1.6],
      [-8, 3.6, -3.6, 2.2],
      [10, 3.8, -3.7, 2.5],
      [16, 3.6, -3.3, 2.4],
      [19, 3.1, -2.6, 2.2],
      [20, 2.8, -2.4, 2.0],
    ],
    2.2,
  );
  const fuselageDecals = [
    (p, n) => (side(n) && [-9, 7].some((x) => Math.abs(p[0] - x) < 0.5) && p[1] > -3 ? { kind: p[1] < split ? 'under' : 'paint', dark: 1 } : null), // panel lines
    (p, n) => (side(n) && Math.abs(p[1] - 1) < 0.5 && [10, 13, 16].some((x) => p[0] >= x - 0.5 && p[0] < x + 1.5) ? { kind: 'dark' } : null), // exhausts
    (p, n) => {
      const k = side(n) && roundel(p[0] + 5, p[1] + 0.3, 0.95);
      return k ? { kind: k } : null;
    },
  ];
  const wing = surface({ root: [11, -4], tip: [5, -1], span: 26, at: -3.3, rise: 0.105, thick: 1.1, round: 0.45 });
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && roundel(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 17, 1.15);
    if (k) return { kind: k };
    const hinge = s.k > 0.45 && Math.abs(s.u - 0.75) < 0.06;
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  const tailplane = surface({ root: [-14, -24], tip: [-18, -23], span: 8.5, at: -0.4, thick: 0.6, round: 0.45 });
  const fin = surface({ root: [-12, -24.3], tip: [-20, -23.2], span: 8, at: 2.7, from: -1.5, thick: 0.6, round: 0.35, vertical: true });
  const canopy = body(
    [
      [-5, 3.8, 2.2, 1.0],
      [-1, 6.8, 2.2, 1.7],
      [2, 8.3, 2.2, 1.9],
      [5, 8.2, 2.2, 1.9],
      [8, 6.0, 2.2, 1.7],
      [10.5, 3.9, 2.2, 1.2],
    ],
    2,
  );
  const plain = (kind) => () => ({ kind });
  const parts = [
    { ...fuselage, material: fuselageMat(split, fuselageDecals) },
    { ...body([[19.5, 2.6, -2.2, 2.4], [21.5, 2.2, -1.8, 2.0], [23, 1.3, -0.9, 1.1], [23.8, 0.4, 0, 0.2]], 2), material: plain('nose') }, // spinner
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: (p) => ({ kind: 'paint', dark: Math.abs(p[0] + 21) < 0.45 && p[1] > 3.8 ? 1 : 0 }) },
    { ...canopy, glass: true, material: (p) => ({ kind: Math.abs(p[0] - 8.2) < 0.45 ? 'frame' : 'glass' }) },
    { ...sphere([2.5, 5.2, 0], 1.6), pilot: true, material: plain('pilot') },
    { ...box([1, -3.9, 4], [2.6, 0.9, 1.3]), material: (p) => ({ kind: p[0] > 3.2 ? 'dark' : 'under' }) }, // radiator scoop
    ...gear(7, [6, -3.4, 6.6]),
  ];
  return {
    parts,
    attach: {
      exhaust: [13, 1, 2.4],
      wingRootL: [3, -3.3, 2.6],
      wingRootR: [3, -3.3, -2.6],
      wingTipL: [2, -0.8, 25.8],
      wingTipR: [2, -0.8, -25.8],
      propHub: [24, 0.3, 0],
      mainContact: [7, -10, 0],
      track: 7,
    },
  };
}

export const MODELS = { bf109: bf109(), fighter: fighter() };
