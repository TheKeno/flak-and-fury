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
// Five-pointed star, its points at radius R, the top point towards +dv: at most 1 inside. The edge runs
// straight from a point to the next inner corner (radius R * 0.382, 36 degrees round).
function starRatio(du, dv, R) {
  const Ri = R * 0.382;
  const t = (36 * Math.PI) / 180;
  const phi = (((Math.atan2(du, dv) % (2 * t)) + 2 * t) % (2 * t));
  const al = phi > t ? 2 * t - phi : phi;
  return Math.hypot(du, dv) / ((R * Ri * Math.sin(t)) / (R * Math.sin(al) + Ri * Math.sin(t - al)));
}
// US star and bar of late 1943: a white five-pointed star in a blue disc of radius r, white bars either
// side, all outlined in blue. du runs along the bars, dv towards the star's top point.
export function starBar(du, dv, r) {
  const a = Math.abs(du) / r;
  const b = Math.abs(dv) / r;
  const k = Math.hypot(du, dv) / r;
  if (k <= 1) return starRatio(du, dv, 0.97 * r) <= 1 ? 'white' : 'marking';
  if (a <= 2.05 && b <= 0.33) return a <= 1.95 && b <= 0.25 ? 'white' : 'marking';
  return k <= 1.08 ? 'marking' : null;
}
// Japanese hinomaru of radius r with the white surround the Army used in 1943.
export function hinomaru(du, dv, r) {
  const k = Math.hypot(du, dv) / r;
  return k > 1 ? null : k > 0.75 ? 'white' : 'marking';
}
// Finnish Air Force insignia of 1918-45 (the hakaristi, from Count von Rosen's emblem): an upright,
// right-facing blue swastika on a white disc of radius r. dv points to the top arm.
export function hakaristi(du, dv, r) {
  const a = du / r;
  const b = dv / r;
  if (Math.hypot(a, b) > 1) return null;
  const L = 0.72; // arm reach
  const w = 0.13; // half the stroke width
  const inBox = (a0, a1, b0, b1) => a >= a0 && a <= a1 && b >= b0 && b <= b1;
  const arms =
    inBox(-w, w, -L, L) ||
    inBox(-L, L, -w, w) ||
    inBox(-w, L, L - 2 * w, L) || // top arm turns right
    inBox(L - 2 * w, L, -L, w) || // right arm turns down
    inBox(-L, w, -L, -L + 2 * w) || // bottom arm turns left
    inBox(-L, -L + 2 * w, -w, L); // left arm turns up
  return arms ? 'marking' : 'white';
}
// Soviet red star of 1943, points at radius r, with a thin white outline.
export function redStar(du, dv, r) {
  if (starRatio(du, dv, r * 0.82) <= 1) return 'marking';
  return starRatio(du, dv, r) <= 1 ? 'white' : null;
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

// Messerschmitt Bf 109 G-6, measured off a 3-view drawing (9.02 m long, 9.92 m span; 5 model units to
// the metre, d back from the spinner tip, h up from the thrust line). Bigger spinner, cowling rising
// to the windscreen with the MG 131 bulges (Beulen) ahead of it, exhaust stacks low on the cowl (the
// DB 605 hangs inverted), chin oil cooler; heavily framed hood flush with a high, straight spine that
// runs back to the fin; deep rear fuselage whose underside sweeps up into the tail; tall squarish fin
// with a rounded top; strut-less tailplane set high on the fin; straight-tapered wing with rounded
// tips and slats; radiators under the wings; narrow splayed gear, a long tail-down stance.
function bf109g6() {
  const M = 5;
  const X = (d) => 23 - d * M;
  const Y = (h) => -0.85 + h * M; // the main wheels' bottom (h -1.83) lands at the usual -10
  const st = (rows) => rows.map(([d, top, bottom, hw]) => [X(d), Y(top), Y(bottom), hw * M]).sort((a, b) => a[0] - b[0]);
  // Camouflage: the pale underside colour reaches high up the rear fuselage sides, low on the cowling.
  const split = (p) => Y(lerp(0.3, -0.2, clamp((p[0] - X(4.4)) / (X(2.8) - X(4.4)), 0, 1)));
  const tone = (p) => (p[1] < split(p) ? 'under' : 'paint');
  const fuselage = body(
    st([
      [0.55, 0.36, -0.36, 0.36],
      [0.75, 0.4, -0.4, 0.4],
      [1.0, 0.45, -0.44, 0.42],
      [1.4, 0.5, -0.47, 0.44],
      [1.9, 0.56, -0.48, 0.45],
      [2.4, 0.63, -0.5, 0.46],
      [3.05, 0.66, -0.53, 0.46],
      [3.2, 0.58, -0.54, 0.46],
      [3.5, 0.58, -0.56, 0.45],
      [4.3, 0.6, -0.46, 0.42],
      [4.45, 0.96, -0.43, 0.41], // spine raised to stay flush with the raised hood, easing back into
      [5.0, 0.92, -0.34, 0.38], // the drawn line by 6 m
      [5.5, 0.87, -0.29, 0.355],
      [6.0, 0.81, -0.2, 0.32],
      [6.5, 0.77, -0.11, 0.27],
      [7.0, 0.73, -0.02, 0.22],
      [7.6, 0.7, 0.1, 0.16],
      [8.2, 0.64, 0.23, 0.1],
      [8.95, 0.56, 0.45, 0.03],
    ]),
    2.5,
  );
  const line = (d, w = 0.05) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselageDecals = [
    // Panel lines: cowling joint, firewall, rear fuselage joint.
    (p, n) => (side(n) && [line(1.05), line(2.45), line(6.6)].some((f) => f(p)) ? { kind: tone(p), dark: 1 } : null),
    // Balkenkreuz behind the cockpit.
    (p, n) => {
      const k = side(n) && cross(p[0] - X(5.6), p[1] - Y(0.33), 0.85);
      return k ? { kind: k } : null;
    },
  ];
  const wing = surface({ root: [X(2.19), X(4.43)], tip: [X(2.4), X(3.49)], span: 4.92 * M, at: Y(-0.38), rise: 0.114, thick: 0.15 * M, round: 0.14 });
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && cross(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 3.5 * M, 1.05);
    if (k) return { kind: k };
    const hinge = s.k > 0.2 && Math.abs(s.u - 0.74) < 0.035; // flap and aileron line
    const slat = s.k > 0.55 && s.k < 0.92 && Math.abs(s.u - 0.13) < 0.035; // leading-edge slats
    return { kind: under ? 'under' : 'paint', dark: hinge || slat ? 1 : 0 };
  };
  const tailplane = surface({ root: [X(7.68), X(8.62)], tip: [X(7.97), X(8.45)], span: 1.5 * M, at: Y(0.82), thick: 0.06 * M, round: 0.45 });
  // Fin and rudder as drawn, [h, d] along each edge: the leading edge rising steeply from the spine to a
  // broad rounded top, the rudder bulging furthest back 0.6 m up and tucking in under the tailcone.
  const finLE = [[0.4, 7.4], [0.86, 7.55], [0.98, 7.68], [1.13, 7.78], [1.28, 7.88], [1.42, 7.98], [1.5, 8.1], [1.53, 8.25], [1.535, 8.37]];
  const finTE = [[0.4, 8.85], [0.47, 8.96], [0.52, 8.99], [0.62, 9.0], [0.77, 8.97], [0.93, 8.94], [1.13, 8.87], [1.23, 8.82], [1.33, 8.72], [1.43, 8.66], [1.48, 8.57], [1.53, 8.4], [1.535, 8.37]];
  const finOutline = (k) => {
    const h = 0.4 + k * 1.135;
    return [X(interp(finLE, h)[1]), X(interp(finTE, h)[1])];
  };
  const fin = surface({ root: [X(7.4), X(9.0)], span: 1.135 * M, at: Y(0.4), thick: 0.07 * M, round: 0, outline: finOutline, vertical: true });
  const canopy = body(
    st([
      [3.08, 0.66, 0.45, 0.25],
      [3.3, 0.94, 0.45, 0.27], // the hood stands a pixel above the drawing's, so it reads at game size
      [3.55, 0.97, 0.45, 0.28],
      [4.3, 0.96, 0.45, 0.28],
      [4.52, 0.95, 0.45, 0.26],
    ]),
    4,
  );
  const canopyMat = (p) => {
    const frame = [3.27, 3.75, 4.08].some((d) => Math.abs(p[0] - X(d)) < 0.045 * M) || Math.abs(p[1] - Y(0.72)) < 0.03 * M;
    const armour = p[0] < X(4.1) && p[0] > X(4.25) && p[1] > Y(0.72); // head armour behind the pilot
    return { kind: frame || armour ? 'frame' : 'glass' };
  };
  const spinner = body(st([[0, 0.02, -0.02, 0.02], [0.1, 0.15, -0.15, 0.15], [0.25, 0.26, -0.26, 0.26], [0.4, 0.32, -0.32, 0.32], [0.55, 0.36, -0.36, 0.36]]), 2);
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json bf109g6.wheels): main wheels 2.31 m back on legs splayed out
  // from the wing roots, 2.06 m track; small tail wheel under the upswept tail.
  const wheelR = 0.33 * M;
  const main = [X(2.31), Y(-1.5), 1.03 * M];
  const tailR = 0.14 * M;
  const tailW = [X(8.0), Y(-0.09), 0];
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...spinner, material: plain('nose') },
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: (p) => ({ kind: 'paint', dark: Math.abs(p[0] - X(8.4)) < 0.04 * M && p[1] > Y(0.5) ? 1 : 0 }) }, // rudder hinge
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(3.8), Y(0.66), 0], 0.16 * M), pilot: true, material: plain('pilot') },
    { ...strut([X(1.4), Y(0.43), 0.36 * M], [X(2.05), Y(0.47), 0.38 * M], 0.09 * M), material: (p) => ({ kind: tone(p) }) }, // MG 131 bulges
    { ...box([X(1.6), Y(-0.53), 0], [0.22 * M, 0.08 * M, 0.2 * M]), material: (p) => ({ kind: p[0] > X(1.42) ? 'dark' : 'under' }) }, // oil cooler
    { ...box([X(3.2), Y(-0.5), 1.0 * M], [0.42 * M, 0.08 * M, 0.42 * M], { mirror: true }), material: (p) => ({ kind: 'under', dark: p[0] < X(3.5) ? 1 : 0 }) }, // radiators
    { ...box([X(1.47), Y(-0.19), 0.45 * M], [0.42 * M, 0.06 * M, 0.08 * M], { mirror: true }), material: (p) => ({ kind: Math.floor((X(1.05) - p[0]) / (0.14 * M)) % 2 ? 'metal' : 'dark' }) }, // exhaust stacks
    { ...box([X(2.0), Y(0.0), 0.55 * M], [0.15 * M, 0.1 * M, 0.12 * M]), material: (p) => ({ kind: p[0] > X(1.88) ? 'dark' : tone(p) }) }, // supercharger intake, port side
    { ...strut([X(2.64), Y(-0.5), 0.45 * M], main, 0.06 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.08 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(7.92), Y(0.18), 0], tailW, 0.05 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.05 * M), material: tyre(tailW, tailR), gear: true },
  ];
  return {
    parts,
    attach: {
      exhaust: [X(1.47), Y(-0.19), 0.5 * M],
      wingRootL: [X(3.3), Y(-0.38), 0.45 * M],
      wingRootR: [X(3.3), Y(-0.38), -0.45 * M],
      wingTipL: [X(2.95), Y(-0.38) + 4.85 * M * 0.114, 4.85 * M],
      wingTipR: [X(2.95), Y(-0.38) + 4.85 * M * 0.114, -4.85 * M],
      propHub: [X(0.55), Y(0), 0],
      propRadius: 1.5 * M,
      mainContact: [main[0], -10, 0],
      track: main[2],
    },
  };
}

