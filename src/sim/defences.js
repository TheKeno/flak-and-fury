// Ground defences shoot at enemy planes, flying or on the ground (taxiing or stranded).
// Flak guns: slow, accurate, reach high, time-fused shells that burst into shrapnel and can start
// fires; they can't get a fix on planes flying low. MG nests: fast bursts, short reach.
// Infantry: each soldier fires his rifle now and then; weak alone, dangerous in numbers.
// Tanks' coaxial MGs: only at planes flying very low or on the ground. Their roof MG (anti-aircraft)
// sprays short, wild bursts at planes passing low over the column: more show than threat.
// MG nests, infantry and tank MGs also shoot enemy soldiers when there's no plane to shoot at.
// All aim with lead: they shoot where the target will be when the round gets there.
import { GRAVITY } from './plane.js';
import { damagePlane } from './weapons.js';
import { angleDiff } from './math.js';
import { ignite } from './fire.js';
import { surfaceAt, mountPoint } from './ground.js';

// Where the rounds leave the gun, in world units: height of the barrel's pivot above the ground and
// barrel length (match the sprites).
const MUZZLE = { flak: [5, 10], mgNest: [3, 4.5], infantry: [5, 1], tank: [7, 5] };
const TANK_AA = [10.5, 3, -2]; // roof MG: pivot height, barrel length, offset along the hull
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

// Nearest enemy plane in reach of a gun at (x, y); failing that (not for flak), the nearest enemy
// soldier, as a point to aim at. Planes lower than minAltitude or higher than mgAltitude above the
// ground are left alone.
function pickTarget(world, obj, x, y, def = obj.def) {
  let best = null;
  let bestD = def.range;
  for (const p of world.planes) {
    if (p.team === obj.team || p.state === 'dead' || p.dying || p.wreck) continue;
    const height = p.y - world.terrain.heightAt(p.x);
    if (def.minAltitude && height < def.minAltitude) continue;
    if (def.mgAltitude && height > def.mgAltitude) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best || obj.type === 'flak' || def.planesOnly) return best;
  for (const o of world.ground) {
    if (!o.alive || !o.soldiers || o.team == null || o.team === obj.team) continue;
    const vx = o.moving ? o.dir * o.def.speed : 0;
    for (const s of o.soldiers) {
      if (s.hp <= 0) continue;
      const sx = o.x + s.dx;
      const sy = surfaceAt(world, sx) + 3;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) {
        best = { id: -o.id, x: sx, y: sy, vx, vy: 0 };
        bestD = d;
      }
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

// The barrel swings towards the wanted angle at turnRate, between its elevation limits (measured from
// a tank's tilted hull).
// gun: what holds the barrel's aim (the object itself, or a tank's roof MG); def: its numbers.
function swing(obj, wanted, dt, gun = obj, def = obj.def) {
  const lo = def.minElevation ?? -0.6;
  const base = obj.tilt ?? 0;
  let a = wanted - base; // measure from the right, round over the top
  while (a < -Math.PI / 2) a += Math.PI * 2;
  while (a >= Math.PI * 1.5) a -= Math.PI * 2;
  a = base + Math.min(Math.PI - lo, Math.max(lo, a));
  const diff = a - gun.aim; // both within the elevation limits, so it never swings through the ground
  const step = def.turnRate * dt;
  gun.aim += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
  return Math.abs(angleDiff(gun.aim, a)) < MAX_TURN && Math.abs(angleDiff(gun.aim, wanted)) < MAX_TURN;
}

function fireBullet(world, obj, x, y, angle, cause, gun = obj, def = obj.def) {
  const a = angle + world.rng.range(-def.spread, def.spread);
  gun.fired = (gun.fired ?? 0) + 1;
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
    tracer: cause !== 'infantry' && gun.fired % (def.tracerEvery ?? TRACER_EVERY) === 0,
    cause,
  });
  world.events.push({ type: 'groundShot', id: obj.id, kind: obj.type, mount: gun.mount, x, y, angle: a });
}

