// Outline Lab: edit a plane's outline (data/outlines/<plane>.json) over a blueprint, with the real
// renderer (tools/plane-models.mjs) showing the finished sprite live. Side view first; open as
// outline-lab.html (the dev server, node tools/serve.mjs, saves the files and builds the sprites).
import { kit, buildModel, render, rollPose } from '../../tools/plane-models.mjs';
import { PALETTE } from '../../tools/plane-palette.mjs';
import { formatOutline } from '../../tools/outline-format.mjs';
import { paintSprite } from '../render/sprites.js';
import { samplePlanform, fitPlanform, convertPlanform } from '../../tools/planform.mjs';

const $ = (id) => document.getElementById(id);
const RES = 2; // the sprite generator renders planes at 2 pixels per model unit
const clone = (x) => JSON.parse(JSON.stringify(x));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const round025 = (v) => Math.round(v / 0.025) * 0.025;

const COLOURS = {
  fuselage: '#e0c070', spinner: '#d09060', spine: '#c0a0e0', canopy: '#70c0e0', nacelle: '#e09090',
  gunTray: '#b0b0b0', radiators: '#90d090', wing: '#e0e070', tailplane: '#a0e0a0', fin: '#e08080', fins: '#e08080', gear: '#ffffff',
};
const LABELS = {
  fuselage: 'Fuselage', spinner: 'Spinner', spine: 'Spine', canopy: 'Canopy', nacelle: 'Nacelle', gunTray: 'Gun tray',
  radiators: 'Radiators', wing: 'Wing', tailplane: 'Tailplane', fin: 'Fin', fins: 'Fins', gear: 'Gear',
};
const SEQ = { side: ['nose', 'tail'], plan: ['nose', 'tipA', 'tipB'], under: ['nose', 'tipA', 'tipB'] }; // calibration clicks per view
// The plan view (from above) and the underside view (from below) edit the same points, each over its own picture.
const isPlan = () => S.mode !== 'side';
const label = (key) => (S.mode === 'side' && (key === 'wing' || key === 'tailplane') ? `${LABELS[key]} root` : LABELS[key]);
const BODY_KEYS = ['fuselage', 'spinner', 'spine', 'canopy', 'nacelle', 'gunTray', 'radiators'];

const S = window.outlineLab = {
  name: null,
  o: null, // the outline being edited
  saved: '', // its saved text
  baseGear: '',
  planes: null,
  nations: null,
  def: null,
  part: 'fuselage',
  sel: null, // { ref, which } the selected point
  mode: 'side', // 'side' or 'plan' (top view)
  bps: { side: null, plan: null, under: null }, // blueprints: { img, name, blob, nose, tail, tailH } (plan: nose, tipA, tipB)
  top: null, // the plan view's rendered sprite { canvas, res }
  calibrating: null,
  view: { x: 0, y: 0, k: 1 },
  sprite: null,
  spriteError: '',
  undo: [],
  redo: [],
  hover: null,
  cursor: null,
  dirtyPreview: true,
};

// The blueprint of the view being edited.
Object.defineProperty(S, 'bp', { get: () => S.bps[S.mode], set: (v) => (S.bps[S.mode] = v) });
const calibrated = (b) => !!b && SEQ[S.mode].every((k) => b[k]);

// ---------- Status ----------
function status(text, warn = false) {
  const el = $('status');
  el.textContent = text;
  el.className = warn ? 'warn' : '';
}
const isDirty = () => S.o && formatOutline(S.o) !== S.saved;
function showDirty() {
  status(isDirty() ? 'unsaved changes' : S.name ? `${S.name}: saved` : '');
}

// ---------- Geometry ----------
// Metres: d back from the plane's reference nose point, h up. The blueprint is placed by the two
// calibration clicks (nose = d 0, h 0; tail end = d length, h tailH), which also gives its scale and tilt.
function tailHeight() {
  if (S.bp?.tailH !== undefined && S.bp.tailH !== null) return S.bp.tailH;
  const last = S.o.fuselage.stations.at(-1);
  return r4((last[1] + last[2]) / 2);
}
function solveT(N, Tp, L, hT) {
  const dx = Tp[0] - N[0];
  const dy = Tp[1] - N[1];
  const cdiv = (bx, by) => {
    const m = bx * bx + by * by || 1;
    return [(dx * bx + dy * by) / m, (dy * bx - dx * by) / m];
  };
  let sigma = 1;
  let e = cdiv(L, -hT);
  if (e[0] < 0) {
    sigma = -1;
    e = cdiv(L, hT);
  }
  // image = N + d * e + h * sigma * (e.y, -e.x)
  return { a: e[0], b: e[1], c: sigma * e[1], d: -sigma * e[0], e: N[0], f: N[1] };
}
// Plan view: the two wingtip clicks give the span line (scale, and the z axis), the nose click the d
// origin along the axis perpendicular to it. z grows towards the first wingtip clicked; the plane is
// symmetric so the other half is its mirror.
function planT() {
  const b = S.bp;
  if (!calibrated(b)) return { a: -40, b: 0, c: 0, d: 40, e: S.o.length * 40 + 20, f: 300 };
  const A = b.tipA;
  const B = b.tipB;
  const N = b.nose;
  const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const len = Math.hypot(A[0] - B[0], A[1] - B[1]) || 1;
  const sc = len / S.o.span; // image pixels per metre
  const v = [(A[0] - M[0]) / (len / 2), (A[1] - M[1]) / (len / 2)];
  let u = [-v[1], v[0]];
  const along = (M[0] - N[0]) * u[0] + (M[1] - N[1]) * u[1];
  if (along < 0) u = [-u[0], -u[1]]; // d grows from the nose towards the tail
  if (b.flip) u = [-u[0], -u[1]]; // the owner turned it round (the guess above fails when the nose is near the tip line)
  const t = Math.abs(along);
  const O = [M[0] - u[0] * t, M[1] - u[1] * t]; // the nose point (d = 0) on the centre line
  return { a: sc * u[0], b: sc * u[1], c: sc * v[0], d: sc * v[1], e: O[0], f: O[1] };
}
function matT() {
  if (isPlan()) return planT();
  const L = S.o.length;
  const b = S.bp?.nose && S.bp?.tail ? S.bp : null;
  if (b) return solveT(b.nose, b.tail, L, tailHeight());
  return solveT([L * 40 + 20, 200], [20, 200], L, 0); // no calibration: nose to the right, 40 px per metre
}
const toImg = (T, d, h) => [T.e + T.a * d + T.c * h, T.f + T.b * d + T.d * h];
function fromImg(T, x, y) {
  const det = T.a * T.d - T.b * T.c || 1e-9;
  const dx = x - T.e;
  const dy = y - T.f;
  return [(T.d * dx - T.c * dy) / det, (-T.b * dx + T.a * dy) / det];
}
const toScreen = (T, d, h) => {
  const [x, y] = toImg(T, d, h);
  return [x * S.view.k + S.view.x, y * S.view.k + S.view.y];
};
const fromScreen = (T, sx, sy) => fromImg(T, (sx - S.view.x) / S.view.k, (sy - S.view.y) / S.view.k);

