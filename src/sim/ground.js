// Ground objects placed on the map: defences, infantry and targets. Each has hit points, a team and a
// score for destroying it. Bullets and bomb blasts damage them; a destroyed one stays as a wreck.
// Solid ones (towers, buildings, radar masts) also stop bombs and wreck planes that fly into them.
// Each airfield gets a hangar too. Tanks, trucks, marching infantry and engineers are ground objects
// that move (obj.mobile; see army.js).
import { clamp } from './math.js';
import { armGround } from './defences.js';
import { addDecor } from './decor.js';
import { clipStructure } from './crashes.js';

const PLANE_CRASH_DAMAGE = 60; // what a plane flying into a structure does to it
const GEAR_REACH = 4; // the wheels hang this far below a plane's centre

const SQUADS = new Set(['infantry', 'engineers']);
// World units per metre for vehicles drawn at real scale (Lab sprites: 10 px a metre, at 4 px a world unit).
const METRE = 2.5;
// Where an airfield's hangar stands: at the end of the runway nearest the map edge.
export const hangarX = (world, af) => (af.x + af.width / 2 < world.map.width / 2 ? af.x + 24 : af.x + af.width - 24);

// Makes one ground object (not yet added to the world). A squad is one object holding several
// soldiers spread along the ground.
export function makeGroundObject(world, type, team, x, { squad, width, mobile = false } = {}) {
  const def = world.groundDefs[type];
  if (!def) return null;
  const obj = { id: world.nextId++, type, def, team, x, alive: true, wreckedAt: 0, mobile };
  if (type === 'hangar') Object.assign(obj, { door: 0, doorHold: 0 }); // doors shut until a plane rolls out
  if (width) obj.width = width;
  // A vehicle with a type per nation (def.sprites; failing that, the team's place in the list) takes that
  // type's real size from def.sizes ([length, height] in metres): one set of numbers, each its own hit box.
  if (def.sprites && def.sizes) {
    const nation = world.map.airfields?.find((a) => a.team === team)?.nation;
    obj.model = def.sprites[nation] ?? Object.values(def.sprites)[team ?? 0] ?? def.sprite;
    const size = def.sizes[obj.model];
    if (size && !width) {
      const k = METRE * (def.spriteScale ?? 1);
      obj.width = size[0] * k;
      obj.height = size[1] * k;
    }
  }
  if (SQUADS.has(type)) {
    const n = squad ?? 4;
    obj.soldiers = Array.from({ length: n }, (_, i) => ({ dx: (i - (n - 1) / 2) * def.spacing, hp: def.hp }));
    obj.hp = obj.maxHp = n * def.hp;
  } else obj.hp = obj.maxHp = def.hp;
  armGround(world, obj);
  return obj;
}

