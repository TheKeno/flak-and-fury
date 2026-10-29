import { createRng, lerp } from './math.js';

const SPACING = 140; // px between large terrain control points
const DETAIL_SPACING = 36;
const AIRFIELD_BLEND = 90;
const RIVER_BLEND = 60;
const RIVER_DEPTH = 16; // channel bed below the banks
const RIVER_SIDE = 6; // width of the steep channel sides
const RIVER_WATER = 6; // water surface below the banks

export const DEFAULT_PADS = { margin: 4, blend: 40 };

// How the map's zones shape the ground. open, field, village, wood, ridge: share of the hills' ups and
// downs kept (around the zone's own average height; open is ground in no zone). fieldTilt: steepest
// gentle slope across a field (rise per unit); fieldSwell: height of a field's long, low roll.
// blend: distance over which one kind of ground eases into the next.
export const DEFAULT_ZONES = { open: 0.75, field: 0.05, village: 0.05, wood: 0.5, ridge: 0.85, fieldTilt: 0.025, fieldSwell: 3, blend: 120 };

// Level ground for each structure placed on the map (guns, tents, buildings...: anything drawn with a
// sprite), so none stands tilted on a hillside. Squads and the bridge stand on the ground as it is.
export function structurePads(map, groundDefs, cfg = DEFAULT_PADS) {
  return (map.ground ?? [])
    .filter((o) => groundDefs[o.type]?.sprite)
    .map((o) => ({ x: o.x, half: groundDefs[o.type].width / 2, margin: cfg.margin, blend: cfg.blend }));
}

const smooth = (t) => t * t * (3 - 2 * t);

// Open country keeps a share of the noise hills; each zone eases in its own kind of ground across its
// edges (so neighbouring zones crossfade). Fields are nearly flat with a gentle tilt and a long low
// roll, each one different (from the map seed and where it lies).
function shapeZones(map, heights, cfg) {
  const { width, seed } = map;
  const { base, amplitude } = map.terrain;
  const raw = heights.slice();
  const mid = base + amplitude * 0.5;
  for (let x = 0; x <= width; x++) heights[x] = mid + (raw[x] - mid) * cfg.open;
  // Each zone's weight ramps from 0 to 1 across its edges (centred on the edge); where zones meet they
  // share the ramp, so one kind of ground eases straight into the next without open hills between.
  const half = Math.max(1, cfg.blend) / 2;
  const weight = new Float32Array(width + 1);
  const sum = new Float32Array(width + 1);
  for (const z of map.zones ?? []) {
    const a = z.x;
    const b = z.x + z.width;
    let total = 0;
    for (let x = Math.max(0, a); x <= Math.min(width, b); x++) total += raw[x];
    const mean = total / Math.max(1, Math.min(width, b) - Math.max(0, a) + 1);
    const keep = cfg[z.type] ?? cfg.open;
    const rng = createRng((seed ^ Math.imul(a + 1, 0x9e3779b1)) >>> 0);
    const tilt = z.type === 'field' ? (rng.next() * 2 - 1) * cfg.fieldTilt : 0;
    const swell = z.type === 'field' ? (rng.next() < 0.5 ? -1 : 1) * cfg.fieldSwell : 0;
    for (let x = Math.max(0, Math.floor(a - half)); x <= Math.min(width, Math.ceil(b + half)); x++) {
      const w = smooth(clamp01(Math.min((x - (a - half)) / (2 * half), (b + half - x) / (2 * half))));
      const t = clamp01((x - a) / Math.max(1, b - a));
      const shape = mean + (raw[x] - mean) * keep + tilt * (x - (a + b) / 2) + swell * Math.sin(Math.PI * t);
      weight[x] += w;
      sum[x] += w * shape;
    }
  }
  for (let x = 0; x <= width; x++) if (weight[x] > 0) heights[x] = lerp(heights[x], sum[x] / weight[x], Math.min(1, weight[x]));
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function valueNoise(rng, width, spacing) {
  const pts = Array.from({ length: Math.ceil(width / spacing) + 2 }, () => rng.next());
  return (x) => {
    const i = Math.floor(x / spacing);
    return lerp(pts[i], pts[i + 1], smooth(x / spacing - i));
  };
}

// Builds a height field (one height per world pixel column). y is up; 0 is the bottom of the world.
// pads: level ground under structures (see structurePads); zones: how the map's zones shape the ground.
export function buildTerrain(map, pads = [], zones = DEFAULT_ZONES) {
  const { width, seed } = map;
  const { base, amplitude } = map.terrain;
  const rng = createRng(seed);
  const big = valueNoise(rng, width, SPACING);
  const detail = valueNoise(rng, width, DETAIL_SPACING);

  const heights = new Float32Array(width + 1);
  for (let x = 0; x <= width; x++) {
    heights[x] = base + amplitude * (0.8 * big(x) + 0.2 * detail(x));
  }
  shapeZones(map, heights, zones);

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
