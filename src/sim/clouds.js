// The cloud layer (ROADMAP.md, Decisions, "Clouds: one layer you can hide in"): one broken band of cloud
// across the whole map between the mid and high bands, with gaps that drift slowly sideways.
// A plane inside it is hidden from eyes (bots, gunners, the other players' screens) but sees out as usual.
// It is shown again by firing (for a moment), by burning or smoking, by a gap, and at very close range;
// radar plots it as always. Heavy flak never stops firing for cloud: its fix only builds slower through it,
// unless its side's radar works (src/sim/defences.js).
// How much of the sky is covered is the match's own, worked out from its seed (not world.rng, so the sim's
// random sequence is what it was): the same for both sides, and the host's online.
import { clamp } from './math.js';

// on: is there a layer at all (off in a bare world and in the air-only arena).
// base, top: the layer's height band (world y). soft: how far its upper and lower edges fade over.
// coverMin, coverMax: the share of the sky it covers, picked per match between these.
// cell: the size of its holes and banks (world units along the map). drift: how fast it slides (units/s).
// taper: how far from its end a bank thins out to nothing (world units along the map).
// closeRange: nearer than this a hidden plane shows. fireReveal: seconds a plane shows after firing.
// smokeHp: a plane below this share of its hit points smokes and cannot hide. fixFactor: how fast heavy
// flak's fix builds through solid cloud (1 = as in clear air).
// rainChance: the chance a match has rain, falling from the layer's banks; rainMin, rainMax: how heavy, if it has.
export const DEFAULT_CLOUDS = { rainChance: 0.35, rainMin: 0.3, rainMax: 1, on: false, base: 750, top: 850, soft: 22, coverMin: 0.4, coverMax: 0.8, cell: 260, taper: 60, drift: 5, closeRange: 45, fireReveal: 1.5, smokeHp: 0.4, fixFactor: 0.5 };