// The sprite's pixel grid in metres: pixel (col, row) is at d = A0 + A1 * col, h = B0 + B1 * row.
// Plan view preview: the model seen from above (rollPose PI/2), its centre line on a pixel edge. The grid
// is always the fine one (2 pixels per model unit) so snapping stays put while a drag renders coarser.
function topLayout(res = RES) {
  const M = S.o.scale;
  const reach = Math.max(S.o.span / 2, ...['nacelle', 'spinner'].map((k) => (S.o[k]?.z ?? 0) + Math.max(0, ...(S.o[k]?.stations ?? []).map((r) => r[3])))) + 0.5;
  const h = 2 * Math.ceil(reach * M * res) + 8;
  return { w: Math.round((spriteSize0()[0] * res) / RES), h, ax: (S.def.pivot[0] * res) / RES, ay: h / 2 - 0.5, res };
}
function pixelGrid() {
  const M = S.o.scale;
  if (isPlan()) {
    const t = topLayout();
    const step = 1 / (RES * M);
    return { A0: (S.o.frame.x + t.ax / RES) / M, A1: -step, B0: -t.ay / (RES * M), B1: step, step };
  }
  const [ax, ay] = S.def.pivot;
  const step = 1 / (RES * M);
  return { A0: (S.o.frame.x + ax / RES) / M, A1: -step, B0: (ay / RES - S.o.frame.y) / M, B1: -step, step };
}
const spriteSize0 = () => S.def.spriteSize ?? [96, 36];
const spriteSize = () => {
  if (!isPlan()) return spriteSize0();
  const t = topLayout();
  return [t.w, t.h];
};
// Snap to pixel edges, so a point sits between two pixels and one step moves the outline one pixel.
function snap(d, h) {
  if (!$('snap').checked) return [r4(d), r4(h)];
  const g = pixelGrid();
  const pd = g.A0 + g.A1 * 0.5;
  const ph = g.B0 + g.B1 * 0.5;
  return [r4(pd + g.step * Math.round((d - pd) / g.step)), r4(ph + g.step * Math.round((h - ph) / g.step))];
}

// ---------- Parts: points, lines ----------
const verticalOf = (key) => key === 'fin' || key === 'fins';
function sampleVertical(s) {
  const o = S.o;
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
function fitFin(s) {
  if (!s?.le || !s?.te) return;
  const hs = [...s.le, ...s.te].map((r) => r[0]);
  s.at = r4(Math.min(...hs));
  s.span = r4(Math.max(...hs) - s.at);
  s.root = [r4(Math.min(...s.le.map((r) => r[1]))), r4(Math.max(...s.te.map((r) => r[1])))];
}

// Puts a fin's points back in order: every point goes under the edge (front or back) it lies on, each edge
// in height order, with the topmost point shared. A point keeps its edge unless it is well over the middle.
function splitFin(s) {
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

function bodyRows(key) {
  return S.o[key].stations;
}
function isSym(rows) {
  return rows.every((r) => Math.abs(r[1] + r[2]) < 1e-9);
}

// ---------- Plan view parts (top view: coordinates are [d, z], z out from the centre line) ----------
const PLAN_PARTS = ['wing', 'tailplane'];
const planned = (key) => PLAN_PARTS.includes(key);
function planHandles(key) {
  const s = S.o[key];
  const hs = [];
  if (!s) return hs;
  if (BODY_KEYS.includes(key)) {
    const z0 = s.z ?? 0;
    const rows = s.stations;
    for (const row of rows) {
      hs.push({
        ref: row,
        which: 'width',
        pos: () => [row[0], z0 + row[3]],
        set: (d, z) => {
          row[0] = d;
          row[3] = r4(Math.max(0, z - z0));
        },
        remove: () => rows.length > 2 && rows.splice(rows.indexOf(row), 1),
      });
    }
    // A mirrored pair (nacelles): one handle moves the pair in or out.
    if (s.z !== undefined) {
      hs.push({ ref: s, which: 'axis', pos: () => [(rows[0][0] + rows.at(-1)[0]) / 2, s.z], set: (d, z) => (s.z = r4(Math.max(0, z))) });
    }
  } else if (planned(key) && s.le) {
    for (const edge of ['le', 'te']) {
      const rows = s[edge];
      const other = edge === 'le' ? 'te' : 'le';
      rows.forEach((row, i) => {
        const last = i === rows.length - 1;
        hs.push({
          ref: row,
          which: edge,
          pos: () => [row[1], row[0]],
          set: (d, z) => {
            row[1] = d;
            row[0] = i === 0 ? 0 : Math.max(0, z);
            if (last) s[other].at(-1)[0] = row[0]; // both edges end at the same z
            fitPlanform(s, false);
          },
          remove: () => {
            if (rows.length > 2 && !last && i > 0) {
              rows.splice(rows.indexOf(row), 1);
              fitPlanform(s, false);
            }
          },
        });
      });
    }
  }
  return hs;
}
function planLines(key) {
  const o = S.o;
  const s = o[key];
  if (!s) return [];
  if (BODY_KEYS.includes(key)) {
    const z0 = s.z ?? 0;
    const rows = s.stations;
    return [{ pts: [...rows.map((r) => [r[0], z0 + r[3]]), ...rows.map((r) => [r[0], z0 - r[3]]).reverse()], closed: true }];
  }
  if (planned(key)) {
    const t = s.le ? s : samplePlanform(o, key, 24);
    return [{ pts: [...t.le.map((r) => [r[1], r[0]]), ...t.te.map((r) => [r[1], r[0]]).reverse()], closed: true }];
  }
  return [];
}
function planSegments(key) {
  const s = S.o[key];
  const segs = [];
  if (!s) return segs;
  if (BODY_KEYS.includes(key)) {
    const z0 = s.z ?? 0;
    const rows = s.stations;
    for (let i = 0; i + 1 < rows.length; i++) {
      segs.push({
        a: [rows[i][0], z0 + rows[i][3]],
        b: [rows[i + 1][0], z0 + rows[i + 1][3]],
        insert: (t) => rows.splice(i + 1, 0, rows[i].map((v, j) => r4(v + (rows[i + 1][j] - v) * t))),
      });
    }
  } else if (planned(key) && s.le) {
    for (const edge of ['le', 'te']) {
      const rows = s[edge];
      for (let i = 0; i + 1 < rows.length; i++) {
        segs.push({
          a: [rows[i][1], rows[i][0]],
          b: [rows[i + 1][1], rows[i + 1][0]],
          insert: (t) => rows.splice(i + 1, 0, rows[i].map((v, j) => r4(v + (rows[i + 1][j] - v) * t))),
        });
      }
    }
  }
  return segs;
}

// The points of the selected part: { ref, which, pos() -> [d, h], set(d, h), remove?() }.
function handlesFor(key) {
  if (isPlan()) return planHandles(key);
  const o = S.o;
  const hs = [];
  if (BODY_KEYS.includes(key) && o[key]) {
    const rows = bodyRows(key);
    const sym = isSym(rows);
    for (const row of rows) {
      hs.push({
        ref: row,
        which: 'top',
        pos: () => [row[0], row[1]],
        set: (d, h) => {
          row[0] = d;
          row[1] = h;
          if (sym) row[2] = r4(-h);
        },
        remove: () => rows.length > 2 && rows.splice(rows.indexOf(row), 1),
      });
      if (!sym) {
        hs.push({
          ref: row,
          which: 'bottom',
          pos: () => [row[0], row[2]],
          set: (d, h) => {
            row[0] = d;
            row[2] = h;
          },
          remove: () => rows.length > 2 && rows.splice(rows.indexOf(row), 1),
        });
      }
    }
  } else if ((key === 'wing' || key === 'tailplane') && o[key]) {
    const s = o[key];
    [0, 1].forEach((i) =>
      hs.push({
        ref: s.root,
        which: `root${i}`,
        pos: () => [s.root[i], s.at],
        set: (d, h) => {
          if (!s.le) s.root[i] = d; // with edge tables the root range follows the plan view's points
          s.at = h;
        },
      }),
    );
  } else if (verticalOf(key) && o[key]?.le) {
    const s = o[key];
    for (const edge of ['le', 'te']) {
      const rows = s[edge];
      rows.forEach((row, i) => {
        const last = i === rows.length - 1;
        hs.push({
          ref: row,
          which: edge,
          pos: () => [row[1], row[0]],
          set: (d, h) => {
            row[1] = d;
            row[0] = h;
            if (last) {
              const other = s[edge === 'le' ? 'te' : 'le'].at(-1);
              other[1] = d;
              other[0] = h;
            }
            fitFin(s);
          },
          remove: () => {
            if (rows.length > 2 && !last) {
              rows.splice(rows.indexOf(row), 1);
              fitFin(s);
            }
          },
        });
      });
    }
  } else if (key === 'gear') {
    const g = o.gear;
    const { M } = kit(o);
    for (const w of ['main', 'tail']) {
      const wh = g[w];
      const centre = () => (wh.bottom === undefined ? wh.h : (wh.bottom + wh.r * M - o.frame.y) / M);
      hs.push({
        ref: wh,
        which: 'centre',
        pos: () => [wh.d, centre()],
        set: (d, h) => {
          wh.d = d;
          wh.h = h;
          delete wh.bottom;
        },
      });
      hs.push({
        ref: wh,
        which: 'radius',
        pos: () => [wh.d + wh.r, centre()],
        set: (d) => {
          const c = centre();
          wh.r = Math.max(0.05, r4(Math.abs(d - wh.d)));
          if (wh.bottom !== undefined) {
            wh.h = r4(c);
            delete wh.bottom;
          }
        },
      });
    }
  }
  return hs;
}

// Lines to draw for a part, in metres: [{ pts, closed }]. Fixed ones for parts without points in this view.
function linesFor(key) {
  if (isPlan()) return planLines(key);
  const o = S.o;
  if (!o[key]) return [];
  if (BODY_KEYS.includes(key)) {
    const rows = bodyRows(key);
    const top = rows.map((r) => [r[0], r[1]]);
    const bottom = rows.map((r) => [r[0], r[2]]).reverse();
    return [{ pts: [...top, ...bottom], closed: true }];
  }
  if (key === 'wing' || key === 'tailplane') {
    const s = o[key];
    return [{ pts: [[s.root[0], s.at], [s.root[1], s.at]], closed: false }];
  }
  if (verticalOf(key)) {
    const s = o[key];
    const { le, te } = s.le ? { le: s.le, te: s.te } : sampleVertical(s);
    return [{ pts: [...le.map((r) => [r[1], r[0]]), ...te.map((r) => [r[1], r[0]]).reverse()], closed: true }];
  }
  if (key === 'gear') {
    const { M } = kit(o);
    return ['main', 'tail'].map((w) => {
      const wh = o.gear[w];
      const c = wh.bottom === undefined ? wh.h : (wh.bottom + wh.r * M - o.frame.y) / M;
      const pts = [];
      for (let i = 0; i <= 32; i++) pts.push([wh.d + wh.r * Math.cos((i / 32) * Math.PI * 2), c + wh.r * Math.sin((i / 32) * Math.PI * 2)]);
      return { pts, closed: true };
    });
  }
  return [];
}

// Segments of the selected part where a double-click adds a point.
function segmentsFor(key) {
  if (isPlan()) return planSegments(key);
  const o = S.o;
  const segs = [];
  if (BODY_KEYS.includes(key) && o[key]) {
    const rows = bodyRows(key);
    const sym = isSym(rows);
    for (let i = 0; i + 1 < rows.length; i++) {
      const insert = (t) => rows.splice(i + 1, 0, rows[i].map((v, j) => r4(v + (rows[i + 1][j] - v) * t)));
      segs.push({ a: [rows[i][0], rows[i][1]], b: [rows[i + 1][0], rows[i + 1][1]], insert });
      if (!sym) segs.push({ a: [rows[i][0], rows[i][2]], b: [rows[i + 1][0], rows[i + 1][2]], insert });
    }
  } else if (verticalOf(key) && o[key]?.le) {
    for (const edge of ['le', 'te']) {
      const rows = o[key][edge];
      for (let i = 0; i + 1 < rows.length; i++) {
        segs.push({
          a: [rows[i][1], rows[i][0]],
          b: [rows[i + 1][1], rows[i + 1][0]],
          insert: (t) => rows.splice(i + 1, 0, rows[i].map((v, j) => r4(v + (rows[i + 1][j] - v) * t))),
        });
      }
    }
  }
  return segs;
}

function partIds() {
  if (isPlan()) return [...BODY_KEYS.filter((k) => S.o[k]), ...PLAN_PARTS.filter((k) => S.o[k])];
  return [...BODY_KEYS.filter((k) => S.o[k]), ...['wing', 'tailplane'].filter((k) => S.o[k]), ...['fin', 'fins'].filter((k) => S.o[k]), 'gear'];
}

// ---------- Undo ----------
function pushUndo() {
  // Until the tail point's height is typed in, it follows the last fuselage station, so editing that
  // station would tilt the whole blueprint fit and every point would seem to move. Fix it before any edit.
  const side = S.bps.side;
  if (side && side.tailH == null && side.nose && side.tail) {
    side.tailH = tailHeight();
    saveBlueprint('side');
  }
  S.undo.push(JSON.stringify(S.o));
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
}
function restore(text) {
  S.o = JSON.parse(text);
  syncDef();
  S.sel = null;
  rebuildPanel();
  changed(false);
}
function undo() {
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(S.o));
  restore(S.undo.pop());
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(S.o));
  restore(S.redo.pop());
}

