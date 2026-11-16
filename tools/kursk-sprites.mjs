// Scenery for the Kursk salient map (milestone 8, "Direction: the front"): drafts, not yet in the game.
// Drawn like the scenery in tools/make-sprites.mjs: palette keys on a grid, 2 pixels per world unit
// (5 pixels a metre). Run: node tools/kursk-sprites.mjs  -> notes/kursk-assets-preview.png, a sheet of all of
// them on a ground line, four times enlarged, with today's farmhouse and a T-34 for size.
// When the owner has approved the looks they move into make-sprites.mjs (SPRITES), data/ground.json and LDtk.
import { writeFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PALETTE } from './plane-palette.mjs';
import { encodePngRgba } from './png.mjs';

// Colours the Kursk scenery adds (dull and sooty: the look is grim). To join PALETTE when the sprites do.
export const KURSK_PALETTE = {
  3: [124, 108, 70, 255], // thatch
  8: [96, 82, 54, 255], // thatch shade
  9: [68, 58, 40, 255], // thatch, wet and dark
  O: [104, 60, 48, 255], // brick
  $: [80, 46, 38, 255], // brick shade
  '&': [38, 34, 32, 255], // char, soot
  '%': [86, 82, 78, 255], // ash
  '+': [146, 124, 68, 255], // ripe wheat, straw
  '=': [112, 94, 52, 255], // wheat shade
  '#': [168, 166, 152, 255], // birch bark
  '@': [88, 68, 58, 255], // rusty sheet-iron roof
  '!': [66, 52, 46, 255], // sheet-iron shade
  '~': [84, 68, 50, 255], // turned earth
  '^': [60, 50, 38, 255], // earth shade
};
const COLOURS = { ...PALETTE, ...KURSK_PALETTE };

function grid(w, h) {
  const px = Array.from({ length: h }, () => Array(w).fill('.'));
  const g = {
    w,
    h,
    px,
    set(x, y, c) {
      x = Math.round(x);
      y = Math.round(y);
      if (x >= 0 && y >= 0 && x < w && y < h) px[y][x] = c;
    },
    get: (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? px[y][x] : '.'),
    span(y, x0, x1, c) {
      for (let x = x0; x <= x1; x++) g.set(x, y, typeof c === 'function' ? c(x, y) : c);
    },
    box(x0, y0, x1, y1, c) {
      for (let y = y0; y <= y1; y++) g.span(y, x0, x1, c);
    },
    line(x0, y0, x1, y1, c) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) g.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
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

const noise = (x, k = 1) => (((Math.imul(x + 1, 2654435761) >>> 0) % 997) / 997) * k;

// A thatched hip roof seen from the long side: ridge x0..x1 at yTop, eaves ex0..ex1 at yEave. The straw lies
// in ragged courses, darker where it is old and wet, and the eaves hang uneven.
function thatch(g, x0, x1, yTop, ex0, ex1, yEave, seed = 0) {
  for (let y = yTop; y <= yEave; y++) {
    const k = (y - yTop) / (yEave - yTop);
    const l = Math.round(x0 + (ex0 - x0) * k);
    const r = Math.round(x1 + (ex1 - x1) * k);
    for (let x = l; x <= r; x++) {
      const n = noise(x * 31 + y * 17 + seed, 1);
      g.set(x, y, (y - yTop) % 4 === 3 ? '8' : n < 0.16 ? '9' : n < 0.42 ? '8' : '3');
    }
  }
  for (let x = ex0; x <= ex1; x++) if (noise(x * 5 + seed, 1) < 0.45) g.set(x, yEave + 1, '9'); // ragged eaves
  g.span(yTop, x0, x1, '9'); // the ridge, weighted down with poles
}

// Log walls: round logs lying in courses, their ends crossing at the corners.
function logs(g, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) g.span(y, x0, x1, (y - y0) % 3 === 2 ? 'T' : (x, yy) => (noise(x * 3 + yy * 11, 1) < 0.12 ? 'T' : 't'));
  for (let y = y0; y <= y1; y += 3) {
    g.set(x0 - 1, y, 'T'); // log ends standing proud of the corner
    g.set(x1 + 1, y, 'T');
    g.set(x0 - 1, y + 1, 't');
    g.set(x1 + 1, y + 1, 't');
  }
}

// A small window with a pale carved frame (nalichnik) and four panes.
function window(g, x, y, w = 4, h = 5, frame = 'y') {
  g.box(x - 1, y - 1, x + w, y + h, frame);
  g.box(x, y, x + w - 1, y + h - 1, 'n');
  g.box(x + (w >> 1) - 0, y, x + (w >> 1) - 0, y + h - 1, frame === 'y' ? 'Y' : frame);
  g.span(y - 2, x, x + w - 1, frame); // the carved head board
}

// Izba: a peasant log house under a heavy thatched roof, two small windows and a low door. 46x34.
// (About 8 m long, eaves at 2.4 m: the houses of the villages around Prokhorovka.)
function izba() {
  const g = grid(46, 34);
  g.box(27, 3, 29, 9, 'O'); // brick chimney
  g.span(3, 26, 30, '$');
  thatch(g, 13, 32, 6, 1, 44, 20, 1);
  logs(g, 5, 22, 40, 33);
  window(g, 9, 25);
  window(g, 19, 25);
  g.box(30, 24, 35, 33, 'D'); // plank door
  g.box(32, 24, 32, 33, 'T');
  g.span(33, 3, 42, 'J'); // stone footing
  g.outline('n');
  return g.rowsOut();
}

// Whitewashed izba (mazanka): clay over the logs, limewashed and gone grey, thatch, a lean-to porch. 52x34.
function izbaWhite() {
  const g = grid(52, 34);
  g.box(18, 4, 20, 9, 'O');
  g.span(4, 17, 21, '$');
  thatch(g, 12, 30, 6, 1, 41, 20, 7);
  g.box(4, 22, 38, 33, (x, y) => (noise(x * 7 + y * 13, 1) < 0.1 ? 'Y' : 'y'));
  g.box(4, 31, 38, 33, 'Y'); // the dark painted plinth (zavalinka)
  g.span(33, 3, 39, 'J');
  window(g, 8, 25, 4, 5, 'T');
  window(g, 18, 25, 4, 5, 'T');
  window(g, 28, 25, 4, 5, 'T');
  // Porch on the gable end: a plank lean-to on two posts.
  for (let y = 19; y <= 22; y++) g.span(y, 39, 39 + (y - 19) * 3 + 2, y % 2 ? 'D' : 'E');
  g.box(48, 23, 48, 33, 'T');
  g.box(40, 25, 44, 33, 'D'); // the door in its shadow
  g.box(42, 25, 42, 33, 'd');
  g.span(33, 40, 50, 'E'); // porch step
  g.outline('n');
  return g.rowsOut();
}

