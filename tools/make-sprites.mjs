// Generates the starter pixel-art PNGs in assets/sprites/. Planes are 3D models (plane-models.mjs)
// rendered to pixel art: <name>.png is the side view, <name>-frames.png the roll, ground-turn and
// ground-loop frames, <name>.json their layout and the model's attach points.
// Run: node tools/make-sprites.mjs
// Sprites are drawn at 2 pixels per world unit (the game's scenery scale), planes at 4.
// Once someone redraws a sprite by hand, remove it from SPRITES so it isn't overwritten.
//
// Paint key colours: the game swaps these for the player's paint scheme at load time,
// so hand-drawn sprites must use the same keys (see src/render/sprites.js).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MODELS, render, rollPose, groundPose, tipBank, project } from './plane-models.mjs';
import { readFileSync } from 'node:fs';
import { wheelGeometry } from '../src/sim/plane.js';

const PALETTE = {
  '.': [0, 0, 0, 0],
  o: [28, 26, 24, 255], // outline
  B: [255, 0, 255, 255], // KEY paint: base
  S: [192, 0, 192, 255], // KEY paint: base shade
  U: [0, 255, 255, 255], // KEY paint: underside
  N: [255, 255, 0, 255], // KEY paint: nose / spinner
  M: [255, 0, 0, 255], // KEY paint: national marking
  W: [128, 0, 128, 255], // KEY paint: wing (darker base)
  1: [0, 192, 192, 255], // KEY paint: underside shade
  2: [192, 192, 0, 255], // KEY paint: nose shade
  4: [176, 176, 168, 255], // white in shadow
  C: [96, 136, 160, 255], // canopy glass
  c: [200, 228, 240, 255], // canopy highlight
  p: [92, 64, 44, 255], // pilot's leather helmet
  P: [140, 104, 74, 255], // helmet highlight
  e: [50, 46, 44, 255], // exhaust stacks, intakes
  x: [236, 236, 226, 255], // white (marking borders)
  g: [96, 102, 90, 255], // hangar wall
  h: [66, 70, 62, 255], // hangar wall shade / door frame
  r: [132, 96, 70, 255], // hangar roof
  R: [100, 72, 52, 255], // hangar roof corrugation
  d: [22, 20, 18, 255], // door opening
  w: [150, 170, 176, 255], // hangar window
  b: [84, 90, 70, 255], // bomb casing
  l: [118, 124, 100, 255], // bomb highlight
  k: [56, 60, 46, 255], // bomb fins
  v: [86, 94, 64, 255], // olive drab steel (guns)
  V: [62, 70, 46, 255], // olive shade
  i: [96, 98, 92, 255], // iron grey
  I: [60, 62, 60, 255], // iron dark
  s: [170, 152, 112, 255], // sandbag
  z: [134, 118, 86, 255], // sandbag shade
  K: [156, 144, 100, 255], // tent canvas
  q: [120, 110, 76, 255], // canvas shade
  t: [128, 94, 62, 255], // timber
  T: [88, 64, 42, 255], // timber dark
  y: [140, 132, 116, 255], // plaster wall (grimy: the look is grim)
  Y: [112, 106, 94, 255], // plaster shade
  f: [96, 58, 46, 255], // roof tiles (dull, sooty brick)
  F: [70, 44, 36, 255], // roof tile shade
  n: [44, 56, 64, 255], // dark window glass
  G: [54, 64, 42, 255], // leaves (drab, late-summer dark)
  H: [38, 46, 32, 255], // leaf shade
  L: [70, 80, 52, 255], // leaf light
  X: [48, 58, 38, 255], // hedge
  Z: [32, 40, 28, 255], // hedge shade
  a: [70, 58, 44, 255], // bark
  A: [48, 40, 32, 255], // bark shade
  j: [104, 102, 94, 255], // field stone
  J: [76, 74, 68, 255], // stone shade
  u: [56, 54, 50, 255], // mortar / gaps
  E: [82, 64, 46, 255], // weathered barn planks
  D: [60, 46, 34, 255], // plank shade
  Q: [66, 62, 56, 255], // barn roof (old slate)
  m: [122, 40, 36, 255], // roundel red (dull)
  5: [168, 146, 64, 255], // roundel yellow (dull)
};

