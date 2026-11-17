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

const COLOURS = PALETTE; // the Kursk colours are in the shared palette (tools/plane-palette.mjs)

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
// barrel false: the mount alone, as the game draws it (the barrel is its own piece that swings).
function flak88(barrel = true) {
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
  if (barrel) gunBarrel(g, 26, 30, 0.95, [[-7, -1, 2.5, 'I'], [-1, 13, 2.5, 'v'], [13, 16, 2, 'V'], [16, 28, 1.5, 'V'], [28, 38, 1, 'v']]);
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
function flak85(barrel = true) {
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
  if (barrel) gunBarrel(g, 28, 29, 0.9, [[-6, -1, 2.5, 'I'], [-1, 12, 2.5, 'v'], [12, 30, 1.5, 'V'], [30, 34, 2.5, 'I'], [34, 35, 1.5, 'V']]);
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

// --- Destroyed versions ------------------------------------------------------------------------------------

const THATCH = '389';
const TIMBER = 'tTEDQaA';
const BRICK = 'O$';
const ROOF_IRON = '@!';
const fromRows = (rows) => {
  const w = Math.max(...rows.map((r) => r.length));
  const g = grid(w, rows.length);
  rows.forEach((row, y) => [...row].forEach((c, x) => g.set(x, y, c)));
  return g;
};

// The wreck of a building, worked out from its sprite so every building gets one in the same hand: the top
// is torn off along a ragged line (keep: the share of its height left standing, on average), thatch and
// sheet iron are gone, timber is charred, windows are holes, brick chimneys and gables stand higher than the
// rest, a few burnt rafters lean in the gap and rubble or ash lies along the foot.
function ruin(rows, { keep = 0.5, seed = 1 } = {}) {
  const src = fromRows(rows);
  const { w, h } = src;
  const g = grid(w, h);
  let bricks = 0;
  let filled = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = src.get(x, y);
    if (c !== '.') filled++;
    if (BRICK.includes(c)) bricks++;
  }
  const masonry = bricks > filled * 0.25;
  const cut = [];
  for (let x = 0; x < w; x++) {
    let top = 0;
    while (top < h && src.get(x, top) === '.') top++;
    const height = h - top;
    const k = Math.min(1, keep * (0.45 + 1.1 * Math.abs(Math.sin(x * 0.19 + seed * 1.7))) + noise(x * 5 + seed, 0.18));
    cut[x] = Math.round(h - height * k);
    for (let y = top; y < h; y++) {
      const c = src.get(x, y);
      if (c === '.') continue;
      const stands = BRICK.includes(c) ? y >= cut[x] - height * 0.3 : y >= cut[x]; // brick outlasts the rest
      if (!stands || THATCH.includes(c) || ROOF_IRON.includes(c)) continue;
      const n = noise(x * 13 + y * 7 + seed, 1);
      const scorched = y < cut[x] + 5;
      let out = c;
      if (c === 'n' || c === 'w') out = 'd';
      else if (c === 'o') out = masonry ? 'o' : '&';
      else if (TIMBER.includes(c)) out = n < (scorched ? 0.8 : 0.45) ? '&' : n < 0.75 ? 'A' : c;
      else if ('yYx'.includes(c)) out = n < (scorched ? 0.45 : 0.1) ? '&' : n < 0.35 ? 'Y' : c;
      else if (BRICK.includes(c)) out = n < (scorched ? 0.3 : 0.06) ? '&' : c;
      g.set(x, y, out);
    }
  }
  // Burnt rafters fallen into the shell.
  for (let i = 0; i < Math.max(2, w / 22); i++) {
    const x0 = Math.round(4 + noise(i * 31 + seed, w - 16));
    const len = 8 + Math.round(noise(i * 17 + seed, 10));
    const dir = noise(i * 7 + seed, 1) < 0.5 ? 1 : -1;
    g.line(x0, h - 3, x0 + dir * len, Math.max(cut[Math.min(w - 1, Math.max(0, x0))] - 2, h - 4 - len), '&');
  }
  // Rubble and ash along the foot, spilling a little past the walls.
  for (let x = 0; x < w; x++) {
    let top = 0;
    while (top < h && src.get(x, top) === '.') top++;
    const near = top < h || src.get(Math.min(w - 1, x + 3), h - 1) !== '.' || src.get(Math.max(0, x - 3), h - 1) !== '.';
    if (!near) continue;
    const heap = 1 + Math.round(noise(x * 9 + seed, 2.6) + (top < h ? 1.2 * (1 - keep) : 0));
    for (let y = h - heap; y < h; y++) {
      const n = noise(x * 3 + y * 5 + seed, 1);
      g.set(x, y, masonry ? (n < 0.45 ? '$' : n < 0.7 ? 'J' : n < 0.85 ? 'O' : '%') : n < 0.5 ? '&' : n < 0.8 ? '%' : 'A');
    }
  }
  // Nothing hangs in the air: only what still joins the ground stays.
  const seen = new Set();
  const stack = [];
  for (let x = 0; x < w; x++) if (g.get(x, h - 1) !== '.') stack.push([x, h - 1]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (seen.has(y * w + x) || g.get(x, y) === '.') continue;
    seen.add(y * w + x);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) stack.push([x + dx, y + dy]);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!seen.has(y * w + x)) g.set(x, y, '.');
  return g.rowsOut();
}

// A burnt-out goods wagon: the planks gone, the iron frame and posts left, sagging on its wheels.
function wagonBurnt() {
  const g = fromRows(wagon());
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = g.get(x, y);
    if (ROOF_IRON.includes(c)) g.set(x, y, noise(x * 3, 1) < 0.5 ? '.' : '&');
    else if (TIMBER.includes(c) && y < 21) g.set(x, y, noise(x * 7 + y * 3, 1) < 0.72 ? '.' : '&');
    else if (c === 'o' && y < 20) g.set(x, y, x % 12 < 2 ? '&' : '.');
  }
  for (const x of [4, 16, 26, 41, 51, 63]) g.box(x, 4 + Math.round(noise(x, 3)), x, 20, 'I'); // the posts, bare
  g.span(20, 4, 63, '&');
  return g.rowsOut();
}

// --- Fields, fire and dust ---------------------------------------------------------------------------------
// Tiles and frames: standing wheat, wheat on fire (three frames to cycle), the black stubble left after,
// dust thrown up by a column (three frames, growing and thinning), a column of smoke from a burning wreck.

function wheat() {
  const g = grid(48, 10);
  for (let x = 0; x < 48; x++) {
    const top = Math.round(1 + noise(x * 3, 2.2));
    for (let y = top; y <= 9; y++) g.set(x, y, y === top ? '=' : noise(x * 7 + y * 13, 1) < 0.3 ? '=' : y < top + 3 ? '+' : noise(x + y * 5, 1) < 0.5 ? '+' : '8');
  }
  return g.rowsOut();
}

function wheatBurning(f) {
  const g = grid(48, 30);
  for (let x = 0; x < 48; x++) {
    const env = 0.35 + 0.65 * Math.abs(Math.sin(x * 0.2 + f * 1.3));
    const fh = Math.round(3 + env * (5 + noise(x * 7 + f * 131, 7)));
    for (let y = 24; y <= 29; y++) g.set(x, y, noise(x * 5 + y * 3 + f, 1) < 0.6 ? '&' : noise(x * 3 + y * 7 + f, 1) < 0.5 ? 'A' : y > 26 ? '=' : '{'); // the stalks, catching
    for (let k = 0; k < fh; k++) g.set(x, 23 - k, k < fh * 0.4 ? '}' : noise(x * 3 + k * 7 + f * 11, 1) < 0.75 ? '{' : 'm');
    // Smoke above, thinning as it rises and leaning downwind.
    for (let k = fh; k < fh + 14; k++) {
      const y = 23 - k;
      const lean = Math.round((k - fh) * 0.35);
      if (y >= 0 && noise(x * 11 + k * 5 + f * 29, 1) < 0.62 - (k - fh) * 0.04) g.set(x + lean, y, noise(x + k + f, 1) < 0.45 ? ')' : '(');
    }
  }
  return g.rowsOut();
}