// A burnt-out izba: only the brick stove and its chimney stand, among charred logs and ash. 40x30.
// (What the villages on the front looked like: rows of chimneys.)
function izbaBurnt() {
  const g = grid(40, 30);
  // Ash and charred logs along the old wall line.
  for (let x = 2; x <= 37; x++) {
    const top = 27 - Math.round(noise(x * 9, 2.4));
    for (let y = top; y <= 29; y++) g.set(x, y, noise(x * 3 + y * 5, 1) < 0.4 ? '&' : '%');
  }
  g.line(3, 26, 12, 22, '&'); // a fallen roof beam
  g.line(4, 26, 13, 22, 'A');
  g.box(31, 20, 32, 29, '&'); // a corner post, burnt to a stump
  g.box(34, 23, 36, 29, '&');
  // The stove (pech): a broad whitewashed brick body, sooted, with the firebox mouth; its chimney above.
  g.box(15, 17, 27, 29, (x, y) => (noise(x * 5 + y * 3, 1) < 0.3 ? 'Y' : 'y'));
  g.box(15, 17, 27, 18, 'Y');
  g.box(18, 22, 22, 26, 'd'); // firebox mouth
  g.span(21, 18, 22, '&');
  g.span(27, 17, 23, 'Y'); // the hearth shelf
  g.box(21, 2, 25, 16, (x, y) => ((y + (x % 2)) % 3 === 0 ? '$' : 'O'));
  g.box(20, 2, 26, 3, '$'); // chimney cap
  for (let y = 4; y <= 12; y++) if (noise(y * 7, 1) < 0.5) g.set(21 + Math.round(noise(y, 4)), y, '&'); // soot streaks
  g.outline('d');
  return g.rowsOut();
}

// Collective-farm cowshed: long and low, wattle-and-daub walls, a sagging thatched roof, a row of small
// openings and a wide door. 104x26. (About 20 m: the kolkhoz yard's main building.)
function cowshed() {
  const g = grid(104, 26);
  for (let y = 3; y <= 14; y++) {
    const k = (y - 3) / 11;
    const l = Math.round(10 - 9 * k);
    const r = Math.round(93 + 9 * k);
    for (let x = l; x <= r; x++) {
      const sag = Math.round(1.6 * Math.sin(((x - 4) / 96) * Math.PI)); // the ridge sags in the middle
      const n = noise(x * 31 + y * 17, 1);
      g.set(x, y + sag, (y - 3) % 4 === 3 ? '8' : n < 0.2 ? '9' : n < 0.45 ? '8' : '3');
    }
  }
  for (let x = 1; x <= 102; x++) if (noise(x * 5, 1) < 0.5) g.set(x, 16, '9');
  g.box(4, 16, 99, 25, (x, y) => (x % 9 === 4 ? 'T' : noise(x * 7 + y * 13, 1) < 0.18 ? 'Y' : noise(x * 3 + y * 7, 1) < 0.06 ? '~' : 'y'));
  g.box(4, 24, 99, 25, 'Y');
  for (let x = 10; x <= 92; x += 12) if (x < 44 || x > 60) g.box(x, 19, x + 3, 21, 'd'); // stall openings
  g.box(46, 17, 57, 25, 'D'); // the double door
  g.box(51, 17, 52, 25, 'd');
  g.line(46, 17, 51, 25, 'T');
  g.line(57, 17, 52, 25, 'T');
  g.outline('d');
  return g.rowsOut();
}

// Well with a sweep (zhuravl, "the crane"): a log well head, a forked post and a long counterweighted pole
// with the bucket on a rod. 44x40.
function well() {
  const g = grid(44, 40);
  logs(g, 26, 31, 34, 39);
  g.span(30, 25, 35, 'T');
  g.box(11, 12, 12, 39, 'a'); // the forked post
  g.line(11, 12, 9, 8, 'a');
  g.line(12, 12, 14, 8, 'a');
  g.line(1, 19, 31, 3, 't'); // the sweep
  g.line(1, 20, 31, 4, 'T');
  g.box(0, 18, 3, 22, 'J'); // counterweight stone lashed to the butt
  g.line(31, 4, 30, 25, 'A'); // the rod down to the bucket
  g.box(28, 25, 32, 28, 'E');
  g.span(25, 28, 32, 'I');
  g.outline();
  return g.rowsOut();
}

// Haystack: a rounded cone of hay round a pole, darker on the weather side. 28x24.
function haystack() {
  const g = grid(28, 24);
  for (let y = 3; y <= 23; y++) {
    const k = (y - 3) / 20;
    const half = Math.round(12.5 * Math.sqrt(Math.sin(Math.min(1, k * 1.15) * Math.PI * 0.5)));
    for (let x = 14 - half; x <= 13 + half; x++) {
      const n = noise(x * 13 + y * 29, 1);
      g.set(x, y, x > 15 + (1 - k) * 2 ? (n < 0.3 ? '9' : '8') : n < 0.15 ? '8' : n < 0.3 ? '+' : '3');
    }
  }
  g.box(13, 0, 13, 4, 'A'); // the pole it is built round
  g.outline();
  return g.rowsOut();
}

// Wattle fence (pleten): willow rods woven between stakes, a clay pot drying on one. 44x12.
function wattle() {
  const g = grid(44, 12);
  for (let y = 4; y <= 11; y++) g.span(y, 1, 42, (x) => ((x + (y % 2) * 3) % 6 < 3 ? 'a' : 'A'));
  for (let x = 3; x <= 40; x += 6) {
    g.box(x, 2 + Math.round(noise(x, 1.4)), x, 11, 'T');
  }
  g.box(20, 0, 23, 2, 'O'); // the pot, upside down on a stake
  g.span(0, 21, 22, '$');
  for (let x = 1; x <= 42; x++) if (noise(x * 3, 1) < 0.25) g.set(x, 4, '.');
  g.outline();
  return g.rowsOut();
}