// A tiny drawing surface of palette keys.
function grid(w, h) {
  const px = Array.from({ length: h }, () => Array(w).fill('.'));
  const g = {
    w,
    h,
    px,
    set(x, y, c) {
      if (x >= 0 && y >= 0 && x < w && y < h) px[y][x] = c;
    },
    get: (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? px[y][x] : '.'),
    span(y, x0, x1, c) {
      for (let x = x0; x <= x1; x++) g.set(x, y, c);
    },
    rows(ranges, c) {
      for (const [y, [x0, x1]] of Object.entries(ranges)) g.span(Number(y), x0, x1, typeof c === 'function' ? c(Number(y)) : c);
    },
    disc(cx, cy, r, c) {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) g.set(x, y, c);
    },
    // Darken every filled pixel that touches empty space into an outline.
    outline(skip = '') {
      const edge = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (px[y][x] === '.' || skip.includes(px[y][x])) continue;
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(x + dx, y + dy) === '.')) edge.push([x, y]);
        }
      for (const [x, y] of edge) px[y][x] = 'o';
    },
    rowsOut: () => px.map((r) => r.join('')),
  };
  return g;
}

const noise = (x, k = 1) => ((Math.imul(x + 1, 2654435761) >>> 0) % 997) / 997 * k;

// Field hedge: a low, ragged bank of dark bushes. 48x10.
function hedge() {
  const g = grid(48, 10);
  for (let x = 1; x <= 46; x++) {
    const top = Math.round(1 + noise(x, 2.5) + (x < 4 || x > 43 ? 2 : 0));
    for (let y = top; y <= 9; y++) g.set(x, y, noise(x * 7 + y, 1) < 0.3 ? 'Z' : y > 6 ? 'Z' : 'X');
  }
  g.outline();
  return g.rowsOut();
}

// Dry-stone field wall: rough blocks, darker gaps. 44x8.
function wall() {
  const g = grid(44, 8);
  for (let y = 1; y <= 7; y++) g.span(y, 1, 42, 'j');
  for (let x = 1; x <= 42; x++) if (noise(x, 1) < 0.35) g.set(x, 1, '.'); // uneven capstones
  for (let y = 2; y <= 7; y++) {
    const off = (y >> 1) % 2 ? 0 : 3;
    for (let x = 1 + off; x <= 42; x += 6) g.set(x, y, 'u');
    if (y % 2 === 0) g.span(y, 1, 42, 'u');
  }
  for (let x = 1; x <= 42; x++) if (noise(x * 3, 1) < 0.4) g.set(x, 7, 'J');
  g.outline('u');
  return g.rowsOut();
}

// Broadleaf tree: a heavy dark crown on a short trunk. 28x52.
function tree() {
  const g = grid(28, 52);
  for (let y = 30; y <= 51; y++) g.span(y, 12, 15, y % 4 ? 'a' : 'A');
  g.set(11, 51, 'A');
  g.set(16, 51, 'A');
  for (const [cx, cy, r] of [[14, 14, 10], [8, 21, 7], [20, 21, 7], [14, 26, 8], [10, 9, 6], [19, 10, 5]]) g.disc(cx, cy, r, 'G');
  for (const [cx, cy, r] of [[18, 25, 6], [21, 18, 4], [12, 30, 4]]) g.disc(cx, cy, r, 'H');
  for (const [cx, cy, r] of [[10, 10, 2.5], [7, 18, 2], [14, 7, 2]]) g.disc(cx, cy, r, 'L');
  for (let y = 0; y < 34; y++) for (let x = 0; x < 28; x++) if (g.get(x, y) !== '.' && noise(x * 13 + y * 7, 1) < 0.12) g.set(x, y, 'H');
  g.outline();
  return g.rowsOut();
}