function stubble() {
  const g = grid(48, 4);
  for (let x = 0; x < 48; x++) {
    const top = noise(x * 7, 1) < 0.35 ? 1 : 2;
    for (let y = top; y <= 3; y++) g.set(x, y, noise(x * 3 + y * 5, 1) < 0.55 ? '&' : noise(x + y, 1) < 0.5 ? '%' : 'A');
    if (noise(x * 13, 1) < 0.12) g.set(x, 0, '&'); // a burnt stalk still standing
  }
  return g.rowsOut();
}

// f 0..2: the puff grows and thins.
function dust(f) {
  const g = grid(40, 22);
  const blobs = [[12, 15, 5], [21, 13, 6], [29, 16, 5], [17, 9, 4], [26, 8, 4]];
  for (const [cx, cy, r] of blobs) g.disc(cx + f, cy - f * 1.5, r + f * 1.6, '<');
  for (let y = 0; y < 22; y++) for (let x = 0; x < 40; x++) {
    if (g.get(x, y) === '.') continue;
    const n = noise(x * 7 + y * 13 + f * 5, 1);
    if (n < 0.12 + f * 0.17 || ((x + y) % 2 === 0 && f === 2 && n < 0.6)) g.set(x, y, '.');
    else if (y > 14 - f || n > 0.8) g.set(x, y, '>');
  }
  return g.rowsOut();
}

function smokeColumn() {
  const g = grid(34, 72);
  for (let y = 71; y >= 0; y -= 2) {
    const k = (71 - y) / 71;
    g.disc(8 + k * 16 + Math.sin(y * 0.33) * 2.5, y, 2.5 + k * 6.5, '(');
  }
  for (let y = 0; y < 72; y++) for (let x = 0; x < 34; x++) {
    if (g.get(x, y) === '.') continue;
    const n = noise(x * 7 + y * 13, 1);
    const k = (71 - y) / 71;
    if (n < k * 0.5) g.set(x, y, '.');
    else if (n > 0.72) g.set(x, y, ')');
    else if (y > 62 && n < 0.3) g.set(x, y, '{');
    else if (n < 0.5 && k < 0.5) g.set(x, y, '&');
  }
  return g.rowsOut();
}

// --- Military buildings, by the nation that built them -----------------------------------------------------

const blit = (g, rows, x0, y0) => rows.forEach((row, y) => [...row].forEach((c, x) => c !== '.' && g.set(x0 + x, y0 + y, c)));
// Fuel drums stood in a row, n of them, on the line yBase.
function drums(g, x, yBase, n, c = 'v', shade = 'V') {
  for (let i = 0; i < n; i++) {
    g.box(x + i * 5, yBase - 6, x + i * 5 + 3, yBase, c);
    g.box(x + i * 5 + 3, yBase - 6, x + i * 5 + 3, yBase, shade);
    g.span(yBase - 4, x + i * 5, x + i * 5 + 3, shade);
    g.span(yBase - 2, x + i * 5, x + i * 5 + 3, shade);
  }
}
function crates(g, x, yBase, cols, rowsN) {
  for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols - (r ? 1 : 0); c++) {
    const cx = x + c * 7 + r * 3;
    g.box(cx, yBase - 4 - r * 5, cx + 5, yBase - r * 5, 'E');
    g.box(cx, yBase - 4 - r * 5, cx + 5, yBase - 4 - r * 5, 't');
    g.box(cx + 3, yBase - 4 - r * 5, cx + 3, yBase - r * 5, 'D');
  }
}
// A camouflage net thrown over what lies under it: knots of garnish with gaps, from (x0, y0) sagging to x1.
function camoNet(g, x0, x1, y0, sag = 3, drop = 4) {
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / (x1 - x0);
    const y = Math.round(y0 + sag * Math.sin(t * Math.PI));
    for (let k = 0; k <= drop; k++) {
      const n = noise(x * 7 + k * 13, 1);
      if (n < 0.3) continue;
      g.set(x, y + k, n < 0.55 ? 'H' : n < 0.8 ? 'G' : n < 0.92 ? 'K' : 'L');
    }
  }
}

// German supply dump (Versorgungslager): a sectional timber store hut with a tarred-felt roof and double
// doors, fuel drums in ranks, a stack of ammunition crates, a net over part of it. 76x34.
function depotGermany() {
  const g = grid(76, 34);
  for (let y = 6; y <= 13; y++) g.span(y, Math.round(10 - (y - 6) * 1.1), Math.round(45 + (y - 6) * 1.1), (x, yy) => (yy % 4 === 1 ? 'u' : 'Q'));
  g.box(4, 14, 51, 33, (x, y) => (x % 8 === 4 ? 'T' : noise(x * 7 + y * 3, 1) < 0.08 ? 'D' : 'E')); // wall panels
  g.box(4, 32, 51, 33, 'J');
  g.box(20, 18, 35, 33, 'D'); // double doors
  g.box(27, 18, 28, 33, 'd');
  g.line(20, 18, 27, 33, 'T');
  g.line(35, 18, 28, 33, 'T');
  for (const x of [9, 42]) g.box(x, 19, x + 4, 23, 'n');
  g.box(21, 15, 34, 16, 'x'); // the unit's tactical board
  g.span(15, 23, 32, 'I');
  drums(g, 54, 33, 4, 'I', 'e');
  drums(g, 56, 26, 3, 'I', 'e');
  crates(g, 60, 19, 2, 1);
  camoNet(g, 52, 75, 10, 3, 3);
  g.outline('nd');
  return g.rowsOut();
}

// Soviet supply point: a log store dug half into the ground under a roof of earth and turf, crates under a
// tarpaulin, drums, a pile of shell boxes. 76x30.
function depotUssr() {
  const g = grid(76, 30);
  for (let x = 1; x <= 50; x++) {
    const top = Math.round(12 - 8 * Math.sin((x / 51) * Math.PI) ** 0.55);
    for (let y = top; y <= 15; y++) g.set(x, y, y === top ? (noise(x * 3, 1) < 0.7 ? 'G' : 'L') : noise(x * 7 + y * 5, 1) < 0.35 ? '^' : '~');
  }
  logs(g, 5, 16, 46, 29);
  g.box(19, 19, 31, 29, 'D');
  g.box(25, 19, 25, 29, 'd');
  g.span(18, 18, 32, 'T');
  for (let x = 8; x <= 40; x += 8) if (x < 18 || x > 32) g.box(x, 20, x + 2, 22, 'd');
  // Stores under a tarpaulin.
  for (let x = 52; x <= 68; x++) {
    const top = Math.round(20 - 4 * Math.sin(((x - 52) / 16) * Math.PI) ** 0.5);
    g.box(x, top, x, 29, noise(x * 5, 1) < 0.3 ? 'q' : 'K');
  }
  g.line(52, 22, 50, 29, 'q');
  g.line(68, 22, 71, 29, 'q');
  drums(g, 60, 17, 2, 'v', 'V');
  crates(g, 67, 29, 1, 2);
  g.outline('d');
  return g.rowsOut();
}