// Railway station: a small brick station of the old South-Eastern line, hipped sheet-iron roof, arched
// windows, the name board and a platform canopy on posts. 96x44. (Prokhorovka's was of this kind.)
function station() {
  const g = grid(96, 44);
  for (const x of [26, 66]) {
    g.box(x, 1, x + 3, 9, 'O');
    g.span(1, x - 1, x + 4, '$');
  }
  for (let y = 5; y <= 16; y++) {
    const k = (y - 5) / 11;
    const l = Math.round(18 - 12 * k);
    const r = Math.round(77 + 12 * k);
    g.span(y, l, r, (x) => ((x + y) % 7 === 0 ? '!' : y === 5 ? '!' : '@')); // standing seams
  }
  g.span(17, 5, 90, '!');
  g.box(8, 18, 87, 43, (x, y) => (y % 3 === 0 ? '$' : (x + (Math.floor(y / 3) % 2) * 3) % 6 === 0 ? '$' : 'O'));
  g.box(8, 40, 87, 43, 'J'); // stone plinth
  g.box(8, 18, 87, 19, 'y'); // plastered cornice
  for (const x of [8, 9, 86, 87, 46, 47]) g.box(x, 20, x, 39, 'y'); // pale corner and centre pilasters
  // Arched windows, and the door under the name board.
  for (const x of [14, 26, 60, 72]) {
    g.box(x - 1, 24, x + 6, 35, 'y');
    g.box(x, 25, x + 5, 34, 'n');
    g.set(x, 25, 'y');
    g.set(x + 5, 25, 'y');
    g.box(x + 2, 25, x + 3, 34, 'Y');
    g.span(30, x, x + 5, 'Y');
  }
  g.box(36, 26, 43, 39, 'T');
  g.box(39, 26, 40, 39, 'D');
  g.box(34, 21, 45, 24, 'x'); // the name board, white gone grey
  g.span(22, 36, 43, 'I');
  g.span(23, 37, 41, 'I');
  // Platform canopy on the right half: a thin iron roof on timber posts.
  g.box(50, 29, 95, 30, '!');
  g.span(31, 50, 95, '@');
  for (const x of [58, 76, 94]) g.box(x, 32, x, 43, 'T');
  g.line(54, 31, 58, 35, 'T');
  g.line(90, 31, 94, 35, 'T');
  g.outline('n');
  return g.rowsOut();
}

// Railway water tower: a tapering brick shaft with a wider timber-clad tank and a low conical roof. 30x70.
function waterTower() {
  const g = grid(30, 70);
  for (let y = 2; y <= 8; y++) g.span(y, 15 - (y - 1) * 2, 14 + (y - 1) * 2, y % 2 ? '!' : '@'); // roof
  g.box(14, 0, 15, 2, 'I'); // finial
  g.box(1, 9, 28, 26, (x) => (x % 3 === 0 ? 'D' : x > 19 ? 'D' : 'E')); // the tank's plank cladding
  g.span(9, 0, 29, 'T');
  g.span(26, 0, 29, 'T');
  g.span(17, 1, 28, 'I'); // an iron hoop
  for (let y = 27; y <= 69; y++) {
    const half = Math.round(8 + (y - 27) * 0.09);
    g.span(y, 15 - half, 14 + half, (x) => (y % 3 === 0 ? '$' : x > 17 ? '$' : (x + (Math.floor(y / 3) % 2) * 2) % 5 === 0 ? '$' : 'O'));
  }
  g.box(13, 34, 16, 39, 'n'); // slit windows up the shaft
  g.box(13, 48, 16, 53, 'n');
  g.box(12, 60, 17, 69, 'd'); // the door
  g.box(26, 27, 26, 69, 'I'); // the filling pipe down the side
  g.outline('nd');
  return g.rowsOut();
}

// Telegraph pole of the railway: two crossarms with insulators, a stay. 14x46.
function pole() {
  const g = grid(14, 46);
  g.box(6, 0, 7, 45, 'a');
  g.box(7, 0, 7, 45, 'A');
  for (const y of [4, 10]) {
    g.span(y, 1, 12, 'T');
    for (const x of [1, 4, 9, 12]) g.set(x, y - 1, '4'); // porcelain insulators
  }
  g.line(8, 16, 12, 45, 'I');
  g.outline();
  return g.rowsOut();
}

// Post windmill (the steppe's own landmark): a plank body that turns on a log trestle, four lattice sails
// with half their boards gone, the tail pole down to the ground. 76x84.
function windmill() {
  const g = grid(76, 84);
  // Trestle of crossed logs.
  for (let y = 62; y <= 83; y += 4) g.span(y, 26 - ((y - 62) >> 2), 49 + ((y - 62) >> 2), 'T');
  for (let y = 60; y <= 83; y++) for (const x of [29, 37, 46]) g.set(x + ((y >> 2) % 2), y, 't');
  g.line(27, 83, 34, 60, 'T');
  g.line(48, 83, 41, 60, 'T');
  // Body: tall plank box, gabled roof.
  g.box(24, 26, 51, 61, (x, y) => (x % 4 === 0 ? 'D' : noise(x * 7 + y * 3, 1) < 0.08 ? 'D' : 'E'));
  for (let y = 16; y <= 25; y++) g.span(y, 38 - (y - 15) * 1.6, 37 + (y - 15) * 1.6, (x, yy) => (yy % 3 === 0 ? 'D' : 'Q'));
  g.span(26, 21, 54, 'T');
  g.box(35, 34, 39, 39, 'd'); // loading hatch
  g.box(33, 50, 39, 61, 'D'); // door
  g.box(36, 50, 36, 61, 'd');
  g.line(52, 44, 70, 83, 'T'); // tail pole
  g.line(53, 44, 71, 83, 'A');
  // Sails: four arms from the wind shaft, each a spar with a ladder of bars on one side.
  const cx = 24;
  const cy = 30;
  for (let i = 0; i < 4; i++) {
    const a = 0.5 + (i * Math.PI) / 2;
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    g.line(cx, cy, cx + ux * 30, cy + uy * 30, 'T');
    for (let r = 8; r <= 30; r += 3) {
      if (noise(i * 37 + r, 1) < 0.3) continue; // boards gone
      g.line(cx + ux * r, cy + uy * r, cx + ux * r - uy * 6, cy + uy * r + ux * 6, 't');
    }
    g.line(cx + ux * 8 - uy * 6, cy + uy * 8 + ux * 6, cx + ux * 30 - uy * 6, cy + uy * 30 + ux * 6, 'a');
  }
  g.disc(cx, cy, 1.5, 'I');
  g.outline('d');
  return g.rowsOut();
}