// A plane that is not in planes.json yet keeps its sprite area in its outline file; the finished
// planes keep theirs in planes.json and are never resized here.
function syncDef() {
  if (!S.def.own) return;
  S.def.pivot = S.o.sprite?.pivot ?? [48, 20];
  S.def.spriteSize = S.o.sprite?.size;
}
// Grow that area, never shrink it, so the tallest and deepest points of the outline fit with a margin.
function growSprite() {
  if (!S.def.own || !S.o.sprite) return;
  let top = 0;
  let bottom = 0;
  for (const k of BODY_KEYS) for (const r of S.o[k]?.stations ?? []) {
    top = Math.max(top, r[1], r[2]);
    bottom = Math.min(bottom, r[1], r[2]);
  }
  for (const k of ['fin', 'fins']) {
    const s = S.o[k];
    if (s) top = Math.max(top, s.at + s.span);
  }
  const { size, pivot } = S.o.sprite;
  const up = Math.max(0, Math.ceil(top * 10) + 4 - pivot[1]);
  const down = Math.max(0, Math.ceil(-bottom * 10) + 4 - (size[1] - pivot[1]));
  if (!up && !down) return;
  size[1] += up + down;
  pivot[1] += up;
  syncDef();
}
function changed(refreshPanel = true) {
  growSprite();
  S.dirtyPreview = true;
  showDirty();
  if (refreshPanel) refreshPanelValues();
  requestDraw();
}

// ---------- Sprite preview ----------
function paintRows(rows, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cx = c.getContext('2d');
  const img = cx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) img.data.set(PALETTE[rows[y][x]] ?? [255, 0, 0, 255], (y * w + x) * 4);
  }
  cx.putImageData(img, 0, 0);
  const paint = S.nations[S.def.nation]?.paint ?? { base: '#5b6b3f', under: '#a9b4a0', nose: '#c9c3a6', marking: '#2f4a8a' };
  return paintSprite(c, paint, { swastika: true });
}
// The model from above, for the plan view. Coarser while a point is being dragged, to keep it fluid.
function renderTop() {
  try {
    const res = drag?.h ? 1 : RES;
    const t = topLayout(res);
    const rows = render(buildModel(S.name, S.o), rollPose((S.mode === 'under' ? -1 : 1) * Math.PI / 2), t.w, t.h, [t.ax, t.ay], { gear: $('gear').checked, res });
    S.top = { canvas: paintRows(rows, t.w, t.h), res };
    const pv = $('pvTop');
    pv.width = t.w;
    pv.height = t.h;
    pv.style.width = `${t.w * (RES / res)}px`; // the same pixel size as the side preview
    pv.style.height = `${t.h * (RES / res)}px`;
    const pc = pv.getContext('2d');
    pc.clearRect(0, 0, t.w, t.h);
    pc.drawImage(S.top.canvas, 0, 0);
  } catch (e) {
    status(`top view render failed: ${e.message ?? e}`, true);
  }
}
function renderSprite() {
  try {
    const [w, h] = spriteSize();
    const model = buildModel(S.name, S.o);
    const rows = render(model, rollPose(0), w, h, S.def.pivot, { gear: $('gear').checked, res: RES });
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const rgba = PALETTE[rows[y][x]] ?? [255, 0, 0, 255];
        img.data.set(rgba, (y * w + x) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
    const paint = S.nations[S.def.nation]?.paint ?? { base: '#5b6b3f', under: '#a9b4a0', nose: '#c9c3a6', marking: '#2f4a8a' };
    S.sprite = paintSprite(c, paint, { swastika: true });
    S.spriteError = '';
    for (const [id, scale] of [['pv1', 1], ['pv4', 4]]) {
      const pv = $(id);
      pv.width = w;
      pv.height = h;
      pv.style.width = `${w * scale}px`;
      pv.style.height = `${h * scale}px`;
      const pc = pv.getContext('2d');
      pc.clearRect(0, 0, w, h);
      pc.drawImage(S.sprite, 0, 0);
    }
  } catch (e) {
    S.spriteError = String(e.message ?? e);
    status(`render failed: ${S.spriteError}`, true);
  }
}

// ---------- Drawing ----------
const cv = $('view');
const ctx = cv.getContext('2d');
let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    if (S.dirtyPreview && S.o) {
      S.dirtyPreview = false;
      renderSprite();
      if (isPlan()) renderTop();
    }
    try {
      draw();
    } catch (e) {
      status(`draw failed: ${e.message}`, true);
      console.error(e);
    }
  });
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  requestDraw();
}

