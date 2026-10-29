import { createRng, lerp } from './math.js';

const SPACING = 140; // px between large terrain control points
const DETAIL_SPACING = 36;
const AIRFIELD_BLEND = 90;
const RIVER_BLEND = 60;
const RIVER_DEPTH = 16; // channel bed below the banks
const RIVER_SIDE = 6; // width of the steep channel sides
const RIVER_WATER = 6; // water surface below the banks

export const DEFAULT_PADS = { margin: 4, blend: 40 };

// Level ground for each structure placed on the map (guns, tents, buildings...: anything drawn with a
// sprite), so none stands tilted on a hillside. Squads and the bridge stand on the ground as it is.
export function structurePads(map, groundDefs, cfg = DEFAULT_PADS) {
  return (map.ground ?? [])
    .filter((o) => groundDefs[o.type]?.sprite)
    .map((o) => ({ x: o.x, half: groundDefs[o.type].width / 2, margin: cfg.margin, blend: cfg.blend }));
}

const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(rng, width, spacing) {
  const pts = Array.from({ length: Math.ceil(width / spacing) + 2 }, () => rng.next());
  return (x) => {
    const i = Math.floor(x / spacing);
    return lerp(pts[i], pts[i + 1], smooth(x / spacing - i));
  };
}

// Builds a height field (one height per world pixel column). y is up; 0 is the bottom of the world.
// pads: level ground under structures (see structurePads).
export function buildTerrain(map, pads = []) {
  const { width, seed } = map;
  const { base, amplitude } = map.terrain;
  const rng = createRng(seed);
  const big = valueNoise(rng, width, SPACING);
  const detail = valueNoise(rng, width, DETAIL_SPACING);

  const heights = new Float32Array(width + 1);
  for (let x = 0; x <= width; x++) {
    heights[x] = base + amplitude * (0.8 * big(x) + 0.2 * detail(x));
  }

  // Flatten airfields, blending smoothly into the surrounding hills.
  for (const af of map.airfields) {
    let sum = 0;
    for (let x = af.x; x < af.x + af.width; x++) sum += heights[x];
    const level = Math.round(sum / af.width);
    af.height = level;
    for (let x = Math.max(0, af.x - AIRFIELD_BLEND); x <= Math.min(width, af.x + af.width + AIRFIELD_BLEND); x++) {
      let t = 1;
      if (x < af.x) t = smooth((x - (af.x - AIRFIELD_BLEND)) / AIRFIELD_BLEND);
      else if (x > af.x + af.width) t = smooth((af.x + af.width + AIRFIELD_BLEND - x) / AIRFIELD_BLEND);
      heights[x] = lerp(heights[x], level, t);
    }
  }

  // Structure pads: level at the average height under the object, a margin wider on each side, then
  // eased into the hill. On a steep slope that cuts in on the high side and builds up the low side,
  // like an emplacement dug into a hillside. Where neighbours' blends overlap, the nearer pad wins
  // smoothly (weighted by closeness), so each pad stays flat and the ground between them has no step.
  const weight = new Float32Array(width + 1);
  const levelSum = new Float32Array(width + 1);
  const reach = new Float32Array(width + 1);
  for (const pad of pads) {
    const left = Math.round(pad.x - pad.half - pad.margin);
    const right = Math.round(pad.x + pad.half + pad.margin);
    let sum = 0;
    let n = 0;
    for (let x = Math.max(0, Math.round(pad.x - pad.half)); x <= Math.min(width, Math.round(pad.x + pad.half)); x++, n++) sum += heights[x];
    if (!n) continue;
    const level = sum / n;
    const blend = Math.max(1, pad.blend);
    for (let x = Math.max(0, left - blend); x <= Math.min(width, right + blend); x++) {
      let t = 1;
      if (x < left) t = smooth((x - (left - blend)) / blend);
      else if (x > right) t = smooth((right + blend - x) / blend);
      const w = t / (1 - t + 1e-6);
      weight[x] += w;
      levelSum[x] += w * level;
      reach[x] = Math.max(reach[x], t);
    }
  }
  for (let x = 0; x <= width; x++) if (weight[x] > 0) heights[x] = lerp(heights[x], levelSum[x] / weight[x], reach[x]);

  // Rivers: level banks blended into the hills (like airfields), with a steep-sided channel between
  // them. river.bank is the height of both banks (and of a bridge's deck); river.water the surface.
  for (const river of map.rivers ?? []) {
    const left = river.x;
    const right = river.x + river.width;
    const bank = Math.round((heights[Math.max(0, left - 10)] + heights[Math.min(width, right + 10)]) / 2);
    river.bank = bank;
    river.water = bank - RIVER_WATER;
    for (let x = Math.max(0, left - RIVER_BLEND); x <= Math.min(width, right + RIVER_BLEND); x++) {
      let t = 1;
      if (x < left) t = smooth((x - (left - RIVER_BLEND)) / RIVER_BLEND);
      else if (x > right) t = smooth((right + RIVER_BLEND - x) / RIVER_BLEND);
      heights[x] = lerp(heights[x], bank, t);
      const inside = Math.min(x - left, right - x); // distance in from the nearer bank
      if (inside > 0) heights[x] = bank - RIVER_DEPTH * smooth(Math.min(1, inside / RIVER_SIDE));
    }
  }

  const heightAt = (x) => {
    if (x <= 0) return heights[0];
    if (x >= width) return heights[width];
    const i = Math.floor(x);
    return lerp(heights[i], heights[i + 1], x - i);
  };
  const slopeAngle = (x) => Math.atan2(heightAt(x + 3) - heightAt(x - 3), 6);

  // Destructible ground: explosions dig bowl-shaped craters and scorch the earth around them.
  const scorch = new Uint8Array(width + 1);
  const crater = (cx, radius, depth) => {
    for (let x = Math.max(0, Math.floor(cx - radius * 1.6)); x <= Math.min(width, Math.ceil(cx + radius * 1.6)); x++) {
      const d = Math.abs(x - cx) / radius;
      if (d < 1) heights[x] = Math.max(4, heights[x] - depth * (1 - d * d));
      else heights[x] += depth * 0.25 * Math.max(0, 1 - (d - 1) / 0.6); // thrown-up rim
      scorch[x] = Math.min(255, scorch[x] + Math.round(200 * Math.max(0, 1 - d / 1.6)));
    }
  };

  return { width, heights, scorch, heightAt, slopeAngle, crater };
}
