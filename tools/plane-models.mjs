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

// A part built round z = 0 moved out to z = ±zc: a pair of engine nacelles or twin fins.
export function mirrorZ(part, zc) {
  const hz = Math.max(Math.abs(part.box[0][2]), Math.abs(part.box[1][2]));
  return {
    ...part,
    box: [[part.box[0][0], part.box[0][1], -(zc + hz)], [part.box[1][0], part.box[1][1], zc + hz]],
    field: ([x, y, z]) => part.field([x, y, Math.abs(z) - zc]),
  };
}

// ----- Outlines -----
// Everything that sets a plane's outline lives in data/outlines/<plane>.json (the Outline Lab edits
// it): fuselage, spinner, canopy and nacelle stations, wing, tailplane and fin planforms, wheel size and
// place. The model functions below add what sits inside the outline (materials, markings, guns, struts).
// kit turns an outline into the helpers a model function needs; all numbers go through the same
// arithmetic the models used inline, so the rendered sprites are unchanged.
export function kit(o) {
  const M = o.scale;
  const X = (d) => o.frame.x - d * M;
  const Y = (h) => o.frame.y + h * M;
  const st = (rows) => rows.map(([d, top, bottom, hw]) => [X(d), Y(top), Y(bottom), hw * M]).sort((a, b) => a[0] - b[0]);
  // A body of revolution from stations; z puts a mirrored pair out at ±z (nacelles, twin fins).
  const bodyOf = (s) => {
    const part = body(st(s.stations), s.n ?? 2);
    return s.z ? mirrorZ(part, s.z * M) : part;
  };
  // A wing, tailplane or fin. le/te are edge tables [along, d]: along the span in metres from the
  // root (a fin: h, up from the model's reference line).
  const surfaceOf = (s, vertical = false) => {
    const outline = s.le && (vertical
      ? (k) => [X(interp(s.le, s.at + k * s.span)[1]), X(interp(s.te, s.at + k * s.span)[1])]
      : (k) => [X(interp(s.le, k * s.span)[1]), X(interp(s.te, k * s.span)[1])]);
    const part = surface({
      root: s.root.map((d) => X(d)),
      tip: s.tip?.map((d) => X(d)),
      span: s.span * M,
      at: Y(s.at),
      rise: s.rise,
      thick: s.thick * M,
      round: s.round,
      from: s.from === undefined ? undefined : s.from * M,
      ellipse: s.ellipse,
      outline,
      vertical,
    });
    return s.z ? mirrorZ(part, s.z * M) : part;
  };
  // Wheel sizes and centres in model units. A wheel is placed by its centre height h, or by the model
  // height of its bottom.
  const gearOf = (g) => {
    const place = (w) => (w.bottom === undefined ? Y(w.h) : w.bottom + w.r * M);
    const wheelR = g.main.r * M;
    const tailR = g.tail.r * M;
    return {
      wheelR,
      tailR,
      main: [X(g.main.d), place({ ...g.main, r: g.main.r }), g.main.half * M],
      tailW: [X(g.tail.d), place(g.tail), 0],
    };
  };
  return { M, X, Y, st, bodyOf, surfaceOf, gearOf };
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
  optDark: ['6', '6', '6'], // optional marking (the German fin swastika): black and white with the
  optLight: ['7', '7', '7'], // setting on, the fin's paint with it off (src/render/sprites.js)
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
// RAF type C roundel (red, thin white, blue) under the wings, radius r.
export function roundelC(du, dv, r) {
  const k = Math.hypot(du, dv) / r;
  return k > 1 ? null : k > 0.5 ? 'marking' : k > 0.4 ? 'white' : 'red';
}
// Swastika arms (right-facing, the top arm towards +b) in units of the radius: reach L, half stroke w.
function swastikaArms(a, b, L, w) {
  const inBox = (a0, a1, b0, b1) => a >= a0 && a <= a1 && b >= b0 && b <= b1;
  return (
    inBox(-w, w, -L, L) ||
    inBox(-L, L, -w, w) ||
    inBox(-w, L, L - 2 * w, L) || // top arm turns right
    inBox(L - 2 * w, L, -L, w) || // right arm turns down
    inBox(-L, w, -L, -L + 2 * w) || // bottom arm turns left
    inBox(-L, -L + 2 * w, -w, L) // left arm turns up
  );
}
// The Luftwaffe's fin swastika, standing on a point, black with a thin white outline, reaching r. It
// is optional (a setting, off by default), so it is drawn in the optDark / optLight keys.
export function hakenkreuz(du, dv, r) {
  const a = (du + dv) / Math.SQRT2 / r;
  const b = (dv - du) / Math.SQRT2 / r;
  if (swastikaArms(a, b, 0.62, 0.1)) return 'optDark';
  if (swastikaArms(a, b, 0.62 + 0.09, 0.1 + 0.09)) return 'optLight';
  return null;
}
// Finnish Air Force insignia of 1918-45 (the hakaristi, from Count von Rosen's emblem): an upright,
// right-facing blue swastika on a white disc of radius r. dv points to the top arm.
export function hakaristi(du, dv, r) {
  const a = du / r;
  const b = dv / r;
  if (Math.hypot(a, b) > 1) return null;
  return swastikaArms(a, b, 0.72, 0.13) ? 'marking' : 'white';
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

// German spinner of 1943: black-green with a white spiral, from the tip at x0 back over len (model
// units) round the axis at height yc.
const spiralSpinner = (x0, yc, len) => (p) => {
  const turn = Math.atan2(p[2], p[1] - yc) / (2 * Math.PI) + (x0 - p[0]) / len;
  return { kind: ((turn % 1) + 1) % 1 < 0.25 ? 'white' : 'dark' };
};

// Messerschmitt Bf 109 G-6, measured off a 3-view drawing (9.02 m long, 9.92 m span; 5 model units to
// the metre, d back from the spinner tip, h up from the thrust line). Bigger spinner, cowling rising
// to the windscreen with the MG 131 bulges (Beulen) ahead of it, exhaust stacks low on the cowl (the
// DB 605 hangs inverted), chin oil cooler; heavily framed hood flush with a high, straight spine that
// runs back to the fin; deep rear fuselage whose underside sweeps up into the tail; tall squarish fin
// with a rounded top; strut-less tailplane set high on the fin; straight-tapered wing with rounded
// tips and slats; radiators under the wings; narrow splayed gear, a long tail-down stance.
function bf109g6(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  // Camouflage: the pale underside colour reaches high up the rear fuselage sides, low on the cowling.
  const split = (p) => Y(lerp(0.3, -0.2, clamp((p[0] - X(4.4)) / (X(2.8) - X(4.4)), 0, 1)));
  const tone = (p) => (p[1] < split(p) ? 'under' : 'paint');
  const fuselage = bodyOf(o.fuselage);
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
  const wing = surfaceOf(o.wing);
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && cross(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 3.5 * M, 1.05);
    if (k) return { kind: k };
    const hinge = s.k > 0.2 && Math.abs(s.u - 0.74) < 0.035; // flap and aileron line
    const slat = s.k > 0.55 && s.k < 0.92 && Math.abs(s.u - 0.13) < 0.035; // leading-edge slats
    return { kind: under ? 'under' : 'paint', dark: hinge || slat ? 1 : 0 };
  };
  const tailplane = surfaceOf(o.tailplane);
  // Fin and rudder as drawn, [h, d] along each edge: the leading edge rising steeply from the spine to a
  // broad rounded top, the rudder bulging furthest back 0.6 m up and tucking in under the tailcone.
  const fin = surfaceOf(o.fin, true);
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => {
    const frame = [3.27, 3.75, 4.08].some((d) => Math.abs(p[0] - X(d)) < 0.045 * M) || Math.abs(p[1] - Y(0.72)) < 0.03 * M;
    const armour = p[0] < X(4.1) && p[0] > X(4.25) && p[1] > Y(0.72); // head armour behind the pilot
    return { kind: frame || armour ? 'frame' : 'glass' };
  };
  const spinner = bodyOf(o.spinner);
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json bf109g6.wheels): main wheels 2.31 m back on legs splayed out
  // from the wing roots, 2.06 m track; small tail wheel under the upswept tail.
  const { wheelR, main, tailR, tailW } = gearOf(o.gear);
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...spinner, material: spiralSpinner(X(0), Y(0), 0.55 * M) },
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    {
      ...fin,
      material: (p, n) => {
        const k = side(n) && hakenkreuz(p[0] - X(8.45), p[1] - Y(1.05), 0.32 * M);
        return { kind: k || 'paint', dark: !k && Math.abs(p[0] - X(8.4)) < 0.04 * M && p[1] > Y(0.5) ? 1 : 0 }; // rudder hinge
      },
    },
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
function p47d(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  const split = Y(-0.45);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const fuselage = bodyOf(o.fuselage);
  // Razorback: the narrow ridge from the hood straight down to the fin.
  const spine = bodyOf(o.spine);
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
  const wing = surfaceOf(o.wing);
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
  const tailplane = surfaceOf(o.tailplane);
  // Fin and rudder as drawn, [h, d] along each edge: a long sloping leading edge to a rounded top, the
  // rudder straight down the back and tucked in under the tailcone.
  const fin = surfaceOf(o.fin, true);
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => ({ kind: [3.88, 4.55, 5.2].some((d) => Math.abs(p[0] - X(d)) < 0.045 * M) ? 'frame' : 'glass' });
  const hub = bodyOf(o.spinner);
  const plain = (kind) => () => ({ kind });
  // Four .50s a side, staggered, sticking out of the leading edge 2.7 to 3.45 m out.
  const guns = [[2.7, 0.48], [2.95, 0.42], [3.2, 0.36], [3.45, 0.3]].map(([z, out]) => ({ ...strut([X(2.85), Y(-0.85) + z * M * 0.086, z * M], [X(2.78 - out), Y(-0.85) + z * M * 0.086, z * M], 0.04 * M), material: plain('dark') }));
  // Gear (world units in data/planes.json p47d.wheels): big main wheels well forward on long legs,
  // 4.7 m track; tail wheel under the tail, sitting the plane about 11 degrees tail-down.
  const { wheelR, main, tailR, tailW } = gearOf(o.gear);
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
function la5fn(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  const split = Y(-0.25);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const fuselage = bodyOf(o.fuselage);
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
  const wing = surfaceOf(o.wing);
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
  const tailplane = surfaceOf(o.tailplane);
  // Fin and rudder as drawn, [h, d] along each edge: the leading edge rising from the decking to a
  // rounded top, the rudder straight down the back and curving in under the tailcone.
  const fin = surfaceOf(o.fin, true);
  const finMat = (p, n) => {
    const k = side(n) && redStar(p[0] - X(8.0), p[1] - Y(1.0), 0.36 * M);
    if (k) return { kind: k };
    return { kind: 'paint', dark: Math.abs(p[0] - X(8.15)) < 0.04 * M && p[1] > Y(0.5) ? 1 : 0 }; // rudder hinge
  };
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => ({ kind: [3.3, 4.15].some((d) => Math.abs(p[0] - X(d)) < 0.045 * M) ? 'frame' : 'glass' });
  const spinner = bodyOf(o.spinner);
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json la5fn.wheels): main wheels on long legs from the wing,
  // 2.8 m track; small tail wheel, sitting the plane about 16 degrees tail-down.
  const { wheelR, main, tailR, tailW } = gearOf(o.gear);
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
function ki43(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  const split = Y(-0.3);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const fuselage = bodyOf(o.fuselage);
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
  const wing = surfaceOf(o.wing);
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && hinomaru(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 4.0 * M, 0.5 * M);
    if (k) return { kind: k };
    // Yellow identification strip along the inner leading edges (Army fighters from 1942).
    if (s.u < 0.07 && s.k > 0.1 && s.k < 0.45) return { kind: 'yellow' };
    const hinge = s.k > 0.2 && Math.abs(s.u - 0.76) < 0.03; // flap and aileron line
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  const tailplane = surfaceOf(o.tailplane);
  // Fin and rudder as drawn, [h, d] along each edge: a straight leading edge up to the rudder hinge, the
  // rudder rounded behind it and hanging below the tailcone.
  const fin = surfaceOf(o.fin, true);
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => ({ kind: [2.62, 3.1].some((d) => Math.abs(p[0] - X(d)) < 0.04 * M) ? 'frame' : 'glass' });
  const spinner = bodyOf(o.spinner);
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json ki43.wheels): light legs from the wing, 3.4 m track; small
  // tail wheel, sitting the plane about 12 degrees tail-down.
  const { wheelR, main, tailR, tailW } = gearOf(o.gear);
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
function b239(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  const split = Y(-0.35);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const band = (p) => p[0] < X(6.2) && p[0] > X(6.55); // yellow Eastern Front band
  const fuselage = bodyOf(o.fuselage);
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
  const wing = surfaceOf(o.wing);
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
  const tailplane = surfaceOf(o.tailplane);
  // Fin and rudder as drawn, [h, d] along each edge: a long concave leading edge sweeping up from the
  // turtledeck to a rounded top, the rudder's trailing edge almost straight down to the tailcone.
  const fin = surfaceOf(o.fin, true);
  const finMat = (p) => ({ kind: band(p) && p[1] < Y(0.6) ? 'nose' : 'paint', dark: Math.abs(p[0] - X(7.25)) < 0.04 * M && p[1] > Y(0.3) ? 1 : 0 }); // rudder hinge
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => ({ kind: [2.98, 3.6, 4.4, 4.85].some((d) => Math.abs(p[0] - X(d)) < 0.04 * M) ? 'frame' : 'glass' });
  const spinner = bodyOf(o.spinner);
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json b239.wheels): stubby legs from the wing roots raking forward,
  // 2.5 m track, the wheels folding up into the fuselage sides; tail wheel under the tail, about 13
  // degrees tail-down.
  const { wheelR, main, tailR, tailW } = gearOf(o.gear);
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

// Messerschmitt Bf 110 G-2, measured off a 3-view drawing (12.07 m long, 16.25 m span; 5 model units
// to the metre, d back from the nose tip, h up from the nose's centre line, the engines' thrust line
// 0.06 m below it). Slim, pointed gun nose; long, heavily framed glasshouse canopy for the pilot and
// the rear gunner, his twin MG 81Z poking out of the back; straight fuselage tapering to the tail;
// two DB 605 nacelles 2.43 m out with oil coolers under them and the radiator baths under the outer
// wings; wing with a straight leading edge and a forward-swept trailing edge; tailplane on top of the
// tailcone with the twin rounded fins at its tips; main wheels under the nacelles, tail wheel.
function bf110(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  const split = Y(-0.2);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const fuselage = bodyOf(o.fuselage);
  const line = (d, w = 0.05) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselageDecals = [
    // Balkenkreuz on the rear fuselage.
    (p, n) => {
      const k = side(n) && cross(p[0] - X(7.6), p[1] - Y(0.02), 0.95);
      return k ? { kind: k } : null;
    },
    // Panel lines: gun bay, rear fuselage joints.
    (p, n) => (side(n) && [line(1.3), line(6.3), line(9.2)].some((f) => f(p)) ? { kind: tone(p), dark: 1 } : null),
  ];
  const wing = surfaceOf(o.wing);
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && cross(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 6.3 * M, 1.15);
    if (k) return { kind: k };
    const hinge = s.k > 0.15 && Math.abs(s.u - 0.74) < 0.03; // flap and aileron line
    const slat = s.k > 0.6 && s.k < 0.93 && Math.abs(s.u - 0.12) < 0.03; // leading-edge slats
    return { kind: under ? 'under' : 'paint', dark: hinge || slat ? 1 : 0 };
  };
  // Engine nacelles, 2.43 m out on each side, round the thrust line.
  const nz = 2.43 * M;
  const nacelle = bodyOf(o.nacelle);
  const spinner = bodyOf(o.spinner);
  // Ventral gun tray under the wing root with the two MG 151/20 cannon.
  const gunTray = bodyOf(o.gunTray);
  // Radiator baths under the outer wings, slipper-shaped: rounded intake, flat bottom, tapered rear.
  const radiators = bodyOf(o.radiators);
  const tailplane = surfaceOf(o.tailplane);
  // Twin fins at the tailplane tips, traced off the drawing, [h, d] along each edge: a gently curved
  // leading edge, a broad round top and the rudder's trailing edge straight down with rounded corners.
  const fins = surfaceOf(o.fins, true);
  const finMat = (p, n) => {
    const k = side(n) && hakenkreuz(p[0] - X(11.45), p[1] - Y(0.42), 0.32 * M);
    return { kind: k || 'paint', dark: !k && Math.abs(p[0] - X(11.75)) < 0.04 * M && p[1] > Y(-0.1) ? 1 : 0 }; // rudder hinge
  };
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => ({ kind: [1.8, 2.25, 2.7, 3.15, 3.6, 4.05, 4.5, 4.85].some((d) => Math.abs(p[0] - X(d)) < 0.04 * M) ? 'frame' : 'glass' });
  const plain = (kind) => () => ({ kind });
  // Gear (world units in data/planes.json bf110.wheels): big main wheels under the nacelles, tail wheel
  // under the tail, about 11.5 degrees tail-down.
  const { wheelR, main, tailR, tailW } = gearOf(o.gear);
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...nacelle, material: (p) => ({ kind: tone(p) }) },
    { ...spinner, material: spiralSpinner(X(0.92), Y(-0.06), 0.63 * M) },
    { ...box([X(2.45), Y(-0.86), nz], [0.35 * M, 0.08 * M, 0.25 * M], { mirror: true }), material: (p) => ({ kind: p[0] > X(2.15) ? 'dark' : 'under' }) }, // oil coolers
    { ...radiators, material: (p) => ({ kind: p[0] > X(3.1) ? 'dark' : 'under' }) }, // radiator baths, intakes dark
    { ...gunTray, material: (p) => ({ kind: p[0] > X(4.0) ? 'dark' : 'under' }) }, // ventral MG 151/20 tray, muzzles dark
    { ...box([X(1.9), Y(0.0), nz + 0.5 * M], [0.4 * M, 0.06 * M, 0.06 * M], { mirror: true }), material: (p) => ({ kind: Math.floor((X(1.5) - p[0]) / (0.13 * M)) % 2 ? 'metal' : 'dark' }) }, // exhaust stacks
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fins, material: finMat },
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(2.4), Y(0.72), 0], 0.16 * M), pilot: true, material: plain('pilot') },
    { ...sphere([X(4.35), Y(0.7), 0], 0.16 * M), pilot: true, material: plain('pilot') }, // rear gunner
    { ...strut([X(5.0), Y(0.82), 0], [X(5.45), Y(1.12), 0], 0.05 * M), material: plain('dark') }, // MG 81Z
    { ...strut([X(0.35), Y(0.22), 0.12 * M], [X(0.05), Y(0.2), 0.12 * M], 0.03 * M), material: plain('dark') }, // nose MG 17 muzzles
    { ...strut([X(3.15), Y(-0.85), nz], main, 0.08 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.13 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(10.95), Y(-0.32), 0], tailW, 0.04 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.05 * M), material: tyre(tailW, tailR), gear: true },
  ];
  return {
    parts,
    attach: {
      exhaust: [X(1.9), Y(0.0), nz + 0.56 * M],
      wingRootL: [X(4.0), Y(-0.45), 0.5 * M],
      wingRootR: [X(4.0), Y(-0.45), -0.5 * M],
      wingTipL: [X(3.9), Y(-0.45) + 8.0 * M * 0.03, 8.0 * M],
      wingTipR: [X(3.9), Y(-0.45) + 8.0 * M * 0.03, -8.0 * M],
      propHub: [X(1.2), Y(-0.06), nz],
      propHubs: [
        [X(1.2), Y(-0.06), nz],
        [X(1.2), Y(-0.06), -nz],
      ],
      propRadius: 1.65 * M,
      mainContact: [main[0], -10, 0],
      track: main[2],
    },
  };
}