// German radar: the Freya (FuMG 80). A square cabin that turns on a cross base, and above it the tall flat
// "mattress" of dipoles in two tiers. 44x80.
function radarGermany() {
  const g = grid(44, 80);
  // The mattress: a lattice frame with rows of dipoles in front of a mesh.
  for (const [y0, y1] of [[2, 26], [30, 52]]) {
    for (let y = y0; y <= y1; y++) for (let x = 5; x <= 38; x++) if ((x + y) % 2 === 0) g.set(x, y, 'I'); // mesh
    g.box(5, y0, 38, y0, 'i');
    g.box(5, y1, 38, y1, 'i');
    g.box(5, y0, 5, y1, 'i');
    g.box(38, y0, 38, y1, 'i');
    for (let y = y0 + 4; y < y1; y += 6) for (let x = 8; x <= 33; x += 6) g.box(x, y, x + 3, y, 'x'); // dipoles
  }
  g.box(21, 0, 22, 62, 'i'); // the mast through both
  g.box(13, 62, 30, 75, 'g'); // cabin
  g.box(13, 62, 30, 63, 'h');
  g.box(26, 62, 30, 75, 'h');
  g.box(16, 66, 19, 69, 'n');
  g.box(22, 67, 25, 75, 'd');
  g.box(6, 76, 37, 77, 'I'); // the cross base on its pads
  g.box(4, 78, 9, 79, 'i');
  g.box(34, 78, 39, 79, 'i');
  g.box(19, 76, 24, 79, 'i');
  g.outline('nd');
  return g.rowsOut();
}

// Soviet radar: the RUS-2 "Redut". The set rides in a van body on a ZiS-6 lorry; a tall mast beside it
// carries the aerial, a long boom with a row of rods. 56x80.
function radarUssr() {
  const g = grid(56, 80);
  g.box(27, 4, 28, 71, 'I'); // mast
  g.line(27, 30, 14, 79, 'e'); // stays
  g.line(28, 30, 44, 79, 'e');
  g.box(8, 7, 48, 8, 'i'); // the boom
  for (let x = 10; x <= 46; x += 6) g.box(x, 2 + ((x / 6) % 2 ? 1 : 0), x, 13 - ((x / 6) % 2 ? 1 : 0), 'i'); // rods
  g.box(22, 6, 33, 9, 'I'); // the turning head
  // The lorry: bonnet, cab, van body, three axles.
  g.box(4, 58, 37, 73, 'v');
  g.box(4, 58, 37, 59, 'V');
  g.box(32, 58, 37, 73, 'V');
  g.box(9, 62, 13, 66, 'n');
  g.box(18, 62, 23, 73, 'V');
  g.box(20, 62, 20, 73, 'I');
  g.box(38, 63, 45, 73, 'v'); // cab
  g.box(40, 64, 44, 68, 'n');
  g.box(46, 67, 53, 73, 'v'); // bonnet
  g.box(46, 67, 53, 67, 'V');
  g.box(2, 74, 54, 75, 'I');
  for (const cx of [10, 18, 48]) {
    g.disc(cx, 76.5, 3, 'e');
    g.disc(cx, 76.5, 1, 'I');
  }
  g.outline('n');
  return g.rowsOut();
}

// German field hangar: an arched frame under tarpaulin panels, splinter camouflage painted over it, the tall
// doors shut. 96x40 (the doors' own frames come when it goes into the game).
function hangarGermany() {
  const g = grid(96, 40);
  for (let x = 2; x <= 93; x++) {
    const t = (x - 47.5) / 46;
    const top = Math.round(38 - 34 * Math.sqrt(Math.max(0, 1 - t * t)) ** 0.8);
    for (let y = top; y <= 39; y++) {
      const blot = Math.sin(x * 0.21 + y * 0.13) + Math.sin(x * 0.07 - y * 0.29) > 0.6;
      g.set(x, y, x % 12 === 0 ? 'q' : blot ? 'V' : y < top + 2 ? 'K' : 'q');
    }
  }
  g.box(24, 12, 71, 39, (x) => (x % 6 === 0 ? 'h' : 'g')); // the doors
  g.box(47, 12, 48, 39, 'd');
  g.box(24, 12, 71, 13, 'h');
  for (const x of [30, 38, 56, 64]) g.box(x, 18, x + 3, 21, 'w');
  g.outline('d');
  return g.rowsOut();
}

// Soviet field hangar: a plank shed with a low gable, hidden under a net stuck with branches. 96x38.
function hangarUssr() {
  const g = grid(96, 38);
  for (let y = 4; y <= 11; y++) g.span(y, Math.round(47 - (y - 3) * 5.6), Math.round(48 + (y - 3) * 5.6), (x, yy) => (yy % 3 === 0 ? 'D' : 'Q'));
  g.box(4, 12, 91, 37, (x, y) => (x % 3 === 0 ? 'D' : noise(x * 7 + y * 3, 1) < 0.07 ? 'D' : 'E'));
  g.box(24, 14, 71, 37, (x) => (x % 8 === 0 ? 'T' : 'D')); // doors
  g.box(47, 14, 48, 37, 'd');
  g.box(24, 14, 71, 15, 'T');
  camoNet(g, 0, 95, 2, 5, 9);
  for (let x = 6; x <= 90; x += 9) g.line(x, 6 + Math.round(noise(x, 4)), x + 2, 1 + Math.round(noise(x * 3, 3)), 'G'); // branches stuck in
  for (const x of [1, 94]) g.line(x, 8, x + (x < 40 ? -1 : 1), 37, 'A'); // net poles
  g.outline('d');
  return g.rowsOut();
}

// Airfield windsock on its pole. 18x40.
function windsock() {
  const g = grid(18, 40);
  g.box(3, 2, 3, 39, 'I');
  for (let x = 4; x <= 15; x++) {
    const half = Math.round(3 - (x - 4) * 0.18);
    g.box(x, 5 - half + Math.round((x - 4) * 0.2), x, 5 + half + Math.round((x - 4) * 0.2), Math.floor((x - 4) / 3) % 2 ? '4' : 'm');
  }
  g.outline();
  return g.rowsOut();
}

// Stores in the open: drums, crates and jerrycans under a net. 44x16.
function stores() {
  const g = grid(44, 16);
  drums(g, 2, 15, 4, 'v', 'V');
  crates(g, 22, 15, 3, 2);
  for (let x = 4; x <= 14; x += 3) g.box(x, 5, x + 1, 8, 'V');
  camoNet(g, 18, 43, 1, 2, 3);
  g.outline();
  return g.rowsOut();
}

// --- Bunkers and strongpoints --------------------------------------------------------------------------------

// An earth mound with turf on top: x0..x1, crest at yTop, foot at yBase.
function mound(g, x0, x1, yTop, yBase, sharp = 0.5) {
  for (let x = x0; x <= x1; x++) {
    const top = Math.round(yBase - (yBase - yTop) * Math.sin(((x - x0) / (x1 - x0)) * Math.PI) ** sharp);
    for (let y = top; y <= yBase; y++) g.set(x, y, y === top ? (noise(x * 3, 1) < 0.65 ? 'G' : '~') : noise(x * 7 + y * 5, 1) < 0.35 ? '^' : '~');
  }
}

