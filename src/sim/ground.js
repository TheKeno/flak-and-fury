// Ground objects placed on the map: defences, infantry and targets. Each has hit points, a team and a
// score for destroying it. Bullets and bomb blasts damage them; a destroyed one stays as a wreck.
// Solid ones (towers, buildings, radar masts) also stop bombs and wreck planes that fly into them.
// Each airfield gets a hangar too. Tanks, marching infantry and engineers are ground objects that move
// (obj.mobile; see army.js).
import { clamp } from './math.js';
import { armGround } from './defences.js';

const PLANE_CRASH_DAMAGE = 60; // what a plane flying into a structure does to it

const SQUADS = new Set(['infantry', 'engineers']);
// Where an airfield's hangar stands: at the end of the runway nearest the map edge.
export const hangarX = (world, af) => (af.x + af.width / 2 < world.map.width / 2 ? af.x + 20 : af.x + af.width - 20);

// Makes one ground object (not yet added to the world). A squad is one object holding several
// soldiers spread along the ground.
export function makeGroundObject(world, type, team, x, { squad, width, mobile = false } = {}) {
  const def = world.groundDefs[type];
  if (!def) return null;
  const obj = { id: world.nextId++, type, def, team, x, alive: true, wreckedAt: 0, mobile };
  if (width) obj.width = width;
  if (SQUADS.has(type)) {
    const n = squad ?? 4;
    obj.soldiers = Array.from({ length: n }, (_, i) => ({ dx: (i - (n - 1) / 2) * def.spacing, hp: def.hp }));
    obj.hp = obj.maxHp = n * def.hp;
  } else obj.hp = obj.maxHp = def.hp;
  armGround(world, obj);
  return obj;
}

// Builds world.ground from the map's placed objects and the type data (data/ground.json).
export function createGround(world) {
  world.ground = [];
  for (const placed of world.map.ground ?? []) {
    const obj = makeGroundObject(world, placed.type, placed.team, placed.x, placed);
    if (obj) world.ground.push(obj);
  }
  for (const af of world.map.airfields) {
    const obj = makeGroundObject(world, 'hangar', af.team, hangarX(world, af));
    if (obj) world.ground.push(obj);
  }
}

// Ground level for things standing at x: the deck of a standing bridge over a river, otherwise the
// terrain (a river's bed where the bridge is down).
export function surfaceAt(world, x) {
  for (const river of world.map.rivers ?? []) {
    if (x < river.x || x > river.x + river.width) continue;
    const bridge = world.ground.find((o) => o.type === 'bridge' && Math.abs(o.x - (river.x + river.width / 2)) < 1);
    if (bridge?.alive) return river.bank;
  }
  return world.terrain.heightAt(x);
}

// A tank's hull follows the ground: it rests on the higher of its track ends and the ground under its
// middle (so it bridges a dip and rocks over a crest), tilted to the slope between the track ends.
// The tilt eases towards the slope at tiltRate, so it settles rather than snapping.
export function settleHull(world, u, dt) {
  const half = u.def.width * 0.4;
  const back = surfaceAt(world, u.x - half);
  const front = surfaceAt(world, u.x + half);
  const slope = Math.atan2(front - back, half * 2);
  u.tilt = u.tilt === undefined ? slope : u.tilt + (slope - u.tilt) * Math.min(1, dt * (u.def.tiltRate ?? 4));
  u.baseY = Math.max(surfaceAt(world, u.x), (back + front) / 2);
}

// A point on a ground object, given as forward (along its facing) and up from where it stands, in
// world units: on a tank it turns with the tilted hull.
export function mountPoint(world, obj, forward, up) {
  const fx = forward * (obj.dir ?? 1);
  const t = obj.tilt ?? 0;
  const y = obj.baseY ?? surfaceAt(world, obj.x);
  return [obj.x + Math.cos(t) * fx - Math.sin(t) * up, y + Math.sin(t) * fx + Math.cos(t) * up];
}

