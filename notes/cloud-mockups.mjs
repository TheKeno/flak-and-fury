// Cloud look mock-ups (still pictures, not game code): run with node; writes the PNG named at the end into notes/.
// The chosen look is heaps(true, false, 5, 'lobes', { rim: 0.45, crown: 0.75 }) (ROADMAP Decisions, "Cloud layer look").
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { encodePngRgba } = await import(pathToFileURL(root + 'tools/png.mjs').href);

const W = 480, H = 300, Z = 2, GAP = 4;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
function rngOf(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (i, s) => rngOf(i * 7919 + s * 104729)();
function noise(x, cell, s) {
  const f = x / cell, i = Math.floor(f), t = smooth(f - i);
  return hash(i, s) * (1 - t) + hash(i + 1, s) * t;
}
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map((r) => r.map((v) => (v + 0.5) / 16));

function panel() {
  const px = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const c = [58 + 14 * t, 63 + 13 * t, 71 + 10 * t];
    for (let x = 0; x < W; x++) px.set(y % 3 === 0 ? c.map((v) => v - 3) : c, (y * W + x) * 3);
  }
  const blend = (x, y, rgb, a) => {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) px[i + k] = px[i + k] * (1 - a) + rgb[k] * a;
  };
  return { px, blend };
}

// The bank: no cloud left of ~150, full from ~260, with a ragged ramp.
const solidAt = (x) => clamp((x - 170) / 110 + (noise(x, 35, 3) - 0.5) * 0.5, 0, 1);
const MID = 160;

// 0: today's drawing (3-pixel columns, four stripes, see-through end).
function current() {
  const p = panel();
  const bands = [['#8a9094', 0.16], ['#787e82', 0.34], ['#6a7074', 0.3], ['#585e62', 0.2]].map(([c, s]) => [hex(c), s]);
  for (let x = 0; x < W; x += 3) {
    const s = clamp((x - 200) / 60, 0, 1);
    if (s <= 0.03) continue;
    const at = x / 2;
    const heap = (Math.abs(Math.sin(at * 0.085)) * 7 + Math.abs(Math.sin(at * 0.029 + 1.1)) * 6) * 2 * s;
    const half = 80 * (0.55 + 0.45 * s);
    const y0 = Math.round(MID - half - heap), y1 = Math.round(MID + half - (Math.sin(at * 0.11) * 3));
    let y = y0;
    for (const [c, share] of bands) {
      const part = Math.max(1, Math.round((y1 - y0) * share));
      for (let yy = y; yy < Math.min(y + part, y1); yy++) for (let k = 0; k < 3; k++) p.blend(x + k, yy, c, 0.92 * s);
      y += part;
    }
  }
  return p.px;
}

// The heaped shape shared by the new looks: a body that thins to nothing at the end, round heaps on top
// sized by how solid the bank is there, and loose puffs past the end.
function heapShape(seed, flat) {
  const rnd = rngOf(seed);
  const puffs = [];
  let x = 120;
  while (x < W + 30) {
    const s = solidAt(x);
    if (s > 0.04) {
      const r = (13 + rnd() * 20) * (0.3 + 0.7 * s);
      const half = 82 * smooth(s);
      puffs.push({ x, y: MID - half * 0.75 + rnd() * 10 - 5 + r * 0.3, rx: r * (flat ? 2.6 : 1), ry: r * (flat ? 0.55 : 1) });
      if (s > 0.6 && rnd() < 0.45) {
        const r2 = r * (0.5 + rnd() * 0.3);
        puffs.push({ x: x + rnd() * r - r / 2, y: MID - half * 0.75 - r * 0.6, rx: r2 * (flat ? 2.4 : 1), ry: r2 * (flat ? 0.55 : 1) });
      }
      x += r * (0.55 + rnd() * 0.5) * (flat ? 1.8 : 1);
    } else {
      // Loose bits beyond the end.
      if (x > 125 && rnd() < 0.18) {
        const r = 3 + rnd() * 5;
        puffs.push({ x, y: MID - 10 + rnd() * 40, rx: r * (flat ? 4 : 1), ry: r * (flat ? 0.4 : 0.8), loose: true });
      }
      x += 5 + rnd() * 8;
    }
  }
  const body = (x) => {
    const s = solidAt(x);
    if (s <= 0.04) return null;
    const half = 82 * smooth(s);
    return { top: MID - half * 0.75, bottom: MID + half * 0.85 + (noise(x, 9, 7) - 0.5) * 5 * s + (flat ? (noise(x, 4, 9) > 0.8 ? 4 : 0) : 0) };
  };
  return { puffs, body };
}

