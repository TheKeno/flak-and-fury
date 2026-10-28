// Ground objects placed on the map: defences, infantry and targets. Each has hit points, a team and a
// score for destroying it. Bullets and bomb blasts damage them; a destroyed one stays as a wreck.
// Solid ones (towers, buildings, radar masts) also stop bombs and wreck planes that fly into them.
import { clamp } from './math.js';
import { armGround } from './defences.js';

const PLANE_CRASH_DAMAGE = 60; // what a plane flying into a structure does to it

// Builds world.ground from the map's placed objects and the type data (data/ground.json).
export function createGround(world) {
  const defs = world.groundDefs;
  world.ground = [];
  for (const placed of world.map.ground ?? []) {
    const def = defs[placed.type];
    if (!def) continue;
    const obj = { id: world.nextId++, type: placed.type, def, team: placed.team, x: placed.x, alive: true, wreckedAt: 0 };
    if (placed.type === 'infantry') {
      // A squad is one object holding several soldiers spread along the ground.
      const n = placed.squad ?? 4;
      obj.soldiers = Array.from({ length: n }, (_, i) => ({ dx: (i - (n - 1) / 2) * def.spacing, hp: def.hp }));
      obj.hp = obj.maxHp = n * def.hp;
    } else obj.hp = obj.maxHp = def.hp;
    armGround(world, obj);
    world.ground.push(obj);
  }
}

// Hit box: [left, bottom, right, top] in world units, standing on the ground (which craters can lower).
export function groundBox(world, obj) {
  const half = obj.soldiers ? (Math.abs(obj.soldiers[0].dx) + obj.def.width / 2) : obj.def.width / 2;
  const y = world.terrain.heightAt(obj.x);
  return [obj.x - half, y - 1, obj.x + half, y + obj.def.height];
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
  world.events.push({ type: 'soldierKilled', id: obj.id, x: obj.x + s.dx, y: world.terrain.heightAt(obj.x + s.dx), by: byId ?? null, points: obj.def.points });
  obj.hp = obj.soldiers.reduce((n, o) => n + o.hp, 0);
  if (obj.soldiers.every((o) => o.hp <= 0)) {
    obj.alive = false;
    obj.wreckedAt = world.tick;
    world.events.push({ type: 'squadWiped', id: obj.id, kind: obj.type, x: obj.x, y: world.terrain.heightAt(obj.x), by: byId ?? null });
  }
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
    const dmg = b.damage * world.rng.range(0.5, 1.5) * obj.def.bulletFactor;
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
export function blastGround(world, x, y, def, ownerId, team) {
  for (const obj of world.ground) {
    if (!obj.alive || !isEnemy(world, obj, team)) continue;
    if (obj.soldiers) {
      const gy = world.terrain.heightAt(obj.x);
      for (const s of obj.soldiers) {
        const d = Math.hypot(obj.x + s.dx - x, gy + obj.def.height / 2 - y);
        if (d < def.blastRadius) hurtSoldier(world, obj, s, def.blastDamage * (1 - d / def.blastRadius), ownerId);
      }
      continue;
    }
    const [l, b, r, t] = groundBox(world, obj);
    const d = Math.hypot(x - clamp(x, l, r), y - clamp(y, b, t));
    if (d < def.blastRadius) damageGround(world, obj, def.blastDamage * (1 - d / def.blastRadius), ownerId);
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
