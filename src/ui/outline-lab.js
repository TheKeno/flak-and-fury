// Outline Lab: edit a plane's outline (data/outlines/<plane>.json) over a blueprint, with the real
// renderer (tools/plane-models.mjs) showing the finished sprite live. Side view first; open as
// outline-lab.html (the dev server, node tools/serve.mjs, saves the files and builds the sprites).
import { kit, buildModel, render, rollPose } from '../../tools/plane-models.mjs';
import { PALETTE } from '../../tools/plane-palette.mjs';
import { formatOutline } from '../../tools/outline-format.mjs';
import { paintSprite } from '../render/sprites.js';

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
  radiators: 'Radiators', wing: 'Wing root', tailplane: 'Tailplane root', fin: 'Fin', fins: 'Fins', gear: 'Gear',
};
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
  bp: null, // blueprint: { img, name, blob, nose, tail, tailH }
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
function matT() {
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
function pixelGrid() {
  const M = S.o.scale;
  const [ax, ay] = S.def.pivot;
  const step = 1 / (RES * M);
  return { A0: (S.o.frame.x + ax / RES) / M, A1: -step, B0: (ay / RES - S.o.frame.y) / M, B1: -step, step };
}
const spriteSize = () => S.def.spriteSize ?? [96, 36];
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

function bodyRows(key) {
  return S.o[key].stations;
}
function isSym(rows) {
  return rows.every((r) => Math.abs(r[1] + r[2]) < 1e-9);
}

// The points of the selected part: { ref, which, pos() -> [d, h], set(d, h), remove?() }.
function handlesFor(key) {
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
          s.root[i] = d;
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
  return [...BODY_KEYS.filter((k) => S.o[k]), ...['wing', 'tailplane'].filter((k) => S.o[k]), ...['fin', 'fins'].filter((k) => S.o[k]), 'gear'];
}

// ---------- Undo ----------
function pushUndo() {
  // Until the tail point's height is typed in, it follows the last fuselage station, so editing that
  // station would tilt the whole blueprint fit and every point would seem to move. Fix it before any edit.
  if (S.bp && S.bp.tailH == null && S.bp.nose && S.bp.tail) {
    S.bp.tailH = tailHeight();
    saveBlueprint();
  }
  S.undo.push(JSON.stringify(S.o));
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
}
function restore(text) {
  S.o = JSON.parse(text);
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

function changed(refreshPanel = true) {
  S.dirtyPreview = true;
  showDirty();
  if (refreshPanel) refreshPanelValues();
  requestDraw();
}

// ---------- Sprite preview ----------
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
  for (const [name, p] of [['nose', S.bp.nose], ['tail', S.bp.tail]]) {
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
  if (S.bp && !(S.bp.nose && S.bp.tail)) {
    drawCalibMarks();
    const msg = S.calibrating === 'tail' ? 'Click the END OF THE TAIL (the rearmost point of the side view)' : S.calibrating === 'nose' ? 'Click the NOSE TIP of the side view (zoom in with the wheel first if you like)' : 'Press Calibrate, then click the nose tip and the tail end';
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
  if (S.sprite) {
    ctx.save();
    ctx.globalAlpha = $('spAlpha').value / 100;
    ctx.imageSmoothingEnabled = false;
    ctx.transform(g.A1, 0, 0, g.B1, g.A0, g.B0);
    ctx.drawImage(S.sprite, -0.5, -0.5);
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
  ctx.stroke();
  // Outlines.
  for (const key of partIds()) {
    const active = key === S.part;
    ctx.strokeStyle = COLOURS[key] ?? '#fff';
    ctx.globalAlpha = active ? 1 : 0.4;
    ctx.lineWidth = line(active ? 2 : 1);
    for (const ln of linesFor(key)) {
      ctx.beginPath();
      ln.pts.forEach(([d, h], i) => (i ? ctx.lineTo(d, h) : ctx.moveTo(d, h)));
      if (ln.closed) ctx.closePath();
      ctx.stroke();
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
  if (S.calibrating) hint = S.calibrating === 'nose' ? 'Click the nose tip (d = 0) on the picture' : 'Click the end of the tail on the picture';
  else if (S.cursor) {
    const [d, h] = fromScreen(T, S.cursor[0], S.cursor[1]);
    const col = Math.round((d - g.A0) / g.A1);
    const row = Math.round((h - g.B0) / g.B1);
    hint = `d ${d.toFixed(2)} m   h ${h.toFixed(2)} m   pixel ${col}, ${row}`;
  }
  $('hint').textContent = hint;
}

function fitView() {
  const r = cv.getBoundingClientRect();
  const T = matT();
  const [sw, sh] = spriteSize();
  const g = pixelGrid();
  let pts;
  if (S.bp?.img && !(S.bp.nose && S.bp.tail)) pts = [[0, 0], [S.bp.img.width, S.bp.img.height]];
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
    S.calibrating = S.calibrating === 'nose' ? 'tail' : null;
    if (!S.calibrating) {
      saveBlueprint();
      fitView();
      updateBlueprintInfo();
    }
    requestDraw();
    return;
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
  if (drag?.h) {
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
  if (drag?.h && BODY_KEYS.includes(S.part)) {
    S.o[S.part].stations.sort((a, b) => a[0] - b[0]);
    rebuildPanel();
  }
  if (drag?.h && S.part === 'gear') rebuildPanel();
  drag = null;
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
  const [nd, nh] = snap(d + arrows[0] * right * g.step * n, hh + arrows[1] * g.step * n);
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
function rebuildPanel() {
  const parts = $('parts');
  parts.textContent = '';
  for (const key of partIds()) {
    const b = document.createElement('button');
    b.textContent = LABELS[key];
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
    row('root d', numInput(() => s.root[0], (v) => (s.root[0] = v)), numInput(() => s.root[1], (v) => (s.root[1] = v)));
    if (s.tip) row('tip d', numInput(() => s.tip[0], (v) => (s.tip[0] = v)), numInput(() => s.tip[1], (v) => (s.tip[1] = v)));
    row('at h', numInput(() => s.at, (v) => (s.at = v)), 'span', numInput(() => s.span, (v) => (s.span = v)));
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
        p.textContent = 'Edge points: drag them freely; the tip point is shared by both edges. The model needs each edge in order of height, so press Sort by h when a point has passed its neighbours.';
        panel.append(p);
        const sort = document.createElement('button');
        sort.textContent = 'Sort by h';
        sort.onclick = () => {
          pushUndo();
          for (const edge of [s.le, s.te]) edge.sort((x, y) => x[0] - y[0]);
          fitFin(s);
          rebuildPanel();
          changed();
        };
        panel.append(sort);
      }
    } else {
      const p = document.createElement('div');
      p.className = 'dim';
      p.textContent = 'Seen edge-on from the side; the plan view (planform) comes with the wing editor.';
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
async function saveBlueprint() {
  if (!S.bp?.blob) return;
  const { blob, name, nose, tail, tailH } = S.bp;
  await idbDo('readwrite', (st) => st.put({ blob, name, nose, tail, tailH }, `${S.name}:side`));
}
async function loadBlueprint(plane) {
  const rec = await idbDo('readonly', (st) => st.get(`${plane}:side`));
  if (!rec?.blob) return null;
  const img = await createImageBitmap(rec.blob);
  return { img, blob: rec.blob, name: rec.name, nose: rec.nose, tail: rec.tail, tailH: rec.tailH ?? null };
}
function updateBlueprintInfo() {
  const b = S.bp;
  $('calibInfo').textContent = !b ? 'No picture loaded (kept in this browser only).' : b.nose && b.tail ? `${b.name}: calibrated` : `${b.name}: click Calibrate`;
  $('calib').disabled = !b;
  $('clear').disabled = !b;
  $('tailH').value = fmt(tailHeight());
}

$('load').onclick = () => $('file').click();
$('file').onchange = async () => {
  const f = $('file').files[0];
  if (!f) return;
  S.bp = { img: await createImageBitmap(f), blob: f, name: f.name, nose: null, tail: null, tailH: null };
  S.calibrating = 'nose';
  updateBlueprintInfo();
  fitView();
  $('file').value = '';
};
$('calib').onclick = () => {
  if (!S.bp) return;
  S.bp.nose = null;
  S.bp.tail = null;
  S.calibrating = 'nose';
  updateBlueprintInfo();
  fitView();
};
$('clear').onclick = async () => {
  await idbDo('readwrite', (st) => st.delete(`${S.name}:side`));
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
  for (const k of ['fin', 'fins']) fitFin(S.o[k]);
  S.def = Object.values(S.planes).find((d) => d && d.sprite === name) ?? { pivot: S.o.sprite?.pivot ?? [48, 20], spriteSize: S.o.sprite?.size, nation: 'germany' };
  S.part = 'fuselage';
  S.sel = null;
  S.undo = [];
  S.redo = [];
  S.calibrating = null;
  S.bp = await loadBlueprint(name);
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