// Apple tree of an orchard: low and broad, pruned flat, a short forked trunk. 30x28.
function appleTree() {
  const g = grid(30, 28);
  g.box(14, 17, 15, 27, 'a');
  g.line(14, 18, 9, 13, 'a');
  g.line(15, 18, 21, 13, 'A');
  for (const [cx, cy, r] of [[9, 9, 7], [20, 9, 7], [15, 6, 6], [5, 12, 4], [24, 12, 4], [15, 12, 6]]) g.disc(cx, cy, r, 'G');
  for (const [cx, cy, r] of [[19, 13, 5], [24, 11, 3], [10, 15, 3]]) g.disc(cx, cy, r, 'H');
  for (const [cx, cy, r] of [[8, 6, 2.5], [14, 3, 2], [4, 10, 1.5]]) g.disc(cx, cy, r, 'L');
  for (let y = 0; y < 18; y++) for (let x = 0; x < 30; x++) if (g.get(x, y) !== '.' && noise(x * 13 + y * 7, 1) < 0.04) g.set(x, y, 'm'); // a few apples
  g.outline();
  return g.rowsOut();
}

// Birch: a thin white trunk with dark scars, a light, hanging crown. 22x58.
function birch() {
  const g = grid(22, 58);
  for (const [cx, cy, r] of [[11, 10, 8], [7, 18, 6], [15, 19, 6], [11, 26, 6], [9, 6, 4]]) g.disc(cx, cy, r, 'G');
  for (const [cx, cy, r] of [[14, 23, 4], [16, 16, 3]]) g.disc(cx, cy, r, 'H');
  for (const [cx, cy, r] of [[8, 8, 3], [6, 16, 2], [11, 3, 2]]) g.disc(cx, cy, r, 'L');
  for (let y = 0; y < 34; y++) for (let x = 0; x < 22; x++) if (g.get(x, y) !== '.' && noise(x * 11 + y * 5, 1) < 0.07) g.set(x, y, '.'); // an airy crown
  for (let y = 14; y <= 57; y++) {
    g.set(10, y, noise(y * 7, 1) < 0.22 ? '&' : '#');
    g.set(11, y, noise(y * 13, 1) < 0.3 ? '&' : '4');
  }
  g.set(9, 57, '&');
  g.set(12, 57, '&');
  g.outline();
  return g.rowsOut();
}

// A strip of sunflowers at the field's edge, heads hanging, late summer. 48x16.
function sunflowers() {
  const g = grid(48, 16);
  for (let x = 2; x <= 45; x += 3) {
    const top = 2 + Math.round(noise(x * 3, 4));
    g.box(x, top + 2, x, 15, 'G');
    if (noise(x, 1) < 0.6) g.set(x + 1, top + 6, 'H');
    if (noise(x * 2, 1) < 0.6) g.set(x - 1, top + 9, 'H');
    g.box(x - 1, top, x + 1, top + 2, '5'); // the head
    g.set(x, top + 1, 'A');
  }
  g.outline();
  return g.rowsOut();
}

// Wheat stooks: sheaves stood together to dry on the stubble. 40x12.
function stooks() {
  const g = grid(40, 12);
  for (const cx of [6, 19, 33]) {
    for (let y = 2; y <= 11; y++) {
      const half = Math.round(1 + (y - 2) * 0.5);
      g.span(y, cx - half, cx + half, (x) => (noise(x * 7 + y * 3, 1) < 0.35 ? '=' : '+'));
    }
    g.span(5, cx - 2, cx + 2, '8'); // the binding
    g.set(cx - 2, 1, '+');
    g.set(cx + 1, 0, '+');
    g.set(cx, 1, '=');
  }
  g.outline();
  return g.rowsOut();
}

// Dugout (blindazh): a log-faced shelter dug into the ground, three layers of logs and earth on top, grown
// over. 48x14.
function dugout() {
  const g = grid(48, 14);
  for (let x = 1; x <= 46; x++) {
    const top = Math.round(11 - 9 * Math.sin(((x - 1) / 45) * Math.PI) ** 0.6);
    for (let y = top; y <= 13; y++) g.set(x, y, y === top && noise(x * 3, 1) < 0.5 ? 'G' : noise(x * 7 + y * 5, 1) < 0.35 ? '^' : '~');
  }
  for (let x = 9; x <= 38; x += 3) g.disc(x, 5, 1.2, x % 2 ? 't' : 'T'); // roof log ends
  logs(g, 15, 7, 32, 13);
  g.box(21, 8, 26, 13, 'd'); // the entrance
  g.span(7, 20, 27, 'T');
  g.outline('d');
  return g.rowsOut();
}

// Anti-tank hedgehog: three lengths of rail welded crosswise. 16x12.
function hedgehog() {
  const g = grid(16, 12);
  g.line(1, 11, 14, 1, 'I');
  g.line(2, 11, 15, 1, 'i');
  g.line(1, 2, 13, 11, 'I');
  g.line(2, 2, 14, 11, 'I');
  g.line(4, 6, 12, 5, 'i');
  g.line(4, 7, 12, 6, 'I');
  g.outline();
  return g.rowsOut();
}

// Covered goods wagon (the two-axle "teplushka"): plank body, sliding door, a low curved roof. 68x28.
function wagon() {
  const g = grid(68, 28);
  for (let x = 3; x <= 64; x++) {
    const t = (x - 33.5) / 31;
    g.box(x, Math.round(4 - 2.5 * Math.sqrt(Math.max(0, 1 - t * t))), x, 4, x % 9 === 0 ? '!' : '@');
  }
  g.box(4, 5, 63, 20, (x, y) => (x % 3 === 0 ? 'D' : noise(x * 5 + y * 7, 1) < 0.06 ? 'D' : 'E'));
  for (const x of [4, 16, 51, 63]) g.box(x, 5, x, 20, 'I'); // iron posts
  g.box(26, 6, 41, 20, (x) => (x % 3 === 0 ? 'T' : 'D')); // the sliding door, darker
  g.span(6, 22, 45, 'I'); // its rail
  g.line(26, 7, 41, 20, 'I');
  g.box(8, 7, 11, 9, 'd'); // the small hatch
  g.box(2, 21, 65, 22, 'I'); // frame
  g.box(0, 21, 1, 22, 'i'); // buffers
  g.box(66, 21, 67, 22, 'i');
  for (const cx of [15, 52]) {
    g.disc(cx, 24.5, 3, 'I');
    g.disc(cx, 24.5, 1, 'i');
    g.box(cx - 3, 21, cx + 3, 22, 'e'); // axle box
  }
  g.outline('d');
  return g.rowsOut();
}