const TONES = ['#565c60', '#636a6e', '#71777b', '#7f8589', '#8e9498'].map(hex);
// Light at a point: high on the crowns, low on the belly. dither: 5 tones and a Bayer pattern; else smooth.
function shade(p, x, y, v, dither, a = 0.95) {
  v = clamp(v, 0, 0.999);
  if (dither) {
    const i = clamp(Math.floor(v * 4 + BAYER[y & 3][x & 3]), 0, 4);
    p.blend(x, y, TONES[i], a);
  } else {
    const f = v * 4, i = Math.min(3, Math.floor(f)), t = f - i;
    p.blend(x, y, TONES[i].map((c, k) => c * (1 - t) + TONES[i + 1][k] * t), a);
  }
}

// Lumpy belly: rounded bulges hanging under the bank, so its underside is not a ruler line.
function bellyOf(seed) {
  const rnd = rngOf(seed);
  const bumps = [];
  for (let x = 100; x < W + 60; x += 14 + rnd() * 26) bumps.push({ x, w: 14 + rnd() * 30, d: 3 + rnd() * 9 });
  return (x) => {
    let d = 0;
    for (const b of bumps) { const t = (x - b.x) / b.w; if (Math.abs(t) < 1) d = Math.max(d, b.d * Math.sqrt(1 - t * t)); }
    return d;
  };
}

