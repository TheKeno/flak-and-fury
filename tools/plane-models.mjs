// Simple 3D plane models, ray-cast to palette-keyed pixel art (used by make-sprites.mjs).
//
// A model is a handful of solid parts. Each part has a field (negative inside, roughly the distance to
// its surface, so its gradient is the surface normal) and a material that picks the palette key from
// the hit point. Model space is in half world units (render at res 2 for the game's 4 plane-sprite
// pixels per world unit) with the origin at the sprite pivot: x towards the nose, y up, z out of the
// screen in the side view.
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
// round: share of the span over which the tip rounds off. ellipse: an elliptical planform (Spitfire)
// instead of root/tip, its chord shrinking about the straight line this share of the chord back from
// the leading edge. outline: a function of the share of the span giving [leading edge x, trailing edge
// x], for shapes neither fits (Spitfire fin); it also gets negative shares below the root down to from.
export function surface({ root, tip = root, span, at = 0, rise = 0, thick = 1, round = 0.3, vertical = false, from = 0, ellipse = 0, outline = null }) {
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
    if (outline) {
      [le, te] = outline(clamp(s / span, Math.min(0, from / span), 1));
    } else if (ellipse) {
      const c = (root[0] - root[1]) * Math.sqrt(Math.max(0, 1 - k * k));
      const axis = root[0] - (root[0] - root[1]) * ellipse;
      le = axis + c * ellipse;
      te = axis - c * (1 - ellipse);
    } else if (round > 0 && k > r0) {
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
  red: ['m', 'm', 'm'], // fixed national colours, not paint keys: RAF roundel red and yellow
  yellow: ['5', '5', '5'],
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
// RAF roundels of 1943, radius r: type C1 on the fuselage (yellow, blue, thin white, red), type B on
// the upper wings (blue, red).
export function roundelC1(du, dv, r) {
  const k = Math.hypot(du, dv) / r;
  return k > 1 ? null : k > 0.89 ? 'yellow' : k > 0.45 ? 'marking' : k > 0.34 ? 'white' : 'red';
}
export function roundelB(du, dv, r) {
  const k = Math.hypot(du, dv) / r;
  return k > 1 ? null : k > 0.4 ? 'marking' : 'red';
}

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
// opts.gear: include the landing gear; opts.res: pixels per model unit. Returns rows of keys.
export function render(model, ps, w, h, [ax, ay], { gear = true, res = 1 } = {}) {
  const parts = model.parts.filter((p) => gear || !p.gear);
  const kinds = Array.from({ length: h }, () => Array(w).fill(null));
  const shade = Array.from({ length: h }, () => Array(w).fill(0));
  const depth = Array.from({ length: h }, () => Array(w).fill(-Infinity));
  const owner = Array.from({ length: h }, () => Array(w).fill(null));
  const dir = ps.dirToModel([0, 0, -1]);
  const Z = 80;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const o = ps.toModel([(col - ax) / res, (ay - row) / res, Z]);
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

const side = (n) => Math.abs(n[2]) > 0.35;

// Messerschmitt Bf 109 F-4, from its real dimensions (8.94 m long, 9.92 m span; 5 model units to the
// metre, with d measured back from the spinner tip and h up from the thrust line). Slim inline
// cowling with a pointed spinner, deep cockpit section tapering hard to a slim tail, low framed
// hood, small rounded fin and rudder, cantilever tailplane set on the fin (the F lost the E's struts),
// rounded wingtips, chin oil cooler, shallow radiator baths under the wings, narrow splayed gear.
function bf109() {
  const M = 5; // model units per metre
  const X = (d) => 24.5 - d * M;
  const Y = (h) => 0.3 + h * M;
  const st = (rows) => rows.map(([d, top, bottom, hw]) => [X(d), Y(top), Y(bottom), hw * M]).sort((a, b) => a[0] - b[0]);
  const split = Y(-0.22); // camouflage demarcation down the fuselage side
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const fuselage = body(
    st([
      [0.7, 0.42, -0.42, 0.42],
      [1.0, 0.47, -0.47, 0.43],
      [1.6, 0.53, -0.52, 0.45],
      [2.3, 0.57, -0.57, 0.46],
      [2.7, 0.58, -0.61, 0.47],
      [3.4, 0.58, -0.62, 0.46],
      [3.95, 0.55, -0.6, 0.43],
      [4.6, 0.48, -0.53, 0.38],
      [5.5, 0.42, -0.47, 0.32],
      [6.5, 0.35, -0.37, 0.25],
      [7.4, 0.29, -0.25, 0.18],
      [8.2, 0.25, -0.09, 0.1],
      [8.6, 0.22, 0.04, 0.05],
    ]),
    2.5,
  );
  const line = (d, w = 0.05) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselageDecals = [
    // Panel lines: cowling joint, firewall, cockpit rear, rear fuselage joint.
    (p, n) => (side(n) && [line(1.05), line(2.3), line(4.2), line(6.6)].some((f) => f(p)) ? { kind: tone(p), dark: 1 } : null),
    // Exhaust stacks: a dark row a little below the cowling top (six stacks are too fine to split).
    (p, n) => (side(n) && Math.abs(p[1] - Y(0.18)) < 0.07 * M && p[0] < X(1.0) && p[0] > X(1.9) ? { kind: 'dark' } : null),
    // Balkenkreuz behind the cockpit.
    (p, n) => {
      const k = side(n) && cross(p[0] - X(5.25), p[1] - Y(0.02), 0.85);
      return k ? { kind: k } : null;
    },
  ];
  const wing = surface({ root: [X(2.25), X(4.3)], tip: [X(2.8), X(3.85)], span: 4.96 * M, at: Y(-0.48), rise: 0.114, thick: 0.15 * M, round: 0.2 });
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && cross(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 3.5 * M, 1.05);
    if (k) return { kind: k };
    const hinge = s.k > 0.2 && Math.abs(s.u - 0.74) < 0.035; // flap and aileron line
    const slat = s.k > 0.55 && s.k < 0.92 && Math.abs(s.u - 0.13) < 0.035; // leading-edge slats
    return { kind: under ? 'under' : 'paint', dark: hinge || slat ? 1 : 0 };
  };
  const tailplane = surface({ root: [X(7.45), X(8.25)], tip: [X(7.7), X(8.15)], span: 1.55 * M, at: Y(0.42), thick: 0.06 * M, round: 0.5 });
  const fin = surface({ root: [X(7.1), X(8.8)], tip: [X(7.6), X(8.72)], span: 1.05 * M, at: Y(0.25), from: -0.3 * M, thick: 0.07 * M, round: 0.45, vertical: true });
  const canopy = body(
    st([
      [2.5, 0.56, 0.3, 0.3],
      [2.85, 1.0, 0.3, 0.32],
      [3.55, 1.03, 0.3, 0.32],
      [3.85, 0.92, 0.3, 0.31],
      [4.15, 0.56, 0.3, 0.27],
    ]),
    4,
  );
  const canopyMat = (p) => {
    const frame = [2.86, 3.57].some((d) => Math.abs(p[0] - X(d)) < 0.045 * M);
    const armour = p[0] < X(3.6) && p[0] > X(3.72) && p[1] > Y(0.58); // head armour behind the pilot
    return { kind: frame || armour ? 'frame' : 'glass' };
  };
  const spinner = body(st([[0, 0.02, -0.02, 0.02], [0.1, 0.15, -0.15, 0.15], [0.25, 0.27, -0.27, 0.27], [0.45, 0.36, -0.36, 0.36], [0.72, 0.42, -0.42, 0.42]]), 2);
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json bf109.wheels, here in model units): main wheels 2.3 m back,
  // 2.06 m track, splayed legs from the wing roots; small tail wheel under the fin.
  const wheelR = 0.33 * M;
  const main = [X(2.3), -10 + wheelR, 1.03 * M];
  const tailR = 0.17 * M;
  const tailW = [X(7.875), -4.2 + tailR, 0];
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...spinner, material: plain('nose') },
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: (p) => ({ kind: 'paint', dark: Math.abs(p[0] - X(8.15)) < 0.04 * M && p[1] > Y(0.3) ? 1 : 0 }) }, // rudder hinge
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(3.3), Y(0.74), 0], 0.17 * M), pilot: true, material: plain('pilot') },
    { ...box([X(1.35), Y(-0.6), 0], [0.35 * M, 0.11 * M, 0.2 * M]), material: (p) => ({ kind: p[0] > X(1.05) ? 'dark' : 'under' }) }, // oil cooler
    { ...box([X(3.75), Y(-0.66), 1.0 * M], [0.45 * M, 0.1 * M, 0.42 * M], { mirror: true }), material: (p) => ({ kind: 'under', dark: p[0] < X(4.1) ? 1 : 0 }) }, // radiators
    { ...box([X(2.05), Y(0.12), 0.5 * M], [0.2 * M, 0.09 * M, 0.07 * M]), material: (p) => ({ kind: p[0] > X(1.9) ? 'dark' : 'paint' }) }, // supercharger intake, port side
    { ...strut([X(2.45), Y(-0.55), 0.4 * M], main, 0.06 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.08 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(7.8), Y(-0.08), 0], tailW, 0.05 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.05 * M), material: tyre(tailW, tailR), gear: true },
  ];
  return {
    parts,
    attach: {
      exhaust: [X(1.45), Y(0.18), 0.47 * M],
      wingRootL: [X(3.3), Y(-0.48), 0.45 * M],
      wingRootR: [X(3.3), Y(-0.48), -0.45 * M],
      wingTipL: [X(3.3), Y(-0.48) + 4.9 * M * 0.114, 4.9 * M],
      wingTipR: [X(3.3), Y(-0.48) + 4.9 * M * 0.114, -4.9 * M],
      propHub: [X(0.7), Y(0), 0],
      propRadius: 1.5 * M,
      mainContact: [main[0], -10, 0],
      track: main[2],
    },
  };
}