// Railway track: rails on sleepers in ballast, a length that tiles end to end. 48x5.
function track() {
  const g = grid(48, 5);
  g.span(0, 0, 47, 'I'); // the rail head
  g.span(1, 0, 47, 'e');
  for (let x = 0; x <= 47; x++) {
    if (x % 6 < 3) g.box(x, 2, x, 3, 'A'); // sleepers
    else g.box(x, 2, x, 3, 'J');
    g.set(x, 4, noise(x * 3, 1) < 0.5 ? 'J' : 'u'); // ballast
  }
  return g.rowsOut();
}

// Plank shed (sarai): a lean-to for the cow, the cart and the firewood. 34x20.
function shed() {
  const g = grid(34, 20);
  for (let x = 1; x <= 32; x++) g.box(x, Math.round(2 + x * 0.14), x, Math.round(4 + x * 0.14), x % 5 === 0 ? 'D' : 'Q');
  for (let x = 3; x <= 30; x++) g.box(x, Math.round(5 + x * 0.14), x, 19, x % 3 === 0 ? 'D' : noise(x * 7, 1) < 0.2 ? 'D' : 'E');
  g.box(8, 10, 16, 19, 'd'); // the open bay
  g.box(12, 10, 12, 19, 'T');
  g.box(21, 14, 27, 19, (x, y) => ((x + y) % 2 ? 'a' : 'A')); // stacked firewood
  g.outline('d');
  return g.rowsOut();
}

// Village church: a small timber church, plank-clad, a low nave, an eight-sided drum with an onion dome and
// a bell tower over the porch. Shut since the thirties and used as the kolkhoz granary: no crosses, boarded
// windows. The landmark of a village from the air. 70x78.
function church() {
  const g = grid(70, 78);
  const planks = (x, y) => (x % 3 === 0 ? 'D' : noise(x * 7 + y * 3, 1) < 0.07 ? 'D' : 'E');
  const onion = (cx, top, r) => {
    for (let y = 0; y <= r * 2.2; y++) {
      const k = y / (r * 2.2);
      const half = k < 0.25 ? (k / 0.25) * r * 0.45 : k < 0.7 ? r * (0.45 + 0.55 * Math.sin(((k - 0.25) / 0.45) * Math.PI * 0.5)) : r * (1 - (k - 0.7) * 1.6);
      g.span(top + y, Math.round(cx - half), Math.round(cx + half), (x) => (x > cx + half * 0.3 ? '!' : (x + y) % 5 === 0 ? '!' : '@'));
    }
    g.box(cx, top - 3, cx, top, 'I'); // the stump where the cross stood
  };
  // Nave.
  g.box(22, 50, 58, 77, planks);
  for (let y = 40; y <= 49; y++) g.span(y, 40 - (y - 39) * 2, 39 + (y - 39) * 2, (x, yy) => (yy % 3 === 0 ? '!' : '@'));
  g.span(50, 19, 61, 'T');
  // Drum and dome over the nave.
  g.box(34, 28, 45, 41, planks);
  g.span(28, 33, 46, 'T');
  onion(40, 12, 7);
  g.box(38, 31, 41, 37, 'D'); // boarded window
  // Apse at the east end, lower.
  g.box(59, 58, 67, 77, planks);
  for (let y = 53; y <= 57; y++) g.span(y, 59, 62 + (y - 53), '@');
  // Bell tower over the west porch: square, an open belfry, a small tent roof and dome.
  g.box(6, 38, 21, 77, planks);
  g.box(8, 30, 19, 37, planks);
  g.box(10, 31, 12, 36, 'd');
  g.box(15, 31, 17, 36, 'd');
  g.span(38, 4, 23, 'T');
  g.span(30, 7, 20, 'T');
  for (let y = 22; y <= 29; y++) g.span(y, 14 - (y - 21), 13 + (y - 21), (x, yy) => (yy % 3 === 0 ? '!' : '@'));
  onion(13, 12, 3.5);
  g.box(11, 62, 16, 77, 'D'); // the porch door, boarded across
  g.span(66, 10, 17, 'T');
  g.span(71, 10, 17, 'T');
  for (const x of [28, 38, 48]) {
    g.box(x, 58, x + 3, 66, 'D'); // boarded windows
    g.span(61, x - 1, x + 4, 'T');
  }
  g.box(4, 76, 68, 77, 'J');
  g.outline('d');
  return g.rowsOut();
}

// --- Town buildings (the railway town in the middle of the map) -------------------------------------------

const bricks = (x, y) => (y % 3 === 0 ? '$' : (x + (Math.floor(y / 3) % 2) * 3) % 6 === 0 ? '$' : 'O');
const ironRoof = (x, y) => ((x + y) % 7 === 0 ? '!' : '@');

// Merchant's house: brick ground floor with the shop, a timber upper floor with carved window frames, a
// hipped iron roof. The provincial two-storey house of every Russian district town. 60x52.
function townHouse() {
  const g = grid(60, 52);
  g.box(40, 1, 43, 8, 'O');
  g.span(1, 39, 44, '$');
  for (let y = 5; y <= 14; y++) g.span(y, Math.round(14 - (y - 5) * 1.3), Math.round(45 + (y - 5) * 1.3), ironRoof);
  g.span(15, 1, 58, '!');
  g.box(4, 16, 55, 32, (x, y) => (y % 3 === 1 ? 'T' : noise(x * 3 + y * 11, 1) < 0.1 ? 'T' : 't')); // boarded logs
  for (const x of [9, 21, 33, 45]) window(g, x, 20, 5, 7);
  g.span(33, 3, 56, 'y'); // string course
  g.box(4, 34, 55, 51, bricks);
  g.box(4, 49, 55, 51, 'J');
  for (const x of [8, 42]) {
    g.box(x, 37, x + 9, 46, 'n'); // shop windows
    g.box(x + 4, 37, x + 5, 46, 'T');
    g.span(36, x - 1, x + 10, 'y');
  }
  g.box(26, 36, 33, 51, 'T'); // double door
  g.box(29, 36, 30, 51, 'D');
  g.box(22, 34, 37, 35, 'E'); // the shop sign board, bare
  g.outline('n');
  return g.rowsOut();
}