// Lockheed P-38J Lightning, traced in the Outline Lab (11.53 m long, 15.85 m span; 5 model units to the
// metre, d back from the nose tip of the central nacelle). The pilot's pod on the centre line with the four
// .50 and the 20 mm cannon in the nose and a bubble canopy; two Allison booms 2.49 m out, each with a
// three-bladed propeller, the turbo-supercharger and intercooler bulge on the boom behind the wing and the
// tailfin at its end; one tailplane joining the booms; tricycle gear, the main wheels under the booms, the
// nosewheel under the pod. 1943 USAAF scheme: olive drab over neutral grey, star and bar on the booms and
// on the wings (port upper, starboard lower).
function p38j(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  const split = Y(-0.2);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const line = (d, w = 0.05) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselage = bodyOf(o.fuselage);
  const boom = bodyOf(o.nacelle);
  const spinner = bodyOf(o.spinner);
  const gunTray = bodyOf(o.gunTray);
  const radiators = bodyOf(o.radiators);
  const wing = surfaceOf(o.wing);
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    // US practice: the star on the port wing's upper surface and the starboard wing's underside.
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && (under ? p[2] < 0 : p[2] > 0) && starBar(Math.abs(p[2]) - 5.2 * M, p[0] - (s.le + s.te) / 2, 0.5 * M);
    if (k) return { kind: k };
    const hinge = s.k > 0.15 && Math.abs(s.u - 0.74) < 0.03; // flap and aileron line
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  const tailplane = surfaceOf(o.tailplane);
  const fins = surfaceOf(o.fins, true);
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => ({ kind: [3.0, 3.6, 4.2, 4.7].some((d) => Math.abs(p[0] - X(d)) < 0.04 * M) ? 'frame' : 'glass' });
  const plain = (kind) => () => ({ kind });
  const nz = o.nacelle.z * M;
  const { wheelR, main, tailR, tailW } = gearOf(o.gear); // tailW is the nosewheel
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const muzzle = (d, h, z, len = 0.3) => ({ ...strut([X(d), Y(h), z * M], [X(d - len), Y(h), z * M], 0.03 * M), material: plain('dark') });
  const parts = [
    { ...fuselage, material: (p, n) => (side(n) && line(1.3)(p) ? { kind: tone(p), dark: 1 } : { kind: tone(p) }) },
    { ...boom, material: (p, n) => {
      // Star and bar on the boom sides over the intercooler, panel lines at the wing and the turbo bay.
      const k = side(n) && starBar(p[0] - X(9.0), p[1] - Y(0.08), 0.26 * M);
      if (k) return { kind: k };
      return { kind: tone(p), dark: side(n) && [line(4.0), line(6.1)].some((f) => f(p)) ? 1 : 0 };
    } },
    { ...spinner, material: plain('paint') },
    { ...radiators, material: (p) => ({ kind: p[0] > X(7.0) ? 'dark' : 'under' }) },
    { ...gunTray, material: (p) => ({ kind: p[0] > X(0.5) ? 'dark' : 'under' }) },
    { ...box([X(1.75), Y(0.62), nz + 0.0 * M], [0.35 * M, 0.06 * M, 0.2 * M], { mirror: true }), material: (p) => ({ kind: Math.floor((X(1.4) - p[0]) / (0.12 * M)) % 2 ? 'metal' : 'dark' }) }, // exhaust stacks
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fins, material: (p) => ({ kind: 'paint', dark: Math.abs(p[0] - X(11.3)) < 0.04 * M && p[1] > Y(-0.1) ? 1 : 0 }) }, // rudder hinge
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(3.5), Y(0.82), 0], 0.17 * M), pilot: true, material: plain('pilot') },
    // Nose armament: four .50 in a row beside the 20 mm, all muzzles just ahead of the nose tip.
    muzzle(0.12, 0.17, 0.1, 0.35), muzzle(0.12, 0.1, 0.1, 0.35), muzzle(0.12, 0.14, 0, 0.3),
    // Main legs under the booms, nose leg under the pod.
    { ...strut([X(4.2), Y(-0.6), nz], main, 0.08 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.14 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(1.0), Y(-0.45), 0], tailW, 0.05 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.07 * M), material: tyre(tailW, tailR), gear: true },
  ];
  const hubD = 1.45;
  const hubH = 0.23;
  return {
    parts,
    attach: {
      exhaust: [X(2.0), Y(0.6), nz + 0.0 * M],
      wingRootL: [X(4.5), Y(0.1), 0.5 * M],
      wingRootR: [X(4.5), Y(0.1), -0.5 * M],
      wingTipL: [X(4.1), Y(0.28 + 7.93 * 0.03), 7.9 * M],
      wingTipR: [X(4.1), Y(0.28 + 7.93 * 0.03), -7.9 * M],
      propHub: [X(hubD), Y(hubH), nz],
      propHubs: [
        [X(hubD), Y(hubH), nz],
        [X(hubD), Y(hubH), -nz],
      ],
      propRadius: 1.75 * M,
      mainContact: [main[0], main[1] - wheelR, 0],
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
function spitfire(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  const split = Y(-0.3);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const band = (p) => p[0] < X(7.25) && p[0] > X(7.7); // Sky band round the rear fuselage
  const fuselage = bodyOf(o.fuselage);
  // Razorback: the narrow spine behind the hood, falling gently to the fin.
  const spine = bodyOf(o.spine);
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
  const wing = surfaceOf(o.wing);
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const mid = p[0] - (s.le + s.te) / 2;
    const k = vn[2] > 0.3 && ((n[1] > 0.6 && roundelB(mid, Math.abs(p[2]) - 3.6 * M, 0.7 * M)) || (n[1] < -0.6 && roundelC(mid, Math.abs(p[2]) - 3.6 * M, 0.41 * M)));
    if (k) return { kind: k };
    // Yellow identification stripe along the outer leading edges.
    if (s.u < 0.07 && s.k > 0.38 && s.k < 0.92) return { kind: 'yellow' };
    const hinge = s.k > 0.15 && s.k < 0.9 && Math.abs(s.u - 0.78) < 0.035; // flap and aileron line
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  // Tailplane as drawn, [z, d] along each edge: curved leading edge, the elevators' trailing edge
  // straight out to two thirds of the span before rounding into the tip.
  const tailplane = surfaceOf(o.tailplane);
  // Fin and rudder as drawn, [h, d] along each edge: the leading edge curving up from the spine into
  // the round top, the rudder bulging furthest back 0.24 m up and curving forward above and below.
  const fin = surfaceOf(o.fin, true);
  const finMat = (p, n) => {
    // Fin flash (red, white, blue) ahead of the rudder hinge.
    const flash = side(n) && p[1] > Y(0.45) && p[1] < Y(1.05) && p[0] < X(8.2) && p[0] > X(8.78);
    if (flash) return { kind: p[0] > X(8.44) ? 'red' : p[0] > X(8.54) ? 'white' : 'marking' };
    return { kind: 'paint', dark: Math.abs(p[0] - X(8.82)) < 0.04 * M && p[1] > Y(0.3) ? 1 : 0 }; // rudder hinge
  };
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => ({ kind: [3.85, 4.45].some((d) => Math.abs(p[0] - X(d)) < 0.045 * M) ? 'frame' : 'glass' });
  const spinner = bodyOf(o.spinner);
  const plain = (kind) => () => ({ kind });
  // Cannon barrels stick out 0.9 m ahead of the leading edge, 2.05 m out from the centre line.
  const gunZ = 2.05 * M;
  const gunLe = wing.shape([0, Y(-0.68), gunZ]).le;
  // Gear (world units in data/planes.json spitfire.wheels): main wheels well forward, under the wing
  // leading edge, 1.68 m track on legs splayed out and raked forward; fixed tail wheel under the tail,
  // which sits the plane about 13 degrees tail-down.
  const { wheelR, main, tailR, tailW } = gearOf(o.gear);
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

// de Havilland Mosquito FB.VI, traced in the Outline Lab from the Czechoslovak B-36 sheet (12.34 m long,
// 16.52 m span; 5 model units to the metre, d back from the spinner tip). Rounded solid nose with four
// .303 above and four 20 mm Hispano in the tray below; side-by-side cockpit under a raked blister canopy;
// slim wooden fuselage rising to a single tall fin on the centre line; two Merlin nacelles 2.48 m out with
// the radiators in the wing leading edges beside them; two 250 lb bombs on racks under the wings outboard
// of the nacelles. 1943 RAF day fighter scheme: Dark Green / Ocean Grey over Medium Sea Grey, Sky spinners
// and tail band, type C1 and B roundels, fin flash. The racks are placed by hand (the sheet's underside is
// the clean post-war airframe), 3.5 m out at mid chord.
function mosquito(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  const split = Y(-0.2);
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const band = (p) => p[0] < X(10.05) && p[0] > X(10.5); // Sky band round the rear fuselage
  const fuselage = bodyOf(o.fuselage);
  const fuselageDecals = [
    (p) => (band(p) ? { kind: 'nose' } : null),
    // C1 roundel between the wing and the band.
    (p, n) => {
      const k = side(n) && roundelC1(p[0] - X(8.0), p[1] - Y(0.1), 0.45 * M);
      return k ? { kind: k } : null;
    },
    // Panel lines: nose gun bay, cockpit bulkhead, rear fuselage joint (the Mosquito's wooden monocoque).
    (p, n) => (side(n) && [1.0, 3.7, 7.0].some((d) => Math.abs(p[0] - X(d)) < 0.04 * M) ? { kind: tone(p), dark: 1 } : null),
  ];
  const wing = surfaceOf(o.wing);
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const mid = p[0] - (s.le + s.te) / 2;
    const k = vn[2] > 0.3 && ((n[1] > 0.6 && roundelB(mid, Math.abs(p[2]) - 5.6 * M, 0.6 * M)) || (n[1] < -0.6 && roundelC(mid, Math.abs(p[2]) - 5.6 * M, 0.45 * M)));
    if (k) return { kind: k };
    const hinge = s.k > 0.2 && Math.abs(s.u - 0.75) < 0.03; // flap and aileron line
    return { kind: under ? 'under' : 'paint', dark: hinge ? 1 : 0 };
  };
  const nz = o.nacelle.z * M;
  const nacelle = bodyOf(o.nacelle);
  const spinner = bodyOf(o.spinner);
  const gunTray = bodyOf(o.gunTray);
  // One wide block for the two radiators beside each nacelle; the front is the dark intake.
  const radiators = bodyOf(o.radiators);
  const tailplane = surfaceOf(o.tailplane);
  const fin = surfaceOf(o.fin, true);
  const finMat = (p, n) => {
    // Fin flash (red, white, blue) ahead of the rudder hinge.
    const flash = side(n) && p[1] > Y(0.95) && p[1] < Y(1.65) && p[0] < X(10.35) && p[0] > X(10.9);
    if (flash) return { kind: p[0] > X(10.53) ? 'red' : p[0] > X(10.72) ? 'white' : 'marking' };
    return { kind: 'paint', dark: Math.abs(p[0] - X(10.95)) < 0.04 * M && p[1] > Y(0.9) ? 1 : 0 }; // rudder hinge
  };
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => ({ kind: [1.95, 2.55, 3.1].some((d) => Math.abs(p[0] - X(d)) < 0.04 * M) ? 'frame' : 'glass' });
  const plain = (kind) => () => ({ kind });
  // Bomb rack: a pylon under the wing and a 250 lb GP bomb (about 1.2 m, 0.28 m across), 3.5 m out.
  const rz = 3.5 * M;
  const bomb = bodyOf({ n: 2, z: 3.5, stations: [[3.25, -0.15, -0.17, 0.01], [3.4, -0.07, -0.29, 0.1], [3.7, -0.04, -0.32, 0.14], [4.1, -0.04, -0.32, 0.14], [4.45, -0.08, -0.28, 0.1], [4.6, -0.12, -0.2, 0.05]] });
  const { wheelR, main, tailR, tailW } = gearOf(o.gear);
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...nacelle, material: (p) => ({ kind: tone(p) }) },
    { ...spinner, material: plain('nose') },
    { ...radiators, material: (p) => ({ kind: p[0] > X(1.25) ? 'dark' : 'under' }) },
    { ...gunTray, material: (p) => ({ kind: p[0] > X(0.95) ? 'dark' : 'under' }) },
    { ...box([X(1.5), Y(0.05), nz + 0.5 * M], [0.4 * M, 0.07 * M, 0.06 * M], { mirror: true }), material: (p) => ({ kind: Math.floor((X(1.1) - p[0]) / (0.13 * M)) % 2 ? 'metal' : 'dark' }) }, // flame-damper exhausts
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: finMat },
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(2.35), Y(0.8), 0.22 * M], 0.16 * M), pilot: true, material: plain('pilot') },
    { ...sphere([X(2.8), Y(0.78), -0.22 * M], 0.16 * M), pilot: true, material: plain('pilot') }, // navigator, beside and behind
    // Four .303 in the upper nose, four Hispanos from the tray below.
    ...[[0.1, 0.12], [0.2, 0.04], [0.1, -0.04], [0.2, -0.12]].map(([zz, hh]) => ({ ...strut([X(0.35), Y(0.1 + hh * 0.5), zz * M], [X(0.12), Y(0.1 + hh * 0.5), zz * M], 0.025 * M), material: plain('dark') })),
    ...[0.12, 0.27].map((zz) => ({ ...strut([X(0.95), Y(-0.62), zz * M], [X(0.55), Y(-0.62), zz * M], 0.04 * M), material: plain('dark') })),
    { ...box([X(3.85), Y(0.0), rz], [0.45 * M, 0.1 * M, 0.04 * M], { mirror: true }), material: plain('under') }, // rack pylon
    { ...bomb, material: (p) => ({ kind: p[0] < X(4.35) ? 'dark' : 'metal' }) },
    { ...strut([X(2.7), Y(-0.7), nz], main, 0.09 * M), material: metal, gear: true },
    { ...wheel(main, wheelR, 0.15 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(10.85), Y(0.1), 0], tailW, 0.05 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.07 * M), material: tyre(tailW, tailR), gear: true },
  ];
  const hubH = Y(-0.01);
  return {
    parts,
    attach: {
      exhaust: [X(1.5), Y(0.05), nz + 0.56 * M],
      wingRootL: [X(3.4), Y(-0.2), 0.65 * M],
      wingRootR: [X(3.4), Y(-0.2), -0.65 * M],
      wingTipL: [X(3.0), Y(o.wing.at) + o.wing.span * M * o.wing.rise, o.wing.span * M],
      wingTipR: [X(3.0), Y(o.wing.at) + o.wing.span * M * o.wing.rise, -o.wing.span * M],
      propHub: [X(0.45), hubH, nz],
      propHubs: [
        [X(0.45), hubH, nz],
        [X(0.45), hubH, -nz],
      ],
      propRadius: 1.75 * M,
      mainContact: [main[0], -10, 0],
      track: main[2],
    },
  };
}