function stepFlak(world, obj, dt) {
  const def = obj.def;
  const [h, len] = MUZZLE.flak;
  const px = obj.x;
  const py = surfaceAt(world, obj.x) + h;
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

// MG nests and tanks' coaxial MGs; with gun/def/muzzle given, a tank's roof MG.
function stepMg(world, obj, dt, gun = obj, def = obj.def, [h, len, along = 0] = MUZZLE[obj.type]) {
  const [px, py] = mountPoint(world, obj, along, h);
  if (gun.rest > 0) gun.rest -= dt;
  const target = pickTarget(world, obj, px, py, def);
  gun.target = target?.id ?? null;
  if (!target) {
    gun.firing = 0;
    return;
  }
  const { angle } = lead(px, py, target, def.velocity, 0.1);
  if (!swing(obj, angle, dt, gun, def) || gun.rest > 0) return;
  // Short bursts with rests between them, as a gunner saves his barrel.
  gun.firing += dt;
  gun.cooldown -= dt;
  while (gun.cooldown <= 0) {
    gun.cooldown += 60 / def.rpm;
    fireBullet(world, obj, px + Math.cos(gun.aim) * len, py + Math.sin(gun.aim) * len, gun.aim, obj.type, gun, def);
  }
  if (gun.firing >= def.burst) {
    gun.firing = 0;
    gun.rest = def.pause * world.rng.range(0.7, 1.3);
  }
}

// A tank's roof MG, built from the tank's aa* numbers each step so the tuning panel applies live.
function stepTankAa(world, obj, dt) {
  const d = obj.def;
  if (!d.aaRange) return;
  if (!obj.aa) {
    obj.aa = { mount: 'aa', aim: obj.aim, cooldown: 0, firing: 0, rest: world.rng.range(0, d.aaPause), fired: 0, target: null };
  }
  const def = {
    planesOnly: true,
    range: d.aaRange,
    mgAltitude: d.aaAltitude,
    minElevation: 0.15,
    turnRate: d.aaTurnRate,
    burst: d.aaBurst,
    pause: d.aaPause,
    rpm: d.aaRpm,
    velocity: d.aaVelocity,
    damage: d.aaDamage,
    spread: d.aaSpread,
    tracerEvery: 3,
  };
  stepMg(world, obj, dt, obj.aa, def, TANK_AA);
}

// Is the straight line between two points above the ground all the way? (Rounds fly nearly flat
// over the short ranges soldiers fight at.)
function lineClear(world, x0, y0, x1, y1) {
  const steps = Math.ceil(Math.abs(x1 - x0) / 4);
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    if (y0 + (y1 - y0) * k < surfaceAt(world, x0 + (x1 - x0) * k)) return false;
  }
  return true;
}

function stepInfantry(world, obj, dt) {
  const def = obj.def;
  const [h] = MUZZLE.infantry;
  const target = pickTarget(world, obj, obj.x, surfaceAt(world, obj.x) + h);
  obj.target = target?.id ?? null;
  // Soldiers (negative ids) behind a hill can't be shot from here: the squad moves on instead of
  // standing to fight (see holdUp in army.js). A plane overhead doesn't stop the march.
  obj.hasShot = Boolean(target && target.id < 0 && lineClear(world, obj.x, surfaceAt(world, obj.x) + h, target.x, target.y));
  for (const s of obj.soldiers) {
    if (s.hp <= 0) continue;
    s.cooldown -= dt;
    if (!target || s.cooldown > 0) continue;
    s.cooldown = def.interval * world.rng.range(0.5, 1.5);
    const x = obj.x + s.dx;
    const y = surfaceAt(world, x) + h;
    if (Math.hypot(target.x - x, target.y - y) > def.range) continue;
    if (target.id < 0 && !obj.hasShot) continue;
    const { angle } = lead(x, y, target, def.velocity, 0.1);
    obj.aim = angle;
    fireBullet(world, obj, x, y, angle, 'infantry');
  }
}

export function stepDefences(world, dt) {
  for (const obj of world.ground) {
    if (!obj.alive) continue;
    if (obj.type === 'flak') stepFlak(world, obj, dt);
    else if (obj.type === 'mgNest' || obj.type === 'tank') stepMg(world, obj, dt);
    if (obj.type === 'tank') stepTankAa(world, obj, dt);
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
    if (!p.burning && world.rng.next() < def.fireChance * k) ignite(world, p);
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