// Trade row: a low brick arcade of shops under one long iron roof, shutters down. 100x30.
function tradeRow() {
  const g = grid(100, 30);
  for (let y = 2; y <= 9; y++) g.span(y, Math.round(8 - (y - 2) * 0.9), Math.round(91 + (y - 2) * 0.9), ironRoof);
  g.span(10, 1, 98, '!');
  g.box(3, 11, 96, 29, bricks);
  g.box(3, 11, 96, 12, 'y');
  g.box(3, 28, 96, 29, 'J');
  for (let x = 7; x <= 84; x += 13) {
    g.box(x, 16, x + 8, 27, 'D'); // arched bays, plank shutters
    g.set(x, 16, 'O');
    g.set(x + 8, 16, 'O');
    g.span(15, x + 1, x + 7, 'y');
    for (let xx = x + 2; xx <= x + 6; xx += 2) g.box(xx, 17, xx, 27, 'T');
  }
  g.box(46, 16, 54, 27, 'd'); // one bay open and dark
  g.outline('d');
  return g.rowsOut();
}

// Town soviet: the plastered office of the district, a small portico on four posts, a flagpole on the
// roof, a loudspeaker horn at the corner. 66x42.
function soviet() {
  const g = grid(66, 42);
  g.box(32, 0, 32, 10, 'I'); // flagpole
  g.box(33, 1, 38, 4, 'm'); // the flag, dull red
  for (let y = 9; y <= 16; y++) g.span(y, Math.round(12 - (y - 9) * 1.4), Math.round(53 + (y - 9) * 1.4), ironRoof);
  g.span(17, 1, 64, '!');
  g.box(4, 18, 61, 41, (x, y) => (noise(x * 7 + y * 13, 1) < 0.08 ? 'Y' : 'y'));
  g.box(4, 39, 61, 41, 'Y');
  for (const x of [8, 17, 44, 53]) {
    g.box(x, 23, x + 4, 32, 'n');
    g.box(x + 2, 23, x + 2, 32, 'Y');
    g.span(27, x, x + 4, 'Y');
  }
  // Portico: a small pediment on four posts over the door.
  for (let y = 19; y <= 23; y++) g.span(y, 33 - (y - 18) * 2, 32 + (y - 18) * 2, 'Y');
  g.span(24, 22, 43, 'T');
  for (const x of [23, 29, 36, 42]) g.box(x, 25, x, 41, 'x');
  g.box(30, 28, 35, 41, 'T');
  g.box(32, 28, 33, 41, 'D');
  g.box(62, 20, 64, 22, 'I'); // loudspeaker
  g.outline('n');
  return g.rowsOut();
}

// Grain elevator by the railway: a tall plank-clad timber tower with a stepped head house and a loading
// lean-to: seen from far off, like the church. 50x92.
function elevator() {
  const g = grid(50, 92);
  const planks = (x, y) => (x % 3 === 0 ? 'D' : noise(x * 7 + y * 3, 1) < 0.07 ? 'D' : y % 14 === 0 ? 'D' : 'E');
  for (let y = 2; y <= 6; y++) g.span(y, 20 - (y - 2) * 2, 29 + (y - 2) * 2, ironRoof);
  g.box(13, 7, 36, 24, planks); // head house
  for (let y = 22; y <= 27; y++) g.span(y, 13 - (y - 22), 36 + (y - 22), ironRoof);
  g.box(8, 28, 41, 91, planks); // the bins
  for (const y of [12, 40, 60]) g.box(23, y, 26, y + 4, 'n');
  for (let x = 42; x <= 48; x++) g.box(x, 66 + Math.round((x - 42) * 0.8), x, 68 + Math.round((x - 42) * 0.8), '@'); // lean-to roof
  g.box(42, 72, 47, 91, planks);
  g.box(43, 78, 46, 91, 'd');
  g.box(1, 50, 7, 51, 'I'); // the loading spout towards the track
  g.line(1, 52, 3, 60, 'I');
  g.box(8, 89, 41, 91, 'J');
  g.outline('nd');
  return g.rowsOut();
}

// A shelled town house: the brick shell of the merchant's house, roof gone, a floor hanging, rubble at its foot. 60x46.
function townRuin() {
  const g = grid(60, 46);
  for (let x = 4; x <= 55; x++) {
    const top = Math.round(14 + 12 * Math.abs(Math.sin(x * 0.21 + 1)) + noise(x * 5, 4) - (x < 14 ? 10 : 0));
    for (let y = Math.max(2, top); y <= 45; y++) g.set(x, y, noise(x * 3 + y * 7, 1) < 0.12 ? '&' : bricks(x, y));
  }
  for (const [x, y] of [[9, 20], [21, 30], [33, 31], [45, 30], [9, 34]]) g.box(x, y, x + 5, y + 7, '.'); // empty window holes
  g.line(14, 28, 30, 31, '&'); // a charred floor beam
  g.box(4, 2, 7, 14, bricks); // a chimney stack still up
  for (let x = 0; x <= 59; x++) {
    const top = 45 - Math.round(noise(x * 9, 3.2));
    for (let y = top; y <= 45; y++) g.set(x, y, noise(x * 3 + y * 5, 1) < 0.5 ? '$' : noise(x + y, 1) < 0.5 ? '%' : 'J');
  }
  g.outline();
  return g.rowsOut();
}

// --- Guns ------------------------------------------------------------------------------------------------
// Drawn whole here, barrel and all, to judge the look; in the game the barrel is its own piece that swings.
// Like the light flak they are about 1.3 times their real size, to read from the air.

// A gun barrel from its pivot at an angle (rad, up from the right): parts [from, to, half width, colour].
function gunBarrel(g, px, py, ang, parts) {
  const [ux, uy] = [Math.cos(ang), -Math.sin(ang)];
  for (const [a, b, half, c] of parts)
    for (let t = a; t <= b; t += 0.5) for (let w = -half; w <= half; w += 0.5) g.set(px + ux * t - uy * w, py + uy * t + ux * w, c);
}

// A crewman, 9 pixels tall (kneeling: 6): helmet, face, tunic, legs.
function man(g, x, feet, helmet, tunic, kneel = false) {
  const h = kneel ? 6 : 9;
  g.box(x, feet - h, x + 2, feet - h + 1, helmet);
  g.box(x, feet - h + 2, x + 2, feet - h + 2, 'P');
  g.box(x, feet - h + 3, x + 2, feet - (kneel ? 2 : 4), tunic);
  if (kneel) g.box(x, feet - 1, x + 3, feet, 'I');
  else {
    g.box(x, feet - 3, x, feet, 'I');
    g.box(x + 2, feet - 3, x + 2, feet, 'I');
  }
}