// Soviet DZOT (timber-and-earth firing point): a low turfed mound over a log box, a narrow embrasure with
// the Maxim's muzzle and water jacket in it, facing right. 60x18.
function dzot() {
  const g = grid(60, 18);
  mound(g, 1, 58, 2, 17, 0.45);
  logs(g, 34, 8, 50, 17);
  g.box(40, 11, 50, 13, 'd'); // embrasure
  g.box(46, 12, 53, 12, 'I'); // the gun
  g.box(44, 11, 48, 12, 'v');
  for (let x = 12; x <= 44; x += 4) g.disc(x, 6, 1, x % 8 ? 'T' : 't'); // the roof logs' ends, showing through
  g.box(6, 12, 10, 17, 'd'); // the way in, at the back
  g.outline('d');
  return g.rowsOut();
}

// German field bunker (Unterstand with a fighting position): squared timber and sandbags, a deeper mound,
// the MG 34 in a sandbagged embrasure facing left, a stove pipe, the entrance trench behind. 64x22.
function bunkerGermany() {
  const g = grid(64, 22);
  mound(g, 3, 62, 3, 21, 0.4);
  g.box(8, 10, 26, 21, (x, y) => (y % 4 === 1 ? 'T' : 't')); // squared timber face
  for (let y = 8; y <= 11; y++) g.span(y, 5, 29, (x) => ((x + (y % 2) * 3) % 6 === 0 ? 'z' : 's')); // sandbag lintel
  for (let y = 16; y <= 21; y++) g.span(y, 4, 10, (x) => ((x + (y % 2) * 3) % 6 === 0 ? 'z' : 's'));
  g.box(8, 12, 22, 15, 'd');
  g.box(3, 13, 12, 13, 'I'); // the MG's barrel
  g.box(10, 13, 14, 14, 'e');
  g.box(44, 0, 45, 6, 'I'); // stove pipe
  g.span(0, 43, 46, 'e');
  g.box(54, 14, 59, 21, 'd'); // entrance
  g.span(13, 53, 60, 'T');
  g.outline('d');
  return g.rowsOut();
}

// A T-34 dug in to its turret (Kursk's own strongpoint): the hull buried in a pit behind a bank, only the
// turret and the long barrel above ground, a net over the back. Facing right. 64x18.
function tankDugIn() {
  const g = grid(64, 18);
  // Turret: the cast 1943 "nut" shape with the cupola-less roof and the mantlet.
  for (let y = 4; y <= 10; y++) g.span(y, 18 - Math.round((10 - y) * 0.2) + (y < 6 ? 2 : 0), 35 + Math.round((y - 4) * 0.5), (x) => (y < 6 ? 'v' : x > 30 ? 'V' : 'v'));
  g.box(22, 2, 27, 3, 'V'); // hatch, open
  g.box(22, 0, 23, 2, 'V');
  g.box(36, 6, 39, 9, 'V'); // mantlet
  g.box(40, 7, 58, 8, 'V'); // the F-34 gun
  g.span(7, 40, 58, 'v');
  mound(g, 1, 62, 9, 17, 0.35);
  camoNet(g, 4, 20, 6, 2, 3);
  g.outline();
  return g.rowsOut();
}

// An anti-tank gun dug in: the gun (its drawing) in a pit behind its bank, a net on poles over it. 84x30.
function gunNest(gun, tall = 0) {
  const g = grid(84, 30);
  for (const x of [8, 44]) g.box(x, 4, x, 29, 'A'); // net poles
  blit(g, gun, 12, 30 - gun.length - 3);
  camoNet(g, 4, 50, 3, 3, 4 + tall);
  const pit = gunPit();
  blit(g, pit, 6, 20);
  for (let x = 30; x <= 60; x++) for (let y = 20; y <= 24; y++) if (g.get(x, y) === 's' || g.get(x, y) === 'z') g.set(x, y, noise(x * 3 + y, 1) < 0.5 ? '~' : '^'); // lower in front of the muzzle
  g.outline();
  return g.rowsOut();
}

// A length of fire trench as it shows from the side: the parapet of turned earth, the dark of the trench
// behind it, three helmets and their rifles. helmet: the palette key of the side's steel. 72x10.
function trench(helmet = 'V') {
  const g = grid(72, 10);
  for (let x = 0; x <= 71; x++) {
    const top = 5 + Math.round(noise(x * 5, 1.8));
    g.box(x, 4, x, top - 1, noise(x * 3, 1) < 0.9 ? 'd' : '.');
    for (let y = top; y <= 9; y++) g.set(x, y, noise(x * 7 + y * 5, 1) < 0.35 ? '^' : '~');
  }
  for (let x = 0; x <= 71; x += 9) g.box(x, 5, x, 9, 'T'); // revetting stakes
  g.outline('d~^');
  for (const x of [12, 34, 55]) {
    g.box(x, 1, x + 3, 2, helmet);
    g.box(x, 0, x + 2, 0, helmet);
    g.box(x + 1, 3, x + 3, 3, 'P');
    g.line(x + 4, 3, x + 11, 2, 'A'); // rifle on the parapet
  }
  return g.rowsOut();
}

// Barbed wire: a double apron on stakes. 56x12.
function wire() {
  const g = grid(56, 12);
  for (let x = 4; x <= 52; x += 12) g.box(x, 1, x, 11, 'A');
  for (let x = 0; x <= 55; x++) {
    for (const [a, b] of [[2, 0.5], [5, 1.7], [8, 3.1]]) {
      const y = Math.round(a + 1.2 * Math.sin(x * 0.52 + b));
      if ((x + a) % 4 !== 0) g.set(x, y, 'I');
      else g.set(x, y, 'i'); // a barb
    }
    if (x % 12 !== 4 && (x >> 1) % 2) g.set(x, Math.round(11 - Math.abs(((x + 2) % 12) - 6) * 1.5), 'I'); // the apron's diagonals
  }
  return g.rowsOut();
}

// Minefield marker: a board on a post. 10x14.
function mineSign() {
  const g = grid(10, 14);
  g.box(4, 3, 5, 13, 'A');
  g.box(1, 1, 8, 6, 'x');
  g.box(2, 2, 3, 3, 'I'); // skull and bones, as much as six pixels allow
  g.box(6, 2, 7, 3, 'I');
  g.span(5, 3, 6, 'I');
  g.outline();
  return g.rowsOut();
}

// A firing-point bunker in concrete, for the last line at an airfield: a low block with a stepped embrasure
// and a steel door, earth banked against it. 56x20.
function pillbox() {
  const g = grid(56, 20);
  mound(g, 0, 22, 8, 19, 0.6);
  g.box(12, 4, 46, 19, (x, y) => (y % 5 === 4 ? 'J' : noise(x * 7 + y * 3, 1) < 0.1 ? 'J' : 'j')); // shuttered concrete
  g.box(10, 3, 48, 5, 'j'); // the roof slab, proud of the wall
  g.span(5, 10, 48, 'u');
  g.box(34, 9, 46, 13, 'J'); // stepped embrasure
  g.box(37, 10, 46, 12, 'u');
  g.box(40, 11, 46, 11, 'd');
  g.box(44, 11, 51, 11, 'I');
  g.box(16, 11, 21, 19, 'I'); // steel door
  g.set(20, 15, 'i');
  g.outline('d');
  return g.rowsOut();
}