// Pine: tiers of dark needles on a straight trunk. 20x60.
function pine() {
  const g = grid(20, 60);
  for (let y = 44; y <= 59; y++) g.span(y, 9, 10, y % 3 ? 'a' : 'A');
  for (const [top, bottom, w] of [[1, 18, 5], [10, 30, 7], [22, 46, 9]]) {
    for (let y = top; y <= bottom; y++) {
      const half = Math.round(((y - top) / (bottom - top)) * w);
      g.span(y, 10 - half, 9 + half, y > bottom - 2 ? 'H' : 'G');
      g.span(y, 10, 9 + half, 'H'); // shaded side
    }
  }
  g.outline();
  return g.rowsOut();
}

// Barn: weathered planks under a sagging slate roof, a big dark door. 72x32.
function barn() {
  const g = grid(72, 32);
  for (let y = 2; y <= 13; y++) {
    const half = Math.round(14 + (y - 2) * 1.9);
    g.span(y, 36 - half, 35 + half, y % 3 === 0 ? 'J' : 'Q');
  }
  g.span(13, 4, 67, 'u');
  for (let y = 14; y <= 31; y++) for (let x = 6; x <= 65; x++) g.set(x, y, x % 4 === 0 ? 'D' : 'E');
  for (let y = 17; y <= 31; y++) g.span(y, 28, 43, 'd');
  for (let y = 17; y <= 31; y++) g.set(35, y, 'D'); // door seam
  for (let k = 0; k <= 15; k++) g.set(28 + k, 17 + Math.round(k * 0.93), 'D'); // cross brace
  for (let y = 19; y <= 22; y++) g.span(y, 12, 16, 'd'); // hay loft hatch
  g.outline('d');
  return g.rowsOut();
}

// Bomb, nose to the right. 14x6; pivot (7, 3).
function bomb() {
  const g = grid(14, 6);
  g.rows({ 0: [0, 1], 1: [0, 4], 4: [0, 4], 5: [0, 1] }, 'k');
  g.rows({ 1: [4, 10], 2: [3, 12], 3: [3, 12], 4: [4, 10] }, 'b');
  g.outline('kl');
  g.span(2, 5, 9, 'l');
  return g.rowsOut();
}

// Arched (Nissen-style) hangar seen from the front, door open. 64x32.
function hangar() {
  const g = grid(64, 32);
  const cx = 31.5;
  for (let x = 2; x <= 61; x++) {
    const t = (x - cx) / 29.5;
    const top = Math.round(31 - 27 * Math.sqrt(Math.max(0, 1 - t * t)));
    for (let y = top; y <= 31; y++) g.set(x, y, y < top + 3 ? (x % 3 === 0 ? 'R' : 'r') : 'g');
  }
  // Door frame, opening and slid-back door panels.
  for (let y = 12; y <= 31; y++) g.span(y, 15, 48, 'h');
  for (let y = 14; y <= 31; y++) g.span(y, 17, 46, 'd');
  for (let y = 14; y <= 31; y++) {
    g.span(y, 11, 14, 'h');
    g.span(y, 49, 52, 'h');
  }
  // Windows.
  for (const x0 of [6, 54]) for (let y = 22; y <= 24; y++) g.span(y, x0, x0 + 3, 'w');
  g.outline('d');
  return g.rowsOut();
}

// Ground objects stand on their bottom row, centred. Guns' barrels and the radar aerial are drawn by
// the game so they can turn.