// 8.8 cm Flak 36, emplaced: the cross-shaped platform down on its jacks, the pedestal, the cradle with its
// two equilibrator cylinders, the long two-piece barrel, the flat shield, the fuze setter on the left.
// Two of the crew. 56x44; trunnion (26, 30).
function flak88() {
  const g = grid(56, 44);
  g.box(4, 41, 47, 42, 'I'); // the fore-and-aft legs
  g.box(2, 42, 7, 43, 'i');
  g.box(44, 42, 49, 43, 'i');
  g.box(22, 40, 30, 42, 'i'); // a side outrigger, end on
  g.box(24, 42, 28, 43, 'I');
  for (let y = 34; y <= 40; y++) g.span(y, 26 - Math.round(2 + (y - 34) * 0.6), 26 + Math.round(2 + (y - 34) * 0.6), (x) => (x < 26 ? 'v' : 'V')); // pedestal
  g.box(21, 29, 31, 34, 'V'); // upper carriage
  g.box(21, 29, 31, 29, 'v');
  g.line(29, 33, 35, 26, 'i'); // equilibrators
  g.line(30, 33, 36, 26, 'I');
  gunBarrel(g, 26, 30, 0.95, [[-7, -1, 2.5, 'I'], [-1, 13, 2.5, 'v'], [13, 16, 2, 'V'], [16, 28, 1.5, 'V'], [28, 38, 1, 'v']]);
  g.disc(26, 30, 2.5, 'v');
  g.set(26, 30, 'I');
  for (let y = 18; y <= 37; y++) g.span(y, 34 + Math.round((37 - y) * 0.1), 36 + Math.round((37 - y) * 0.1), y < 20 ? 'v' : 'V'); // shield
  g.box(14, 33, 18, 38, 'v'); // fuze setter
  g.box(15, 34, 17, 35, 'I');
  g.box(18, 38, 20, 40, 'i'); // layer's seat
  man(g, 9, 40, 'V', 'q');
  man(g, 17, 37, 'V', 'q', true);
  g.outline();
  return g.rowsOut();
}

// 85 mm 52-K, emplaced: the four-wheeled platform up on its jacks with the wheels left on, side outriggers
// out, a squat pedestal, the barrel with its bell muzzle brake, no shield. Two of the crew. 58x44; trunnion (28, 29).
function flak85() {
  const g = grid(58, 44);
  g.box(7, 36, 49, 37, 'I'); // the platform girder
  g.box(9, 34, 47, 35, 'v');
  for (const cx of [12, 44]) {
    g.disc(cx, 37.5, 4, 'e'); // wheels, clear of the ground
    g.disc(cx, 37.5, 1.5, 'v');
  }
  for (const x of [20, 36]) {
    g.box(x, 38, x + 1, 42, 'i'); // jacks
    g.box(x - 2, 42, x + 3, 43, 'I');
  }
  g.box(25, 38, 31, 40, 'i'); // side outrigger, end on
  g.box(27, 40, 29, 43, 'I');
  for (let y = 30; y <= 33; y++) g.span(y, 28 - 5 - (y - 30), 28 + 5 + (y - 30), (x) => (x < 28 ? 'v' : 'V')); // low pedestal
  g.box(23, 26, 33, 30, 'V');
  g.line(31, 31, 37, 25, 'I');
  gunBarrel(g, 28, 29, 0.9, [[-6, -1, 2.5, 'I'], [-1, 12, 2.5, 'v'], [12, 30, 1.5, 'V'], [30, 34, 2.5, 'I'], [34, 35, 1.5, 'V']]);
  g.disc(28, 29, 2.5, 'v');
  g.set(28, 29, 'I');
  g.box(34, 27, 37, 33, 'v'); // the layers' sights and handwheels, either side
  g.disc(38, 30, 1.5, 'I');
  man(g, 14, 34, 'v', 'K');
  man(g, 39, 34, 'v', 'K');
  g.outline();
  return g.rowsOut();
}

// 7.5 cm Pak 40: very low, the double shield raked back, solid-tyred wheels, the long barrel with its
// double-baffle muzzle brake, the split trail spread. Two men kneeling behind the shield. 60x18; barrel pivot (30, 10).
function pak40() {
  const g = grid(60, 18);
  g.line(26, 12, 3, 16, 'V'); // the near trail leg
  g.line(26, 13, 3, 17, 'V');
  g.box(1, 15, 4, 17, 'I'); // spade
  g.line(26, 11, 8, 13, 'v'); // the far leg, behind
  gunBarrel(g, 30, 10, 0.04, [[-6, 0, 1.5, 'I'], [0, 9, 1.5, 'v'], [9, 24, 1, 'V'], [24, 27, 1.5, 'I']]);
  g.box(31, 11, 38, 12, 'V'); // recoil cylinder under the barrel
  for (let y = 5; y <= 14; y++) g.span(y, 27 + Math.round((y - 5) * 0.45), 29 + Math.round((y - 5) * 0.45), y < 7 ? 'v' : 'V'); // shield
  g.disc(29, 13.5, 3.5, 'e'); // wheel
  g.disc(29, 13.5, 1.5, 'V');
  man(g, 19, 17, 'V', 'q', true);
  man(g, 13, 17, 'V', 'q', true);
  g.outline();
  return g.rowsOut();
}

// 76 mm ZiS-3: taller than the Pak, a square shield with a raised middle, big pneumatic truck wheels, the
// recuperator over the barrel, a single-baffle muzzle brake, tubular split trail. Two men behind the shield. 60x20; barrel pivot (30, 10).
function zis3() {
  const g = grid(60, 20);
  g.line(26, 13, 3, 18, 'v');
  g.line(26, 14, 3, 19, 'V');
  g.box(1, 16, 4, 19, 'I');
  g.line(26, 12, 9, 15, 'V');
  gunBarrel(g, 30, 10, 0.05, [[-5, 0, 1.5, 'I'], [0, 8, 1, 'V'], [8, 23, 1, 'V'], [23, 26, 2, 'I']]);
  g.box(30, 7, 40, 8, 'v'); // recuperator above the barrel
  g.box(31, 12, 37, 12, 'V'); // cradle below
  g.box(27, 4, 29, 15, 'V'); // shield
  g.box(27, 3, 29, 3, 'v');
  g.box(28, 1, 29, 3, 'V'); // its raised centre
  g.disc(29, 15, 4, 'e'); // wheel
  g.disc(29, 15, 1.8, 'v');
  man(g, 20, 19, 'v', 'K', true);
  man(g, 13, 19, 'v', 'K');
  g.outline();
  return g.rowsOut();
}