// Hangar doors (obj.door, 0 shut .. 1 open): open while a plane of the team is leaving or its crew are
// out, shut again doorHold seconds after the last is in. doorTime is how long they take to move.
export function stepHangarDoors(world, dt) {
  for (const o of world.ground) {
    if (o.type !== 'hangar') continue;
    // Open while a plane of the team is waiting or on its way out, or the crew who pushed it are not home.
    // Plain loops, not .some(): this runs every tick, and a closure per hangar is garbage every tick.
    let leaving = false;
    for (const p of world.planes) if (p.team === o.team && p.state === 'ground' && p.exitTo != null && p.exitPhase !== 'shove' && !p.hold) { leaving = true; break; }
    if (!leaving) for (const c of world.crew) if (c.team === o.team && c.push) { leaving = true; break; }
    if (leaving) o.doorHold = o.def.doorHold ?? 1.5;
    else if (o.doorHold > 0) o.doorHold -= dt;
    const open = leaving || o.doorHold > 0;
    const step = dt / (o.def.doorTime || 1.2);
    o.door = Math.min(1, Math.max(0, (o.door ?? 0) + (open ? step : -step)));
  }
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
  addDecor(world);
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

// Half a squad's length: its men stand either side of its x (while forming up, not evenly).
export function squadHalf(obj) {
  let m = 0;
  for (const s of obj.soldiers) m = Math.max(m, Math.abs(s.dx));
  return m + obj.def.width / 2;
}

// Half the width of a ground object's hit box.
const halfWidth = (obj) => (obj.soldiers ? squadHalf(obj) : (obj.width ?? obj.def.width) / 2);

// Half widths by index in world.ground, worked out once per pass (speed: every bullet and plane checks
// every object, and a squad's takes a walk over its men). Valid within one bullets step or one collision
// pass: squads only move and objects only leave the list in the army step; ones added meanwhile (past
// the end) are worked out each time. NaN: not worked out yet.
// What one pass over world.ground (a bullets step, the collision check) works out once and shares. One
// per world and kind of pass, reused tick after tick (speed: no garbage); the two passes never overlap.
const passes = new WeakMap(); // world -> { [kind]: pass }
export function groundPass(world, kind) {
  let byKind = passes.get(world);
  if (!byKind) passes.set(world, (byKind = {}));
  let pass = byKind[kind];
  if (!pass || pass.halves.length !== world.ground.length) pass = byKind[kind] = { halves: new Float64Array(world.ground.length), ceiling: null };
  pass.halves.fill(NaN);
  pass.ceiling = groundCeiling(world, pass.ceiling);
  return pass;
}

// What nothing on the ground reaches above (speed: most bullets and planes are well above it, and can skip
// every object): the highest ground or river bank, plus the tallest object, plus 1 for rounding. The
// objects' part is worked out once per pass (their heights are set when they're made); objects added
// meanwhile (past `count`) aren't in it, so then there's no skipping. The ground's part is read live
// (terrain.highest(), which terrain.crater keeps up), since a crash mid-pass can throw up a rim.
// into: an old ceiling to fill in again (no garbage).
export function groundCeiling(world, into = null) {
  let bank = -Infinity;
  for (const rv of world.map.rivers ?? []) bank = Math.max(bank, rv.bank ?? Infinity);
  let tall = 1; // a bridge's deck reaches 1 above its bank
  for (const o of world.ground) tall = Math.max(tall, o.height ?? o.def.height ?? Infinity);
  const c = into ?? {};
  c.bank = bank;
  c.tall = tall + 1;
  c.count = world.ground.length;
  return c;
}
function aboveAll(world, ceiling, y) {
  if (!ceiling || world.ground.length !== ceiling.count || !world.terrain.highest) return false;
  return y > Math.max(world.terrain.highest(), ceiling.bank) + ceiling.tall;
}
function halfIn(halves, obj, i) {
  if (!halves || i >= halves.length) return halfWidth(obj);
  let h = halves[i];
  if (h !== h) h = halves[i] = halfWidth(obj);
  return h;
}

const riverOf = (world, obj) => world.map.rivers?.find((rv) => Math.abs(rv.x + rv.width / 2 - obj.x) < 1);

// Hit box: [left, bottom, right, top] in world units, standing on the ground (which craters can lower).
// A bridge's box is its deck.
export function groundBox(world, obj) {
  const half = halfWidth(obj);
  if (obj.type === 'bridge') {
    const bank = riverOf(world, obj)?.bank ?? world.terrain.heightAt(obj.x);
    return [obj.x - half, bank - obj.def.height, obj.x + half, bank + 1];
  }
  const y = surfaceAt(world, obj.x);
  return [obj.x - half, y - 1, obj.x + half, y + (obj.height ?? obj.def.height)];
}

// Like radar: how well a team's ground crew can work, 0..1, from its hangar's state.
export function hangarHealth(world, team) {
  const hangar = hangarOf(world, team);
  if (!hangar) return 1;
  return hangar.alive ? Math.max(0, hangar.hp / hangar.maxHp) : 0;
}

// A team's hangar (the first in world.ground), remembered by its index (speed: the servicing asks every
// tick for every plane). Hangars are only made with the map, so the index holds while the object there is
// still that team's hangar; with none, while the list keeps its length. Kept outside the world (no
// snapshot state).
const hangars = new WeakMap(); // world -> { list, len, [team]: index or -1 }
function hangarOf(world, team) {
  const list = world.ground;
  let c = hangars.get(world);
  if (!c || c.list !== list) hangars.set(world, (c = { list, len: -1 }));
  const i = c[team];
  if (i >= 0) {
    const o = list[i];
    if (o && o.type === 'hangar' && o.team === team) return o;
  } else if (i === -1 && c.len === list.length) return null;
  const k = list.findIndex((o) => o.type === 'hangar' && o.team === team);
  c[team] = k;
  c.len = list.length;
  return k >= 0 ? list[k] : null;
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

function destroy(world, obj, byId) {
  obj.alive = false;
  obj.hp = 0;
  obj.wreckedAt = world.tick;
  obj.by = byId ?? null; // who gets the men still aboard a truck (army.js)
  const [, bottom, , top] = groundBox(world, obj);
  world.events.push({ type: 'groundDestroyed', id: obj.id, kind: obj.type, x: obj.x, y: (bottom + top) / 2, by: byId ?? null });
}

// Damage to one soldier of a squad; the squad is gone once the last one falls. `how` says what did it
// (cause: bullet, blast or runDown; dir: which way it was travelling) for the gore effects. A killing
// blow carries its force, in multiples of a soldier's hit points.
function hurtSoldier(world, obj, s, amount, byId, how = {}) {
  if (s.hp <= 0) return;
  s.hp -= amount;
  if (s.hp > 0) return;
  s.hp = 0;
  world.events.push({
    type: 'soldierKilled', id: obj.id, x: obj.x + s.dx, y: surfaceAt(world, obj.x + s.dx), by: byId ?? null,
    cause: how.cause ?? 'other', dir: how.dir ?? 0, force: amount / obj.def.hp,
  });
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

// Where the i-th man sits in a truck's bed, along the ground (the bed is the back half).
const seatX = (obj, i) => obj.x - (obj.dir ?? 1) * (obj.def.width * 0.1 + i * 2);

// Damage to a man riding in a truck (obj.passengers: each man's hit points).
export function hurtPassenger(world, obj, i, amount, byId, how = {}) {
  if (!(obj.passengers[i] > 0)) return;
  obj.passengers[i] -= amount;
  if (obj.passengers[i] > 0) return;
  obj.passengers.splice(i, 1);
  const x = seatX(obj, i);
  world.events.push({
    type: 'soldierKilled', id: obj.id, x, y: surfaceAt(world, x) + obj.def.height * 0.5, by: byId ?? null,
    cause: how.cause ?? 'other', dir: how.dir ?? 0, force: amount / world.groundDefs.infantry.hp,
  });
}

export function damageGround(world, obj, amount, byId) {
  if (!obj.alive || amount <= 0) return;
  obj.hp -= amount;
  if (obj.hp <= 0) destroy(world, obj, byId);
}

// Where segment a->b first enters the box, as a share of its length (Liang-Barsky), or null.
const EDGES = new Float64Array(8); // reused (p, q) pairs: this runs for every bullet and object
function segmentEnters(ax, ay, bx, by, [l, b, r, t]) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const e = EDGES;
  e[0] = -dx; e[1] = ax - l; e[2] = dx; e[3] = r - ax; e[4] = -dy; e[5] = ay - b; e[6] = dy; e[7] = t - ay;
  for (let i = 0; i < 8; i += 2) {
    const p = e[i];
    const q = e[i + 1];
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
// pass: groundPass(world), shared by the bullets of one step (optional, for speed).
export function bulletHitsGround(world, b, ox, oy, pass = null) {
  if (pass && aboveAll(world, pass.ceiling, Math.min(oy, b.y))) return false;
  const halves = pass?.halves;
  const left = Math.min(ox, b.x);
  const right = Math.max(ox, b.x);
  const ground = world.ground;
  for (let i = 0; i < ground.length; i++) {
    const obj = ground[i];
    if (!obj.alive || !isEnemy(world, obj, b.team)) continue;
    // Nowhere near it along the ground: skip the box (speed; the 1 keeps rounding out of it).
    const half = halfIn(halves, obj, i);
    if (right < obj.x - half - 1 || left > obj.x + half + 1) continue;
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
      hurtSoldier(world, obj, s, dmg, b.owner, { cause: 'bullet', dir: Math.sign(b.vx) });
    } else if (obj.open && obj.passengers?.length && world.rng.next() < obj.def.openHit * obj.passengers.length / obj.def.seats) {
      // An open truck: the round finds a man on the benches instead of the truck.
      hurtPassenger(world, obj, Math.floor(world.rng.next() * obj.passengers.length), b.damage * world.rng.range(0.5, 1.5), b.owner, { cause: 'bullet', dir: Math.sign(b.vx) });
    } else damageGround(world, obj, dmg, b.owner);
    world.events.push({ type: 'groundHit', id: obj.id, kind: obj.type, x: hx, y: hy, damage: dmg, dir: Math.sign(b.vx) });
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
// bomb: a bomb's blast, which armour shrugs off in part (the def's bombFactor; tank shells are not cut).
export function blastGround(world, x, y, def, ownerId, team, { spareNeutral = false, bomb = false } = {}) {
  for (const obj of world.ground) {
    if (!obj.alive || !isEnemy(world, obj, team)) continue;
    if (spareNeutral && obj.team == null) continue;
    if (obj.soldiers) {
      for (const s of obj.soldiers) {
        const gy = surfaceAt(world, obj.x + s.dx);
        const d = Math.hypot(obj.x + s.dx - x, gy + obj.def.height / 2 - y);
        if (d < def.blastRadius) hurtSoldier(world, obj, s, def.blastDamage * (1 - d / def.blastRadius), ownerId, { cause: 'blast', dir: Math.sign(obj.x + s.dx - x) });
      }
      continue;
    }
    const [l, b, r, t] = groundBox(world, obj);
    const d = Math.hypot(x - clamp(x, l, r), y - clamp(y, b, t));
    if (d >= def.blastRadius) continue;
    const dmg = def.blastDamage * (1 - d / def.blastRadius) * (bomb ? obj.def.bombFactor ?? 1 : 1);
    world.events.push({ type: 'groundHit', id: obj.id, kind: obj.type, x: clamp(x, l, r), y: clamp(y, b, t), damage: dmg });
    // Men in a truck feel it too: fully in an open one, less under a tarp.
    if (obj.passengers) {
      const share = obj.open ? 1 : obj.def.tarpShield ?? 0.5;
      for (let i = obj.passengers.length - 1; i >= 0; i--) hurtPassenger(world, obj, i, dmg * share, ownerId, { cause: 'blast', dir: Math.sign(obj.x - x) });
    }
    damageGround(world, obj, dmg, ownerId);
  }
}

// A plane going in throws a shockwave: soldiers near the wreck are hurt or killed, friend and foe alike,
// stronger the closer they stand. No score for it (nobody aimed it). Settings: collisions.crashBlast*.
export function crashShockwave(world, x, y) {
  const { crashBlastRadius: radius, crashBlastForce: force } = world.collisions;
  if (!(radius > 0) || !(force > 0)) return;
  for (const obj of world.ground) {
    if (!obj.alive || !obj.soldiers) continue;
    for (const s of obj.soldiers) {
      if (s.hp <= 0) continue;
      const sx = obj.x + s.dx;
      const d = Math.hypot(sx - x, surfaceAt(world, sx) + obj.def.height / 2 - y);
      if (d >= radius) continue;
      hurtSoldier(world, obj, s, obj.def.hp * force * (1 - d / radius), null, { cause: 'blast', dir: Math.sign(sx - x) });
    }
  }
}

// Planes that run into a standing solid object. Flying, or rolling fast, the plane is wrecked and the
// object damaged; a tank it dives into is destroyed with it. At taxi speed on the ground it's only a
// bump: a little damage to both, and the plane stops. Flying low through enemy infantry cuts them
// down, and costs the plane a little.
export function planesHitStructures(world, crash) {
  const cfg = world.collisions;
  const ground = world.ground;
  let pass = null;
  for (const p of world.planes) {
    if (p.state === 'dead') continue;
    const margin = p.def.hitRadius * 0.6;
    pass ??= groundPass(world, 'planes');
    // Above everything: no squad, obstacle or structure below can be met (each needs p.y within
    // margin, or GEAR_REACH, of an object's top).
    if (aboveAll(world, pass.ceiling, p.y - margin - GEAR_REACH)) continue;
    const halves = pass.halves;
    for (let i = 0; i < ground.length; i++) {
      const obj = ground[i];
      if (!obj.alive) continue;
      // Nowhere near it along the ground: nothing below can happen (speed; the 2 keeps rounding out).
      if (Math.abs(p.x - obj.x) > halfIn(halves, obj, i) + margin + 2) continue;
      if (obj.soldiers) {
        if (isEnemy(world, obj, p.team)) runDown(world, p, obj, margin, crash);
        if (p.state === 'dead') break;
        continue;
      }
      if (obj.def.obstacle) {
        hitObstacle(world, p, obj, margin, crash);
        if (p.state === 'dead') break;
        continue;
      }
      if (!obj.def.solid) continue;
      const [l, b, r, t] = groundBox(world, obj);
      if (p.x < l - margin || p.x > r + margin || p.y < b || p.y > t + margin) continue;
      if (p.state === 'ground' && p.speed < cfg.taxiBump) {
        if (p.speed < 1) continue; // standing still: a tank may roll right past
        p.x = p.x < obj.x ? l - margin - 0.5 : r + margin + 0.5;
        p.speed = p.vx = 0;
        p.hp -= cfg.bumpDamage;
        damageGround(world, obj, cfg.bumpDamage, p.id);
        world.events.push({ type: 'bump', plane: p.id, kind: obj.type, x: p.x, y: p.y });
        if (p.hp <= 0) crash(p, world, 'structure', obj.def.name);
        break;
      }
      // Only catching the top of it (a tree's crown, a roof): a part torn off, not a crash (src/sim/crashes.js).
      if (clipStructure(world, p, obj, t, margin)) {
        if (p.state === 'dead') break;
        continue;
      }
      // Diving into a tank takes it with you, and the plane gets the points.
      const tank = obj.type === 'tank';
      damageGround(world, obj, tank ? Infinity : PLANE_CRASH_DAMAGE, tank ? p.id : p.lastHitBy ?? null);
      crash(p, world, 'structure', obj.def.name);
      break;
    }
  }
}

// Hedges and stone walls are low: only a plane on the ground, or skimming it with its wheels, meets
// one. A hedge it ploughs through (losing speed and a little damage); a wall tears the gear off (on the
// ground: down on its belly), and one flown into fuselage-first is a crash. Each is hit once.
function hitObstacle(world, p, obj, margin, crash) {
  const [l, , r, t] = groundBox(world, obj);
  if (p.x < l - margin || p.x > r + margin || p.y > t + GEAR_REACH || p.speed < 1 || p.lastObstacle === obj.id) return;
  p.lastObstacle = obj.id;
  const cfg = world.decor;
  if (obj.def.obstacle === 'hedge') {
    p.hp -= cfg.hedgeDamage;
    p.speed *= cfg.hedgeDrag;
    damageGround(world, obj, Infinity, null);
    world.events.push({ type: 'hedgeHit', plane: p.id, x: obj.x, y: t });
    if (p.hp <= 0) crash(p, world, 'structure', obj.def.name);
    return;
  }
  if (p.state === 'air' && p.y < t + 1) {
    crash(p, world, 'structure', obj.def.name);
    return;
  }
  damageGround(world, obj, PLANE_CRASH_DAMAGE / 2, null);
  p.hp -= cfg.wallDamage;
  p.gear = 0;
  p.gearDown = false;
  p.propBent = true;
  world.events.push({ type: 'wallHit', plane: p.id, x: obj.x, y: t });
  if (p.state === 'ground' && !p.belly) {
    // Down on the belly: the engine stops with the propeller in the dirt.
    p.belly = true;
    p.speed *= 0.5;
    p.engineRunning = false;
    p.engineDamage = clamp(p.engineDamage + 0.3, 0, 1);
    world.events.push({ type: 'bellyLanding', plane: p.id, x: p.x, y: p.y, speed: p.speed, collapsed: true });
  }
  if (p.hp <= 0) crash(p, world, 'structure', obj.def.name);
}

// A plane low enough to strike a squad's soldiers kills those within its reach.
function runDown(world, p, obj, margin, crash) {
  if (p.state === 'ground' && p.speed < world.collisions.taxiBump) return; // they step aside
  for (const s of obj.soldiers) {
    if (s.hp <= 0) continue;
    const sx = obj.x + s.dx;
    if (Math.abs(p.x - sx) > margin + 1 || p.y - surfaceAt(world, sx) > obj.def.height + margin) continue;
    const dir = Math.cos(p.angle) >= 0 ? 1 : -1;
    hurtSoldier(world, obj, s, Infinity, p.id, { cause: 'runDown', dir });
    p.hp -= world.collisions.runDownDamage;
    world.events.push({ type: 'runDown', plane: p.id, dir, x: sx, y: surfaceAt(world, sx) + 2 });
    if (p.hp <= 0) {
      crash(p, world, 'infantryRam');
      return;
    }
  }
}