const hash = (n, seed) => {
  let h = Math.imul(n ^ Math.imul(seed | 0, 2654435761), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 3266489917) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
// Smooth noise 0..1 along the map.
function noise(x, cell, seed) {
  const k = x / cell;
  const i = Math.floor(k);
  return hash(i, seed) + (hash(i + 1, seed) - hash(i, seed)) * smooth(k - i);
}

export function createClouds(world) {
  const cfg = world.clouds;
  if (!cfg?.on) {
    world.cloud = null;
    return;
  }
  // cover: this match's share of sky under cloud. offset: how far the layer has drifted.
  // (Rounded as a snapshot rounds it, so an online guest draws exactly the host's sky.)
  const rain = hash(13, world.seed) < (cfg.rainChance ?? 0) ? cfg.rainMin + (cfg.rainMax - cfg.rainMin) * hash(17, world.seed) : 0;
  world.cloud = { cover: Math.round((cfg.coverMin + (cfg.coverMax - cfg.coverMin) * hash(7, world.seed)) * 1000) / 1000, offset: 0, rain: Math.round(rain * 1000) / 1000 };
}

// The layer over one place along the map: how solid it is there (0 a gap .. 1 solid) and its ragged lower
// and upper edges. The drawing uses this too, so what you see is what hides you.
// How solid the layer is at a place along the drifted layer (`at` = x - offset).
function solidAt(world, at) {
  const cfg = world.clouds;
  // Two sizes of noise: the banks and holes, and their ragged edges. The threshold turns it into cover.
  const n = noise(at, cfg.cell, world.seed) * 0.8 + noise(at, cfg.cell * 0.27, world.seed + 11) * 0.2;
  // (The blend bunches towards the middle; stretch it back so the covered share is about `cover`.)
  const spread = clamp((n - 0.5) * 1.5 + 0.5, 0, 1);
  return clamp((world.cloud.cover - spread) / 0.08 + 0.5, 0, 1);
}

export function layerAt(world, x) {
  const cfg = world.clouds;
  const c = world.cloud;
  if (!c) return { solid: 0, bottom: 0, top: 0 };
  const at = x - c.offset;
  const solid = solidAt(world, at);
  const thick = cfg.top - cfg.base;
  const mid = (cfg.base + cfg.top) / 2;
  if (solid <= 0) return { solid, bottom: mid, top: mid };
  // A bank closes up at its ends instead of turning see-through: it thins to nothing over `taper` from the
  // nearest gap, however steeply the noise ends it. (Looked for in eighths, then narrowed down, so the slope is smooth.)
  const taper = cfg.taper ?? 60;
  const gap = (d) => solidAt(world, at - d) <= 0 || solidAt(world, at + d) <= 0;
  let end = taper;
  for (let k = 1; k <= 8; k++) {
    let hi = (taper * k) / 8;
    if (!gap(hi)) continue;
    let lo = hi - taper / 8;
    for (let j = 0; j < 5; j++) {
      const m = (lo + hi) / 2;
      if (gap(m)) hi = m;
      else lo = m;
    }
    end = (lo + hi) / 2;
    break;
  }
  const swell = (noise(at, cfg.cell * 0.4, world.seed + 23) - 0.5) * thick * 0.5;
  // Like a cumulus: the base stays nearly flat (rising a little at the very end) and the top comes down over it.
  const e = clamp(end / taper, 0, 1);
  const half = thick / 2 + swell * 0.5;
  const bottom = mid - half + 0.35 * half * (1 - e) * (1 - e);
  return { solid, bottom, top: bottom + (mid + half - bottom) * (0.5 * e * (2 - e) + 0.5 * smooth(e)) };
}

// How deep in cloud a point is: 0 clear air .. 1 fully inside. Only the depth counts, not how solid the bank is:
// it is drawn solid wherever it is, so a thin tip hides a plane as far as it is thick.
export function cloudAt(world, x, y) {
  if (!world.cloud) return 0;
  const { solid, bottom, top } = layerAt(world, x);
  if (solid <= 0 || y <= bottom || y >= top) return 0;
  const soft = world.clouds.soft;
  return smooth(clamp(Math.min(y - bottom, top - y) / soft, 0, 1));
}

// A plane that cloud cannot hide, wherever it is: one that just fired, burns, or trails smoke.
export const showsItself = (world, p) => p.cloudShown > 0 || p.burning || p.dying || p.hp < p.def.hp * world.clouds.smokeHp;

// Can `viewer` not see `target` because of the cloud? (Sight only: radar is the radar's business.)
export function hiddenFrom(world, viewer, target) {
  if (!world.cloud || !(target.cloud > 0.5) || showsItself(world, target)) return false;
  return Math.hypot(target.x - viewer.x, target.y - viewer.y) > world.clouds.closeRange;
}

// How much of a plane shows to eyes that are not close: 1 in clear air, 0 deep in cloud, fading at its edges.
export function shownShare(world, p) {
  if (!world.cloud || showsItself(world, p)) return 1;
  return 1 - smooth(clamp((p.cloud ?? 0) / 0.6, 0, 1));
}

// How fast a heavy gun's fix builds on a plane, as a share of clear air: slower with cloud between them.
export function fixThrough(world, gx, gy, target) {
  if (!world.cloud) return 1;
  const cfg = world.clouds;
  const mid = (cfg.base + cfg.top) / 2;
  let dense = target.cloud ?? 0;
  if (target.y > mid && gy < mid) {
    // Where the line from the gun to the plane goes through the layer.
    const x = gx + ((target.x - gx) * (mid - gy)) / (target.y - gy);
    dense = Math.max(dense, layerAt(world, x).solid);
  }
  return 1 - (1 - cfg.fixFactor) * dense;
}

export function stepClouds(world, dt) {
  const c = world.cloud;
  if (!c) return;
  c.offset += world.clouds.drift * dt;
  for (const p of world.planes) {
    p.cloud = p.state === 'air' ? cloudAt(world, p.x, p.y) : 0;
    if (p.cloudShown > 0) p.cloudShown = Math.max(0, p.cloudShown - dt);
  }
  // Guns give a plane away: tracers show anywhere, and so for a moment does the plane that fired them.
  for (const e of world.events) {
    if (e.type !== 'shot') continue;
    const p = world.planes.find((q) => q.id === e.plane);
    if (p) p.cloudShown = world.clouds.fireReveal;
  }
}