// The nose and tail clicks, as red crosses on the picture.
function drawCalibMarks() {
  const { k, x: vx, y: vy } = S.view;
  if (!S.bp) return;
  ctx.font = '12px monospace';
  for (const [name, p] of SEQ[S.mode].map((k) => [k, S.bp[k]])) {
    if (!p) continue;
    const sx = p[0] * k + vx;
    const sy = p[1] * k + vy;
    ctx.strokeStyle = '#ff5030';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 9, sy);
    ctx.lineTo(sx + 9, sy);
    ctx.moveTo(sx, sy - 9);
    ctx.lineTo(sx, sy + 9);
    ctx.stroke();
    ctx.fillStyle = '#ff5030';
    ctx.fillText(name, sx + 6, sy - 6);
  }
}

const CALIB_MSG = {
  under: {
    nose: 'Click the NOSE TIP of the underside view (the same reference point as in the side view)',
    tipA: 'Click ONE WINGTIP of the underside view',
    tipB: 'Click the OTHER WINGTIP; the distance between them is the span',
  },
  side: { nose: 'Click the NOSE TIP of the side view (zoom in with the wheel first if you like)', tail: 'Click the END OF THE TAIL (the rearmost point of the side view)' },
  plan: {
    nose: 'Click the NOSE TIP of the top view (the same reference point as in the side view)',
    tipA: 'Click ONE WINGTIP (the outermost point of the wing) of the top view',
    tipB: 'Click the OTHER WINGTIP; the distance between them is the span',
  },
};
const calibMsg = () => (S.bp?.rel ? 'Click the NOSE TIP in this view: the scale and direction are copied from the plan view' : CALIB_MSG[S.mode][S.calibrating]);
function draw() {
  if (!S.o) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width / dpr;
  const H = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#14171a';
  ctx.fillRect(0, 0, W, H);
  const T = matT();
  const { k, x: vx, y: vy } = S.view;
  // Blueprint, in image pixels.
  if (S.bp?.img) {
    ctx.save();
    ctx.globalAlpha = $('bpAlpha').value / 100;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(S.bp.img, vx, vy, S.bp.img.width * k, S.bp.img.height * k);
    ctx.restore();
  }
  // Until both calibration clicks are made, the plane has no place on the picture: show only the picture.
  if (S.bp && !calibrated(S.bp)) {
    drawCalibMarks();
    const msg = S.calibrating ? calibMsg() : isPlan() ? 'Press Calibrate, then click the nose tip and both wingtips' : 'Press Calibrate, then click the nose tip and the tail end';
    ctx.font = '16px monospace';
    ctx.fillStyle = 'rgba(16,18,20,0.85)';
    ctx.fillRect(0, 0, W, 30);
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(msg, 12, 20);
    $('hint').textContent = '';
    return;
  }
  // Everything else in metres: screen = k * image + v, image = T(d, h).
  ctx.save();
  ctx.setTransform(dpr * k * T.a, dpr * k * T.b, dpr * k * T.c, dpr * k * T.d, dpr * (k * T.e + vx), dpr * (k * T.f + vy));
  const pxPerM = Math.hypot(T.a, T.b) * k; // screen pixels per metre
  const line = (px) => px / pxPerM; // a width in screen pixels, in metres
  const g = pixelGrid();
  const [sw, sh] = spriteSize();
  // Sprite overlay.
  const overlay = isPlan() ? S.top?.canvas : S.sprite;
  if (overlay) {
    ctx.save();
    ctx.globalAlpha = $('spAlpha').value / 100;
    ctx.imageSmoothingEnabled = false;
    if (isPlan()) {
      // Rendered at its own resolution (coarser during a drag), laid over the fine grid.
      const t = topLayout(S.top.res);
      const M = S.o.scale;
      ctx.transform(-1 / (t.res * M), 0, 0, 1 / (t.res * M), (S.o.frame.x + t.ax / t.res) / M, -t.ay / (t.res * M));
    } else ctx.transform(g.A1, 0, 0, g.B1, g.A0, g.B0);
    ctx.drawImage(overlay, -0.5, -0.5);
    ctx.restore();
  }
  // Pixel grid over the sprite's area, when the pixels are big enough to see.
  if ($('grid').checked && g.step * pxPerM >= 5) {
    const d0 = g.A0 + g.A1 * -0.5;
    const d1 = g.A0 + g.A1 * (sw - 0.5);
    const h0 = g.B0 + g.B1 * -0.5;
    const h1 = g.B0 + g.B1 * (sh - 0.5);
    ctx.lineWidth = line(1);
    for (let i = 0; i <= sw; i++) {
      const d = g.A0 + g.A1 * (i - 0.5);
      ctx.strokeStyle = i % 10 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(d, h0);
      ctx.lineTo(d, h1);
      ctx.stroke();
    }
    for (let j = 0; j <= sh; j++) {
      const h = g.B0 + g.B1 * (j - 0.5);
      ctx.strokeStyle = j % 10 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(d0, h);
      ctx.lineTo(d1, h);
      ctx.stroke();
    }
  }
  // Reference marks: the nose point and the thrust line.
  ctx.strokeStyle = 'rgba(255,120,60,0.6)';
  ctx.lineWidth = line(1);
  ctx.beginPath();
  ctx.moveTo(-1, 0);
  ctx.lineTo(S.o.length + 1, 0);
  if (isPlan()) {
    ctx.moveTo(0, -S.o.span / 2 - 1); // the nose point's line across the plane
    ctx.lineTo(0, S.o.span / 2 + 1);
  }
  ctx.stroke();
  // Outlines.
  for (const key of partIds()) {
    const active = key === S.part;
    ctx.strokeStyle = COLOURS[key] ?? '#fff';
    ctx.globalAlpha = active ? 1 : 0.4;
    ctx.lineWidth = line(active ? 2 : 1);
    for (const ln of linesFor(key)) {
      for (const flip of isPlan() ? [1, -1] : [1]) {
        ctx.globalAlpha = (active ? 1 : 0.4) * (flip < 0 ? 0.5 : 1); // the other wing, mirrored
        ctx.beginPath();
        ln.pts.forEach(([d, h], i) => (i ? ctx.lineTo(d, flip * h) : ctx.moveTo(d, flip * h)));
        if (ln.closed) ctx.closePath();
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // Points, in screen pixels: the selected part's big, the others' small (click one to switch to its part).
  for (const key of [...partIds().filter((k) => k !== S.part), S.part]) {
    const active = key === S.part;
    const r = active ? 4 : 2.5;
    for (const h of handlesFor(key)) {
      const [px, py] = toScreen(T, ...h.pos());
      const selected = active && S.sel && S.sel.ref === h.ref && S.sel.which === h.which;
      const hovered = S.hover && S.hover.ref === h.ref && S.hover.which === h.which;
      ctx.fillStyle = selected ? '#ffd24a' : hovered ? '#ffffff' : COLOURS[key] ?? '#fff';
      ctx.globalAlpha = active || hovered ? 1 : 0.7;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (h.which === 'radius') ctx.arc(px, py, r, 0, Math.PI * 2);
      else ctx.rect(px - r, py - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  drawCalibMarks();
  // Hint line.
  let hint = '';
  if (S.calibrating) hint = calibMsg();
  else if (S.cursor) {
    const [d, h] = fromScreen(T, S.cursor[0], S.cursor[1]);
    const col = Math.round((d - g.A0) / g.A1);
    const row = Math.round((h - g.B0) / g.B1);
    hint = isPlan() ? `d ${d.toFixed(2)} m   z ${h.toFixed(2)} m` : `d ${d.toFixed(2)} m   h ${h.toFixed(2)} m   pixel ${col}, ${row}`;
  }
  $('hint').textContent = hint;
}

function fitView() {
  const r = cv.getBoundingClientRect();
  const T = matT();
  const [sw, sh] = spriteSize();
  const g = pixelGrid();
  let pts;
  if (S.bp?.img && !calibrated(S.bp)) pts = [[0, 0], [S.bp.img.width, S.bp.img.height]];
  else {
    const dd = [g.A0 + g.A1 * -0.5, g.A0 + g.A1 * (sw - 0.5)];
    const hh = [g.B0 + g.B1 * -0.5, g.B0 + g.B1 * (sh - 0.5)];
    pts = dd.flatMap((d) => hh.map((h) => toImg(T, d, h)));
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs) || 1;
  const h = Math.max(...ys) - Math.min(...ys) || 1;
  const k = Math.min(r.width / w, r.height / h) * 0.92;
  S.view = { k, x: r.width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * k, y: r.height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * k };
  requestDraw();
}

// ---------- Mouse and keys ----------
const mouse = (e) => {
  const r = cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
function hitHandle(p) {
  const T = matT();
  let best = null;
  let bestD = 10;
  const keys = [S.part, ...partIds().filter((k) => k !== S.part)];
  for (const key of keys) {
    for (const h of handlesFor(key)) {
      const [sx, sy] = toScreen(T, ...h.pos());
      const dist = Math.hypot(sx - p[0], sy - p[1]) + (key === S.part ? 0 : 3); // the active part wins close calls
      if (dist <= bestD) {
        bestD = dist;
        best = { ...h, key };
      }
    }
  }
  return best;
}
let drag = null;
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  const p = mouse(e);
  if (S.calibrating && e.button === 0) {
    const pt = [(p[0] - S.view.x) / S.view.k, (p[1] - S.view.y) / S.view.k];
    S.bp[S.calibrating] = pt;
    if (S.bp.rel && S.calibrating === 'nose') {
      // Copied from the plan view: the same sheet at the same scale and turn, so the wingtips lie where the
      // plan view's did, relative to the nose.
      S.bp.tipA = [pt[0] + S.bp.rel.A[0], pt[1] + S.bp.rel.A[1]];
      S.bp.tipB = [pt[0] + S.bp.rel.B[0], pt[1] + S.bp.rel.B[1]];
      delete S.bp.rel;
      S.calibrating = null;
    } else S.calibrating = SEQ[S.mode][SEQ[S.mode].indexOf(S.calibrating) + 1] ?? null;
    if (!S.calibrating) {
      saveBlueprint();
      fitView();
      updateBlueprintInfo();
    }
    requestDraw();
    return;
  }
  // Shift+drag a red calibration cross to correct it after the fact (the picture stays, the outline moves).
  if (e.shiftKey && e.button === 0 && S.bp && calibrated(S.bp)) {
    let best = null;
    let bestD = 16;
    for (const k of SEQ[S.mode]) {
      const q = S.bp[k];
      const dist = q ? Math.hypot(q[0] * S.view.k + S.view.x - p[0], q[1] * S.view.k + S.view.y - p[1]) : Infinity;
      if (dist < bestD) {
        bestD = dist;
        best = k;
      }
    }
    if (best) {
      drag = { calib: best };
      return;
    }
  }
  const h = e.button === 0 ? hitHandle(p) : null;
  if (h) {
    if (h.key !== S.part) {
      S.part = h.key;
      rebuildPanel();
    }
    pushUndo();
    S.sel = { ref: h.ref, which: h.which };
    drag = { h };
    refreshPanelValues();
  } else {
    drag = { pan: true, from: p, view: { ...S.view } };
  }
  requestDraw();
});
cv.addEventListener('pointermove', (e) => {
  const p = mouse(e);
  S.cursor = p;
  const T = matT();
  if (drag?.calib) {
    S.bp[drag.calib] = [(p[0] - S.view.x) / S.view.k, (p[1] - S.view.y) / S.view.k];
    requestDraw();
  } else if (drag?.h) {
    const [d, h] = snap(...fromScreen(T, p[0], p[1]));
    drag.h.set(d, h);
    changed();
  } else if (drag?.pan) {
    S.view.x = drag.view.x + p[0] - drag.from[0];
    S.view.y = drag.view.y + p[1] - drag.from[1];
    requestDraw();
  } else {
    S.hover = hitHandle(p);
    cv.style.cursor = S.calibrating ? 'crosshair' : S.hover ? 'pointer' : 'grab';
    requestDraw();
  }
});
function endDrag() {
  if (drag?.calib) {
    drag = null;
    saveBlueprint();
    requestDraw();
    return;
  }
  if (drag?.h && BODY_KEYS.includes(S.part)) {
    S.o[S.part].stations.sort((a, b) => a[0] - b[0]);
    rebuildPanel();
  }
  if (drag?.h && isPlan() && planned(S.part) && S.o[S.part]?.le) {
    fitPlanform(S.o[S.part]);
    rebuildPanel();
  }
  if (drag?.h && S.part === 'gear') rebuildPanel();
  const wasPlanDrag = !!drag?.h && isPlan();
  // A fin edge must stay in height order and on its own side, or the preview shows a gap: put the
  // points right once the drag is done (doing it mid-drag swaps lines under the cursor).
  if (drag?.h && S.mode === 'side' && verticalOf(S.part) && S.o[S.part]?.le) {
    Object.assign(S.o[S.part], splitFin(S.o[S.part]));
    fitFin(S.o[S.part]);
    rebuildPanel();
  }
  drag = null;
  if (wasPlanDrag) S.dirtyPreview = true; // render the top view at full resolution again
  changed();
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = mouse(e);
  const f = Math.exp(-e.deltaY * 0.0015);
  const k = Math.min(60, Math.max(0.05, S.view.k * f));
  S.view.x = p[0] - ((p[0] - S.view.x) / S.view.k) * k;
  S.view.y = p[1] - ((p[1] - S.view.y) / S.view.k) * k;
  S.view.k = k;
  requestDraw();
}, { passive: false });
cv.addEventListener('dblclick', (e) => {
  if (S.calibrating) return;
  const p = mouse(e);
  const T = matT();
  let best = null;
  let bestD = 8;
  for (const seg of segmentsFor(S.part)) {
    const a = toScreen(T, ...seg.a);
    const b = toScreen(T, ...seg.b);
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby || 1;
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
    const dist = Math.hypot(a[0] + abx * t - p[0], a[1] + aby * t - p[1]);
    if (dist < bestD) {
      bestD = dist;
      best = { seg, t };
    }
  }
  if (best) {
    pushUndo();
    best.seg.insert(best.t);
    rebuildPanel();
    changed();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
    return;
  }
  if (e.key === 'Escape') {
    S.calibrating = null;
    S.sel = null;
    requestDraw();
    return;
  }
  const h = S.sel && handlesFor(S.part).find((x) => x.ref === S.sel.ref && x.which === S.sel.which);
  if (!h) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (h.remove) {
      pushUndo();
      h.remove();
      S.sel = null;
      rebuildPanel();
      changed();
    }
    return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (!arrows) return;
  e.preventDefault();
  const T = matT();
  const n = e.shiftKey ? 5 : 1;
  const g = pixelGrid();
  const [d, hh] = h.pos();
  const right = T.a >= 0 ? 1 : -1; // which way d runs on screen
  pushUndo();
  let dd = arrows[0] * right;
  let dh = arrows[1];
  if (isPlan()) {
    // The drawing may be turned: move along whichever of d and z points most nearly the way of the key.
    const [px, py] = toScreen(T, d, hh);
    const q = fromScreen(T, px + arrows[0] * 100, py - arrows[1] * 100);
    const along = Math.abs(q[0] - d) >= Math.abs(q[1] - hh);
    dd = along ? Math.sign(q[0] - d) : 0;
    dh = along ? 0 : Math.sign(q[1] - hh);
  }
  const [nd, nh] = snap(d + dd * g.step * n, hh + dh * g.step * n);
  h.set(nd, nh);
  changed();
});

// ---------- Side panel ----------
function fmt(v) {
  return v === undefined || Number.isNaN(v) ? '' : String(r4(v));
}
function numInput(get, set, step = 0.01) {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = step;
  i.value = fmt(get());
  i._get = get;
  i.addEventListener('change', () => {
    const v = parseFloat(i.value);
    if (Number.isNaN(v)) return;
    pushUndo();
    set(v);
    changed();
  });
  return i;
}
function refreshPanelValues() {
  for (const i of $('partPanel').querySelectorAll('input')) if (i._get && document.activeElement !== i) i.value = fmt(i._get());
  for (const tr of $('partPanel').querySelectorAll('tr[data-ref]')) tr.classList.toggle('sel', !!S.sel && tr._ref === S.sel.ref);
  $('length').value = fmt(S.o.length);
  $('tailH').value = fmt(tailHeight());
}
// A table of rows of numbers: columns are [{ title, i, step }], edit(row, i, v) stores a value.
function rowTable(rows, cols, edit, remove) {
  const t = document.createElement('table');
  t.className = 'st';
  t.innerHTML = `<tr>${cols.map((c) => `<th>${c.title}</th>`).join('')}<th></th></tr>`;
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.dataset.ref = '1';
    tr._ref = r;
    for (const c of cols) {
      const td = document.createElement('td');
      td.append(numInput(() => r[c.i], (v) => edit(r, c.i, v)));
      tr.append(td);
    }
    const td = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = () => remove(r);
    td.append(del);
    tr.append(td);
    t.append(tr);
  }
  return t;
}
function planPanel(o, row, note, button, panel) {
  const s = o[S.part];
  if (!s) return;
  if (BODY_KEYS.includes(S.part)) {
    if (s.z !== undefined) row('z (centre of the pair)', numInput(() => s.z, (v) => (s.z = v)));
    panel.append(
      rowTable(s.stations, [{ title: 'd', i: 0 }, { title: 'half width', i: 3 }], (r, i, v) => (r[i] = v), (r) => {
        if (s.stations.length <= 2) return;
        pushUndo();
        s.stations.splice(s.stations.indexOf(r), 1);
        rebuildPanel();
        changed();
      }),
    );
    button('Sort by d', () => {
      pushUndo();
      s.stations.sort((a, b) => a[0] - b[0]);
      rebuildPanel();
      changed();
    });
    note('Seen from above, the outline is the half width at each station (the same stations as the side view: a new point also needs its heights there). Drag a point sideways for the width, along for its d.');
    return;
  }
  if (!planned(S.part)) return;
  if (!s.le) {
    note('This wing is a formula (root, tip and rounding), not points. Convert it to edge points traced from its current shape to drag them.');
    button('Convert to draggable points', () => {
      pushUndo();
      convertPlanform(o, S.part);
      rebuildPanel();
      changed();
    }, 'Replaces the formula with leading and trailing edge points that draw the same shape');
    return;
  }
  row('half span', numInput(() => s.span, () => {}));
  const edge = (name, key) => {
    const h = document.createElement('div');
    h.className = 'dim';
    h.textContent = `${name} [z out from the centre line, d back from the nose]`;
    panel.append(h);
    panel.append(
      rowTable(s[key], [{ title: 'z', i: 0 }, { title: 'd', i: 1 }], (r, i, v) => {
        r[i] = v;
        fitPlanform(s);
        rebuildPanel();
      }, (r) => {
        if (s[key].length <= 2 || r === s[key].at(-1) || r === s[key][0]) return;
        pushUndo();
        s[key].splice(s[key].indexOf(r), 1);
        fitPlanform(s);
        rebuildPanel();
        changed();
      }),
    );
  };
  edge('Leading edge', 'le');
  edge('Trailing edge', 'te');
  button('Sort by z', () => {
    pushUndo();
    fitPlanform(s);
    rebuildPanel();
    changed();
  });
  note('Trace the outline as if the engine nacelles were not there (they are their own part: Nacelle). Both edges end at the same z at the tip: a flat tip is the line between the two end points, a rounded tip needs a few points that close in. The first point of each edge sits on the centre line. Double-click a line to add a point.');
}
function rebuildPanel() {
  const parts = $('parts');
  parts.textContent = '';
  for (const key of partIds()) {
    const b = document.createElement('button');
    b.textContent = label(key);
    b.className = key === S.part ? 'on' : '';
    b.onclick = () => {
      S.part = key;
      S.sel = null;
      rebuildPanel();
      requestDraw();
    };
    parts.append(b);
  }
  const panel = $('partPanel');
  panel.textContent = '';
  const o = S.o;
  const row = (...els) => {
    const d = document.createElement('div');
    d.className = 'row';
    for (const e of els) d.append(typeof e === 'string' ? Object.assign(document.createElement('span'), { textContent: e }) : e);
    panel.append(d);
    return d;
  };
  const note = (text) => {
    const p = document.createElement('div');
    p.className = 'dim';
    p.textContent = text;
    panel.append(p);
  };
  const button = (text, fn, title) => {
    const b = document.createElement('button');
    b.textContent = text;
    if (title) b.title = title;
    b.onclick = fn;
    panel.append(b);
  };
  if (isPlan()) {
    planPanel(o, row, note, button, panel);
    refreshPanelValues();
    return;
  }
  if (BODY_KEYS.includes(S.part) && o[S.part]) {
    const s = o[S.part];
    const nRow = row('squareness n', numInput(() => s.n, (v) => (s.n = v), 0.1));
    if (s.z !== undefined) nRow.append('z', numInput(() => s.z, (v) => (s.z = v)));
    const t = document.createElement('table');
    t.className = 'st';
    t.innerHTML = '<tr><th>d</th><th>top h</th><th>bottom h</th><th>half width</th><th></th></tr>';
    s.stations.forEach((r) => {
      const tr = document.createElement('tr');
      tr.dataset.ref = '1';
      tr._ref = r;
      for (let j = 0; j < 4; j++) {
        const td = document.createElement('td');
        td.append(numInput(() => r[j], (v) => (r[j] = v)));
        tr.append(td);
      }
      const td = document.createElement('td');
      const del = document.createElement('button');
      del.textContent = '×';
      del.onclick = () => {
        if (s.stations.length <= 2) return;
        pushUndo();
        s.stations.splice(s.stations.indexOf(r), 1);
        rebuildPanel();
        changed();
      };
      td.append(del);
      tr.append(td);
      t.append(tr);
    });
    panel.append(t);
    const sortBtn = document.createElement('button');
    sortBtn.textContent = 'Sort by d';
    sortBtn.onclick = () => {
      pushUndo();
      s.stations.sort((a, b) => a[0] - b[0]);
      rebuildPanel();
      changed();
    };
    panel.append(sortBtn);
  } else if (S.part === 'wing' || S.part === 'tailplane' || verticalOf(S.part)) {
    const s = o[S.part];
    if (!s.le || verticalOf(S.part)) row('root d', numInput(() => s.root[0], (v) => (s.root[0] = v)), numInput(() => s.root[1], (v) => (s.root[1] = v)));
    if (s.tip) row('tip d', numInput(() => s.tip[0], (v) => (s.tip[0] = v)), numInput(() => s.tip[1], (v) => (s.tip[1] = v)));
    if (s.le && !verticalOf(S.part)) row('at h', numInput(() => s.at, (v) => (s.at = v)));
    else row('at h', numInput(() => s.at, (v) => (s.at = v)), 'span', numInput(() => s.span, (v) => (s.span = v)));
    row('thick', numInput(() => s.thick, (v) => (s.thick = v)));
    if (s.rise !== undefined) row('dihedral', numInput(() => s.rise, (v) => (s.rise = v), 0.001));
    if (s.round !== undefined && !s.le) row('tip rounding', numInput(() => s.round, (v) => (s.round = v), 0.05));
    if (s.ellipse !== undefined) row('ellipse', numInput(() => s.ellipse, (v) => (s.ellipse = v), 0.01));
    if (s.from !== undefined) row('from h', numInput(() => s.from, (v) => (s.from = v)));
    if (s.z !== undefined) row('z', numInput(() => s.z, (v) => (s.z = v)));
    if (verticalOf(S.part)) {
      if (!s.le) {
        const b = document.createElement('button');
        b.textContent = 'Convert to draggable points';
        b.title = 'Replaces the fin formula with edge points traced from its current shape';
        b.onclick = () => {
          pushUndo();
          const { le, te } = sampleVertical(s);
          const thin = (rows) => rows.filter((_, i) => i % 4 === 0 || i === rows.length - 1).map((r) => [r4(r[0]), r4(r[1])]);
          s.le = thin(le);
          s.te = thin(te);
          s.te[s.te.length - 1] = [...s.le.at(-1)];
          delete s.round;
          rebuildPanel();
          changed();
        };
        panel.append(b);
      } else {
        const p = document.createElement('div');
        p.className = 'dim';
        p.textContent = 'Edge points: drag them freely; the tip point is shared by both edges. The model needs each edge in order of height and on its own side, so press Sort by h when a point has passed its neighbours or crossed over.';
        panel.append(p);
        const sort = document.createElement('button');
        sort.textContent = 'Sort by h';
        sort.onclick = () => {
          pushUndo();
          Object.assign(s, splitFin(s));
          fitFin(s);
          rebuildPanel();
          changed();
        };
        panel.append(sort);
      }
    } else {
      const p = document.createElement('div');
      p.className = 'dim';
      p.textContent = 'Seen edge-on from the side. Its outline (planform) is edited in the Plan view.';
      panel.append(p);
    }
  } else if (S.part === 'gear') {
    const g = o.gear;
    const { M } = kit(o);
    for (const w of ['main', 'tail']) {
      const wh = g[w];
      const centre = () => (wh.bottom === undefined ? wh.h : (wh.bottom + wh.r * M - o.frame.y) / M);
      row(`${w} wheel d`, numInput(() => wh.d, (v) => (wh.d = v)), 'h', numInput(centre, (v) => {
        wh.h = v;
        delete wh.bottom;
      }), 'r', numInput(() => wh.r, (v) => (wh.r = v)));
      if (wh.half !== undefined) row('half track', numInput(() => wh.half, (v) => (wh.half = v)));
    }
    const p = document.createElement('div');
    p.className = 'dim';
    p.textContent = 'Saving writes the wheel centres and sizes you changed into data/planes.json wheels.';
    panel.append(p);
  }
  refreshPanelValues();
}

// ---------- Blueprint storage (this browser only; blueprints never go into the repo) ----------
const idb = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('outline-lab', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('bp');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
async function idbDo(mode, fn) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('bp', mode);
      const req = fn(tx.objectStore('bp'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return undefined;
  }
}
async function saveBlueprint(mode = S.mode) {
  const b = S.bps[mode];
  if (!b?.blob) return;
  const { blob, name, nose, tail, tailH, tipA, tipB, flip } = b;
  await idbDo('readwrite', (st) => st.put({ blob, name, nose, tail, tailH, tipA, tipB, flip: !!flip }, `${S.name}:${mode}`));
}
async function loadBlueprint(plane, mode) {
  const rec = await idbDo('readonly', (st) => st.get(`${plane}:${mode}`));
  if (!rec?.blob) return null;
  const img = await createImageBitmap(rec.blob);
  return { img, blob: rec.blob, name: rec.name, nose: rec.nose ?? null, tail: rec.tail ?? null, tailH: rec.tailH ?? null, tipA: rec.tipA ?? null, tipB: rec.tipB ?? null, flip: !!rec.flip };
}
function updateBlueprintInfo() {
  const b = S.bp;
  const plan = isPlan();
  $('bpTitle').textContent = { side: 'Blueprint (side view)', plan: 'Blueprint (plan view, from above)', under: 'Blueprint (underside, from below)' }[S.mode];
  $('calibInfo').textContent = !b ? 'No picture loaded (kept in this browser only).' : calibrated(b) ? `${b.name}: calibrated (Shift+drag a red cross to correct it)` : `${b.name}: click Calibrate`;
  $('calib').disabled = !b;
  $('clear').disabled = !b;
  $('rowSide').hidden = plan;
  $('rowPlan').hidden = !plan;
  $('tailH').value = fmt(tailHeight());
  $('span').value = fmt(S.o?.span);
  $('turn').disabled = !S.bp;
  $('copyPlan').hidden = S.mode !== 'under';
  $('copyPlan').disabled = !calibratedPlan();
  $('modeSide').className = plan ? '' : 'on';
  $('modePlan').className = S.mode === 'plan' ? 'on' : '';
  $('modeUnder').className = S.mode === 'under' ? 'on' : '';
}
const calibratedPlan = () => !!S.bps.plan?.blob && ['nose', 'tipA', 'tipB'].every((k) => S.bps.plan[k]);
// The underside is often on the same sheet as the plan view: take its picture, scale and turn, and only click
// the nose again.
$('copyPlan').onclick = () => {
  const p = S.bps.plan;
  if (!calibratedPlan()) return;
  const rel = (q) => [q[0] - p.nose[0], q[1] - p.nose[1]];
  S.bps.under = { img: p.img, blob: p.blob, name: p.name, nose: null, tail: null, tailH: null, tipA: null, tipB: null, flip: p.flip, rel: { A: rel(p.tipA), B: rel(p.tipB) } };
  S.calibrating = 'nose';
  updateBlueprintInfo();
  fitView();
};
function setMode(mode) {
  if (S.mode === mode || !S.o) return;
  S.mode = mode;
  S.calibrating = null;
  S.sel = null;
  if (!partIds().includes(S.part)) S.part = 'fuselage';
  updateBlueprintInfo();
  rebuildPanel();
  S.dirtyPreview = true;
  $('topFig').hidden = mode === 'side';
  $('topCap').textContent = mode === 'under' ? 'from below (for checking only)' : 'from above (for checking only)';
  fitView();
}
$('turn').onclick = () => {
  if (!S.bp) return;
  S.bp.flip = !S.bp.flip;
  saveBlueprint();
  requestDraw();
};
$('modeSide').onclick = () => setMode('side');
$('modePlan').onclick = () => setMode('plan');
$('modeUnder').onclick = () => setMode('under');
$('span').onchange = () => {
  const v = parseFloat($('span').value);
  if (v > 0) {
    pushUndo();
    S.o.span = v;
    changed();
  }
};

$('load').onclick = () => $('file').click();
$('file').onchange = async () => {
  const f = $('file').files[0];
  if (!f) return;
  S.bp = { img: await createImageBitmap(f), blob: f, name: f.name, nose: null, tail: null, tailH: null, tipA: null, tipB: null };
  S.calibrating = 'nose';
  updateBlueprintInfo();
  fitView();
  $('file').value = '';
};
$('calib').onclick = () => {
  if (!S.bp) return;
  for (const k of SEQ[S.mode]) S.bp[k] = null;
  S.calibrating = 'nose';
  updateBlueprintInfo();
  fitView();
};
$('clear').onclick = async () => {
  await idbDo('readwrite', (st) => st.delete(`${S.name}:${S.mode}`));
  S.bp = null;
  S.calibrating = null;
  updateBlueprintInfo();
  fitView();
};
$('length').onchange = () => {
  const v = parseFloat($('length').value);
  if (v > 0) {
    pushUndo();
    S.o.length = v;
    changed();
  }
};
$('tailH').onchange = () => {
  const v = parseFloat($('tailH').value);
  if (S.bp && !Number.isNaN(v)) {
    S.bp.tailH = v;
    saveBlueprint();
    requestDraw();
  }
};
for (const id of ['grid', 'snap', 'bpAlpha', 'spAlpha']) $(id).oninput = requestDraw;
$('gear').onchange = () => {
  S.dirtyPreview = true;
  requestDraw();
};
$('undo').onclick = undo;
$('redo').onclick = redo;
$('fit').onclick = fitView;

// ---------- Save and build ----------
async function put(path, text) {
  const res = await fetch(path, { method: 'PUT', body: text });
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
}
// The game's wheels (data/planes.json) in world units: half the model units, to 0.025.
async function writeWheels() {
  const base = JSON.parse(S.baseGear);
  const now = S.o.gear;
  const changedWheels = ['main', 'tail'].filter((w) => JSON.stringify(base[w]) !== JSON.stringify(now[w]));
  if (!changedWheels.length) return false;
  const res = await fetch('data/planes.json', { cache: 'no-store' });
  const planes = await res.json();
  const key = Object.keys(planes).find((k) => planes[k]?.sprite === S.name);
  if (!key) return false;
  const { X, Y, M } = kit(S.o);
  for (const w of changedWheels) {
    const wh = now[w];
    const r = wh.r * M;
    const cy = wh.bottom === undefined ? Y(wh.h) : wh.bottom + r;
    const entry = planes[key].wheels?.find((e) => (w === 'tail') === !!e.tail);
    if (!entry) continue;
    entry.wheel = [round025(X(wh.d) / 2), round025(cy / 2)];
    entry.r = round025(r / 2);
  }
  await put('data/planes.json', JSON.stringify(planes, null, 2) + '\n');
  return true;
}
async function save() {
  try {
    const text = formatOutline(S.o);
    await put(`data/outlines/${S.name}.json`, text);
    const wheels = await writeWheels();
    S.saved = text;
    S.baseGear = JSON.stringify(S.o.gear);
    status(`saved ${S.name}.json${wheels ? ' and the wheels in planes.json' : ''}`);
    return true;
  } catch (e) {
    status(`save failed: ${e.message}`, true);
    return false;
  }
}
$('save').onclick = save;
$('build').onclick = async () => {
  if (isDirty() && !(await save())) return;
  status('building sprites…');
  $('build').disabled = true;
  try {
    const res = await fetch(`/build-sprites?plane=${encodeURIComponent(S.name)}`, { method: 'POST' });
    const out = await res.json();
    status(out.ok ? `built sprites for ${S.name}` : `build failed: ${out.output.slice(-200)}`, !out.ok);
  } catch (e) {
    status(`build failed: ${e.message}`, true);
  }
  $('build').disabled = false;
};
window.addEventListener('beforeunload', (e) => {
  if (isDirty()) e.preventDefault();
});

// ---------- Start ----------
async function openPlane(name, fresh = null) {
  if (isDirty() && !confirm('Discard unsaved changes?')) {
    $('plane').value = S.name;
    return;
  }
  S.o = fresh ?? (await (await fetch(`data/outlines/${name}.json`, { cache: 'no-store' })).json());
  S.name = name;
  S.saved = fresh ? '' : formatOutline(S.o);
  S.baseGear = JSON.stringify(S.o.gear);
  // After S.saved, so a fin that had drifted shows as an unsaved change to save.
  for (const k of ['fin', 'fins']) {
    if (S.o[k]?.le) Object.assign(S.o[k], splitFin(S.o[k]));
    fitFin(S.o[k]);
  }
  S.def = Object.values(S.planes).find((d) => d && d.sprite === name) ?? { own: true, nation: 'germany' };
  syncDef();
  growSprite();
  S.part = 'fuselage';
  S.sel = null;
  S.undo = [];
  S.redo = [];
  S.calibrating = null;
  S.mode = 'side';
  $('topFig').hidden = true;
  S.bps = { side: await loadBlueprint(name, 'side'), plan: await loadBlueprint(name, 'plan'), under: await loadBlueprint(name, 'under') };
  updateBlueprintInfo();
  rebuildPanel();
  S.dirtyPreview = true;
  resizeCanvas();
  fitView();
  showDirty();
}

// A new plane starts as a scaled copy of a finished one (its template), which also supplies the model
// code for the preview until the plane gets a model of its own.
async function newPlane() {
  const id = (prompt('Short name for the new plane (lowercase letters and digits), e.g. blenheim') ?? '').trim();
  if (!id) return;
  if (!/^[a-z][a-z0-9_]*$/.test(id) || [...$('plane').options].some((o) => o.value === id)) return alert('That name is not usable or already exists.');
  const tmpl = (prompt('Start from which plane? bf109, spitfire, p47d, la5fn, ki43, b239 are single-engine; bf110 is a twin.', 'bf110') ?? '').trim();
  if (!BASES.includes(tmpl)) return alert(`Pick one of: ${BASES.join(', ')}`);
  const base = await (await fetch(`data/outlines/${tmpl}.json`, { cache: 'no-store' })).json();
  const L = parseFloat(prompt('Length in metres (nose tip to tail end)', '12.9'));
  const W = parseFloat(prompt('Wingspan in metres', '17.2'));
  if (!(L > 0 && W > 0)) return;
  const o = scaledOutline(base, id, tmpl, L, W);
  $('plane').append(new Option(id, id));
  $('plane').value = id;
  await openPlane(id, o);
  status(`${id}: new, unsaved (a copy of ${tmpl} scaled to ${L} m)`);
}
const BASES = ['bf109', 'bf109g6', 'spitfire', 'p47d', 'la5fn', 'ki43', 'b239', 'bf110'];
function scaledOutline(base, id, template, L, W) {
  const f = L / base.length; // along the plane
  const g = W / base.span; // across it
  const o = clone(base);
  o.plane = id;
  o.template = template;
  o.length = L;
  o.span = W;
  const rows = (list, fn) => list.map((r) => fn(r));
  for (const key of ['fuselage', 'spinner', 'spine', 'canopy', 'nacelle', 'gunTray', 'radiators']) {
    if (!o[key]) continue;
    o[key].stations = rows(o[key].stations, ([d, t, b, hw]) => [r4(d * f), r4(t * f), r4(b * f), r4(hw * g)]);
    if (o[key].z) o[key].z = r4(o[key].z * g);
  }
  for (const key of ['wing', 'tailplane', 'fin', 'fins']) {
    const s = o[key];
    if (!s) continue;
    const vertical = key === 'fin' || key === 'fins';
    s.root = s.root.map((d) => r4(d * f));
    if (s.tip) s.tip = s.tip.map((d) => r4(d * f));
    s.at = r4(s.at * f);
    if (s.from !== undefined) s.from = r4(s.from * f);
    s.span = r4(s.span * (vertical ? f : g));
    s.thick = r4(s.thick * f);
    if (s.z) s.z = r4(s.z * g);
    for (const edge of ['le', 'te']) if (s[edge]) s[edge] = s[edge].map(([a, d]) => [r4(a * (vertical ? f : g)), r4(d * f)]);
  }
  const gear = o.gear;
  for (const w of ['main', 'tail']) {
    gear[w].d = r4(gear[w].d * f);
    if (gear[w].h !== undefined) gear[w].h = r4(gear[w].h * f);
    gear[w].r = r4(gear[w].r * f);
    if (gear[w].half !== undefined) gear[w].half = r4(gear[w].half * g);
  }
  // The sprite is 10 pixels per metre; put the pivot at the middle of the plane.
  const width = Math.ceil(L * 10) + 16;
  o.frame = { x: r4((L * o.scale) / 2), y: r4(base.frame.y * f) };
  o.sprite = { size: [width, 44], pivot: [Math.round(width / 2), 22] };
  return o;
}

async function start() {
  S.planes = await (await fetch('data/planes.json', { cache: 'no-store' })).json();
  S.nations = await (await fetch('data/nations.json', { cache: 'no-store' })).json();
  const res = await fetch('/api/outlines', { cache: 'no-store' });
  if (!res.ok) throw new Error('the dev server is the old version: stop it and start it again (node tools/serve.mjs 8080)');
  const list = await res.json();
  for (const n of list) $('plane').append(new Option(n, n));
  $('plane').onchange = () => openPlane($('plane').value);
  $('newPlane').onclick = newPlane;
  new ResizeObserver(resizeCanvas).observe($('stage'));
  const first = new URLSearchParams(location.search).get('plane');
  const name = list.includes(first) ? first : list[0];
  $('plane').value = name;
  await openPlane(name);
}
start().catch((e) => status(`could not start: ${e.message}`, true));