// Flak gun on its cruciform platform, without the barrel. 28x18; barrel pivot (14, 6).
function flak() {
  const g = grid(28, 18);
  // Outrigger legs and jacks.
  g.rows({ 14: [1, 26], 15: [0, 27] }, 'I');
  for (const x of [0, 1, 26, 27]) g.set(x, 16, 'I');
  g.rows({ 16: [5, 22], 17: [4, 23] }, 'i');
  // Pedestal and cradle.
  g.rows({ 9: [10, 17], 10: [9, 18], 11: [9, 18], 12: [8, 19], 13: [8, 19] }, (y) => (y < 11 ? 'v' : 'V'));
  // Trunnion hub where the barrel sits.
  g.disc(14, 6.5, 3, 'v');
  g.set(14, 6, 'I');
  // Shield plate.
  g.rows({ 3: [19, 20], 4: [19, 21], 5: [19, 21], 6: [19, 21], 7: [19, 21], 8: [19, 21], 9: [19, 20] }, 'V');
  // Ammunition box.
  g.rows({ 11: [2, 6], 12: [2, 6], 13: [2, 6] }, 'v');
  g.span(11, 2, 6, 'V');
  g.outline();
  return g.rowsOut();
}

// Machine-gun nest: a ring of sandbags with a firing slit. 24x10; gun pivot (13, 3).
function mgnest() {
  const g = grid(24, 10);
  const rows = { 2: [6, 17], 3: [4, 19], 4: [2, 21], 5: [1, 22], 6: [1, 22], 7: [0, 23], 8: [0, 23], 9: [0, 23] };
  g.rows(rows, 's');
  // Bag seams: staggered courses.
  for (let y = 2; y <= 9; y++) for (let x = 0; x < 24; x++) if (g.get(x, y) === 's' && (x + (y % 2) * 3) % 6 === 0) g.set(x, y, 'z');
  for (let x = 0; x < 24; x++) for (const y of [4, 7]) if (g.get(x, y) === 's') g.set(x, y, 'z');
  // Firing slit and helmet of the gunner.
  g.span(3, 9, 14, 'd');
  g.rows({ 1: [11, 13], 2: [10, 14] }, 'V');
  g.outline('d');
  return g.rowsOut();
}

// Ridge tent with the door flap tied back. 32x16.
function tent() {
  const g = grid(32, 16);
  for (let y = 1; y <= 15; y++) {
    const half = Math.round(1 + y * 0.98);
    g.span(y, 16 - half, 15 + half, y % 5 === 0 ? 'q' : 'K');
  }
  // Shaded far slope and the door.
  for (let y = 1; y <= 15; y++) g.set(16 + Math.round(y * 0.98), y, 'q');
  g.rows({ 9: [14, 17], 10: [13, 18], 11: [13, 18], 12: [12, 19], 13: [12, 19], 14: [12, 19], 15: [12, 19] }, 'd');
  // Pole tip and guy-rope pegs.
  g.set(16, 0, 'T');
  g.outline('d');
  return g.rowsOut();
}

// Wooden watchtower: four legs with cross bracing and a roofed lookout. 20x60.
function tower() {
  const g = grid(20, 60);
  // Roof and lookout hut.
  g.rows({ 0: [8, 11], 1: [6, 13], 2: [4, 15], 3: [2, 17], 4: [1, 18] }, (y) => (y % 2 ? 'r' : 'R'));
  for (let y = 5; y <= 13; y++) g.span(y, 3, 16, y < 9 ? 'T' : 't');
  g.rows({ 6: [5, 14], 7: [5, 14] }, 'd'); // lookout opening
  g.rows({ 14: [1, 18], 15: [1, 18] }, 'T'); // platform
  // Splayed legs.
  for (let y = 16; y <= 59; y++) {
    const s = Math.round((y - 16) * 0.12);
    g.set(3 - s, y, 'T');
    g.set(4 - s, y, 't');
    g.set(15 + s, y, 't');
    g.set(16 + s, y, 'T');
  }
  // X bracing between the legs, in three bays.
  for (const [y0, y1] of [[17, 30], [31, 44], [45, 58]]) {
    for (let y = y0; y <= y1; y++) {
      const k = (y - y0) / (y1 - y0);
      const l = 4 - Math.round((y - 16) * 0.12);
      const r = 15 + Math.round((y - 16) * 0.12);
      g.set(Math.round(l + (r - l) * k), y, 't');
      g.set(Math.round(r - (r - l) * k), y, 't');
    }
    g.span(y1, 4 - Math.round((y1 - 16) * 0.12), 15 + Math.round((y1 - 16) * 0.12), 'T');
  }
  g.outline('d');
  return g.rowsOut();
}