// Republic P-47D Thunderbolt (razorback), measured off a 3-view drawing (11.0 m long, 12.4 m span;
// 5 model units to the metre, d back from the propeller hub, h up from the thrust line). Huge round
// cowling, deeper below than above for the intercooler intake, with a small hub cap ahead of it; long
// flat cowl top to the windscreen; razorback spine falling straight from the hood to the fin; deep
// belly; long sloping fin; wing with a straight leading edge and an elliptical trailing edge, four
// .50s a side sticking out of it; very wide-track gear raking forward; tail wheel under the tail.
function p47d() {
  const M = 5;
  const X = (d) => 27.5 - d * M;
  const Y = (h) => 1.45 + h * M; // the main wheels' bottom (h -2.29) lands at the usual -10
  const st = (rows) => rows.map(([d, top, bottom, hw]) => [X(d), Y(top), Y(bottom), hw * M]).sort((a, b) => a[0] - b[0]);
  const split = Y(-0.45);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const fuselage = body(
    st([
      [0.62, 0.36, -0.72, 0.45],
      [0.9, 0.6, -0.91, 0.58],
      [1.15, 0.65, -0.98, 0.62],
      [1.64, 0.69, -1.06, 0.64],
      [2.14, 0.71, -1.1, 0.65],
      [2.63, 0.71, -1.12, 0.66],
      [3.37, 0.71, -1.14, 0.66],
      [3.62, 0.66, -1.14, 0.66],
      [4.4, 0.62, -1.12, 0.66],
      [5.5, 0.66, -1.06, 0.66],
      [6.2, 0.68, -1.04, 0.64],
      [6.82, 0.6, -0.95, 0.6],
      [7.31, 0.52, -0.9, 0.55],
      [7.8, 0.45, -0.8, 0.5],
      [8.3, 0.38, -0.7, 0.44],
      [8.79, 0.3, -0.64, 0.38],
      [9.09, 0.27, -0.58, 0.33],
      [9.53, 0.22, -0.45, 0.25],
      [10.27, 0.15, -0.37, 0.14],
      [10.76, 0.1, -0.3, 0.07],
      [10.95, 0.08, -0.15, 0.03],
    ]),
    2.2,
  );
  // Razorback: the narrow ridge from the hood straight down to the fin.
  const spine = body(st([[5.75, 0.95, 0.4, 0.36], [6.2, 0.83, 0.4, 0.3], [6.82, 0.73, 0.35, 0.22], [7.31, 0.62, 0.3, 0.17], [7.8, 0.52, 0.25, 0.13], [8.3, 0.42, 0.2, 0.1], [9.03, 0.28, 0.1, 0.06]]), 2.2);
  const line = (d, w = 0.05) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselageDecals = [
    // Cowl ring at the front, panel lines: cowl flaps, firewall, rear fuselage joint.
    (p) => (p[0] > X(0.85) ? { kind: 'nose' } : null),
    (p, n) => (side(n) && [line(1.64), line(3.2), line(8.0)].some((f) => f(p)) ? { kind: tone(p), dark: 1 } : null),
    // Turbo-supercharger waste gate and intercooler exit doors low on the side.
    (p, n) => (side(n) && p[1] < Y(-0.5) && p[1] > Y(-0.8) && p[0] < X(2.9) && p[0] > X(3.35) ? { kind: 'dark' } : null),
    // Star and bar on the rear fuselage.
    (p, n) => {
      const k = side(n) && starBar(p[0] - X(7.15), p[1] - Y(-0.18), 0.42 * M);
      return k ? { kind: k } : null;
    },
  ];
  const wingLE = [[0, 2.78], [5.0, 2.78], [5.53, 2.91], [5.81, 3.03], [5.96, 3.15], [6.06, 3.28], [6.1, 3.45]];
  const wingTE = [[0, 5.45], [0.7, 5.4], [2.2, 5.26], [3.11, 5.13], [3.73, 5.01], [4.21, 4.89], [4.58, 4.76], [4.91, 4.64], [5.18, 4.52], [5.38, 4.39], [5.59, 4.27], [5.75, 4.14], [5.88, 4.02], [5.98, 3.9], [6.04, 3.77], [6.08, 3.65], [6.1, 3.45]];
  const wing = surface({ root: [X(2.78), X(5.45)], span: 6.1 * M, at: Y(-0.85), rise: 0.086, thick: 0.2 * M, round: 0, outline: (k) => [X(interp(wingLE, k * 6.1)[1]), X(interp(wingTE, k * 6.1)[1])] });
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    // US practice: the star on the port wing's upper surface and the starboard wing's underside, its top
    // point forward and the bars along the span.
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && (under ? p[2] < 0 : p[2] > 0) && starBar(Math.abs(p[2]) - 4.6 * M, p[0] - (s.le + s.te) / 2, 0.5 * M);
    if (k) return { kind: k };
    const hinge = s.k > 0.2 && Math.abs(s.u - 0.76) < 0.03; // flap and aileron line
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  const tailLE = [[0, 9.15], [0.56, 9.34], [0.97, 9.46], [1.4, 9.59], [1.84, 9.71], [2.23, 9.84], [2.37, 9.96], [2.45, 10.08], [2.47, 10.25]];
  const tailTE = [[0, 10.88], [1.55, 10.82], [2.04, 10.7], [2.29, 10.58], [2.41, 10.45], [2.47, 10.25]];
  const tailplane = surface({ root: [X(9.15), X(10.88)], span: 2.47 * M, at: Y(0.05), thick: 0.07 * M, round: 0, outline: (k) => [X(interp(tailLE, k * 2.47)[1]), X(interp(tailTE, k * 2.47)[1])] });
  // Fin and rudder as drawn, [h, d] along each edge: a long sloping leading edge to a rounded top, the
  // rudder straight down the back and tucked in under the tailcone.
  const finLE = [[-0.24, 9.0], [0.28, 9.03], [0.41, 9.15], [0.59, 9.28], [0.79, 9.4], [0.97, 9.53], [1.16, 9.65], [1.35, 9.77], [1.53, 9.9], [1.67, 10.02], [1.75, 10.14], [1.8, 10.27], [1.805, 10.33]];
  const finTE = [[-0.24, 10.88], [-0.07, 11.0], [0.35, 11.0], [0.92, 10.88], [1.27, 10.76], [1.52, 10.64], [1.68, 10.51], [1.78, 10.39], [1.805, 10.33]];
  const fin = surface({ root: [X(9.0), X(11.0)], span: 2.045 * M, at: Y(-0.24), thick: 0.08 * M, round: 0, outline: (k) => [X(interp(finLE, -0.24 + k * 2.045)[1]), X(interp(finTE, -0.24 + k * 2.045)[1])], vertical: true });
  const canopy = body(
    st([
      [3.6, 0.69, 0.5, 0.3],
      [3.86, 0.87, 0.5, 0.33],
      [4.1, 1.02, 0.5, 0.35],
      [4.48, 1.04, 0.5, 0.35],
      [4.85, 1.02, 0.5, 0.35],
      [5.34, 0.98, 0.5, 0.34],
      [5.83, 0.91, 0.5, 0.3],
    ]),
    3,
  );
  const canopyMat = (p) => ({ kind: [3.88, 4.55, 5.2].some((d) => Math.abs(p[0] - X(d)) < 0.045 * M) ? 'frame' : 'glass' });
  const hub = body(st([[0, 0.03, -0.03, 0.03], [0.15, 0.12, -0.12, 0.12], [0.35, 0.16, -0.16, 0.16], [0.62, 0.2, -0.2, 0.2]]), 2);
  const plain = (kind) => () => ({ kind });
  // Four .50s a side, staggered, sticking out of the leading edge 2.7 to 3.45 m out.
  const guns = [[2.7, 0.48], [2.95, 0.42], [3.2, 0.36], [3.45, 0.3]].map(([z, out]) => ({ ...strut([X(2.85), Y(-0.85) + z * M * 0.086, z * M], [X(2.78 - out), Y(-0.85) + z * M * 0.086, z * M], 0.04 * M), material: plain('dark') }));
  // Gear (world units in data/planes.json p47d.wheels): big main wheels well forward on long legs,
  // 4.7 m track; tail wheel under the tail, sitting the plane about 11 degrees tail-down.
  const wheelR = 0.41 * M;
  const main = [X(2.81), Y(-1.88), 2.36 * M];
  const tailR = 0.19 * M;
  const tailW = [X(9.24), Y(-0.85), 0];
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...spine, material: plain('paint') },
    { ...hub, material: plain('metal') },
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: (p) => ({ kind: 'paint', dark: Math.abs(p[0] - X(10.45)) < 0.04 * M && p[1] > Y(0.3) ? 1 : 0 }) }, // rudder hinge
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(4.55), Y(0.78), 0], 0.17 * M), pilot: true, material: plain('pilot') },
    { ...box([X(0.64), Y(-0.18), 0], [0.03 * M, 0.42 * M, 0.42 * M]), material: plain('dark') }, // the cowl's open front
    ...guns,
    { ...strut([X(3.5), Y(-0.85), 2.25 * M], main, 0.08 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.11 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(9.1), Y(-0.6), 0], tailW, 0.06 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.06 * M), material: tyre(tailW, tailR), gear: true },
  ];
  return {
    parts,
    attach: {
      exhaust: [X(3.1), Y(-0.65), 0.67 * M],
      wingRootL: [X(4.0), Y(-0.85), 0.66 * M],
      wingRootR: [X(4.0), Y(-0.85), -0.66 * M],
      wingTipL: [X(3.45), Y(-0.85) + 6.0 * M * 0.086, 6.0 * M],
      wingTipR: [X(3.45), Y(-0.85) + 6.0 * M * 0.086, -6.0 * M],
      propHub: [X(0.3), Y(0), 0],
      propRadius: 1.98 * M,
      mainContact: [main[0], -10, 0],
      track: main[2],
    },
  };
}

