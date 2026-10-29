// Decor placed from the map's zones, the same every time (from the map seed): hedges or stone walls at
// the ends of each field, trees in woods, a few pines on ridges and lone trees in open country, a barn
// and trees in each village. Nothing goes on a runway, by a river or in the middle of a field (fields
// are for landing). Decor is neutral (team null): tanks and gunners ignore it, bullets, bombs and planes
// don't (see planesHitStructures in ground.js).
import { createRng } from './math.js';
import { makeGroundObject } from './ground.js';

// hedgeDamage, hedgeDrag: what ploughing through a hedge costs a plane (hit points, share of speed kept).
// wallDamage: hit points lost when a stone wall tears the gear off. woodSpacing: average gap between
// trees in a wood. loneTrees: chance of a lone tree every ~90 units of open country.
export const DEFAULT_DECOR = { hedgeDamage: 6, hedgeDrag: 0.6, wallDamage: 20, woodSpacing: 12, loneTrees: 0.4 };

const KEEP_CLEAR = 30; // from runways and river banks
// Trees only need room for their trunks: crowns may overlap, so a wood can be thick.
const ROOM = { tree: 4, pine: 3 };

export function addDecor(world) {
  const { map } = world;
  const cfg = world.decor ?? DEFAULT_DECOR;
  const rng = createRng((map.seed ^ 0xdec0) >>> 0);
  // Soldiers may stand among the trees; everything else keeps its room.
  const taken = world.ground.filter((o) => !o.soldiers).map((o) => [o.x, (o.width ?? o.def.width) / 2]);
  const zones = map.zones ?? [];
  const inField = (x, half) => zones.some((z) => z.type === 'field' && x + half > z.x && x - half < z.x + z.width);
  const blocked = (x, half) =>
    x - half < 10 ||
    x + half > map.width - 10 ||
    map.airfields.some((a) => x + half > a.x - KEEP_CLEAR && x - half < a.x + a.width + KEEP_CLEAR) ||
    (map.rivers ?? []).some((r) => x + half > r.x - KEEP_CLEAR && x - half < r.x + r.width + KEEP_CLEAR) ||
    taken.some(([tx, th]) => Math.abs(tx - x) < th + half + 3);
  const put = (type, x, { field = false } = {}) => {
    const def = world.groundDefs[type];
    if (!def) return false;
    const half = ROOM[type] ?? def.width / 2;
    if (blocked(x, half) || (!field && inField(x, half))) return false;
    world.ground.push(makeGroundObject(world, type, null, x));
    taken.push([x, half]);
    return true;
  };
  const tree = () => (rng.next() < 0.6 ? 'tree' : 'pine');

  for (const z of zones) {
    const end = z.x + z.width;
    if (z.type === 'field') {
      // A hedge or a wall just beyond each end, sometimes with a tree beside it.
      for (const [x, out] of [[z.x - 14, -1], [end + 14, 1]]) {
        if (put(rng.next() < 0.55 ? 'hedge' : 'wall', x) && rng.next() < 0.5) put('tree', x + out * 22);
      }
    } else if (z.type === 'wood') {
      for (let x = z.x + 6; x < end - 6; x += cfg.woodSpacing * (0.7 + rng.next() * 0.6)) put(tree(), x);
    } else if (z.type === 'ridge') {
      for (let x = z.x + 20; x < end - 20; x += 50) if (rng.next() < 0.35) put('pine', x + (rng.next() - 0.5) * 20);
    } else if (z.type === 'village') {
      // A barn where there's room among the houses, and a couple of trees.
      for (let x = z.x + 20; x < end - 20; x += 4) if (put('barn', x)) break;
      for (let k = 0; k < 2; k++) put('tree', z.x + rng.next() * z.width);
    }
  }
  // Lone trees in open country (ground in no zone).
  const inZone = (x) => zones.some((z) => x > z.x - 10 && x < z.x + z.width + 10);
  for (let x = 60; x < map.width - 60; x += 90) {
    const tx = x + (rng.next() - 0.5) * 60;
    if (!inZone(tx) && rng.next() < cfg.loneTrees) put(tree(), tx);
  }
}