export const KURSK_RUINS = {
  'izba-ruin': ruin(izba(), { keep: 0.45, seed: 2 }),
  'izba-white-ruin': ruin(izbaWhite(), { keep: 0.5, seed: 5 }),
  'shed-ruin': ruin(shed(), { keep: 0.4, seed: 3 }),
  'cowshed-ruin': ruin(cowshed(), { keep: 0.55, seed: 4 }),
  'church-ruin': ruin(church(), { keep: 0.3, seed: 6 }),
  'windmill-ruin': ruin(windmill(), { keep: 0.33, seed: 7 }),
  'station-ruin': ruin(station(), { keep: 0.55, seed: 8 }),
  'water-tower-ruin': ruin(waterTower(), { keep: 0.55, seed: 9 }),
  'trade-row-ruin': ruin(tradeRow(), { keep: 0.6, seed: 10 }),
  'soviet-ruin': ruin(soviet(), { keep: 0.55, seed: 11 }),
  'elevator-ruin': ruin(elevator(), { keep: 0.28, seed: 12 }),
  'wagon-burnt': wagonBurnt(),
  'depot-germany-ruin': ruin(depotGermany(), { keep: 0.45, seed: 13 }),
  'depot-ussr-ruin': ruin(depotUssr(), { keep: 0.55, seed: 14 }),
};
export const KURSK_FIELD = {
  wheat: wheat(),
  'wheat-burning-1': wheatBurning(0),
  'wheat-burning-2': wheatBurning(1),
  'wheat-burning-3': wheatBurning(2),
  stubble: stubble(),
  'dust-1': dust(0),
  'dust-2': dust(1),
  'dust-3': dust(2),
  'smoke-column': smokeColumn(),
};
export const KURSK_MILITARY = {
  'depot-germany': depotGermany(),
  'depot-ussr': depotUssr(),
  'radar-germany': radarGermany(),
  'radar-ussr': radarUssr(),
  'hangar-germany': hangarGermany(),
  'hangar-ussr': hangarUssr(),
  windsock: windsock(),
  stores: stores(),
  dzot: dzot(),
  'bunker-germany': bunkerGermany(),
  'tank-dug-in': tankDugIn(),
  'pak-nest': gunNest(pak40()),
  'zis-nest': gunNest(zis3()),
  'trench-germany': trench('V'),
  'trench-ussr': trench('v'),
  wire: wire(),
  'mine-sign': mineSign(),
  pillbox: pillbox(),
};

// --- Paratroopers ------------------------------------------------------------------------------------------
// canopy, shade: the palette keys of the silk; round: a German RZ 20 (round, the man hanging forward from one
// point behind his shoulders), else a Soviet PD-41 (a flatter, squarer canopy on two risers).

function paraMan(g, x, y, helmet, tunic, forward = false) {
  g.box(x, y, x + 2, y + 1, helmet);
  g.box(x + (forward ? 1 : 0), y + 2, x + 2, y + 2, 'P');
  g.box(x, y + 3, x + 2, y + 6, tunic);
  g.box(x - 1, y + 3, x - 1, y + 5, tunic); // pack
  if (forward) {
    g.line(x + 3, y + 4, x + 5, y + 6, tunic); // arms spread
    g.line(x, y + 7, x - 2, y + 10, 'I'); // legs trailing
    g.line(x + 2, y + 7, x + 1, y + 10, 'I');
  } else {
    g.box(x, y + 7, x, y + 10, 'I');
    g.box(x + 2, y + 7, x + 2, y + 10, 'I');
    g.box(x + 3, y + 4, x + 4, y + 5, 'e'); // weapon across the chest
  }
}

function paraOpen(round, canopy, shade, helmet, tunic) {
  const g = grid(40, 46);
  for (let x = 2; x <= 37; x++) {
    const t = (x - 19.5) / 18;
    const top = round ? Math.round(16 - 14 * Math.sqrt(Math.max(0, 1 - t * t))) : Math.round(10 - 7 * Math.max(0, 1 - t * t * t * t));
    const bottom = round ? 16 : 11 + Math.round(Math.abs(Math.sin(x * 0.9)) * 1.5);
    for (let y = top; y <= bottom; y++) g.set(x, y, (x + 1) % 6 === 0 ? shade : x > 26 ? shade : canopy);
  }
  if (round) for (let x = 2; x <= 37; x += 6) g.set(x, 17, shade); // scalloped hem
  const foot = round ? 17 : 12;
  const [mx, my] = [18, 33];
  if (round) for (const x of [3, 10, 17, 22, 29, 36]) g.line(x, foot, 19, my - 3, 'J'); // all lines to one point
  else for (const x of [3, 9, 15]) {
    g.line(x, foot, mx - 1, my + 2, 'J');
    g.line(39 - x, foot, mx + 3, my + 2, 'J');
  }
  if (round) g.line(19, my - 3, 19, my + 1, 'J');
  paraMan(g, mx, my, helmet, tunic, round);
  g.outline('J');
  return g.rowsOut();
}

// Just out of the door: the canopy still a streaming sausage above the man.
function paraStream(canopy, shade, helmet, tunic) {
  const g = grid(14, 46);
  for (let y = 2; y <= 22; y++) g.box(6 + Math.round(Math.sin(y * 0.6) * 1.2), y, 7 + Math.round(Math.sin(y * 0.6) * 1.2) + (y > 6 && y < 18 ? 1 : 0), y, y % 4 === 0 ? shade : canopy);
  g.line(6, 23, 6, 32, 'J');
  paraMan(g, 5, 33, helmet, tunic, true);
  g.outline('J');
  return g.rowsOut();
}

// Down: the canopy collapsing on the ground, the man on one knee freeing himself.
function paraLanded(canopy, shade, helmet, tunic) {
  const g = grid(46, 14);
  for (let x = 12; x <= 44; x++) {
    const top = Math.round(12 - 6 * Math.abs(Math.sin((x - 12) * 0.21)) * (1 - (x - 12) / 60));
    for (let y = top; y <= 13; y++) g.set(x, y, (x + y) % 5 === 0 || y > 11 ? shade : canopy);
  }
  g.line(7, 9, 14, 12, 'J');
  man(g, 3, 13, helmet, tunic, true);
  g.outline('J');
  return g.rowsOut();
}

// A drop container (German Abwurfbehaelter) under its own small canopy. 22x40.
function dropContainer() {
  const g = grid(22, 40);
  for (let x = 2; x <= 19; x++) {
    const t = (x - 10.5) / 9;
    for (let y = Math.round(9 - 7 * Math.sqrt(Math.max(0, 1 - t * t))); y <= 9; y++) g.set(x, y, x % 4 === 0 ? 'q' : 'K');
  }
  for (const x of [3, 10, 18]) g.line(x, 10, 10, 22, 'J');
  g.box(8, 23, 12, 39, 'v');
  g.box(12, 23, 12, 39, 'V');
  g.box(8, 26, 12, 26, 'm');
  g.box(8, 36, 12, 36, 'm');
  g.outline('J');
  return g.rowsOut();
}

// --- The engine of the railway -----------------------------------------------------------------------------