// Lavochkin La-5FN, measured off a 3-view drawing (8.67 m long, 9.8 m span; 5 model units to the
// metre, d back from the spinner tip, h up from the thrust line). Big round cowling for the ASh-82FN
// radial with the carburettor intake fairing along its top, exhaust outlets on the sides, oil cooler
// under the nose; cut-down rear decking only a little below the hood; deep, short rear fuselage; tall
// rounded fin; wing with a swept leading edge, forward-swept trailing edge and rounded tips; tailplane
// set high; two ShVAK cannon in the cowling; long main legs, tail wheel under the tail.
function la5fn() {
  const M = 5;
  const X = (d) => 21.7 - d * M;
  const Y = (h) => -0.1 + h * M; // the main wheels' bottom (h -1.98) lands at the usual -10
  const st = (rows) => rows.map(([d, top, bottom, hw]) => [X(d), Y(top), Y(bottom), hw * M]).sort((a, b) => a[0] - b[0]);
  const split = Y(-0.25);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const fuselage = body(
    st([
      [0.53, 0.44, -0.44, 0.52],
      [0.65, 0.59, -0.54, 0.62],
      [0.76, 0.63, -0.59, 0.66],
      [1.0, 0.66, -0.65, 0.68],
      [1.5, 0.67, -0.66, 0.66],
      [2.0, 0.67, -0.67, 0.62],
      [2.5, 0.67, -0.68, 0.58],
      [3.1, 0.67, -0.62, 0.54],
      [3.3, 0.52, -0.61, 0.53],
      [4.2, 0.52, -0.59, 0.48],
      [4.6, 0.6, -0.57, 0.44],
      [5.0, 0.81, -0.55, 0.41],
      [5.55, 0.8, -0.48, 0.38],
      [6.0, 0.8, -0.4, 0.33],
      [6.46, 0.8, -0.32, 0.28],
      [6.92, 0.79, -0.21, 0.24],
      [7.5, 0.72, -0.07, 0.17],
      [8.1, 0.62, 0.08, 0.1],
      [8.6, 0.55, 0.42, 0.03],
    ]),
    2.4,
  );
  const line = (d, w = 0.05) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselageDecals = [
    // Cowling joint and rear fuselage joint.
    (p, n) => (side(n) && [line(1.95), line(5.3)].some((f) => f(p)) ? { kind: tone(p), dark: 1 } : null),
    // Red star on the rear fuselage.
    (p, n) => {
      const k = side(n) && redStar(p[0] - X(6.0), p[1] - Y(0.28), 0.46 * M);
      return k ? { kind: k } : null;
    },
  ];
  const wing = surface({ root: [X(1.6), X(4.5)], tip: [X(2.3), X(3.45)], span: 5.0 * M, at: Y(-0.42), rise: 0.087, thick: 0.2 * M, round: 0.2 });
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    // Red stars under both wings only, as the Soviets painted them.
    const k = under && Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && redStar(Math.abs(p[2]) - 3.6 * M, p[0] - (s.le + s.te) / 2, 0.55 * M);
    if (k) return { kind: k };
    const hinge = s.k > 0.2 && Math.abs(s.u - 0.75) < 0.03; // flap and aileron line
    const slat = s.k > 0.45 && s.k < 0.9 && Math.abs(s.u - 0.12) < 0.03; // leading-edge slats
    return { kind: under ? 'under' : 'paint', dark: hinge || slat ? 1 : 0 };
  };
  const tailLE = [[0, 6.6], [0.31, 6.75], [0.69, 6.9], [1.0, 7.05], [1.31, 7.2], [1.58, 7.35], [1.74, 7.5], [1.76, 7.65]];
  const tailTE = [[0, 8.22], [1.31, 8.1], [1.62, 7.95], [1.72, 7.8], [1.76, 7.65]];
  const tailplane = surface({ root: [X(6.6), X(8.22)], span: 1.76 * M, at: Y(0.5), thick: 0.06 * M, round: 0, outline: (k) => [X(interp(tailLE, k * 1.76)[1]), X(interp(tailTE, k * 1.76)[1])] });
  // Fin and rudder as drawn, [h, d] along each edge: the leading edge rising from the decking to a
  // rounded top, the rudder straight down the back and curving in under the tailcone.
  const finLE = [[0.1, 6.9], [0.8, 6.95], [0.87, 7.03], [1.0, 7.15], [1.12, 7.26], [1.2, 7.38], [1.31, 7.49], [1.46, 7.6], [1.54, 7.72], [1.58, 7.83], [1.62, 7.95]];
  const finTE = [[0.1, 8.1], [0.21, 8.4], [0.29, 8.52], [0.44, 8.63], [0.86, 8.63], [1.12, 8.52], [1.31, 8.4], [1.43, 8.29], [1.5, 8.17], [1.58, 8.06], [1.62, 7.95]];
  const fin = surface({ root: [X(6.9), X(8.63)], span: 1.52 * M, at: Y(0.1), thick: 0.07 * M, round: 0, outline: (k) => [X(interp(finLE, 0.1 + k * 1.52)[1]), X(interp(finTE, 0.1 + k * 1.52)[1])], vertical: true });
  const finMat = (p, n) => {
    const k = side(n) && redStar(p[0] - X(8.0), p[1] - Y(1.0), 0.36 * M);
    if (k) return { kind: k };
    return { kind: 'paint', dark: Math.abs(p[0] - X(8.15)) < 0.04 * M && p[1] > Y(0.5) ? 1 : 0 }; // rudder hinge
  };
  const canopy = body(
    st([
      [3.1, 0.7, 0.4, 0.25],
      [3.3, 0.89, 0.4, 0.3],
      [3.45, 0.93, 0.4, 0.32],
      [4.1, 0.93, 0.4, 0.32],
      [4.5, 0.86, 0.4, 0.3],
      [5.0, 0.82, 0.4, 0.26],
    ]),
    3,
  );
  const canopyMat = (p) => ({ kind: [3.3, 4.15].some((d) => Math.abs(p[0] - X(d)) < 0.045 * M) ? 'frame' : 'glass' });
  const spinner = body(st([[0, 0.02, -0.02, 0.02], [0.08, 0.1, -0.1, 0.1], [0.19, 0.21, -0.21, 0.21], [0.3, 0.25, -0.25, 0.25], [0.42, 0.29, -0.29, 0.29], [0.55, 0.32, -0.32, 0.32]]), 2);
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json la5fn.wheels): main wheels on long legs from the wing,
  // 2.8 m track; small tail wheel, sitting the plane about 16 degrees tail-down.
  const wheelR = 0.33 * M;
  const main = [X(2.12), Y(-1.65), 1.4 * M];
  const tailR = 0.15 * M;
  const tailW = [X(7.5), Y(-0.29), 0];
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...spinner, material: plain('nose') },
    { ...box([X(0.56), Y(0), 0], [0.03 * M, 0.45 * M, 0.5 * M]), material: plain('dark') }, // the cowl's open front
    { ...box([X(1.35), Y(0.66), 0], [0.6 * M, 0.06 * M, 0.12 * M]), material: (p) => ({ kind: p[0] > X(0.85) ? 'dark' : 'paint' }) }, // carburettor intake
    { ...box([X(1.8), Y(-0.08), 0.62 * M], [0.15 * M, 0.17 * M, 0.06 * M], { mirror: true }), material: plain('dark') }, // exhaust outlets
    { ...box([X(1.75), Y(-0.74), 0], [0.28 * M, 0.08 * M, 0.2 * M]), material: (p) => ({ kind: p[0] > X(1.55) ? 'dark' : 'under' }) }, // oil cooler
    { ...strut([X(0.75), Y(0.45), 0.15 * M], [X(0.5), Y(0.45), 0.15 * M], 0.035 * M), material: plain('dark') }, // ShVAK muzzles
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: finMat },
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(3.85), Y(0.7), 0], 0.16 * M), pilot: true, material: plain('pilot') },
    { ...strut([X(2.3), Y(-0.55), 1.35 * M], main, 0.06 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.09 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(7.4), Y(-0.05), 0], tailW, 0.05 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.05 * M), material: tyre(tailW, tailR), gear: true },
  ];
  return {
    parts,
    attach: {
      exhaust: [X(1.8), Y(-0.08), 0.68 * M],
      wingRootL: [X(3.0), Y(-0.42), 0.55 * M],
      wingRootR: [X(3.0), Y(-0.42), -0.55 * M],
      wingTipL: [X(2.8), Y(-0.42) + 4.9 * M * 0.087, 4.9 * M],
      wingTipR: [X(2.8), Y(-0.42) + 4.9 * M * 0.087, -4.9 * M],
      propHub: [X(0.55), Y(0), 0],
      propRadius: 1.55 * M,
      mainContact: [main[0], -10, 0],
      track: main[2],
    },
  };
}

