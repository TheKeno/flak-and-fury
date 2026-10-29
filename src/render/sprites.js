// Loads PNG sprites, applies paint schemes and pre-renders crisp pixel rotations.
//
// Paint key colours (hand-drawn sprites must use these exact RGB values):
//   #ff00ff base   #c000c0 base shade   #800080 wing   #00ffff underside
//   #ffff00 nose   #ff0000 national marking   #00c0c0 underside shade   #c0c000 nose shade
//   #0080ff / #80ff00 optional marking, dark / light (the German fin swastika: black and white with
//   the historical-markings setting on, the base colour with it off)
export const ROTATION_STEPS = 128; // ~2.8 degrees per frame, so the nose shows where the guns point

const KEYS = {
  '255,0,255': 'base',
  '192,0,192': 'shade',
  '128,0,128': 'wing',
  '0,255,255': 'under',
  '0,192,192': 'underShade',
  '192,192,0': 'noseShade',
  '255,255,0': 'nose',
  '255,0,0': 'marking',
  '0,128,255': 'optDark',
  '128,255,0': 'optLight',
};

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const shadeRgb = ([r, g, b], f) => [r * f, g * f, b * f].map((v) => Math.round(Math.min(255, v)));

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// opts.swastika: draw the optional marking (see KEYS) instead of hiding it in the base colour.
export function paintSprite(img, paint, opts = {}) {
  const base = hexToRgb(paint.base);
  const colours = {
    base,
    shade: shadeRgb(base, 0.78),
    wing: shadeRgb(base, 0.62),
    under: hexToRgb(paint.under),
    underShade: shadeRgb(hexToRgb(paint.under), 0.75),
    nose: hexToRgb(paint.nose),
    noseShade: shadeRgb(hexToRgb(paint.nose), 0.75),
    marking: hexToRgb(paint.marking),
    optDark: opts.swastika ? [28, 26, 24] : base,
    optLight: opts.swastika ? [236, 236, 226] : base,
  };
  const c = canvasOf(img.width, img.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const key = KEYS[`${px[i]},${px[i + 1]},${px[i + 2]}`];
    if (key) [px[i], px[i + 1], px[i + 2]] = colours[key];
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// Nearest-neighbour rotation of one image (pixel data srcData, sw x sh) around the pivot by rotation
// step `step`, so rotated sprites stay sharp pixel art. `flipped` mirrors it vertically first (plane
// rolled over). Returns a (radius * 2 + 1) square canvas with the pivot at its centre.
function rotateOne(srcData, sw, sh, [pivotX, pivotY], step, flipped, radius) {
  const size = radius * 2 + 1;
  const a = (step / ROTATION_STEPS) * Math.PI * 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(size, size);
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      const dx = ox - radius;
      const dy = oy - radius;
      let ry = dx * sin + dy * cos;
      if (flipped) ry = -ry;
      const sx = Math.floor(pivotX + dx * cos - dy * sin + 0.5);
      const sy = Math.floor(pivotY + ry + 0.5);
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      const si = (sy * sw + sx) * 4;
      if (srcData[si + 3] === 0) continue;
      const oi = (oy * size + ox) * 4;
      out.data[oi] = srcData[si];
      out.data[oi + 1] = srcData[si + 1];
      out.data[oi + 2] = srcData[si + 2];
      out.data[oi + 3] = srcData[si + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

const reach = (sw, sh, [px, py]) => Math.ceil(Math.max(Math.hypot(px, py), Math.hypot(sw - px, py), Math.hypot(px, sh - py), Math.hypot(sw - px, sh - py))) + 1;

// All ROTATION_STEPS rotations of a sprite, built up front (the plane's normal flight sprite).
export function buildRotations(src, pivot, flipped = false) {
  const data = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
  const radius = reach(src.width, src.height, pivot);
  const frames = [];
  for (let step = 0; step < ROTATION_STEPS; step++) frames.push(rotateOne(data, src.width, src.height, pivot, step, flipped, radius));
  return { frames, radius };
}

export function frameIndex(angle) {
  const t = angle / (Math.PI * 2);
  return ((Math.round(t * ROTATION_STEPS) % ROTATION_STEPS) + ROTATION_STEPS) % ROTATION_STEPS;
}

export function buildPlaneSprite(img, def, paint, opts) {
  const painted = paintSprite(img, paint, opts);
  return {
    upright: buildRotations(painted, def.pivot, false),
    inverted: buildRotations(painted, def.pivot, true),
  };
}

// The transient frames from a plane's -frames.png sheet (roll, ground turn, ground loop; layout in its
// .json). They show for a moment at a time, so they are rotated on demand and cached, not pre-built.
// frame(row, index, angle, mirror) returns { canvas, radius }: the anchor sits at the canvas centre.
export function buildPlaneFrames(sheetImg, meta, paint, opts) {
  const sheet = paintSprite(sheetImg, paint, opts);
  const data = sheet.getContext('2d').getImageData(0, 0, sheet.width, sheet.height).data;
  const [cw, ch] = meta.cell;
  const cache = new Map();
  const cells = new Map();
  // One cell's pixels, mirrored left-right about the anchor when facing the other way.
  const cell = (row, index, mirror) => {
    const key = `${row}|${index}|${mirror}`;
    if (!cells.has(key)) {
      const r = meta.rows[row];
      const px = new Uint8ClampedArray(cw * ch * 4);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const sx = mirror ? 2 * r.anchor[0] - x : x;
          if (sx < 0 || sx >= cw) continue;
          const si = ((r.row * ch + y) * sheet.width + index * cw + sx) * 4;
          px.set(data.subarray(si, si + 4), (y * cw + x) * 4);
        }
      }
      cells.set(key, px);
    }
    return cells.get(key);
  };
  return {
    meta,
    frame(row, index, angle, mirror = false) {
      const step = frameIndex(angle);
      const key = `${row}|${index}|${step}|${mirror}`;
      let f = cache.get(key);
      if (!f) {
        if (cache.size > 600) cache.clear();
        const anchor = meta.rows[row].anchor;
        const radius = reach(cw, ch, anchor);
        f = { canvas: rotateOne(cell(row, index, mirror), cw, ch, anchor, step, false, radius), radius };
        cache.set(key, f);
      }
      return f;
    },
  };
}