// Goods locomotive of the E class (0-10-0), the commonest engine on Soviet lines: a long black boiler, five
// small coupled wheels, a tall chimney, steam and sand domes, a cab with a curved roof; facing right.
// Drawn to the size of the wagon. 96x44; then the tender. Rail level is the bottom row.
function locomotive() {
  const g = grid(96, 44);
  g.box(6, 31, 90, 33, 'I'); // frame
  g.box(22, 13, 82, 28, (x, y) => (y < 16 ? 'i' : y > 25 ? 'u' : x % 14 === 8 ? 'u' : 'e')); // boiler, with its bands
  g.box(22, 13, 82, 13, 'I');
  g.box(83, 12, 90, 29, 'I'); // smokebox
  g.disc(90, 20.5, 2, 'i'); // its door handle wheel
  g.box(84, 2, 88, 11, 'e'); // chimney
  g.box(83, 2, 89, 3, 'I');
  g.disc(58, 11, 4, 'e'); // steam dome
  g.box(54, 11, 62, 13, 'e');
  g.box(38, 9, 44, 13, 'I'); // sand dome
  g.box(70, 9, 72, 13, 'i'); // whistle and safety valves
  g.box(91, 14, 93, 17, '5'); // headlamp, dull
  // Cab.
  g.box(4, 8, 21, 31, 'e');
  for (let x = 3; x <= 22; x++) {
    g.set(x, 7 - Math.round(1.5 * Math.sin(((x - 3) / 19) * Math.PI)), 'I');
    g.set(x, 8, 'I');
  }
  g.box(8, 12, 15, 18, 'n');
  g.box(11, 12, 11, 18, 'I');
  g.box(4, 22, 21, 22, 'i'); // the line of the number board
  // Running board, cylinders, buffer beam.
  g.box(22, 29, 90, 30, 'i');
  g.box(76, 31, 86, 37, 'I');
  g.box(76, 33, 86, 34, 'i');
  g.box(91, 30, 94, 34, 'm');
  g.box(95, 31, 95, 32, 'i');
  for (const cx of [28, 39, 50, 61, 72]) {
    g.disc(cx, 37.5, 5, 'I');
    g.disc(cx, 37.5, 3.5, 'm'); // wheel centres, dull red
    g.disc(cx, 37.5, 1, 'i');
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) g.set(cx + dx, 37.5 + dy, 'I');
  }
  g.box(28, 39, 72, 39, 'i'); // coupling rod
  g.line(61, 39, 80, 35, 'i'); // connecting rod to the crosshead
  g.box(8, 34, 16, 41, 'I'); // steps and ash pan
  g.outline('n');
  return g.rowsOut();
}

// Its tender: a water tank on three axles with the coal heaped at the front. 60x40.
function tender() {
  const g = grid(60, 40);
  g.box(3, 12, 56, 28, (x) => (x % 13 === 3 ? 'u' : 'e'));
  g.box(3, 12, 56, 13, 'I');
  for (let x = 30; x <= 55; x++) {
    const top = Math.round(11 - 4 * Math.sin(((x - 30) / 25) * Math.PI) - noise(x * 7, 1.5));
    for (let y = top; y <= 11; y++) g.set(x, y, noise(x * 3 + y * 5, 1) < 0.35 ? 'u' : 'd'); // coal
  }
  g.box(2, 29, 57, 31, 'I');
  g.box(0, 29, 1, 31, 'i');
  g.box(58, 29, 59, 31, 'i');
  for (const cx of [11, 30, 49]) {
    g.disc(cx, 34.5, 4.5, 'I');
    g.disc(cx, 34.5, 3, 'm');
    g.disc(cx, 34.5, 1, 'i');
    g.box(cx - 4, 30, cx + 4, 31, 'e');
  }
  g.outline('d');
  return g.rowsOut();
}

// An open wagon with a load under a tarpaulin (tanks came up to Kursk like this). 68x24.
function flatWagon() {
  const g = grid(68, 24);
  g.box(2, 15, 65, 17, 'I');
  g.box(4, 9, 63, 14, (x) => (x % 3 === 0 ? 'D' : 'E')); // low drop sides
  for (let x = 12; x <= 56; x++) {
    const top = Math.round(8 - 6 * Math.sin(((x - 12) / 44) * Math.PI) ** 0.4 - (x > 40 && x < 50 ? 2 : 0));
    g.box(x, top, x, 9, noise(x * 5, 1) < 0.3 ? 'q' : 'K');
  }
  g.box(0, 15, 1, 16, 'i');
  g.box(66, 15, 67, 16, 'i');
  for (const cx of [15, 52]) {
    g.disc(cx, 19.5, 3, 'I');
    g.disc(cx, 19.5, 1, 'i');
    g.box(cx - 3, 16, cx + 3, 17, 'e');
  }
  g.outline();
  return g.rowsOut();
}

export const KURSK_EXTRA = {
  'para-germany-stream': paraStream('K', 'q', 'V', 'q'),
  'para-germany': paraOpen(true, 'K', 'q', 'V', 'q'),
  'para-germany-landed': paraLanded('K', 'q', 'V', 'q'),
  'drop-container': dropContainer(),
  'para-ussr-stream': paraStream('4', 'Y', 'p', 'K'),
  'para-ussr': paraOpen(false, '4', 'Y', 'p', 'K'),
  'para-ussr-landed': paraLanded('4', 'Y', 'p', 'K'),
  locomotive: locomotive(),
  tender: tender(),
  'flat-wagon': flatWagon(),
};

// What is in the game (tools/make-sprites.mjs writes these to assets/sprites/; data/ground.json names them):
// the scenery, each building's wreck as <name>-ruin, the heavy flak mounts without their barrels, and each
// nation's depot and radar. The rest of this file is still drafts.
const pick = (set, names) => Object.fromEntries(names.map((n) => [n, set[n]]));
export const GAME_SPRITES = {
  ...pick(KURSK, ['izba', 'izba-white', 'izba-burnt', 'shed', 'cowshed', 'church', 'windmill', 'well', 'haystack', 'wattle', 'station',
    'water-tower', 'telegraph-pole', 'apple-tree', 'birch', 'sunflowers', 'stooks', 'dugout', 'hedgehog', 'town-house', 'trade-row',
    'soviet', 'elevator', 'town-ruin']),
  ...pick(KURSK_RUINS, ['izba-ruin', 'izba-white-ruin', 'shed-ruin', 'cowshed-ruin', 'church-ruin', 'windmill-ruin', 'station-ruin',
    'water-tower-ruin', 'trade-row-ruin', 'soviet-ruin', 'elevator-ruin', 'depot-germany-ruin', 'depot-ussr-ruin']),
  ...pick(KURSK_MILITARY, ['depot-germany', 'depot-ussr', 'radar-germany', 'radar-ussr', 'windsock', 'stores', 'wire', 'mine-sign']),
  'flak-88': flak88(false),
  'flak-85': flak85(false),
};

// --- The transports of the paratroop drops ------------------------------------------------------------------
// Side views at the planes' scale (4 pixels a world unit: 10 pixels a metre), nose to the right, in the paint
// key colours (B base, S its shade, W the wing, U the underside), so a nation's paint goes on like any plane's.
// Drawn from the types' published dimensions as a first look; the game's planes are 3D models traced over a
// 3-view in the Outline Lab, and these two get that treatment before they fly.

// A fuselage between two curves: top(d) and bottom(d) give the rows at d pixels back from the nose (x = nose - d).
// rib: every second row in the shade (the Ju 52's corrugated skin); belly: rows from the bottom in the underside colour.
function hullOf(g, nose, d0, d1, top, bottom, { rib = false, belly = 3 } = {}) {
  for (let d = d0; d <= d1; d++) {
    const t = Math.round(top(d));
    const b = Math.round(bottom(d));
    for (let y = t; y <= b; y++) g.set(nose - d, y, y > b - belly ? 'U' : rib && y % 2 === 0 ? 'S' : y < t + 2 ? 'B' : y > (t + b) / 2 ? 'S' : 'B');
  }
}
const lerp = (a, b, k) => a + (b - a) * Math.min(1, Math.max(0, k));
// The near wing as a side view really shows it: the wing rises towards its tip (dihedral), so from the side its
// underside is seen as a band from the root chord (d from le0 to te0 at row y0) up to the tip chord (le1 to te1 at
// row y1, shorter and further back). Pale underside, a darker trailing third, the leading edge and tip in the wing colour.
function wingBand(g, nose, [le0, te0, y0], [le1, te1, y1]) {
  for (let y = y1; y <= y0; y++) {
    const k = (y0 - y) / (y0 - y1);
    const le = Math.round(lerp(le0, le1, k));
    const te = Math.round(lerp(te0, te1, k));
    for (let d = le; d <= te; d++) g.set(nose - d, y, d <= le + 1 || y === y1 ? 'W' : d > le + (te - le) * 0.68 ? '1' : 'U');
  }
}