const riverOf = (world, obj) => world.map.rivers?.find((rv) => Math.abs(rv.x + rv.width / 2 - obj.x) < 1);

// Hit box: [left, bottom, right, top] in world units, standing on the ground (which craters can lower).
// A bridge's box is its deck.
export function groundBox(world, obj) {
  const half = obj.soldiers ? Math.abs(obj.soldiers[0].dx) + obj.def.width / 2 : (obj.width ?? obj.def.width) / 2;
  if (obj.type === 'bridge') {
    const bank = riverOf(world, obj)?.bank ?? world.terrain.heightAt(obj.x);
    return [obj.x - half, bank - obj.def.height, obj.x + half, bank + 1];
  }
  const y = surfaceAt(world, obj.x);
  return [obj.x - half, y - 1, obj.x + half, y + obj.def.height];
}

// Like radar: how well a team's ground crew can work, 0..1, from its hangar's state.
export function hangarHealth(world, team) {
  const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === team);
  if (!hangar) return 1;
  return hangar.alive ? Math.max(0, hangar.hp / hangar.maxHp) : 0;
}

// How well a team's radar works, 0..1: the scope is fed by the best of its radar stations, so it
// degrades as they are damaged and fails when the last one is destroyed. A team the map gives no
// radar station has a radar that can't be knocked out.
export function radarHealth(world, team) {
  const stations = world.ground.filter((o) => o.type === 'radar' && o.team === team);
  if (!stations.length) return 1;
  return Math.max(...stations.map((o) => (o.alive ? Math.max(0, o.hp / o.maxHp) : 0)));
}

const isEnemy = (world, obj, team) => world.rules.friendlyFire || obj.team !== team;

function award(world, byId, obj, points) {
  const by = world.planes.find((p) => p.id === byId);
  if (by && by.team !== obj.team) by.score += points;
}

function destroy(world, obj, byId) {
  obj.alive = false;
  obj.hp = 0;
  obj.wreckedAt = world.tick;
  award(world, byId, obj, obj.def.points);
  const [, bottom, , top] = groundBox(world, obj);
  world.events.push({ type: 'groundDestroyed', id: obj.id, kind: obj.type, x: obj.x, y: (bottom + top) / 2, by: byId ?? null, points: obj.def.points });
}

// Damage to one soldier of a squad; the squad is gone once the last one falls.
function hurtSoldier(world, obj, s, amount, byId) {
  if (s.hp <= 0) return;
  s.hp -= amount;
  if (s.hp > 0) return;
  s.hp = 0;
  award(world, byId, obj, obj.def.points);
  world.events.push({ type: 'soldierKilled', id: obj.id, x: obj.x + s.dx, y: surfaceAt(world, obj.x + s.dx), by: byId ?? null, points: obj.def.points });
  obj.hp = obj.soldiers.reduce((n, o) => n + o.hp, 0);
  if (obj.soldiers.every((o) => o.hp <= 0)) {
    obj.alive = false;
    obj.wreckedAt = world.tick;
    world.events.push({ type: 'squadWiped', id: obj.id, kind: obj.type, x: obj.x, y: surfaceAt(world, obj.x), by: byId ?? null });
  }
}

// Damage to every soldier of a squad (Infinity: the whole squad is lost).
export function hurtSquad(world, obj, amount, byId) {
  for (const s of obj.soldiers) if (obj.alive) hurtSoldier(world, obj, s, amount, byId);
}

export function damageGround(world, obj, amount, byId) {
  if (!obj.alive || amount <= 0) return;
  obj.hp -= amount;
  if (obj.hp <= 0) destroy(world, obj, byId);
}

// Where segment a->b first enters the box, as a share of its length (Liang-Barsky), or null.
function segmentEnters(ax, ay, bx, by, [l, b, r, t]) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [[-dx, ax - l], [dx, r - ax], [-dy, ay - b], [dy, t - ay]]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const k = q / p;
      if (p < 0) t0 = Math.max(t0, k);
      else t1 = Math.min(t1, k);
      if (t0 > t1) return null;
    }
  }
  return t0;
}