// Farmhouse / barracks with a tiled roof and chimney. 56x36.
function building() {
  const g = grid(56, 36);
  // Chimney.
  for (let y = 1; y <= 8; y++) g.span(y, 40, 43, 'Y');
  // Pitched roof.
  for (let y = 4; y <= 15; y++) {
    const half = Math.round(10 + (y - 4) * 1.6);
    g.span(y, 28 - half, 27 + half, y % 3 === 0 ? 'F' : 'f');
  }
  g.span(15, 4, 51, 'F');
  // Walls.
  for (let y = 16; y <= 35; y++) g.span(y, 5, 50, y > 32 ? 'Y' : 'y');
  for (let y = 16; y <= 35; y++) for (const x of [5, 6, 49, 50]) g.set(x, y, 'Y');
  // Windows with frames and a door.
  for (const x0 of [9, 20, 40]) {
    for (let y = 20; y <= 26; y++) g.span(y, x0, x0 + 5, 'n');
    g.span(23, x0, x0 + 5, 'T');
    for (let y = 20; y <= 26; y++) g.set(x0 + 2, y, 'T');
  }
  for (let y = 23; y <= 35; y++) g.span(y, 30, 35, 't');
  for (let y = 23; y <= 35; y++) g.set(33, y, 'T');
  g.outline('n');
  return g.rowsOut();
}

// Radar station: steel lattice mast with the operators' hut at its foot. 36x80; aerial at (26, 4).
function radar() {
  const g = grid(36, 80);
  // Mast: two tapering rails with zig-zag lattice.
  for (let y = 6; y <= 79; y++) {
    const s = Math.round((y - 6) * 0.06);
    const l = 24 - s;
    const r = 28 + s;
    g.set(l, y, 'I');
    g.set(r, y, 'I');
    const k = ((y - 6) % 10) / 10;
    const bay = Math.floor((y - 6) / 10) % 2;
    g.set(Math.round(bay ? l + (r - l) * k : r - (r - l) * k), y, 'i');
    if ((y - 6) % 10 === 0) g.span(y, l, r, 'i');
  }
  g.rows({ 4: [25, 27], 5: [24, 28] }, 'I'); // aerial mount
  // Hut with a curved roof, door and window.
  for (let x = 1; x <= 20; x++) {
    const t = (x - 10.5) / 9.5;
    const top = Math.round(66 - 3 * Math.sqrt(Math.max(0, 1 - t * t)));
    for (let y = top; y <= 79; y++) g.set(x, y, y < top + 2 ? 'R' : y > 76 ? 'h' : 'g');
  }
  for (let y = 71; y <= 79; y++) g.span(y, 13, 17, 'd');
  for (let y = 70; y <= 73; y++) g.span(y, 4, 8, 'w');
  // Cable from the hut up the mast.
  for (let y = 66; y <= 72; y++) g.set(21, y, 'e');
  g.span(66, 21, 23, 'e');
  g.outline('d');
  return g.rowsOut();
}