// Junkers Ju 52/3m: 18.9 m long, the corrugated box fuselage, three radials (one in the nose, one on each
// wing, the wing engines toed out), the raised cockpit, seven square cabin windows, the thick low wing with
// the Junkers flap hung behind it, a broad square fin, fixed spatless undercarriage. 200x66; nose at x 194.
function ju52() {
  const g = grid(200, 66);
  const nose = 194;
  const cy = 26;
  const top = (d) => (d < 10 ? cy - 7 : d < 14 ? cy - 8 : d < 28 ? lerp(cy - 8, cy - 14, (d - 14) / 12) : d < 50 ? cy - 14 : d < 54 ? cy - 12 : lerp(cy - 12, cy - 6, (d - 54) / 126));
  const bottom = (d) => (d < 10 ? cy + 6 : d < 14 ? cy + 8 : d < 96 ? cy + 9 : lerp(cy + 9, cy, (d - 96) / 86));
  // Fin and rudder: square-cut, the rudder with its horn; the tailplane edge on, braced.
  for (let d = 158; d <= 190; d++) {
    const t = d < 168 ? lerp(cy - 7, cy - 32, (d - 158) / 10) : d < 184 ? cy - 33 : lerp(cy - 33, cy - 24, (d - 184) / 6);
    const b = d < 182 ? top(Math.min(d, 180)) : lerp(cy - 6, cy + 3, (d - 182) / 8);
    for (let y = Math.round(t); y <= Math.round(b); y++) g.set(nose - d, y, d > 177 ? 'S' : y % 2 === 0 ? 'S' : 'B');
  }
  hullOf(g, nose, 10, 182, top, bottom, { rib: true });
  g.box(nose - 188, cy - 9, nose - 163, cy - 8, 'W'); // tailplane
  g.line(nose - 170, cy - 7, nose - 166, cy - 1, 'e'); // its strut
  // Nose engine: cowl ring and the cylinders showing behind it.
  g.box(nose - 9, cy - 7, nose - 2, cy + 6, 'e');
  g.box(nose - 7, cy - 8, nose - 3, cy + 7, 'I');
  g.box(nose - 1, cy - 2, nose, cy + 1, 'I'); // hub
  // Cockpit glazing and the cabin windows.
  for (let d = 15; d <= 27; d++) g.box(nose - d, Math.round(top(d)) + 1, nose - d, cy - 8, d % 5 === 0 ? 'e' : d < 20 ? 'c' : 'C');
  for (let i = 0; i < 7; i++) g.box(nose - (58 + i * 11) - 5, cy - 9, nose - (58 + i * 11), cy - 5, 'C');
  g.box(nose - 141, cy - 9, nose - 133, cy + 5, 'S'); // the door
  g.box(nose - 141, cy - 9, nose - 141, cy + 5, 'e');
  g.box(nose - 133, cy - 9, nose - 133, cy + 5, 'e');
  // The wing root (thick, low) and the flap behind and below it.
  wingBand(g, nose, [38, 92, cy + 12], [60, 88, cy - 3]);
  for (let y = cy - 1; y <= cy + 13; y++) g.box(nose - Math.round(lerp(100, 91, (cy + 13 - y) / 14)), y, nose - Math.round(lerp(96, 88, (cy + 13 - y) / 14)), y, '1'); // the flap, clear of the wing
  // The near wing engine: cowl ring ahead of the wing, its nacelle fairing back into it.
  for (let d = 30; d <= 50; d++) g.box(nose - d, Math.round(lerp(cy - 1, cy + 6, (d - 30) / 20)), nose - d, Math.round(lerp(cy + 13, cy + 12, (d - 30) / 20)), d < 40 ? 'B' : 'W');
  g.box(nose - 31, cy - 1, nose - 28, cy + 13, 'e'); // the ring cowl, open at the front
  g.box(nose - 30, cy - 2, nose - 29, cy + 14, 'I');
  g.box(nose - 34, cy + 1, nose - 33, cy + 11, 'S');
  g.box(nose - 27, cy + 4, nose - 25, cy + 7, 'I');
  // Fixed undercarriage: the leg and its bracing down to the wheel; tail wheel.
  g.line(nose - 46, cy + 12, nose - 48, cy + 27, 'I');
  g.line(nose - 62, cy + 12, nose - 50, cy + 28, 'e');
  g.disc(nose - 48, cy + 31, 6, 'e');
  g.disc(nose - 48, cy + 31, 2, 'I');
  g.line(nose - 172, cy + 3, nose - 174, cy + 8, 'I');
  g.disc(nose - 174, cy + 10, 2, 'e');
  g.outline('Cc');
  return g.rowsOut();
}

// Lisunov Li-2 (the licence-built DC-3, with the dorsal turret of the wartime ones): 19.65 m long, the round
// stressed-skin fuselage, the tall curved fin with its fillet, two radials well ahead of the low wing, the
// main wheels half out of the nacelles when up, seven cabin windows and the wide freight door. 206x70; nose at x 200.
function li2() {
  const g = grid(206, 70);
  const nose = 200;
  const cy = 36;
  const r = (d) => 12.5 * Math.sqrt(Math.min(1, d / 30));
  const top = (d) => (d < 112 ? cy - 1 - r(d) : lerp(cy - 13.5, cy - 7, (d - 112) / 80));
  const bottom = (d) => (d < 100 ? cy + 1 + r(d) * 0.9 : lerp(cy + 12, cy - 2, (d - 100) / 94));
  // Fin, fillet and rudder.
  for (let d = 140; d <= 198; d++) {
    const t = d < 166 ? lerp(top(d), cy - 22, ((d - 140) / 26) ** 2) : d < 182 ? lerp(cy - 22, cy - 44, Math.sin(((d - 166) / 16) * Math.PI * 0.5)) : d < 190 ? cy - 44 + ((d - 182) / 8) ** 2 * 3 : lerp(cy - 41, cy - 20, ((d - 190) / 8) ** 0.6);
    const b = d < 194 ? top(Math.min(d, 192)) : lerp(cy - 7, cy - 3, (d - 194) / 4);
    for (let y = Math.round(t); y <= Math.round(b); y++) g.set(nose - d, y, d > 184 ? 'S' : 'B');
  }
  hullOf(g, nose, 0, 194, top, bottom);
  g.box(nose - 196, cy - 10, nose - 168, cy - 9, 'W'); // tailplane
  // Cockpit windows, cabin windows, the freight door.
  g.box(nose - 22, cy - 10, nose - 18, cy - 6, 'C');
  g.box(nose - 16, cy - 9, nose - 13, cy - 6, 'c');
  for (let i = 0; i < 7; i++) g.box(nose - (48 + i * 11) - 4, cy - 7, nose - (48 + i * 11), cy - 4, 'C');
  g.box(nose - 138, cy - 9, nose - 124, cy + 6, 'S');
  for (const d of [124, 131, 138]) g.box(nose - d, cy - 9, nose - d, cy + 6, 'e');
  // The dorsal turret.
  g.disc(nose - 78, cy - 14, 3.5, 'C');
  g.line(nose - 81, cy - 16, nose - 88, cy - 18, 'e');
  // Wing root, then the near engine and its nacelle over it, the wheel showing under.
  wingBand(g, nose, [56, 112, cy + 13], [86, 110, cy]);
  for (let d = 38; d <= 78; d++) {
    const round = d < 42 ? 42 - d : 0; // the cowl's rounded lip
    g.box(nose - d, Math.round(d < 52 ? cy + 1 : lerp(cy + 1, cy + 10, (d - 52) / 26)) + round, nose - d, Math.round(d < 70 ? cy + 16 : lerp(cy + 16, cy + 13, (d - 70) / 8)) - round, d < 40 ? 'e' : d < 50 ? 'B' : d < 52 ? 'e' : 'W');
  }
  g.box(nose - 37, cy + 6, nose - 34, cy + 10, 'I'); // hub
  g.disc(nose - 64, cy + 17, 5, 'e');
  g.disc(nose - 64, cy + 17, 2, 'I');
  g.box(nose - 70, cy + 11, nose - 58, cy + 15, 'S'); // the nacelle covers its top half
  g.disc(nose - 186, cy - 1, 2, 'e'); // tail wheel
  g.outline('Cc');
  return g.rowsOut();
}

