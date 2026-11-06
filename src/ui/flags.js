// Tiny pixel-art national flags for the hangar list (15 x 10 pixels, muted for the grim look).
// Drawn with rectangles so there are no image files; Germany gets the plain black-white-red tricolour
// (no swastika flag, whatever the markings setting says).
const W = 15;
const H = 10;

const stripes = (g, cols, horizontal = true) => {
  const n = cols.length;
  cols.forEach((c, i) => {
    g.fillStyle = c;
    if (horizontal) g.fillRect(0, Math.floor((i * H) / n), W, Math.ceil(H / n));
    else g.fillRect(Math.floor((i * W) / n), 0, Math.ceil(W / n), H);
  });
};
const rect = (g, c, x, y, w, h) => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};

const DRAW = {
  uk(g) {
    rect(g, '#2a3a6a', 0, 0, W, H);
    // diagonals (white then red), then the white and red crosses
    g.fillStyle = '#b8b4a4';
    for (let i = 0; i < W; i++) {
      const y = Math.round((i * (H - 1)) / (W - 1));
      g.fillRect(i, y, 1, 1);
      g.fillRect(i, H - 1 - y, 1, 1);
    }
    rect(g, '#b8b4a4', 6, 0, 3, H);
    rect(g, '#b8b4a4', 0, 3, W, 4);
    rect(g, '#8a2a2a', 7, 0, 1, H);
    rect(g, '#8a2a2a', 0, 4, W, 2);
  },
  usa(g) {
    stripes(g, ['#8a2a2a', '#b8b4a4', '#8a2a2a', '#b8b4a4', '#8a2a2a', '#b8b4a4', '#8a2a2a'], true);
    rect(g, '#2a3a6a', 0, 0, 7, 5);
    g.fillStyle = '#b8b4a4';
    for (let y = 1; y < 5; y += 2) for (let x = 1; x < 7; x += 2) g.fillRect(x, y, 1, 1);
  },
  germany: (g) => stripes(g, ['#1e1e1e', '#b8b4a4', '#8a2a2a'], true),
  japan(g) {
    rect(g, '#b8b4a4', 0, 0, W, H);
    rect(g, '#9a2a2a', 5, 2, 5, 6);
    rect(g, '#9a2a2a', 4, 3, 7, 4);
  },
  finland(g) {
    rect(g, '#b8b4a4', 0, 0, W, H);
    rect(g, '#2d4f8a', 4, 0, 3, H);
    rect(g, '#2d4f8a', 0, 3, W, 3);
  },
  ussr(g) {
    rect(g, '#8a2a2a', 0, 0, W, H);
    rect(g, '#c0a040', 2, 2, 3, 1); // hammer and sickle, much simplified
    rect(g, '#c0a040', 3, 3, 1, 2);
    rect(g, '#c0a040', 2, 5, 3, 1);
  },
};

const cache = new Map();
// A canvas for the nation's flag (a new element each time; null if unknown).
export function flagCanvas(nation) {
  const draw = DRAW[nation];
  if (!draw) return null;
  if (!cache.has(nation)) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    draw(c.getContext('2d'));
    cache.set(nation, c);
  }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  out.getContext('2d').drawImage(cache.get(nation), 0, 0);
  return out;
}