// Tank, side view facing right, without its gun barrel. 44x20; barrel pivot (30, 5).
// Tracks with road wheels, sloped hull, turret with a cupola. Painted in the nation's base colour.
function tank() {
  const g = grid(44, 20);
  // Turret and cupola.
  g.rows({ 1: [22, 25], 2: [21, 26] }, 'S');
  g.rows({ 3: [16, 31], 4: [15, 32], 5: [15, 33], 6: [15, 33], 7: [14, 33] }, (y) => (y < 5 ? 'B' : 'S'));
  g.span(5, 26, 27, 'e'); // vision slit
  // Hull: sloped glacis at the front.
  g.rows({ 8: [6, 36], 9: [4, 38], 10: [3, 40], 11: [3, 41], 12: [3, 41] }, (y) => (y < 10 ? 'B' : 'S'));
  // Track run: dark belt around the wheels.
  g.rows({ 13: [2, 42], 14: [1, 43], 15: [1, 43], 16: [1, 43], 17: [1, 43], 18: [2, 42], 19: [4, 40] }, 'I');
  for (const cx of [7, 14, 21, 28, 35]) g.disc(cx, 16, 2.4, 'i');
  for (const cx of [7, 14, 21, 28, 35]) g.set(cx, 16, 'I');
  g.disc(3.5, 15.5, 1.8, 'i'); // idler
  g.disc(40.5, 15.5, 1.8, 'i'); // drive sprocket
  // National marking on the turret.
  g.disc(20, 5.5, 1.6, 'M');
  g.outline();
  return g.rowsOut();
}

// Tank depot: a long brick-and-steel shed with two big doors and a yard crane. 68x32.
function depot() {
  const g = grid(68, 32);
  // Sawtooth roof.
  for (let k = 0; k < 4; k++) {
    const x0 = 4 + k * 15;
    for (let y = 4; y <= 10; y++) g.span(y, x0 + Math.round((10 - y) * 1.6), x0 + 14, y % 2 ? 'R' : 'r');
    for (let y = 4; y <= 10; y++) g.set(x0 + 14, y, 'h');
  }
  for (let y = 11; y <= 31; y++) g.span(y, 3, 64, y > 28 ? 'h' : 'g');
  // Two vehicle doors, dark, with a half-open shutter.
  for (const x0 of [10, 38]) {
    for (let y = 15; y <= 31; y++) g.span(y, x0, x0 + 17, 'd');
    for (let y = 15; y <= 19; y++) g.span(y, x0, x0 + 17, y % 2 ? 'h' : 'g');
  }
  // Windows.
  for (const x0 of [30, 58]) for (let y = 14; y <= 16; y++) g.span(y, x0, x0 + 3, 'w');
  // Yard crane.
  for (let y = 0; y <= 14; y++) g.set(1, y, 'I');
  g.span(0, 1, 9, 'I');
  for (let y = 1; y <= 5; y++) g.set(9, y, 'e');
  g.outline('d');
  return g.rowsOut();
}

