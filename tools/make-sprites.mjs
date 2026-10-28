// Generates the starter pixel-art PNGs in assets/sprites/.
// Run: node tools/make-sprites.mjs
// Sprites are drawn at 2 pixels per world unit (the game's render scale).
// Once someone redraws a sprite by hand, remove it from SPRITES so it isn't overwritten.
//
// Paint key colours: the game swaps these for the player's paint scheme at load time,
// so hand-drawn sprites must use the same keys (see src/render/sprites.js).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PALETTE = {
  '.': [0, 0, 0, 0],
  o: [28, 26, 24, 255], // outline
  B: [255, 0, 255, 255], // KEY paint: base
  S: [192, 0, 192, 255], // KEY paint: base shade
  U: [0, 255, 255, 255], // KEY paint: underside
  N: [255, 255, 0, 255], // KEY paint: nose / spinner
  M: [255, 0, 0, 255], // KEY paint: national marking
  W: [128, 0, 128, 255], // KEY paint: wing (darker base)
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
  y: [200, 190, 164, 255], // plaster wall
  Y: [164, 154, 130, 255], // plaster shade
  f: [146, 68, 50, 255], // roof tiles
  F: [108, 50, 38, 255], // roof tile shade
  n: [44, 56, 64, 255], // dark window glass
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

// Single-engine fighter, side view, nose to the right. 48x18; pivot (24, 10).
function fighter() {
  const g = grid(48, 18);
  // Tail fin (drawn first, the fuselage overlaps its base).
  for (let y = 0; y <= 8; y++) g.span(y, 1, 4 + Math.round(y * 0.9), 'B');
  // Fuselage: top band in base colour, shaded flank, light underside.
  g.rows({ 7: [9, 40], 8: [1, 44], 9: [0, 45], 10: [0, 46], 11: [0, 46], 12: [2, 45], 13: [6, 42] }, (y) =>
    y <= 9 ? 'B' : y <= 11 ? 'S' : 'U',
  );
  // Tailplane.
  g.rows({ 10: [0, 10], 11: [0, 9] }, 'W');
  // Wing root seen edge-on beneath the fuselage.
  g.rows({ 13: [17, 38], 14: [18, 37], 15: [21, 33] }, 'W');
  // Panel lines.
  for (const x of [15, 31]) for (let y = 8; y <= 11; y++) g.set(x, y, 'S');
  // National marking.
  g.disc(19, 10.5, 2.4, 'M');
  // Canopy with pilot.
  g.rows({ 2: [24, 29], 3: [22, 31], 4: [21, 32], 5: [20, 33], 6: [20, 33] }, 'C');
  g.span(3, 24, 27, 'c');
  g.span(4, 22, 23, 'c');
  g.rows({ 5: [26, 27], 6: [25, 28] }, 'p');
  g.set(27, 5, 'P');
  // Exhaust stacks along the engine cowling.
  for (const x of [34, 37, 40]) {
    g.set(x, 9, 'e');
    g.set(x + 1, 9, 'e');
  }
  // Spinner.
  g.rows({ 8: [44, 45], 9: [44, 46], 10: [44, 47], 11: [44, 47], 12: [44, 45] }, 'N');
  g.outline();
  return g.rowsOut();
}

// Messerschmitt Bf 109, side view, nose to the right. 48x18; pivot (24, 10).
// Long nose with pointed spinner, angular framed canopy, rounded fin, chin oil cooler, Balkenkreuz.
function bf109() {
  const g = grid(48, 18);
  // Rounded fin with the rudder hinge line.
  g.rows({ 1: [3, 6], 2: [2, 7], 3: [1, 8], 4: [1, 8], 5: [1, 9], 6: [1, 9] }, 'B');
  for (let y = 2; y <= 7; y++) g.set(6, y, 'S');
  // Slim fuselage tapering hard to the tail.
  g.rows({ 6: [22, 34], 7: [8, 44], 8: [2, 45], 9: [1, 46], 10: [1, 47], 11: [2, 46], 12: [6, 44], 13: [14, 40] }, (y) =>
    y <= 9 ? 'B' : y <= 11 ? 'S' : 'U',
  );
  // Tailplane, set high on the fin.
  g.rows({ 7: [0, 12], 8: [0, 11] }, 'W');
  // Wing root and the radiator bath under it.
  g.rows({ 13: [18, 34], 14: [19, 33], 15: [22, 30] }, 'W');
  g.span(15, 24, 28, 'S');
  // Chin oil cooler with its dark intake.
  g.rows({ 13: [37, 42], 14: [38, 42] }, 'U');
  g.set(42, 13, 'e');
  g.set(42, 14, 'e');
  // Panel lines: cockpit rear and firewall.
  for (let y = 8; y <= 11; y++) g.set(20, y, 'S');
  for (let y = 7; y <= 11; y++) g.set(34, y, 'S');
  // Supercharger intake on the cowling side.
  g.span(8, 32, 33, 'e');
  // Exhaust stacks.
  for (const x of [35, 38, 41]) g.span(9, x, x + 1, 'e');
  // Angular canopy, framed, with the pilot.
  g.rows({ 3: [25, 30], 4: [24, 31], 5: [23, 32], 6: [23, 33] }, 'C');
  g.span(4, 25, 26, 'c');
  g.rows({ 5: [25, 26], 6: [24, 27] }, 'p');
  g.set(26, 5, 'P');
  for (const x of [28, 31]) for (let y = 3; y <= 6; y++) g.set(x, y, 'o');
  // Pointed spinner.
  g.rows({ 8: [45, 45], 9: [45, 46], 10: [45, 47], 11: [45, 46] }, 'N');
  // Balkenkreuz: black cross with a white border.
  g.rows({ 8: [15, 17], 9: [14, 18], 10: [14, 18], 11: [14, 18], 12: [15, 17] }, 'x');
  g.rows({ 9: [16, 16], 10: [15, 17], 11: [16, 16] }, 'M');
  g.outline();
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

const SPRITES = {
  fighter: fighter(),
  bf109: bf109(),
  bomb: bomb(),
  hangar: hangar(),
  flak: flak(),
  mgnest: mgnest(),
  tent: tent(),
  tower: tower(),
  building: building(),
  radar: radar(),
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

const outDir = new URL('../assets/sprites/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const [name, rows] of Object.entries(SPRITES)) {
  writeFileSync(new URL(`${name}.png`, outDir), encodePng(rows));
  console.log(`wrote assets/sprites/${name}.png`);
  if (process.argv.includes('--print')) console.log(rows.join('\n'));
}
