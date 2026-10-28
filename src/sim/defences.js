// Ground defences shoot at enemy planes, flying or on the ground (taxiing or stranded).
// Flak guns: slow, accurate, reach high, time-fused shells that burst into shrapnel and can start
// fires; they can't get a fix on planes flying low. MG nests: fast bursts, short reach.
// Infantry: each soldier fires his rifle now and then; weak alone, dangerous in numbers.
// All aim with lead: they shoot where the plane will be when the round gets there.
import { GRAVITY } from './plane.js';
import { damagePlane } from './weapons.js';
import { angleDiff } from './math.js';

// Where the rounds leave the gun, in world units: height of the barrel's pivot above the ground and
// barrel length (match the sprites).
const MUZZLE = { flak: [5, 10], mgNest: [3, 4.5], infantry: [5, 1] };
const TRACER_EVERY = 4;
const MAX_TURN = 0.06; // fire only when the barrel is this close to the aim point (rad)

// Turret state for a freshly built ground object.
export function armGround(world, obj) {
  if (!MUZZLE[obj.type]) return;
  const facing = obj.x < world.map.width / 2 ? 1 : -1;
  obj.aim = facing > 0 ? 0.8 : Math.PI - 0.8; // resting elevation, towards the enemy side
  obj.cooldown = world.rng.range(0, obj.def.interval ?? 1);
  obj.firing = 0;
  obj.rest = 0;
  obj.target = null;
  for (const s of obj.soldiers ?? []) s.cooldown = world.rng.range(0, obj.def.interval);
}