export const KURSK_PLANES = { ju52: ju52(), li2: li2() };

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
  // Drop the empty rows under it (a vehicle sprite keeps room below the ground line), so it stands on the sheet.
  let rows = h;
  while (rows > 1 && px.subarray((rows - 1) * w * 4, rows * w * 4).every((v, i) => i % 4 !== 3 || v === 0)) rows--;
  return { w, h: rows, px: px.subarray(0, rows * w * 4) };
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

// Lays rows of images on ground lines and writes the sheet, four times enlarged. track: an image that stands on rails.
function sheetOf(file, rows, onTrack = []) {
  const root = fileURLToPath(new URL('..', import.meta.url));
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
    let x = GAP;
    for (const s of r) {
      const railed = onTrack.includes(s);
      if (railed) for (let tx = x - 6; tx < x + s.w + 6; tx++) for (let ty = 0; ty < 5; ty++) sheet.set(COLOURS[KURSK.track[ty][((tx % 48) + 48) % 48]], ((ground - 2 + ty) * W + tx) * 4);
      const base = railed ? ground - 2 : ground;
      for (let sy = 0; sy < s.h; sy++)
        for (let sx = 0; sx < s.w; sx++) {
          const a = s.px[(sy * s.w + sx) * 4 + 3];
          if (a) sheet.set(s.px.subarray((sy * s.w + sx) * 4, (sy * s.w + sx) * 4 + 4), ((base - s.h + sy) * W + x + sx) * 4);
        }
      x += s.w + GAP;
    }
    top = ground + 8;
  });
  const Z = 4;
  const big = new Uint8Array(W * Z * H * Z * 4);
  for (let y = 0; y < H * Z; y++) for (let x = 0; x < W * Z; x++) big.set(sheet.subarray(((y / Z | 0) * W + (x / Z | 0)) * 4, ((y / Z | 0) * W + (x / Z | 0)) * 4 + 4), (y * W * Z + x) * 4);
  writeFileSync(`${root}notes/${file}`, encodePngRgba(W * Z, H * Z, big));
  console.log(`notes/${file} (${W * Z}x${H * Z})`);
}

function preview() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const game = (name) => readPng(`${root}assets/sprites/${name}.png`);
  const img = (set) => Object.fromEntries(Object.entries(set).map(([name, rows]) => [name, toImage(rows)]));
  const k = img(KURSK);
  const r = img(KURSK_RUINS);
  const f = img(KURSK_FIELD);
  const m = img(KURSK_MILITARY);
  sheetOf('kursk-assets-preview.png', [
    [game('building'), game('t34-76'), k.izba, k['izba-white'], k['izba-burnt'], k.shed, k.well, k.haystack, k.wattle],
    [k.cowshed, k.church, k.windmill, k['apple-tree'], k.birch, k.sunflowers, k.stooks],
    [k.station, k['water-tower'], k['telegraph-pole'], k.wagon, k.dugout, k.hedgehog],
    [k['town-house'], k['trade-row'], k.soviet, k.elevator, k['town-ruin']],
    [game('flak'), game('lightflak'), k['flak-88'], k['flak-85'], k['pak-40'], k['zis-3'], game('panzer4h'), k['gun-pit']],
  ], [k.wagon]);
  sheetOf('kursk-assets-preview-2.png', [
    [r['izba-ruin'], r['izba-white-ruin'], r['shed-ruin'], r['cowshed-ruin'], r['church-ruin'], r['windmill-ruin']],
    [r['station-ruin'], r['water-tower-ruin'], r['wagon-burnt'], r['trade-row-ruin'], r['soviet-ruin'], r['elevator-ruin']],
    [f.wheat, f['wheat-burning-1'], f['wheat-burning-2'], f['wheat-burning-3'], f.stubble, f['dust-1'], f['dust-2'], f['dust-3'], f['smoke-column']],
    [m['depot-germany'], r['depot-germany-ruin'], m['radar-germany'], m['hangar-germany'], m.windsock, m.stores],
    [m['depot-ussr'], r['depot-ussr-ruin'], m['radar-ussr'], m['hangar-ussr'], game('depot'), game('radar'), game('hangar')],
    [m['bunker-germany'], m['pak-nest'], m['trench-germany'], m.wire, m['mine-sign'], m.pillbox],
    [m.dzot, m['tank-dug-in'], m['zis-nest'], m['trench-ussr']],
  ], [r['wagon-burnt']]);
  // The transports in their own colours (the paint keys swapped as the game would): German dark green over pale
  // blue, Soviet green over light blue.
  const painted = (rows, paint) => {
    const im = toImage(rows);
    for (let i = 0; i < im.px.length; i += 4) {
      const key = Object.keys(paint).find((c) => PALETTE[c].every((v, n) => v === im.px[i + n]));
      if (key) im.px.set(paint[key], i);
    }
    return im;
  };
  sheetOf('kursk-assets-preview-4.png', [
    [painted(KURSK_PLANES.ju52, { B: [70, 78, 60, 255], S: [54, 60, 48, 255], W: [46, 52, 42, 255], U: [116, 134, 142, 255], 1: [92, 108, 116, 255] })],
    [painted(KURSK_PLANES.li2, { B: [66, 80, 52, 255], S: [50, 62, 42, 255], W: [44, 54, 36, 255], U: [124, 144, 158, 255], 1: [98, 116, 130, 255] })],
    [game('blenheim'), game('bf109g6')],
  ]);
  const e = img(KURSK_EXTRA);
  sheetOf('kursk-assets-preview-3.png', [
    [e['para-germany-stream'], e['para-germany'], e['para-germany-landed'], e['drop-container'], e['para-ussr-stream'], e['para-ussr'], e['para-ussr-landed'], game('opel-blitz')],
    [e['flat-wagon'], k.wagon, e.tender, e.locomotive],
    [game('panzer4h'), game('tiger'), game('t34-76'), game('su-152')],
  ], [e['flat-wagon'], k.wagon, e.tender, e.locomotive]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) preview();