// Junkers Ju 87 D-5 Stuka (11.5 m long, 15 m span; 5 model units to the metre, d back from the spinner tip).
// Inverted gull wing (the outline's edge tables carry the crank; the dive brakes show as dark slats under
// the outer wing), long glazed canopy over pilot and rear gunner with the MG 81Z on the rear mount, deep
// chin radiator, fixed gear in wheel spats, single tall fin with the rudder. Two MG 151/20 in the outer
// wings. 1943 Luftwaffe scheme: RLM 70 / 71 splinter on top over RLM 65 underneath, dark spinner,
// Balkenkreuze on fuselage and wings (a white-bordered black cross, `cross`), optional fin swastika.
function ju87(o) {
  const { M, X, Y, bodyOf, surfaceOf, gearOf } = kit(o);
  const split = Y(-0.12); // demarcation down the fuselage side
  const tone = (p) => (p[1] < split ? 'under' : 'paint');
  const fuselage = bodyOf(o.fuselage);
  const line = (d, w = 0.04) => (p) => Math.abs(p[0] - X(d)) < w * M;
  const fuselageDecals = [
    // Panel lines: cowling joint, firewall, rear of the canopy, rear fuselage joint.
    (p, n) => (side(n) && [line(1.45), line(2.7), line(6.75), line(8.6)].some((f) => f(p)) ? { kind: tone(p), dark: 1 } : null),
    // Exhaust stubs along the cowling side.
    (p, n) => (side(n) && Math.abs(p[1] - Y(0.1)) < 0.06 * M && p[0] < X(0.9) && p[0] > X(1.55) ? { kind: 'dark' } : null),
    // Balkenkreuz between the canopy and the tail.
    (p, n) => {
      const k = side(n) && cross(p[0] - X(8.0), p[1] - Y(0.12), 0.42);
      return k ? { kind: k } : null;
    },
  ];
  const wing = surfaceOf(o.wing);
  const wingMat = (p, n, vn) => {
    const s = wing.shape(p);
    const under = n[1] < -0.3;
    const k = Math.abs(n[1]) > 0.6 && vn[2] > 0.3 && cross(p[0] - (s.le + s.te) / 2, Math.abs(p[2]) - 5.2 * M, 0.34);
    if (k) return { kind: k };
    const hinge = s.k > 0.25 && Math.abs(s.u - 0.72) < 0.03; // flap and aileron line
    const brake = under && s.k > 0.3 && s.k < 0.8 && Math.abs(s.u - 0.42) < 0.05; // dive brake slat
    return { kind: under ? 'under' : 'paint', dark: hinge || brake ? 1 : 0 };
  };
  const tailplane = surfaceOf(o.tailplane);
  const fin = surfaceOf(o.fin, true);
  const finMat = (p, n) => {
    const k = side(n) && hakenkreuz(p[0] - X(10.25), p[1] - Y(1.15), 0.3 * M);
    return { kind: k || 'paint', dark: !k && Math.abs(p[0] - X(10.65)) < 0.04 * M && p[1] > Y(0.6) ? 1 : 0 }; // rudder hinge
  };
  const canopy = bodyOf(o.canopy);
  const canopyMat = (p) => ({ kind: [4.0, 4.7, 5.35, 6.0].some((d) => Math.abs(p[0] - X(d)) < 0.04 * M) ? 'frame' : 'glass' });
  const spinner = bodyOf(o.spinner);
  const radiators = bodyOf(o.radiators);
  const spat = bodyOf(o.spat);
  const bump = bodyOf(o.bump);
  const plain = (kind) => () => ({ kind });
  const { wheelR, main, tailR, tailW } = gearOf(o.gear);
  // The wheel sits inside the spat (its outer face behind the spat skin), so only the tyre below shows.
  const inner = [main[0], main[1], 1.45 * M];
  const metal = () => ({ kind: 'metal' });
  const tyre = (c, r) => (p) => ({ kind: Math.hypot(p[0] - c[0], p[1] - c[1]) < r * 0.4 ? 'metal' : 'tyre' });
  const wz = 3.4 * M; // MG 151/20 muzzles in the wing leading edge
  const wy = Y(o.wing.at + 3.4 * o.wing.rise * 0 + 0.1);
  const parts = [
    { ...fuselage, material: (p, n) => fuselageDecals.map((f) => f(p, n)).find(Boolean) ?? { kind: tone(p) } },
    { ...spinner, material: plain('dark') },
    { ...radiators, material: (p) => ({ kind: p[0] > X(1.9) ? 'dark' : 'under' }) },
    { ...wing, material: wingMat },
    { ...tailplane, material: (p, n, vn) => ({ kind: n[1] < -0.6 && Math.abs(vn[2]) > 0.25 ? 'under' : 'paint' }) },
    { ...fin, material: finMat },
    { ...canopy, glass: true, material: canopyMat },
    { ...sphere([X(4.5), Y(0.88), 0], 0.17 * M), pilot: true, material: plain('pilot') },
    { ...sphere([X(5.55), Y(0.86), 0], 0.17 * M), pilot: true, material: plain('pilot') }, // rear gunner, facing aft
    // Rear gunner's MG 81Z on its pivot mount, barrels poking aft out of the canopy.
    { ...strut([X(6.55), Y(0.78), 0.06 * M], [X(6.95), Y(0.62), 0.06 * M], 0.03 * M), material: plain('dark') },
    // Two MG 151/20 in the wings.
    { ...strut([X(3.25), wy, wz], [X(2.8), wy, wz], 0.04 * M), material: plain('dark') },
    { ...spat, material: plain('paint') },
    { ...bump, material: plain('metal') }, // leg fairing above the spat
    { ...strut([X(3.2), Y(-0.9), 1.45 * M], inner, 0.07 * M), material: metal, gear: true },
    { ...wheel(inner, wheelR, 0.08 * M), material: tyre(main, wheelR), gear: true },
    { ...strut([X(10.75), Y(0.1), 0], tailW, 0.08 * M), material: metal, gear: true },
    { ...wheel(tailW, tailR, 0.05 * M), material: tyre(tailW, tailR), gear: true },
  ];
  return {
    parts,
    attach: {
      exhaust: [X(1.0), Y(0.1), 0.45 * M],
      wingRootL: [X(3.9), Y(-0.45), 0.6 * M],
      wingRootR: [X(3.9), Y(-0.45), -0.6 * M],
      wingTipL: [X(3.4), Y(o.wing.at) + o.wing.span * M * o.wing.rise, o.wing.span * M],
      wingTipR: [X(3.4), Y(o.wing.at) + o.wing.span * M * o.wing.rise, -o.wing.span * M],
      propHub: [X(0.4), Y(0), 0],
      propRadius: 1.7 * M,
      mainContact: [main[0], -10, 0],
      track: main[2],
    },
  };
}