// A bullet's step from (ox, oy) to (b.x, b.y). Returns true if it struck something and is spent.
export function bulletHitsGround(world, b, ox, oy) {
  for (const obj of world.ground) {
    if (!obj.alive || !isEnemy(world, obj, b.team)) continue;
    const k = segmentEnters(ox, oy, b.x, b.y, groundBox(world, obj));
    if (k === null) continue;
    const hx = ox + (b.x - ox) * k;
    const hy = oy + (b.y - oy) * k;
    // Tanks are thinner on top: rounds coming down steeply (a diving plane) find the roof.
    const steep = obj.def.roofFactor != null && b.vy < -Math.abs(b.vx) * 1.5;
    const dmg = b.damage * world.rng.range(0.5, 1.5) * (steep ? obj.def.roofFactor : obj.def.bulletFactor);
    if (obj.soldiers) {
      // Rounds pass between soldiers; only one that strikes near a man counts.
      const s = obj.soldiers.find((o) => o.hp > 0 && Math.abs(obj.x + o.dx - hx) < obj.def.width);
      if (!s) continue;
      hurtSoldier(world, obj, s, dmg, b.owner);
    } else damageGround(world, obj, dmg, b.owner);
    world.events.push({ type: 'groundHit', id: obj.id, kind: obj.type, x: hx, y: hy, damage: dmg });
    return true;
  }
  return false;
}

// A falling bomb that meets a standing object goes off against it instead of reaching the ground.
export function bombStrikesGround(world, bomb) {
  return world.ground.some((obj) => {
    if (!obj.alive || obj.soldiers) return false;
    const [l, b, r, t] = groundBox(world, obj);
    return bomb.x >= l && bomb.x <= r && bomb.y >= b && bomb.y <= t;
  });
}

// Blast damage falls off with the distance to the nearest point of each object.
// spareNeutral: leaves bridges alone (tank shells, so tanks don't knock down the bridge they need).
export function blastGround(world, x, y, def, ownerId, team, { spareNeutral = false } = {}) {
  for (const obj of world.ground) {
    if (!obj.alive || !isEnemy(world, obj, team)) continue;
    if (spareNeutral && obj.team == null) continue;
    if (obj.soldiers) {
      for (const s of obj.soldiers) {
        const gy = surfaceAt(world, obj.x + s.dx);
        const d = Math.hypot(obj.x + s.dx - x, gy + obj.def.height / 2 - y);
        if (d < def.blastRadius) hurtSoldier(world, obj, s, def.blastDamage * (1 - d / def.blastRadius), ownerId);
      }
      continue;
    }
    const [l, b, r, t] = groundBox(world, obj);
    const d = Math.hypot(x - clamp(x, l, r), y - clamp(y, b, t));
    if (d >= def.blastRadius) continue;
    const dmg = def.blastDamage * (1 - d / def.blastRadius);
    world.events.push({ type: 'groundHit', id: obj.id, kind: obj.type, x: clamp(x, l, r), y: clamp(y, b, t), damage: dmg });
    damageGround(world, obj, dmg, ownerId);
  }
}

// Planes (flying or taxiing) that run into a standing solid object are wrecked, and damage it.
export function planesHitStructures(world, crash) {
  for (const p of world.planes) {
    if (p.state === 'dead') continue;
    const margin = p.def.hitRadius * 0.6;
    for (const obj of world.ground) {
      if (!obj.alive || !obj.def.solid) continue;
      const [l, b, r, t] = groundBox(world, obj);
      if (p.x < l - margin || p.x > r + margin || p.y < b || p.y > t + margin) continue;
      damageGround(world, obj, PLANE_CRASH_DAMAGE, p.lastHitBy ?? null);
      crash(p, world, 'structure', obj.def.name);
      break;
    }
  }
}
