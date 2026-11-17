// Ground defences shoot at enemy planes, flying or on the ground (taxiing or stranded).
// Heavy flak ('flak'): slow, reaches high, time-fused shells that burst into shrapnel and can start
// fires; blind below minAltitude. Its bursts start wide and creep in on a plane that holds a straight
// course (the gunners' fix); a turning plane loses them. Light flak: streams of tracer, direct hits,
// deadly up to maxAltitude and no higher. MG nests: fast bursts, short reach.
// Infantry: each soldier fires his rifle now and then; weak alone, dangerous in numbers.
// Tanks' coaxial MGs: only at planes flying very low or on the ground. Their roof MG (anti-aircraft)
// sprays short, wild bursts at planes passing low over the column: more show than threat.
// MG nests, infantry and tank MGs also shoot enemy soldiers when there's no plane to shoot at.
// Anti-tank guns (Pak 40, ZiS-3): dug in, facing the enemy; they shell enemy tanks and trucks coming at them and
// never planes. Their crew can be shot or blasted (ground.js hurtGunner); with no crew left the gun is lost.
// All aim with lead: they shoot where the target will be when the round gets there.
import { GRAVITY } from './plane.js';
import { damagePlane } from './weapons.js';
import { angleDiff } from './math.js';
import { ignite } from './fire.js';
import { surfaceAt, mountPoint, radarHealth } from './ground.js';
import { fixThrough, showsItself } from './clouds.js';

const SHELL_DROP = 0.25; // as army.js's tank shells, which the anti-tank guns fire

// Where the rounds leave the gun, in world units: height of the barrel's pivot above the ground and
// barrel length (match the sprites).
const MUZZLE = { flak: [5, 10], lightFlak: [4, 6], mgNest: [3, 4.5], infantry: [5, 1], tank: [7, 5], searchlight: [6.5, 4.5], atGun: [4, 14] };
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
  if (obj.type === 'flak') Object.assign(obj, { fix: 0, fixId: null, fixVx: 0, fixVy: 0 });
  if (obj.type === 'atGun') obj.aim = facing > 0 ? 0.03 : Math.PI - 0.03; // laid level on the road
  for (const s of obj.soldiers ?? []) s.cooldown = world.rng.range(0, obj.def.interval);
}

// How far out (world units along the ground) a gun reaches a plane h above it: 0 below its minAltitude,
// above its maxAltitude or beyond its range; never lower than the barrel can point. The bots and the
// tests read a gun's reach from here.
export function reachAt(def, h) {
  if (h < (def.minAltitude ?? 0) || h > (def.maxAltitude ?? Infinity) || h >= def.range) return 0;
  const r = Math.sqrt(def.range ** 2 - h ** 2);
  return def.minElevation > 0 ? Math.min(r, h / Math.tan(def.minElevation)) : r;
}