// A gun pit: a low ring of turned earth and sandbags round an emplaced gun, seen as its near wall. 72x10.
function gunPit() {
  const g = grid(72, 10);
  for (let x = 1; x <= 70; x++) {
    const top = Math.round(9 - 7 * Math.min(1, Math.sin(((x - 1) / 69) * Math.PI) * 2.2));
    for (let y = top; y <= 9; y++) g.set(x, y, y < top + 2 && x > 8 && x < 63 ? ((x + (y % 2) * 3) % 6 === 0 ? 'z' : 's') : noise(x * 7 + y * 5, 1) < 0.35 ? '^' : '~');
  }
  g.outline();
  return g.rowsOut();
}

export const KURSK = {
  izba: izba(),
  'izba-white': izbaWhite(),
  'izba-burnt': izbaBurnt(),
  cowshed: cowshed(),
  well: well(),
  haystack: haystack(),
  wattle: wattle(),
  station: station(),
  'water-tower': waterTower(),
  'telegraph-pole': pole(),
  windmill: windmill(),
  'apple-tree': appleTree(),
  birch: birch(),
  sunflowers: sunflowers(),
  stooks: stooks(),
  dugout: dugout(),
  hedgehog: hedgehog(),
  wagon: wagon(),
  track: track(),
  shed: shed(),
  church: church(),
  'flak-88': flak88(),
  'flak-85': flak85(),
  'pak-40': pak40(),
  'zis-3': zis3(),
  'gun-pit': gunPit(),
  'town-house': townHouse(),
  'trade-row': tradeRow(),
  soviet: soviet(),
  elevator: elevator(),
  'town-ruin': townRuin(),
};

// --- The preview sheet -----------------------------------------------------------------------------------

// Reads one of the game's sprite PNGs (8-bit RGBA, as tools/make-sprites.mjs writes them) for the size comparison.
function readPng(path) {
  const buf = readFileSync(path);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const idat = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at);
    if (buf.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4 + 1;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride];
    for (let i = 0; i < w * 4; i++) {
      const v = raw[y * stride + 1 + i];
      const left = i >= 4 ? px[y * w * 4 + i - 4] : 0;
      const up = y ? px[(y - 1) * w * 4 + i] : 0;
      const ul = y && i >= 4 ? px[(y - 1) * w * 4 + i - 4] : 0;
      const pa = Math.abs(up - ul);
      const pb = Math.abs(left - ul);
      const pc = Math.abs(left + up - 2 * ul);
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      px[y * w * 4 + i] = (v + [0, left, up, (left + up) >> 1, paeth][f]) & 255;
    }
  }
  return { w, h, px };
}

const toImage = (rows) => {
  const w = Math.max(...rows.map((r) => r.length));
  const px = new Uint8Array(w * rows.length * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const c = COLOURS[row[x] ?? '.'];
      if (!c) throw new Error(`Unknown palette key "${row[x]}"`);
      px.set(c, (y * w + x) * 4);
    }
  });
  return { w, h: rows.length, px };
};

function preview() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const game = (name) => readPng(`${root}assets/sprites/${name}.png`);
  // Rows of the sheet: each a list of [image, sunk (pixels below the ground line)].
  const k = Object.fromEntries(Object.entries(KURSK).map(([name, rows]) => [name, toImage(rows)]));
  const rows = [
    [game('building'), game('t34-76'), k.izba, k['izba-white'], k['izba-burnt'], k.shed, k.well, k.haystack, k.wattle],
    [k.cowshed, k.church, k.windmill, k['apple-tree'], k.birch, k.sunflowers, k.stooks],
    [k.station, k['water-tower'], k['telegraph-pole'], k.wagon, k.dugout, k.hedgehog],
    [k['town-house'], k['trade-row'], k.soviet, k.elevator, k['town-ruin']],
    [game('flak'), game('lightflak'), k['flak-88'], k['flak-85'], k['pak-40'], k['zis-3'], game('panzer4h'), k['gun-pit']],
  ];
  const GAP = 8;
  const SKY = [96, 104, 108, 255];
  const EARTH = [58, 52, 40, 255];
  const GRASS = [66, 72, 46, 255];
  const rowH = rows.map((r) => Math.max(...r.map((s) => s.h)) + 6);
  const W = Math.max(...rows.map((r) => r.reduce((n, s) => n + s.w + GAP, GAP)));
  const H = rowH.reduce((n, h) => n + h + 8, 0);
  const sheet = new Uint8Array(W * H * 4);
  let top = 0;
  rows.forEach((r, i) => {
    const ground = top + rowH[i];
    for (let y = top; y < ground + 8; y++) for (let x = 0; x < W; x++) sheet.set(y < ground ? SKY : y === ground ? GRASS : EARTH, (y * W + x) * 4);
    // The track runs under the wagon's row.
    let x = GAP;
    for (const s of r) {
      if (s === k.wagon) for (let tx = x - 10; tx < x + s.w + 10; tx++) for (let ty = 0; ty < 5; ty++) sheet.set(COLOURS[KURSK.track[ty][((tx % 48) + 48) % 48]], ((ground - 2 + ty) * W + tx) * 4);
      const base = s === k.wagon ? ground - 2 : ground;
      for (let sy = 0; sy < s.h; sy++)
        for (let sx = 0; sx < s.w; sx++) {
          const a = s.px[(sy * s.w + sx) * 4 + 3];
          if (a) sheet.set(s.px.subarray((sy * s.w + sx) * 4, (sy * s.w + sx) * 4 + 4), ((base - s.h + sy) * W + x + sx) * 4);
        }
      x += s.w + GAP;
    }
    top = ground + 8;
  });
  // Four times enlarged, so the pixels can be judged.
  const Z = 4;
  const big = new Uint8Array(W * Z * H * Z * 4);
  for (let y = 0; y < H * Z; y++) for (let x = 0; x < W * Z; x++) big.set(sheet.subarray(((y / Z | 0) * W + (x / Z | 0)) * 4, ((y / Z | 0) * W + (x / Z | 0)) * 4 + 4), (y * W * Z + x) * 4);
  const out = `${root}notes/kursk-assets-preview.png`;
  writeFileSync(out, encodePngRgba(W * Z, H * Z, big));
  console.log(`${Object.keys(KURSK).length} sprites -> ${out} (${W * Z}x${H * Z})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) preview();