// Supermarine Spitfire Mk IX, measured off a 3-view drawing (9.47 m long, 11.23 m span, 2.4 m root
// chord; 5 model units to the metre, d back from the spinner tip, h up from the thrust line). Long
// Merlin 61 nose with a pointed spinner, six ejector stacks a side and a long carburettor intake under
// the chin; low hood barely above the razorback spine; elliptical wing and tailplane; tall fin with a
// round top, the rudder bulging furthest back low down and running on below the tailcone; symmetric
// radiators under both wings; C-wing cannon barrels well out ahead of the wing; narrow splayed gear
// raking forward, fixed tail wheel. Dark Green / Ocean Grey over Medium Sea Grey, Sky spinner and band.
function spitfire() {
  const M = 5;
  const X = (d) => 23.5 - d * M;
  const Y = (h) => 0.3 + h * M;
  const st = (rows) => rows.map(([d, top, bottom, hw]) => [X(d), Y(top), Y(bottom), hw * M]).sort((a, b) => a[0] - b[0]);
  const split = Y(-0.3);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const band = (p) => p[0] < X(7.25) && p[0] > X(7.7); // Sky band round the rear fuselage
  const fuselage = body(
    st([
      [0.72, 0.35, -0.37, 0.37],
      [1.0, 0.37, -0.55, 0.39],
      [1.3, 0.39, -0.66, 0.41],
      [1.6, 0.41, -0.72, 0.42],
      [2.2, 0.42, -0.76, 0.43],
      [2.8, 0.42, -0.8, 0.44],
      [3.4, 0.42, -0.82, 0.44],
      [4.2, 0.42, -0.79, 0.42],
      [4.63, 0.42, -0.77, 0.42],
      [5.4, 0.4, -0.69, 0.4],
      [6.6, 0.36, -0.54, 0.34],
      [7.76, 0.32, -0.38, 0.24],
      [8.29, 0.29, -0.3, 0.17],
      [8.9, 0.26, -0.2, 0.09],
      [9.1, 0.24, -0.1, 0.04],
    ]),
    2.4,
  );
  // Razorback: the narrow spine behind the hood, falling gently to the fin.
  const spine = body(st([[4.42, 0.66, 0.3, 0.25], [4.6, 0.64, 0.3, 0.21], [5.6, 0.62, 0.3, 0.17], [6.6, 0.53, 0.25, 0.13], [7.76, 0.44, 0.2, 0.09], [8.3, 0.4, 0.2, 0.06]]), 2.2);
  const line = (d, w = 0.05) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselageDecals = [
    // The hood's side glazing reaches a little below the sill line.
    (p, n) => (side(n) && p[1] > Y(0.32) && p[0] < X(3.62) && p[0] > X(4.48) ? { kind: [3.85, 4.45].some((d) => line(d, 0.045)(p)) ? 'frame' : 'glass' } : null),
    // Panel lines: cowling joint, firewall, cockpit door.
    (p, n) => (side(n) && [line(1.15), line(2.25), line(4.6)].some((f) => f(p)) ? { kind: tone(p), dark: 1 } : null),
    (p) => (band(p) ? { kind: 'nose' } : null),
    // C1 roundel between the cockpit and the band.
    (p, n) => {
      const k = side(n) && roundelC1(p[0] - X(6.2), p[1] - Y(-0.06), 0.46 * M);
      return k ? { kind: k } : null;
    },
  ];
  const wing = surface({ root: [X(2.1), X(4.6)], span: 5.615 * M, at: Y(-0.68), rise: 0.105, thick: 0.155 * M, round: 0, ellipse: 0.34 });
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = n[1] > 0.6 && vn[2] > 0.3 && roundelB(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 3.6 * M, 0.7 * M);
    if (k) return { kind: k };
    const hinge = s.k > 0.15 && s.k < 0.9 && Math.abs(s.u - 0.78) < 0.035; // flap and aileron line
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  // Tailplane as drawn, [z, d] along each edge: curved leading edge, the elevators' trailing edge
  // straight out to two thirds of the span before rounding into the tip.
  const tailLE = [[0, 7.93], [0.5, 7.97], [0.82, 8.0], [1.09, 8.1], [1.27, 8.2], [1.42, 8.3], [1.52, 8.4], [1.59, 8.5], [1.63, 8.64]];
  const tailTE = [[0, 9.12], [1.04, 9.09], [1.44, 8.99], [1.55, 8.89], [1.61, 8.79], [1.63, 8.64]];
  const tailOutline = (k) => [X(interp(tailLE, k * 1.63)[1]), X(interp(tailTE, k * 1.63)[1])];
  const tailplane = surface({ root: [X(7.93), X(9.12)], span: 1.63 * M, at: Y(0.2), thick: 0.06 * M, round: 0, outline: tailOutline });
  // Fin and rudder as drawn, [h, d] along each edge: the leading edge curving up from the spine into
  // the round top, the rudder bulging furthest back 0.24 m up and curving forward above and below.
  const finLE = [[-0.25, 7.8], [0.44, 7.9], [0.59, 8.12], [1.01, 8.35], [1.33, 8.59], [1.43, 8.7], [1.48, 8.82]];
  const finTE = [[-0.25, 8.9], [-0.2, 9.22], [-0.12, 9.33], [0.02, 9.41], [0.24, 9.47], [0.69, 9.41], [0.97, 9.33], [1.16, 9.22], [1.31, 9.1], [1.43, 8.94], [1.48, 8.82]];
  const finOutline = (k) => {
    const h = -0.25 + k * 1.73;
    return [X(interp(finLE, h)[1]), X(interp(finTE, h)[1])];
  };
  const fin = surface({ root: [X(7.8), X(9.47)], span: 1.73 * M, at: Y(-0.25), thick: 0.07 * M, round: 0, outline: finOutline, vertical: true });
  const finMat = (p, n) => {
    // Fin flash (red, white, blue) ahead of the rudder hinge.
    const flash = side(n) && p[1] > Y(0.45) && p[1] < Y(1.05) && p[0] < X(8.2) && p[0] > X(8.78);
    if (flash) return { kind: p[0] > X(8.44) ? 'red' : p[0] > X(8.54) ? 'white' : 'marking' };
    return { kind: 'paint', dark: Math.abs(p[0] - X(8.82)) < 0.04 * M && p[1] > Y(0.3) ? 1 : 0 }; // rudder hinge
  };
  const canopy = body(
    st([
      [3.5, 0.42, 0.3, 0.25],
      [3.75, 0.62, 0.3, 0.28],
      [4.0, 0.7, 0.3, 0.3],
      [4.3, 0.71, 0.3, 0.3],
      [4.5, 0.65, 0.3, 0.26],
    ]),
    3,
  );
  const canopyMat = (p) => ({ kind: [3.85, 4.45].some((d) => Math.abs(p[0] - X(d)) < 0.045 * M) ? 'frame' : 'glass' });
  const spinner = body(st([[0, 0.02, -0.02, 0.02], [0.12, 0.14, -0.14, 0.14], [0.24, 0.2, -0.2, 0.2], [0.53, 0.3, -0.3, 0.3], [0.72, 0.35, -0.35, 0.35]]), 2);
  const plain = (kind) => () => ({ kind });
  // Cannon barrels stick out 0.9 m ahead of the leading edge, 2.05 m out from the centre line.
  const gunZ = 2.05 * M;
  const gunLe = wing.shape([0, Y(-0.68), gunZ]).le;
  // Gear (world units in data/planes.json spitfire.wheels): main wheels well forward, under the wing
  // leading edge, 1.68 m track on legs splayed out and raked forward; fixed tail wheel under the tail,
  // which sits the plane about 13 degrees tail-down.
  const wheelR = 0.33 * M;
  const main = [X(2.35), -10 + wheelR, 0.84 * M];
  const tailR = 0.13 * M;
  const tailW = [X(8.75), Y(-0.45), 0];
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...spine, material: (p) => ({ kind: band(p) ? 'nose' : 'paint' }) },
    { ...spinner, material: plain('nose') },
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: finMat },
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(4.15), Y(0.47), 0], 0.16 * M), pilot: true, material: plain('pilot') },
    { ...box([X(1.88), Y(-0.79), 0], [0.43 * M, 0.08 * M, 0.13 * M]), material: (p) => ({ kind: p[0] > X(1.55) ? 'dark' : 'under' }) }, // carburettor intake
    { ...box([X(3.6), Y(-0.92), 1.2 * M], [0.54 * M, 0.1 * M, 0.25 * M], { mirror: true }), material: (p) => ({ kind: p[0] > X(3.12) || p[0] < X(4.08) ? 'dark' : 'under' }) }, // radiators
    { ...box([X(1.47), Y(0.11), 0.4 * M], [0.43 * M, 0.07 * M, 0.05 * M], { mirror: true }), material: (p) => ({ kind: Math.floor((X(1.04) - p[0]) / (0.143 * M)) % 2 ? 'metal' : 'dark' }) }, // exhaust stacks
    { ...strut([gunLe + 0.3, Y(-0.68), gunZ], [gunLe + 0.35 * M, Y(-0.68), gunZ], 0.09 * M), material: plain('paint') }, // cannon fairings
    { ...strut([gunLe + 0.3, Y(-0.68), gunZ], [gunLe + 0.9 * M, Y(-0.68), gunZ], 0.055 * M), material: plain('dark') }, // Hispano barrels
    { ...strut([X(2.7), Y(-0.75), 0.42 * M], main, 0.06 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.08 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(8.62), Y(-0.15), 0], tailW, 0.05 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.05 * M), material: tyre(tailW, tailR), gear: true },
  ];
  return {
    parts,
    attach: {
      exhaust: [X(1.47), Y(0.11), 0.45 * M],
      wingRootL: [X(3.3), Y(-0.68), 0.44 * M],
      wingRootR: [X(3.3), Y(-0.68), -0.44 * M],
      wingTipL: [X(2.7), Y(-0.68) + 5.5 * M * 0.105, 5.5 * M],
      wingTipR: [X(2.7), Y(-0.68) + 5.5 * M * 0.105, -5.5 * M],
      propHub: [X(0.72), Y(0), 0],
      propRadius: 1.635 * M,
      mainContact: [main[0], -10, 0],
      track: main[2],
    },
  };
}

export const MODELS = { bf109: bf109(), spitfire: spitfire() };