const SPRITES = {
  tank: tank(),
  depot: depot(),
  bomb: bomb(),
  hangar: hangar(),
  flak: flak(),
  mgnest: mgnest(),
  tent: tent(),
  tower: tower(),
  building: building(),
  radar: radar(),
  hedge: hedge(),
  wall: wall(),
  tree: tree(),
  pine: pine(),
  barn: barn(),
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function encodePng(rows) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  rows.forEach((row, y) => {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const px = PALETTE[row[x] ?? '.'];
      if (!px) throw new Error(`Unknown palette key "${row[x]}"`);
      raw.set(px, y * (w * 4 + 1) + 1 + x * 4);
    }
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Plane frame sheets. Every cell is CELL_W x CELL_H with the frame's anchor at a fixed pixel: the
// pivot for roll frames, the main wheels' ground contact for the ground frames. Ground-turn frames
// swing the nose away from the camera through tail-on to facing the other way; ground-loop frames
// spin the plane round while it tips over, ending as the far wingtip touches the ground.
// Planes are drawn at 4 pixels per world unit (twice the scenery's detail): RES pixels per model unit.
const RES = 2;
const CELL_W = 161;
const CELL_H = 129;
const ROLL_ANCHOR = [80, 64];
const GROUND_ANCHOR = [80, 92];
const ROLL_FRAMES = 16; // a full roll: 8 per half roll
const TURN_FRAMES = 13; // yaw 0..180 degrees
const LOOP_FRAMES = 24;
const LOOP_YAW = Math.PI * 2.5; // one and a quarter turns, ending nose away from the camera

// The plane def drawn with this sprite, for its wheels (the ground frames stand tail-down on them).
const planeDefs = JSON.parse(readFileSync(new URL('../data/planes.json', import.meta.url), 'utf8'));
const defOf = (sprite) => Object.values(planeDefs).find((d) => d.sprite === sprite);

function planeSheet(model, tailDown) {
  const propRadius = model.attach.propRadius ?? 8.5;
  const rows = [];
  const props = {};
  const add = (name, anchor, poses, gear) => {
    rows.push({ name, anchor, frames: poses.map((ps) => render(model, ps, CELL_W, CELL_H, anchor, { gear, res: RES })) });
    // Propeller disc per frame: hub and the two half axes, in pixels from the anchor (y down).
    props[name] = poses.map((ps) => {
      const [hx, hy, hz] = project(ps, model.attach.propHub);
      const ax = ps.dirToView([0, propRadius, 0]);
      const bx = ps.dirToView([0, 0, propRadius]);
      return [hx, hy, ax[0], -ax[1], bx[0], -bx[1], hz].map((v) => Math.round(v * RES * 100) / 100);
    });
  };
  const roll = Array.from({ length: ROLL_FRAMES }, (_, k) => rollPose((k / ROLL_FRAMES) * Math.PI * 2));
  add('roll', ROLL_ANCHOR, roll, false);
  add('rollGear', ROLL_ANCHOR, roll, true);
  add('turn', GROUND_ANCHOR, Array.from({ length: TURN_FRAMES }, (_, k) => groundPose(model, (k / (TURN_FRAMES - 1)) * Math.PI, tailDown)), true);
  const bank = tipBank(model, LOOP_YAW, tailDown);
  add('loop', GROUND_ANCHOR, Array.from({ length: LOOP_FRAMES }, (_, k) => {
    const s = k / (LOOP_FRAMES - 1);
    return groundPose(model, LOOP_YAW * (1 - (1 - s) ** 1.6), tailDown, bank * s ** 2.5);
  }), true);
  const width = CELL_W * Math.max(...rows.map((r) => r.frames.length));
  const sheet = [];
  for (const r of rows) {
    for (let y = 0; y < CELL_H; y++) sheet.push(r.frames.map((f) => f[y]).join('').padEnd(width, '.'));
  }
  const meta = {
    _notes: 'Generated by tools/make-sprites.mjs from tools/plane-models.mjs. Frame cells of the -frames.png sheet, row by row; anchor in cell pixels. props: per frame [hub x, hub y, half axis a x, y, half axis b x, y, hub depth] in pixels from the anchor. attach: model points in half world units from the pivot (x nose, y up, z towards the camera).',
    cell: [CELL_W, CELL_H],
    rows: Object.fromEntries(rows.map((r, i) => [r.name, { row: i, count: r.frames.length, anchor: r.anchor }])),
    props,
    attach: model.attach,
  };
  return { sheet, meta };
}

const outDir = new URL('../assets/sprites/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const [name, model] of Object.entries(MODELS)) {
  // Side view, 96 x 36 (or the plane's spriteSize) at the pivot planes.json gives, without the gear:
  // the game draws the gear so it can retract.
  const def = defOf(name);
  const [w, h] = def.spriteSize ?? [96, 36];
  SPRITES[name] = render(model, rollPose(0), w, h, def.pivot, { gear: false, res: RES });
  const { sheet, meta } = planeSheet(model, wheelGeometry(def).tailDown);
  writeFileSync(new URL(`${name}-frames.png`, outDir), encodePng(sheet));
  writeFileSync(new URL(`${name}.json`, outDir), JSON.stringify(meta) + '\n');
  console.log(`wrote assets/sprites/${name}-frames.png and ${name}.json`);
}
for (const [name, rows] of Object.entries(SPRITES)) {
  writeFileSync(new URL(`${name}.png`, outDir), encodePng(rows));
  console.log(`wrote assets/sprites/${name}.png`);
  if (process.argv.includes('--print')) console.log(rows.join('\n'));
}