// Nearest enemy plane in reach of a gun at (x, y).
function pickTarget(world, obj, x, y) {
  const def = obj.def;
  let best = null;
  let bestD = def.range;
  for (const p of world.planes) {
    if (p.team === obj.team || p.state === 'dead' || p.dying) continue;
    if (def.minAltitude && p.y - world.terrain.heightAt(p.x) < def.minAltitude) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

// Aim angle and flight time to meet plane p with a round of the given speed and drop.
function lead(x, y, p, speed, drop) {
  let t = Math.hypot(p.x - x, p.y - y) / speed;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < 4; i++) {
    dx = p.x + p.vx * t - x;
    dy = p.y + p.vy * t - y + 0.5 * GRAVITY * drop * t * t; // aim high to make up for the drop
    t = Math.hypot(dx, dy) / speed;
  }
  return { angle: Math.atan2(dy, dx), t };
}

// The barrel swings towards the wanted angle at turnRate, between its elevation limits.
function swing(obj, wanted, dt) {
  const lo = obj.def.minElevation ?? -0.15;
  let a = wanted < -Math.PI / 2 ? wanted + Math.PI * 2 : wanted; // measure from the right, round over the top
  a = Math.min(Math.PI - lo, Math.max(lo, a));
  const diff = a - obj.aim; // both within the elevation limits, so it never swings through the ground
  const step = obj.def.turnRate * dt;
  obj.aim += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
  return Math.abs(angleDiff(obj.aim, a)) < MAX_TURN && Math.abs(angleDiff(obj.aim, wanted)) < MAX_TURN;
}

function fireBullet(world, obj, x, y, angle, cause) {
  const def = obj.def;
  const a = angle + world.rng.range(-def.spread, def.spread);
  obj.fired = (obj.fired ?? 0) + 1;
  world.bullets.push({
    id: world.nextId++,
    owner: obj.id,
    team: obj.team,
    x,
    y,
    vx: Math.cos(a) * def.velocity,
    vy: Math.sin(a) * def.velocity,
    life: (def.range / def.velocity) * 1.15,
    drop: 0.1,
    damage: def.damage,
    tracer: cause === 'mgNest' && obj.fired % TRACER_EVERY === 0,
    cause,
  });
  world.events.push({ type: 'groundShot', id: obj.id, kind: obj.type, x, y, angle: a });
}

function stepFlak(world, obj, dt) {
  const def = obj.def;
  const [h, len] = MUZZLE.flak;
  const px = obj.x;
  const py = world.terrain.heightAt(obj.x) + h;
  obj.cooldown = Math.max(0, obj.cooldown - dt);
  const target = pickTarget(world, obj, px, py);
  obj.target = target?.id ?? null;
  if (!target) return;
  const { angle, t } = lead(px, py, target, def.velocity, def.drop);
  if (!swing(obj, angle, dt) || obj.cooldown > 0) return;
  obj.cooldown = def.interval;
  const a = obj.aim + world.rng.range(-def.spread, def.spread);
  const x = px + Math.cos(obj.aim) * len;
  const y = py + Math.sin(obj.aim) * len;
  world.shells.push({
    id: world.nextId++,
    owner: obj.id,
    team: obj.team,
    def,
    x,
    y,
    vx: Math.cos(a) * def.velocity,
    vy: Math.sin(a) * def.velocity,
    fuse: t * (1 + world.rng.range(-def.fuseError, def.fuseError)),
  });
  world.events.push({ type: 'flakFire', id: obj.id, x, y, angle: obj.aim });
}

function stepMgNest(world, obj, dt) {
  const def = obj.def;
  const [h, len] = MUZZLE.mgNest;
  const px = obj.x;
  const py = world.terrain.heightAt(obj.x) + h;
  if (obj.rest > 0) obj.rest -= dt;
  const target = pickTarget(world, obj, px, py);
  obj.target = target?.id ?? null;
  if (!target) {
    obj.firing = 0;
    return;
  }
  const { angle } = lead(px, py, target, def.velocity, 0.1);
  if (!swing(obj, angle, dt) || obj.rest > 0) return;
  // Short bursts with rests between them, as a gunner saves his barrel.
  obj.firing += dt;
  obj.cooldown -= dt;
  while (obj.cooldown <= 0) {
    obj.cooldown += 60 / def.rpm;
    fireBullet(world, obj, px + Math.cos(obj.aim) * len, py + Math.sin(obj.aim) * len, obj.aim, 'mgNest');
  }
  if (obj.firing >= def.burst) {
    obj.firing = 0;
    obj.rest = def.pause * world.rng.range(0.7, 1.3);
  }
}

function stepInfantry(world, obj, dt) {
  const def = obj.def;
  const [h] = MUZZLE.infantry;
  const target = pickTarget(world, obj, obj.x, world.terrain.heightAt(obj.x) + h);
  obj.target = target?.id ?? null;
  for (const s of obj.soldiers) {
    if (s.hp <= 0) continue;
    s.cooldown -= dt;
    if (!target || s.cooldown > 0) continue;
    s.cooldown = def.interval * world.rng.range(0.5, 1.5);
    const x = obj.x + s.dx;
    const y = world.terrain.heightAt(x) + h;
    if (Math.hypot(target.x - x, target.y - y) > def.range) continue;
    const { angle } = lead(x, y, target, def.velocity, 0.1);
    obj.aim = angle;
    fireBullet(world, obj, x, y, angle, 'infantry');
  }
}

export function stepDefences(world, dt) {
  for (const obj of world.ground) {
    if (!obj.alive) continue;
    if (obj.type === 'flak') stepFlak(world, obj, dt);
    else if (obj.type === 'mgNest') stepMgNest(world, obj, dt);
    else if (obj.type === 'infantry') stepInfantry(world, obj, dt);
  }
}

// A shell bursts when its fuse runs out, when it passes right by an enemy plane, or on the ground.
function burst(world, s) {
  const def = s.def;
  world.events.push({ type: 'flakBurst', x: s.x, y: s.y });
  for (const p of world.planes) {
    if (p.state === 'dead') continue;
    if (!world.rules.friendlyFire && p.team === s.team) continue;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d >= def.burstRadius) continue;
    const k = 1 - d / def.burstRadius;
    const dmg = def.burstDamage * k * world.rng.range(0.6, 1.4);
    world.events.push({ type: 'shrapnel', plane: p.id, x: p.x, y: p.y, damage: dmg });
    if (!p.burning && !p.dying && world.rng.next() < def.fireChance * k) {
      p.burning = true;
      world.events.push({ type: 'fire', plane: p.id });
    }
    damagePlane(world, p, dmg, s.owner, p.x, p.y, 'flak');
  }
}

export function stepShells(world, dt) {
  const list = world.shells;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    s.vy -= GRAVITY * s.def.drop * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.fuse -= dt;
    const close = world.planes.some(
      (p) => p.state !== 'dead' && p.team !== s.team && Math.hypot(p.x - s.x, p.y - s.y) < p.def.hitRadius,
    );
    const ground = world.terrain.heightAt(s.x);
    if (s.fuse <= 0 || close || s.y <= ground || s.x < 0 || s.x > world.map.width) {
      s.y = Math.max(s.y, ground);
      burst(world, s);
      list.splice(i, 1);
    }
  }
}