// Nearest enemy plane in reach of a gun at (x, y); failing that (not for flak), the nearest enemy
// soldier, as a point to aim at. Planes lower than minAltitude or higher than maxAltitude (a tank's
// MGs: mgAltitude) above the ground are left alone.
// reach: how far it looks (a heavy gun's predictor follows planes further out than the gun shoots).
function pickTarget(world, obj, x, y, def = obj.def, reach = def.range) {
  let best = null;
  let bestD = reach;
  for (const p of world.planes) {
    if (p.team === obj.team || p.state === 'dead' || p.dying || p.wreck) continue;
    if (obj.crew === 'in') continue; // a tank in a ground fight: the crew will not expose themselves
    const height = p.y - world.terrain.heightAt(p.x);
    if (def.minAltitude && height < def.minAltitude) continue;
    if (height > (def.maxAltitude ?? def.mgAltitude ?? Infinity)) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best || obj.type === 'flak' || def.planesOnly) return best;
  for (const o of world.ground) {
    if (o.gunners?.length && o.alive && o.team !== obj.team) {
      // An anti-tank gun's crew behind their shield: a target for rifles and MGs.
      const d = Math.abs(o.x - x) < bestD ? Math.hypot(o.x - x, surfaceAt(world, o.x) + 3 - y) : Infinity;
      if (d < bestD) {
        best = { id: -o.id, x: o.x, y: surfaceAt(world, o.x) + 3, vx: 0, vy: 0 };
        bestD = d;
      }
      continue;
    }
    if (!o.alive || !o.soldiers || o.team == null || o.team === obj.team) continue;
    const vx = o.moving ? o.dir * o.def.speed : 0;
    for (const s of o.soldiers) {
      if (s.hp <= 0) continue;
      const sx = o.x + s.dx;
      if (Math.abs(sx - x) >= bestD) continue; // can't be nearer: skip the ground lookup (speed)
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
  // The predictor follows a plane from trackRange, so the fix is under way before the gun can reach it.
  const target = pickTarget(world, obj, px, py, def, Math.max(def.range, def.trackRange ?? 0));
  obj.target = target?.id ?? null;
  if (!target) {
    obj.fixId = null;
    obj.fix = 0;
    return;
  }
  // The fix: grows while the target holds its course and speed, falls with every change of them
  // (beyond fixSteady, the wobble of level flight). A new target starts from nothing.
  if (target.id !== obj.fixId) {
    obj.fixId = target.id;
    obj.fix = 0;
  } else if (def.fixTime) {
    const accel = Math.hypot(target.vx - obj.fixVx, target.vy - obj.fixVy) / dt;
    // Cloud between the gun and the plane slows the fix (it never stops the gun firing); with the side's
    // radar working the predictor has its range and the cloud makes no difference.
    const rate = radarHealth(world, obj.team) > 0 ? 1 : fixThrough(world, px, py, target);
    obj.fix = Math.min(1, Math.max(0, obj.fix + (dt / def.fixTime) * rate - Math.max(0, accel - def.fixSteady) * def.fixLoss * dt));
  }
  obj.fixVx = target.vx;
  obj.fixVy = target.vy;
  const { angle } = lead(px, py, target, def.velocity, def.drop);
  if (!swing(obj, angle, dt) || obj.cooldown > 0 || Math.hypot(target.x - px, target.y - py) > def.range) return;
  obj.cooldown = def.interval;
  // The shell is laid on a point off the target: far off without a fix (missFar), close with one (missNear).
  const miss = def.fixTime ? (def.missFar + (def.missNear - def.missFar) * obj.fix) * world.rng.range(0.5, 1) : 0;
  const off = world.rng.range(0, Math.PI * 2);
  const laid = lead(px, py, { x: target.x + Math.cos(off) * miss, y: target.y + Math.sin(off) * miss, vx: target.vx, vy: target.vy }, def.velocity, def.drop);
  const t = laid.t;
  const a = laid.angle + world.rng.range(-def.spread, def.spread);
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

// Anti-tank guns: the nearest enemy tank or truck ahead within range, with the line to it clear of the ground
// (in a dip or behind a crest it is safe), is laid on with lead and shelled. The shells are the tanks' own
// (army.js: world.tankShells, burst by def.shellRadius and shellDamage). Each man lost slows the loading.
function atGunTarget(world, obj, x, y, facing) {
  const def = obj.def;
  let best = null;
  let bestD = def.range;
  for (const o of world.ground) {
    if (!o.alive || !o.mobile || o.team == null || o.team === obj.team || (o.type !== 'tank' && o.type !== 'truck')) continue;
    const ahead = (o.x - x) * facing;
    if (ahead <= 0 || ahead >= bestD) continue;
    const ty = (o.baseY ?? surfaceAt(world, o.x)) + (o.height ?? o.def.height) * 0.4;
    const d = Math.hypot(o.x - x, ty - y);
    if (d >= bestD || !lineClear(world, x, y, o.x, ty + 2)) continue;
    best = { o, ty };
    bestD = d;
  }
  return best;
}
function stepAtGun(world, obj, dt) {
  const def = obj.def;
  const [h, len] = MUZZLE.atGun;
  const facing = obj.x < world.map.width / 2 ? 1 : -1;
  const x = obj.x;
  const y = surfaceAt(world, obj.x) + h;
  obj.cooldown = Math.max(0, obj.cooldown - dt);
  const found = atGunTarget(world, obj, x, y, facing);
  obj.target = found?.o.id ?? null;
  if (!found) {
    swing(obj, facing > 0 ? 0.03 : Math.PI - 0.03, dt);
    return;
  }
  const { o, ty } = found;
  const vx = o.moving ? o.dir * (o.step ?? 0) / dt : 0;
  const { angle } = lead(x, y, { x: o.x, y: ty, vx, vy: 0 }, def.gunVelocity, SHELL_DROP);
  if (!swing(obj, angle, dt) || obj.cooldown > 0 || !world.tankShells) return;
  const crew = obj.gunners?.length ?? def.crew;
  obj.cooldown = def.interval * (def.crew / Math.max(1, crew)) * world.rng.range(0.9, 1.1);
  const a = angle + world.rng.range(-def.spread, def.spread);
  const mx = x + Math.cos(obj.aim) * len;
  const my = y + Math.sin(obj.aim) * len;
  world.tankShells.push({ id: world.nextId++, owner: obj.id, team: obj.team, def, x: mx, y: my, vx: Math.cos(a) * def.gunVelocity, vy: Math.sin(a) * def.gunVelocity, life: 2.5 });
  world.events.push({ type: 'tankFire', id: obj.id, kind: 'atGun', x: mx, y: my, angle: a });
}

// Searchlights (for night fighting to come): they only burn at night (world.rules.night). With nothing caught the
// beam sweeps the sky over the gun; a plane that crosses it is caught and held while the light can follow it.
// A caught plane is marked (p.litBy = the light's id, cleared every tick), for the guns and the drawing. Cloud hides
// a plane from the light as from an eye. Deterministic: the sweep runs on the light's own clock.
function canLight(world, obj, p, x, y) {
  const def = obj.def;
  if (p.team === obj.team || p.state !== 'air' || p.dying || p.wreck) return false;
  if ((p.cloud ?? 0) > 0.5 && !showsItself(world, p)) return false;
  const h = p.y - world.terrain.heightAt(p.x);
  return h >= (def.minAltitude ?? 0) && Math.hypot(p.x - x, p.y - y) < def.range;
}
function stepSearchlight(world, obj, dt) {
  const def = obj.def;
  const [h] = MUZZLE.searchlight;
  const x = obj.x;
  const y = surfaceAt(world, obj.x) + h;
  obj.lit = null;
  if (!world.rules.night) {
    obj.target = null;
    swing(obj, obj.x < world.map.width / 2 ? 1.2 : Math.PI - 1.2, dt); // switched off, pointing up and away
    return;
  }
  const bearing = (p) => Math.atan2(p.y - y, p.x - x);
  let target = world.planes.find((p) => p.id === obj.target);
  if (!target || !canLight(world, obj, target, x, y)) {
    target = null;
    obj.target = null;
    // Anything inside the beam now is caught.
    for (const p of world.planes) {
      if (canLight(world, obj, p, x, y) && Math.abs(angleDiff(bearing(p), obj.aim)) < def.beam) {
        target = p;
        obj.target = p.id;
        break;
      }
    }
  }
  if (target) {
    swing(obj, bearing(target), dt);
    if (Math.abs(angleDiff(bearing(target), obj.aim)) < def.beam * 1.5) {
      obj.lit = target.id;
      target.litBy = obj.id;
    }
    return;
  }
  // Sweeping: a slow swing to and fro across the sky over the gun.
  obj.sweep = (obj.sweep ?? 0) + dt;
  swing(obj, Math.PI / 2 + def.sweepArc * Math.sin((obj.sweep * 2 * Math.PI) / def.sweepTime + obj.id), dt);
}

export function stepDefences(world, dt) {
  if (world.rules.night) for (const p of world.planes) p.litBy = null;
  for (const obj of world.ground) {
    if (!obj.alive) continue;
    if (obj.type === 'flak') stepFlak(world, obj, dt);
    else if (obj.type === 'mgNest' || obj.type === 'lightFlak' || obj.type === 'tank') stepMg(world, obj, dt);
    if (obj.type === 'searchlight') stepSearchlight(world, obj, dt);
    else if (obj.type === 'atGun') stepAtGun(world, obj, dt);
    if (obj.type === 'tank') stepTankAa(world, obj, dt);
    else if (obj.type === 'infantry') stepInfantry(world, obj, dt);
  }
}

// A shell bursts when its fuse runs out, when it passes right by an enemy plane (not heavy flak), or on the ground.
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
    // A gun that works up a fix fires on the time fuse alone: bursting on every plane it passes would
    // turn each shell laid short or long of the target into a hit.
    const close = !s.def.fixTime && world.planes.some(
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