function heaps(dither, flat, seed, style = 'plain', o = {}) {
  const rim = o.rim ?? 1, rough = o.rough ?? 0, fringe = o.fringe ?? 0, crown = o.crown ?? 1;
  // How far inside a heap's edge a point is, with the edge wobbled by noise round the heap and frayed by a dither.
  const inside = (q, x, y, i) => {
    const nx = (x - q.x) / q.rx, ny = (y - q.y) / q.ry;
    const ang = Math.atan2(ny, nx);
    const wob = 1 + rough * ((noise(ang * q.rx * 0.5 + 100, 3, i) - 0.5) + 0.5 * (noise(ang * q.rx + 50, 1.3, i + 9) - 0.5));
    const d = Math.hypot(nx, ny) / wob;
    if (d > 1) return null;
    const px = (1 - d) * Math.min(q.rx, q.ry);
    if (fringe && px < fringe && px / fringe < BAYER[y & 3][x & 3]) return null;
    return { nx, ny, d };
  };
  const p = panel();
  const { puffs, body: body0 } = heapShape(seed, flat);
  const lump = style === 'plain' ? () => 0 : bellyOf(seed + 3);
  const body = (x) => { const b = body0(x); if (!b) return null; const s = solidAt(x); return { top: b.top, bottom: b.bottom - 8 * s + lump(x) * s }; };
  const lobes = style === 'lobes' || style === 'both';
  const streaks = style === 'streaks' || style === 'both';
  for (let x = 0; x < W; x++) {
    const b = body(x);
    if (!b) continue;
    for (let y = Math.floor(b.top); y < b.bottom; y++) {
      const t = (y - b.top) / (b.bottom - b.top);
      let v = 0.62 - 0.6 * t * t;
      if (streaks) {
        // Wandering darker creases: thin layers inside the cloud, bent by slow noise.
        const yy = y + (noise(x, 70, 31) - 0.5) * 30 + (noise(x, 23, 37) - 0.5) * 8;
        const ph = (yy / 17) % 1;
        v -= 0.13 * Math.exp(-((ph - 0.5) ** 2) / 0.012) * (0.4 + 0.6 * t) * (0.5 + noise(x, 40, 41));
      }
      // The underside of each belly bulge is in shade.
      if (style !== 'plain') v -= 0.12 * clamp((y - (b.bottom - 6)) / 6, 0, 1);
      const edge = dither ? 1 : clamp((b.bottom - y) / 4, 0, 1);
      shade(p, x, y, v, dither, 0.95 * edge);
    }
  }
  if (lobes) {
    // Big dim heaps inside the body, lower rows darker: the bank is heaps all the way down.
    const rnd = rngOf(seed + 50);
    const inner = [];
    for (const f of [0.18, 0.42, 0.66]) {
      for (let x = 140 + rnd() * 20; x < W + 40;) {
        const s = solidAt(x), b = body(x);
        const r = (16 + rnd() * 22) * (0.4 + 0.6 * s);
        if (b && s > 0.15) inner.push({ x, y: b.top + f * (b.bottom - b.top) + rnd() * 10 - 5, rx: r * 1.35, ry: r * 0.8, f });
        x += r * (1.1 + rnd() * 0.8);
      }
    }
    inner.sort((a, b) => b.y - a.y);
    for (const q of inner) {
      for (let y = Math.floor(q.y - q.ry); y <= q.y + q.ry; y++) for (let x = Math.floor(q.x - q.rx); x <= q.x + q.rx; x++) {
        const h = inside(q, x, y, Math.round(q.x * 13 + q.y));
        if (!h) continue;
        const { ny } = h;
        const b = body(x);
        if (!b || y < b.top || y >= b.bottom - 3) continue;
        const t = (y - b.top) / (b.bottom - b.top);
        const v = 0.6 - 0.55 * t * t - 0.16 * rim * ny - 0.03;
        shade(p, x, y, v, dither, 0.95);
      }
    }
  }
  puffs.sort((a, b) => b.y - a.y); // lower ones first, the crowns over them
  for (const q of puffs) {
    for (let y = Math.floor(q.y - q.ry); y <= q.y + q.ry; y++) {
      for (let x = Math.floor(q.x - q.rx); x <= q.x + q.rx; x++) {
        const h = inside(q, x, y, Math.round(q.x * 7 + q.y * 3));
        if (!h) continue;
        const { nx, ny, d } = h;
        const b = body(x);
        if (!q.loose && b && y > b.bottom) continue;
        const edge = dither ? 1 : clamp((1 - d) * q.rx / 2.5, 0, 1);
        const g = 1 - (y - (MID - 82 * 0.75 - 30)) / 60; const v = 0.55 * crown * clamp(g, 0, 1) + 0.3 + 0.55 * (1 - crown) * 0.5 - rim * (0.18 * ny * ny * Math.sign(ny) + 0.05 * nx) + (q.loose ? -0.05 : 0);
        shade(p, x, y, v, dither, (q.loose ? 0.8 : 0.95) * edge);
      }
    }
  }
  return p.px;
}

const panels = [heaps(true, false, 5, 'lobes'), heaps(true, false, 5, 'lobes', { rim: 0.45, crown: 0.75 }), heaps(true, false, 5, 'lobes', { rough: 0.35, fringe: 3 }), heaps(true, false, 5, 'lobes', { rim: 0.45, crown: 0.75, rough: 0.35, fringe: 3 })];
const OW = (W * 2 + GAP) * Z, OH = (H * 2 + GAP) * Z;
const out = new Uint8Array(OW * OH * 4).fill(20);
panels.forEach((px, n) => {
  const ox = (n % 2) * (W + GAP), oy = Math.floor(n / 2) * (H + GAP);
  for (let y = 0; y < H * Z; y++) for (let x = 0; x < W * Z; x++) {
    const i = (Math.floor(y / Z) * W + Math.floor(x / Z)) * 3, o = ((oy * Z + y) * OW + ox * Z + x) * 4;
    out[o] = px[i]; out[o + 1] = px[i + 1]; out[o + 2] = px[i + 2]; out[o + 3] = 255;
  }
});
for (let i = 3; i < out.length; i += 4) out[i] = 255;
writeFileSync(root + 'notes/cloud-top-mockups.png', encodePngRgba(OW, OH, out));
console.log('ok');