// Builders by plane; each reads its outline (data/outlines/<plane>.json, see kit above).
// Parts any plane can carry although its model code does not know them (a plane built from a template in the
// Outline Lab): `bump`, `bump2`, `bump3` (small details: gun sight, antenna housing), `spat` (a mirrored pair
// round the main wheels, with z) and, when the model never reads them, `radiators`, `gunTray`, `nacelle` and
// `spine`. Each is a plain solid made from body-part stations; the outline may set its surface `kind`. A plane
// whose model already draws a key is not drawn twice: the model is built through a proxy that notes what it
// reads, so a finished plane is built exactly as before.
const EXTRA_PARTS = { bump: 'dark', bump2: 'dark', bump3: 'dark', spat: 'paint', radiators: 'under', gunTray: 'under', nacelle: 'paint', spine: 'paint' };
const withBumps = (build) => (o) => {
  const read = new Set();
  const model = build(new Proxy(o, { get: (t, k) => (read.add(k), t[k]) }));
  const { bodyOf } = kit(o);
  for (const [key, kind] of Object.entries(EXTRA_PARTS)) {
    if (o[key] && !read.has(key)) model.parts.push({ ...bodyOf(o[key]), material: () => ({ kind: o[key].kind ?? kind }) });
  }
  return model;
};
export const BUILDERS = Object.fromEntries(Object.entries({ bf109g6, spitfire, p47d, la5fn, ki43, b239, bf110, mosquito, ju87, p38j }).map(([k, f]) => [k, withBumps(f)]));
// A plane without a model of its own yet (a new outline in the Outline Lab) borrows a finished plane's
// model code through outline.template, so its outline can be traced and previewed.
export const buildModel = (name, outline) => BUILDERS[outline.template ?? name](outline);