// Nakajima Ki-43-II Hayabusa, measured off a 3-view drawing (9.0 m long, 10.84 m span; 5 model units
// to the metre, d back from the spinner tip, h up from the thrust line). Small pointed spinner, short
// round cowling for the Ha-115 radial with the oil cooler scoop under it; slim fuselage tapering to a
// thin tail; bubble hood falling into a low turtledeck; straight-edged fin with a rounded rudder
// hanging below the tailcone; wing with a nearly straight leading edge and a strongly forward-swept
// trailing edge; light, wide-track gear. Dark cowling, Army hinomaru with white surrounds.
function ki43() {
  const M = 5;
  const X = (d) => 22.5 - d * M;
  const Y = (h) => -0.65 + h * M; // the main wheels' bottom (h -1.87) lands at the usual -10
  const st = (rows) => rows.map(([d, top, bottom, hw]) => [X(d), Y(top), Y(bottom), hw * M]).sort((a, b) => a[0] - b[0]);
  const split = Y(-0.3);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const fuselage = body(
    st([
      [0.58, 0.51, -0.46, 0.45],
      [0.75, 0.58, -0.55, 0.55],
      [0.9, 0.63, -0.6, 0.59],
      [1.22, 0.68, -0.66, 0.61],
      [1.6, 0.67, -0.69, 0.6],
      [2.38, 0.67, -0.71, 0.58],
      [2.6, 0.6, -0.72, 0.57],
      [3.2, 0.6, -0.72, 0.56],
      [3.99, 0.6, -0.7, 0.53],
      [4.37, 0.51, -0.67, 0.5],
      [5.0, 0.47, -0.6, 0.42],
      [5.5, 0.43, -0.54, 0.32],
      [6.0, 0.38, -0.48, 0.27],
      [6.6, 0.33, -0.42, 0.23],
      [7.38, 0.26, -0.35, 0.19],
      [8.0, 0.22, -0.3, 0.14],
      [8.39, 0.19, -0.23, 0.09],
      [9.0, 0.15, -0.05, 0.02],
    ]),
    2.3,
  );
  const line = (d, w = 0.05) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselageDecals = [
    // The cowling painted dark, up to its rear edge.
    (p) => (p[0] > X(1.22) ? { kind: 'nose' } : null),
    // Hinomaru on the rear fuselage.
    (p, n) => {
      const k = side(n) && hinomaru(p[0] - X(6.0), p[1] - Y(-0.08), 0.38 * M);
      return k ? { kind: k } : null;
    },
    // Panel lines: firewall, rear fuselage joint.
    (p, n) => (side(n) && [line(2.3), line(5.3)].some((f) => f(p)) ? { kind: tone(p), dark: 1 } : null),
  ];
  const wing = surface({ root: [X(2.08), X(4.49)], tip: [X(1.73), X(3.15)], span: 5.42 * M, at: Y(-0.52), rise: 0.105, thick: 0.17 * M, round: 0.15 });
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && hinomaru(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 4.0 * M, 0.5 * M);
    if (k) return { kind: k };
    const hinge = s.k > 0.2 && Math.abs(s.u - 0.76) < 0.03; // flap and aileron line
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  const tailLE = [[0, 7.6], [0.8, 7.8], [1.45, 7.95], [1.99, 8.1], [2.19, 8.25], [2.23, 8.4]];
  const tailTE = [[0, 8.9], [1.19, 8.85], [1.97, 8.7], [2.18, 8.55], [2.23, 8.4]];
  const tailplane = surface({ root: [X(7.6), X(8.9)], span: 2.23 * M, at: Y(0.0), thick: 0.06 * M, round: 0, outline: (k) => [X(interp(tailLE, k * 2.23)[1]), X(interp(tailTE, k * 2.23)[1])] });
  // Fin and rudder as drawn, [h, d] along each edge: a straight leading edge up to the rudder hinge, the
  // rudder rounded behind it and hanging below the tailcone.
  const finLE = [[-0.23, 7.3], [0.23, 7.38], [1.33, 8.3], [1.39, 8.37]];
  const finTE = [[-0.23, 8.39], [-0.21, 8.71], [-0.09, 8.91], [0.11, 9.03], [0.51, 9.03], [0.92, 8.95], [1.24, 8.74], [1.39, 8.37]];
  const fin = surface({ root: [X(7.3), X(9.03)], span: 1.62 * M, at: Y(-0.23), thick: 0.06 * M, round: 0, outline: (k) => [X(interp(finLE, -0.23 + k * 1.62)[1]), X(interp(finTE, -0.23 + k * 1.62)[1])], vertical: true });
  const canopy = body(
    st([
      [2.38, 0.67, 0.45, 0.25],
      [2.6, 0.86, 0.45, 0.28],
      [2.79, 0.94, 0.45, 0.3],
      [3.43, 0.94, 0.45, 0.3],
      [3.75, 0.8, 0.45, 0.28],
      [3.99, 0.6, 0.45, 0.25],
    ]),
    3,
  );
  const canopyMat = (p) => ({ kind: [2.62, 3.1].some((d) => Math.abs(p[0] - X(d)) < 0.04 * M) ? 'frame' : 'glass' });
  const spinner = body(st([[0, 0.02, -0.02, 0.02], [0.15, 0.08, -0.08, 0.08], [0.3, 0.14, -0.14, 0.14], [0.45, 0.18, -0.18, 0.18], [0.58, 0.2, -0.2, 0.2]]), 2);
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json ki43.wheels): light legs from the wing, 3.4 m track; small
  // tail wheel, sitting the plane about 12 degrees tail-down.
  const wheelR = 0.3 * M;
  const main = [X(2.2), Y(-1.57), 1.69 * M];
  const tailR = 0.1 * M;
  const tailW = [X(7.64), Y(-0.63), 0];
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...spinner, material: plain('metal') },
    { ...box([X(0.6), Y(0.02), 0], [0.03 * M, 0.42 * M, 0.42 * M]), material: plain('dark') }, // the cowl's open front
    { ...box([X(1.38), Y(-0.05), 0.6 * M], [0.13 * M, 0.08 * M, 0.05 * M], { mirror: true }), material: plain('dark') }, // exhaust stacks
    { ...box([X(1.78), Y(-0.72), 0], [0.23 * M, 0.08 * M, 0.17 * M]), material: (p) => ({ kind: p[0] > X(1.6) ? 'dark' : 'under' }) }, // oil cooler
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: (p) => ({ kind: 'paint', dark: Math.abs(p[0] - X(8.37)) < 0.04 * M && p[1] > Y(0.3) ? 1 : 0 }) }, // rudder hinge
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(3.2), Y(0.7), 0], 0.16 * M), pilot: true, material: plain('pilot') },
    { ...strut([X(2.25), Y(-0.6), 1.6 * M], main, 0.05 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.08 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(7.55), Y(-0.38), 0], tailW, 0.04 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.04 * M), material: tyre(tailW, tailR), gear: true },
  ];
  return {
    parts,
    attach: {
      exhaust: [X(1.38), Y(-0.05), 0.65 * M],
      wingRootL: [X(3.2), Y(-0.52), 0.55 * M],
      wingRootR: [X(3.2), Y(-0.52), -0.55 * M],
      wingTipL: [X(2.4), Y(-0.52) + 5.3 * M * 0.105, 5.3 * M],
      wingTipR: [X(2.4), Y(-0.52) + 5.3 * M * 0.105, -5.3 * M],
      propHub: [X(0.4), Y(0), 0],
      propRadius: 1.45 * M,
      mainContact: [main[0], -10, 0],
      track: main[2],
    },
  };
}

