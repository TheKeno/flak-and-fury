// Loads PNG sprites, applies paint schemes and pre-renders crisp pixel rotations.
//
// Paint key colours (hand-drawn sprites must use these exact RGB values):
//   #ff00ff base   #c000c0 base shade   #800080 wing   #00ffff underside
//   #ffff00 nose   #ff0000 national marking
export const ROTATION_STEPS = 128; // ~2.8 degrees per frame, so the nose shows where the guns point

const KEYS = {
  '255,0,255': 'base',
  '192,0,192': 'shade',
  '128,0,128': 'wing',
  '0,255,255': 'under',
  '255,255,0': 'nose',
  '255,0,0': 'marking',
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

export function paintSprite(img, paint) {
  const base = hexToRgb(paint.base);
  const colours = {
    base,
    shade: shadeRgb(base, 0.78),
    wing: shadeRgb(base, 0.62),
    under: hexToRgb(paint.under),
    nose: hexToRgb(paint.nose),
    marking: hexToRgb(paint.marking),
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

// Nearest-neighbour rotation around the pivot, so rotated sprites stay sharp pixel art.
// Returns ROTATION_STEPS frames; `flipped` mirrors the sprite vertically first (plane rolled over).
export function buildRotations(src, [pivotX, pivotY], flipped = false) {
  const sw = src.width;
  const sh = src.height;
  const srcData = src.getContext('2d').getImageData(0, 0, sw, sh).data;
  const radius = Math.ceil(
    Math.max(Math.hypot(pivotX, pivotY), Math.hypot(sw - pivotX, pivotY), Math.hypot(pivotX, sh - pivotY), Math.hypot(sw - pivotX, sh - pivotY)),
  ) + 1;
  const size = radius * 2 + 1;
  const frames = [];
  for (let step = 0; step < ROTATION_STEPS; step++) {
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
    frames.push(c);
  }
  return { frames, radius };
}

export function frameIndex(angle) {
  const t = angle / (Math.PI * 2);
  return ((Math.round(t * ROTATION_STEPS) % ROTATION_STEPS) + ROTATION_STEPS) % ROTATION_STEPS;
}

export function buildPlaneSprite(img, def, paint) {
  const painted = paintSprite(img, paint);
  return {
    upright: buildRotations(painted, def.pivot, false),
    inverted: buildRotations(painted, def.pivot, true),
  };
}