// Brewster B-239 (the Finnish Buffalo), side measured off a 1/72 profile drawing, plan and gear off a
// 3-view (8.1 m long to the spinner tip, 10.67 m span; 5 model units to the metre, d back from the
// spinner tip, h up from the thrust line). Short barrel of a fuselage behind a big round cowling with a
// small pointed spinner; tall, heavily framed canopy running far back, the gunsight tube poking through
// the windscreen; turtledeck falling to a tall fin with a long concave leading edge and a rounded top;
// mid-set wing with a straight leading edge and rounded tips; stubby gear well forward, tail wheel
// under the tail. Yellow Eastern Front band round the rear fuselage and under the wingtips.
function b239() {
  const M = 5;
  const X = (d) => 20.5 - d * M;
  const Y = (h) => -0.15 + h * M; // the main wheels' bottom (h -1.97) lands at the usual -10
  const st = (rows) => rows.map(([d, top, bottom, hw]) => [X(d), Y(top), Y(bottom), hw * M]).sort((a, b) => a[0] - b[0]);
  const split = Y(-0.35);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const band = (p) => p[0] < X(6.2) && p[0] > X(6.55); // yellow Eastern Front band
  const fuselage = body(
    st([
      [0.48, 0.6, -0.64, 0.62],
      [0.6, 0.65, -0.69, 0.7],
      [0.78, 0.68, -0.72, 0.74],
      [1.02, 0.7, -0.75, 0.75],
      [1.34, 0.74, -0.76, 0.76],
      [1.66, 0.8, -0.8, 0.75],
      [2.06, 0.82, -0.84, 0.73],
      [2.79, 0.85, -0.88, 0.71],
      [2.95, 0.62, -0.88, 0.7],
      [3.9, 0.62, -0.87, 0.67],
      [5.0, 0.62, -0.77, 0.58],
      [5.2, 0.84, -0.74, 0.56],
      [5.51, 0.76, -0.7, 0.53],
      [6.0, 0.64, -0.64, 0.45],
      [6.5, 0.52, -0.56, 0.37],
      [7.0, 0.4, -0.49, 0.27],
      [7.5, 0.28, -0.37, 0.17],
      [7.88, 0.2, -0.28, 0.08],
      [8.1, 0.02, -0.02, 0.02],
    ]),
    2.3,
  );
  const line = (d, w = 0.05) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselageDecals = [
    (p) => (band(p) ? { kind: 'nose' } : null),
    // Hakaristi on the rear fuselage.
    (p, n) => {
      const k = side(n) && hakaristi(p[0] - X(5.6), p[1] - Y(0.02), 0.44 * M);
      return k ? { kind: k } : null;
    },
    // Panel lines: cowl gills at the back of the cowling, firewall.
    (p, n) => (side(n) && [line(1.7, 0.07), line(2.4)].some((f) => f(p)) ? { kind: tone(p), dark: 1 } : null),
  ];
  const wingLE = [[0, 1.9], [3.7, 1.93], [4.5, 1.98], [5.05, 2.1], [5.24, 2.25], [5.33, 2.55], [5.35, 2.7]];
  const wingTE = [[0, 4.15], [0.87, 4.05], [2.16, 3.9], [3.45, 3.75], [4.57, 3.6], [4.91, 3.45], [5.09, 3.3], [5.19, 3.15], [5.28, 3.0], [5.33, 2.85], [5.35, 2.7]];
  const wing = surface({ root: [X(1.9), X(4.15)], span: 5.35 * M, at: Y(-0.15), rise: 0.077, thick: 0.17 * M, round: 0, outline: (k) => [X(interp(wingLE, k * 5.35)[1]), X(interp(wingTE, k * 5.35)[1])] });
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    // The same way round on both wings, and mirrored underneath so it reads right from below too.
    const across = (p[2] - Math.sign(p[2]) * 3.9 * M) * (under ? -1 : 1);
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && hakaristi(across, p[0] - (s.le + s.te) / 2, 0.55 * M);
    if (k) return { kind: k };
    // Yellow wingtips underneath, the Eastern Front recognition marking.
    if (under && Math.abs(p[2]) > 4.6 * M) return { kind: 'nose' };
    const hinge = s.k > 0.2 && Math.abs(s.u - 0.76) < 0.03; // flap and aileron line
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  const tailLE = [[0, 6.7], [0.31, 6.75], [1.1, 6.9], [1.53, 7.05], [1.8, 7.2], [1.9, 7.35], [1.94, 7.5]];
  const tailTE = [[0, 8.12], [0.67, 8.1], [1.05, 8.05], [1.23, 8.0], [1.4, 7.95], [1.53, 7.9], [1.64, 7.85], [1.71, 7.8], [1.88, 7.65], [1.94, 7.5]];
  const tailplane = surface({ root: [X(6.7), X(8.12)], span: 1.94 * M, at: Y(-0.1), thick: 0.06 * M, round: 0, outline: (k) => [X(interp(tailLE, k * 1.94)[1]), X(interp(tailTE, k * 1.94)[1])] });
  // Fin and rudder as drawn, [h, d] along each edge: a long concave leading edge sweeping up from the
  // turtledeck to a rounded top, the rudder's trailing edge almost straight down to the tailcone.
  const finLE = [[-0.25, 5.3], [0.74, 5.51], [0.79, 5.67], [0.94, 5.93], [1.25, 6.25], [1.49, 6.62], [1.65, 6.94], [1.71, 7.2]];
  const finTE = [[-0.25, 7.7], [0.0, 8.1], [0.06, 8.02], [0.15, 7.94], [0.3, 7.86], [1.0, 7.78], [1.25, 7.7], [1.41, 7.61], [1.53, 7.53], [1.61, 7.45], [1.65, 7.37], [1.71, 7.2]];
  const fin = surface({ root: [X(5.3), X(8.1)], span: 1.96 * M, at: Y(-0.25), thick: 0.07 * M, round: 0, outline: (k) => [X(interp(finLE, -0.25 + k * 1.96)[1]), X(interp(finTE, -0.25 + k * 1.96)[1])], vertical: true });
  const finMat = (p) => ({ kind: band(p) && p[1] < Y(0.6) ? 'nose' : 'paint', dark: Math.abs(p[0] - X(7.25)) < 0.04 * M && p[1] > Y(0.3) ? 1 : 0 }); // rudder hinge
  const canopy = body(
    st([
      [2.79, 0.85, 0.5, 0.3],
      [2.95, 0.98, 0.5, 0.34],
      [3.11, 1.07, 0.5, 0.36],
      [3.27, 1.19, 0.5, 0.37],
      [3.91, 1.19, 0.5, 0.37],
      [4.15, 1.13, 0.5, 0.36],
      [4.48, 1.05, 0.5, 0.34],
      [4.8, 0.97, 0.5, 0.32],
      [5.16, 0.86, 0.5, 0.3],
    ]),
    3,
  );
  const canopyMat = (p) => ({ kind: [2.98, 3.6, 4.4, 4.85].some((d) => Math.abs(p[0] - X(d)) < 0.04 * M) ? 'frame' : 'glass' });
  const spinner = body(st([[0, 0.02, -0.02, 0.02], [0.05, 0.1, -0.1, 0.1], [0.13, 0.13, -0.13, 0.13], [0.21, 0.16, -0.16, 0.16], [0.29, 0.18, -0.18, 0.18], [0.37, 0.2, -0.2, 0.2], [0.45, 0.22, -0.22, 0.22]]), 2);
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json b239.wheels): stubby legs from the wing roots raking forward,
  // 2.5 m track, the wheels folding up into the fuselage sides; tail wheel under the tail, about 13
  // degrees tail-down.
  const wheelR = 0.36 * M;
  const main = [X(1.72), Y(-1.61), 1.23 * M];
  const tailR = 0.13 * M;
  const tailW = [X(7.22), Y(-0.58), 0];
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...spinner, material: plain('nose') },
    { ...box([X(0.5), Y(-0.04), 0], [0.03 * M, 0.55 * M, 0.55 * M]), material: plain('dark') }, // the cowl's open front
    { ...box([X(1.8), Y(-0.55), 0.72 * M], [0.12 * M, 0.08 * M, 0.06 * M], { mirror: true }), material: plain('dark') }, // exhaust outlets
    { ...strut([X(2.55), Y(0.88), 0], [X(2.95), Y(0.93), 0], 0.045 * M), material: plain('dark') }, // gunsight tube, running into the windscreen
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: finMat },
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(3.6), Y(0.85), 0], 0.16 * M), pilot: true, material: plain('pilot') },
    { ...strut([X(2.0), Y(-0.6), 1.55 * M], main, 0.07 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.1 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(7.1), Y(-0.36), 0], tailW, 0.04 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.05 * M), material: tyre(tailW, tailR), gear: true },
  ];
  return {
    parts,
    attach: {
      exhaust: [X(1.8), Y(-0.55), 0.78 * M],
      wingRootL: [X(3.0), Y(-0.15), 0.7 * M],
      wingRootR: [X(3.0), Y(-0.15), -0.7 * M],
      wingTipL: [X(2.7), Y(-0.15) + 5.25 * M * 0.077, 5.25 * M],
      wingTipR: [X(2.7), Y(-0.15) + 5.25 * M * 0.077, -5.25 * M],
      propHub: [X(0.3), Y(0), 0],
      propRadius: 1.55 * M,
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

export const MODELS = { bf109: bf109(), bf109g6: bf109g6(), spitfire: spitfire(), p47d: p47d(), la5fn: la5fn(), ki43: ki43(), b239: b239() };
