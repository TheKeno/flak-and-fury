// Tanks by train (the Kursk map): on a map with a railway every side's tanks come by train instead of
// leaving the depot with the trucks. A train (locomotive, tender, a flatcar per tank, a flak wagon at the
// back) comes in over its own map edge, runs along the line and stops at its railhead: the depot, or the
// middle station while that station is behind the side's front (where the two sides' forward units meet).
// There the tanks roll off one by one down a ramp beside the track, the train creeping forward a wagon at
// a time, and the empty train backs out the way it came. The next one leaves the edge on schedule, once
// the line is clear (one train a side on the line at a time).
// The wagons are ground objects (world.ground, obj.train = the train's id), so they are hit, wrecked and
// drawn like everything else. A bomb's blast reaches only the one wagon nearest it (ground.js blastGround):
// a good attack thins a train without wiping it out. A wrecked flatcar's tank is lost with it. The
// locomotive and tender can't be wrecked: the line can't be cut yet.
// The train runs on a smoothed bed, the straight line along each length of track as it is drawn (and from
// rim to rim over a bridge), and each wagon tilts between its two supports (its bogies, or the outer axles).
// Trucks and their infantry still leave the depot on the waves' own timer (army.js).
import { makeGroundObject, surfaceAt } from './ground.js';

// first: seconds from the start to the first trains stopping at their railheads (they start on the line).
// interval: seconds between trains leaving the map edge (longer while the depot is damaged, as the waves).
// speed, accel: running speed (world units a second) and how fast it gets there or stops.
// flatcars: tanks a train brings at most (fewer from a damaged depot, and never more than waves.maxTanks
// on the field). rampTime: seconds a tank takes to drive off its flatcar and down the ramp. creepSpeed: how
// fast the train inches forward to bring the next flatcar to the ramp. stationMargin: how far behind the
// side's front the station must be to serve as its railhead. depotRamp, stationRamp: where the ramps are,
// ahead of the depot and short of the station (world units).
export const DEFAULT_TRAINS = { first: 15, interval: 120, speed: 30, accel: 3, flatcars: 4, rampTime: 4, creepSpeed: 10, stationMargin: 150, depotRamp: 40, stationRamp: 90 };

export const RAIL = 2.5; // the rail head stands this far above the ground line the track is drawn on
const RAMP_RUN = 26; // a tank drives this far along the line going down the ramp
const FRONT_KINDS = new Set(['tank', 'infantry']);

// --- The bed -------------------------------------------------------------------------------------------------

// The line's pieces as [left end, right end], sorted: every length of track (whole or torn) and the bridges.
// Worked out once per world and again whenever track is laid (world.railway.laid); kept outside the world.
const beds = new WeakMap();
function pieces(world) {
  const laid = world.railway?.laid ?? 0;
  const c = beds.get(world);
  if (c && c.laid === laid) return c.list;
  const list = [];
  for (const o of world.ground) {
    if (o.def?.tilt || o.type === 'railBridge') list.push([o.x - o.def.width / 2, o.x + o.def.width / 2]);
  }
  list.sort((a, b) => a[0] - b[0]);
  beds.set(world, { laid, list });
  return list;
}

export const hasRailway = (world) => Boolean(world.groundDefs.loco && world.groundDefs.flatcar && pieces(world).length);

// The height of the bed's ground line at x: along a length of track, the straight line between its ends (as
// it is drawn); between two pieces (a gap, a bridge's rims), the straight line from one to the next.
export function bedAt(world, x) {
  const list = pieces(world);
  if (!list.length) return surfaceAt(world, x);
  let lo = 0;
  let hi = list.length - 1;
  if (x < list[0][0]) return surfaceAt(world, list[0][0]);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid][0] <= x) lo = mid;
    else hi = mid - 1;
  }
  const [l, r] = list[lo];
  if (x <= r) return lerpGround(world, l, r, x);
  const next = list[lo + 1];
  return next ? lerpGround(world, r, next[0], x) : surfaceAt(world, r);
}
const lerpGround = (world, a, b, x) => {
  const ha = surfaceAt(world, a);
  return ha + (surfaceAt(world, b) - ha) * ((x - a) / (b - a || 1));
};

// --- Setting up ------------------------------------------------------------------------------------------------

const depotOf = (world, team) => world.ground.find((o) => o.type === 'depot' && o.team === team);
const stationOf = (world) => world.ground.find((o) => o.type === 'station');
const nationOf = (world, team) => world.map.airfields?.find((a) => a.team === team)?.nation;
// A wagon type's look for a team: its nation's own, failing that the team's place in the list.
const lookFor = (world, def, team) => def.looks?.[nationOf(world, team)] ?? Object.values(def.looks ?? {})[team ?? 0];
// World units per sprite pixel (10 a metre at the vehicles' 2.5 units a metre, drawn spriteScale bigger).
const unitOf = (def) => (2.5 * (def.spriteScale ?? 1)) / 10;

export function createTrains(world) {
  if (!hasRailway(world)) return;
  world.trains = [];
  world.railway = { laid: 0, sides: {} };
  for (const [teamKey, side] of Object.entries(world.army ?? {})) {
    const team = Number(teamKey);
    world.railway.sides[team] = { dir: side.dir, timer: world.trainsCfg.interval, repaired: false, held: false };
    // The first train starts on the line, first seconds short of its railhead.
    const depot = depotOf(world, team);
    if (!depot) continue;
    const t = makeTrain(world, team, tanksFor(world, team, depot));
    if (!t) continue;
    const stop = stopFor(world, t);
    const run = Math.min(world.trainsCfg.speed * world.trainsCfg.first, (stop - edgeX(world, t.dir)) * t.dir);
    t.x = stop - t.dir * run;
    t.v = Math.min(world.trainsCfg.speed, Math.sqrt(2 * world.trainsCfg.accel * run));
    placeWagons(world, t);
  }
}

// The x a train's head starts from: its own map edge (the rest of it still off the map).
const edgeX = (world, dir) => (dir > 0 ? 0 : world.map.width);

// How many tanks a train brings: as the waves, fewer from a damaged depot, and never more on the field than
// waves.maxTanks.
function tanksFor(world, team, depot) {
  const cfg = world.trainsCfg;
  const health = depot.hp / depot.maxHp;
  let out = 0;
  for (const o of world.ground) {
    if (o.team !== team || !o.alive) continue;
    if (o.type === 'tank' && o.mobile) out++;
    else if (o.type === 'flatcar' && o.load) out++;
  }
  return Math.min(Math.max(1, Math.round(cfg.flatcars * health)), (world.waves.maxTanks ?? Infinity) - out);
}

function makeTrain(world, team, tanks) {
  if (tanks <= 0) return null;
  const side = world.railway.sides[team];
  const dir = side.dir;
  const t = { id: world.nextId++, team, dir, x: edgeX(world, dir), v: world.trainsCfg.speed, phase: 'run', to: null, ramp: null, rolling: null, cars: [] };
  let at = 0;
  for (const type of ['loco', 'tender', ...Array(tanks).fill('flatcar'), 'flakWagon']) {
    const def = world.groundDefs[type];
    if (!def) continue;
    const look = lookFor(world, def, team);
    const o = makeGroundObject(world, type, team, t.x);
    const k = unitOf(def);
    o.width = (look?.size?.[0] ?? def.width / k) * k;
    o.height = def.height;
    o.dir = dir;
    o.train = t.id;
    o.at = at + o.width / 2; // its middle, this far behind the head
    at += o.width;
    if (type === 'flatcar') o.load = true;
    if (type === 'flakWagon' && look?.gun) {
      // Where the barrels turn, above the rail and along the wagon (from its middle, forward positive).
      const [gx, gy] = look.gun.at;
      o.muzzle = [(look.size[1] - gy) * k, 8, (gx - look.size[0] / 2) * k];
    }
    loadHeight(world, o);
    t.cars.push(o.id);
    world.ground.push(o);
  }
  world.trains.push(t);
  world.events.push({ type: 'trainIn', id: t.id, team, x: t.x, tanks });
  return t;
}

// A loaded flatcar's hit box reaches up over its tank.
function loadHeight(world, o) {
  if (o.type !== 'flatcar') return;
  const look = lookFor(world, o.def, o.team);
  const k = unitOf(o.def);
  const deck = look?.load ? (look.size[1] - look.load.row) * k : o.def.height;
  o.deck = deck;
  o.height = deck + (o.load ? world.groundDefs.tank?.height ?? 10 : 0);
}

// --- Where it stops ---------------------------------------------------------------------------------------------

// The front: halfway between each side's most forward tank or infantry squad (a side with none out: its depot),
// as the Balance Lab measures it.
export function frontX(world) {
  const fwd = {};
  const home = {};
  for (const [team, side] of Object.entries(world.railway.sides)) {
    home[team] = depotOf(world, Number(team))?.x ?? edgeX(world, side.dir);
    fwd[team] = null;
  }
  for (const o of world.ground) {
    if (!o.mobile || !o.alive || o.returning || o.ramp || !FRONT_KINDS.has(o.type) || !(o.team in fwd)) continue;
    const dir = world.railway.sides[o.team].dir;
    if (fwd[o.team] == null || o.x * dir > fwd[o.team] * dir) fwd[o.team] = o.x;
  }
  const xs = Object.keys(fwd).map((t) => fwd[t] ?? home[t]);
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

// Is the middle station behind this side's front, so its trains run on to it? Taken once the front is
// stationMargin past it, given up only once the front is stationMargin back the other side of it: the front
// jumps about (a side with nobody out counts from its depot), and without the gap trains were turned back
// and forth and stopped short on the open steppe.
export function stationHeld(world, team, front = frontX(world)) {
  const station = stationOf(world);
  const side = world.railway.sides[team];
  if (!station || !side) return false;
  const past = (front - station.x) * side.dir;
  return past > world.trainsCfg.stationMargin || (side.held && past > -world.trainsCfg.stationMargin);
}

// The ramp a train unloads at, by its railhead.
function rampFor(world, t) {
  const cfg = world.trainsCfg;
  if (t.to === 'station') return stationOf(world).x - t.dir * cfg.stationRamp;
  const depot = depotOf(world, t.team);
  return (depot?.x ?? world.map.width / 2) + t.dir * cfg.depotRamp;
}

// The first flatcar still carrying its tank.
function nextLoad(world, t) {
  for (const id of t.cars) {
    const o = world.ground.find((g) => g.id === id);
    if (o?.type === 'flatcar' && o.alive && o.load) return o;
  }
  return null;
}

// Where the head must stand for the next loaded flatcar to be at the ramp.
function stopFor(world, t) {
  const car = nextLoad(world, t);
  const ramp = t.ramp ?? rampFor(world, t);
  return ramp + t.dir * (car?.at ?? 0);
}

// Lays the track again from the depot to the station: torn lengths made whole, missing ones put back.
function repairLine(world, team) {
  const depot = depotOf(world, team);
  const station = stationOf(world);
  if (!depot || !station) return;
  const lo = Math.min(depot.x, station.x);
  const hi = Math.max(depot.x, station.x);
  const track = world.groundDefs.track;
  const laid = world.ground.filter((o) => o.def?.tilt && o.x > lo && o.x < hi).sort((a, b) => a.x - b.x);
  for (const o of laid) {
    if (o.type === 'trackTorn' && track) {
      o.type = 'track';
      o.def = track;
    }
    o.alive = true;
    o.hp = o.maxHp = o.def.hp;
  }
  // A gap wider than a length and a half (a length taken away) gets lengths again, evenly; not over a bridge.
  const bridges = world.ground.filter((o) => o.type === 'railBridge');
  for (let i = 1; i < laid.length; i++) {
    const a = laid[i - 1].x;
    const b = laid[i].x;
    if (b - a < 72 || bridges.some((br) => br.x > a && br.x < b)) continue;
    const n = Math.round((b - a) / 47) - 1;
    for (let k = 1; k <= n; k++) {
      const o = makeGroundObject(world, 'track', null, a + ((b - a) * k) / (n + 1));
      if (o) world.ground.push(o);
    }
  }
  world.railway.laid++;
  world.events.push({ type: 'trackRepaired', team, from: lo, to: hi });
}

// --- Each tick ------------------------------------------------------------------------------------------------

// Each wagon along the line behind the head, at its height on the bed and tilted between its supports.
function placeWagons(world, t) {
  for (const id of t.cars) {
    const o = world.ground.find((g) => g.id === id);
    if (o) placeWagon(world, o, t.x - t.dir * o.at);
  }
}
function placeWagon(world, o, x) {
  o.x = x;
  const look = lookFor(world, o.def, o.team);
  const k = unitOf(o.def);
  const w = look?.size?.[0] ?? o.width / k;
  // Supports measured on the right-facing sprite from its left edge; a train going left is drawn mirrored.
  const [s1, s2] = (look?.supports ?? [w * 0.2, w * 0.8]).map((px) => x + o.dir * (px - w / 2) * k);
  const a = Math.min(s1, s2);
  const b = Math.max(s1, s2);
  const ha = bedAt(world, a);
  const hb = bedAt(world, b);
  o.tilt = Math.atan2(hb - ha, b - a);
  o.baseY = ha + (hb - ha) * ((x - a) / (b - a || 1)) + RAIL;
}

// A tank on its way down the ramp: off the deck, forward and down to the ground beside the line.
function stepRamp(world, u, dt) {
  const r = u.ramp;
  r.t = Math.min(1, r.t + dt / world.trainsCfg.rampTime);
  u.x = r.x + u.dir * RAMP_RUN * r.t;
  const ground = surfaceAt(world, u.x);
  u.baseY = r.y + (ground - r.y) * r.t;
  u.tilt = -u.dir * Math.atan2(r.y - ground, RAMP_RUN) * Math.sin(Math.PI * r.t) * 1.6;
  u.moving = true;
  if (r.t >= 1) {
    delete u.ramp;
    world.events.push({ type: 'tankOffRamp', id: u.id, team: u.team, x: u.x });
  }
}

export function stepTrains(world, dt) {
  if (!world.trains) return;
  const cfg = world.trainsCfg;
  const front = frontX(world);
  for (const [teamKey, side] of Object.entries(world.railway.sides)) {
    const team = Number(teamKey);
    side.held = stationHeld(world, team, front);
    // The first time a side's front passes the station, its rails from the depot are laid again.
    if (side.held && !side.repaired) {
      side.repaired = true;
      repairLine(world, team);
    }
    side.timer -= dt;
    const depot = depotOf(world, team);
    if (side.timer <= 0 && depot?.alive && !world.trains.some((t) => t.team === team)) {
      const t = makeTrain(world, team, tanksFor(world, team, depot));
      if (t) placeWagons(world, t);
      // As the waves, slower from a damaged depot; nothing to send now: look again shortly.
      side.timer = t ? cfg.interval * (1 + 1.5 * (1 - depot.hp / depot.maxHp)) : 10;
    }
  }

  for (const u of world.ground) if (u.ramp && u.alive) stepRamp(world, u, dt);

  for (let i = world.trains.length - 1; i >= 0; i--) {
    const t = world.trains[i];
    const cars = t.cars.map((id) => world.ground.find((g) => g.id === id)).filter(Boolean);
    // A wrecked flatcar's tank is lost with it.
    for (const o of cars) {
      if (o.type === 'flatcar' && !o.alive && o.load) {
        o.load = false;
        loadHeight(world, o);
        world.events.push({ type: 'trainLoadLost', id: o.id, team: t.team, x: o.x, y: o.baseY });
      }
    }
    if (t.phase === 'run') stepRun(world, t, dt);
    else if (t.phase === 'unload') stepUnload(world, t, dt, cars);
    else if (t.phase === 'back') {
      t.v = Math.min(cfg.speed, t.v + cfg.accel * dt);
      t.x -= t.dir * t.v * dt;
      // Gone once its last wagon is off the map.
      const tail = cars.reduce((m, o) => Math.max(m, o.at + o.width / 2), 0);
      if ((t.x - t.dir * tail - edgeX(world, t.dir)) * t.dir < -tail) {
        for (const o of cars) world.ground.splice(world.ground.indexOf(o), 1);
        world.trains.splice(i, 1);
        world.events.push({ type: 'trainOut', id: t.id, team: t.team });
        continue;
      }
    }
    placeWagons(world, t);
  }
}

function stepRun(world, t, dt) {
  const cfg = world.trainsCfg;
  if (!nextLoad(world, t)) {
    // Every flatcar wrecked on the way: back home.
    t.phase = 'back';
    t.v = 0;
    return;
  }
  if (t.to !== 'here') {
    const to = world.railway.sides[t.team].held && stationOf(world) ? 'station' : 'depot';
    if (to !== t.to) {
      const was = t.to;
      t.to = to;
      // The station lost with the train already past its depot: it stops where it can, behind the front.
      if (was === 'station' && (stopFor(world, t) - t.x) * t.dir < 0) {
        t.to = 'here';
        const car = nextLoad(world, t);
        t.ramp = t.x + t.dir * ((t.v * t.v) / (2 * cfg.accel) - car.at);
      }
    }
  }
  const dist = (stopFor(world, t) - t.x) * t.dir;
  const most = Math.min(cfg.speed, Math.sqrt(2 * cfg.accel * Math.max(0, dist)));
  t.v = Math.min(most, t.v + cfg.accel * dt);
  const step = Math.min(Math.max(0, dist), Math.max(t.v, 0.5) * dt);
  t.x += t.dir * step;
  if (dist - step <= 0.05) {
    t.ramp ??= rampFor(world, t);
    t.phase = 'unload';
    t.v = 0;
    world.events.push({ type: 'trainStop', id: t.id, team: t.team, x: t.x, at: t.to });
  }
}

// Brings each loaded flatcar to the ramp in turn and rolls its tank off; then backs out.
function stepUnload(world, t, dt) {
  const cfg = world.trainsCfg;
  if (t.rolling != null) {
    const tank = world.ground.find((g) => g.id === t.rolling);
    if (tank?.alive && tank.ramp) return;
    t.rolling = null;
  }
  const car = nextLoad(world, t);
  if (!car) {
    t.phase = 'back';
    t.v = 0;
    world.events.push({ type: 'trainEmpty', id: t.id, team: t.team, x: t.x });
    return;
  }
  const want = t.ramp + t.dir * car.at;
  const gap = (want - t.x) * t.dir;
  if (Math.abs(gap) > 0.05) {
    const step = Math.min(Math.abs(gap), cfg.creepSpeed * dt);
    t.x += Math.sign(gap) * t.dir * step;
    return;
  }
  // The tank drives off: a mobile unit from here on, though the army leaves it be until it is off the ramp.
  const tank = makeGroundObject(world, 'tank', t.team, car.x, { mobile: true });
  if (!tank) return;
  tank.dir = t.dir;
  tank.moving = true;
  tank.baseY = car.baseY + car.deck;
  tank.tilt = car.tilt;
  tank.ramp = { t: 0, x: car.x, y: car.baseY + car.deck };
  car.load = false;
  loadHeight(world, car);
  world.ground.push(tank);
  t.rolling = tank.id;
  world.events.push({ type: 'tankUnloaded', id: tank.id, team: t.team, x: car.x, train: t.id });
}

// The unloading ramps for drawing: each side's at its depot, and at the station once that side has held it.
export function rampsOf(world) {
  const out = [];
  for (const [teamKey, side] of Object.entries(world.railway?.sides ?? {})) {
    const team = Number(teamKey);
    const depot = depotOf(world, team);
    if (depot) out.push({ x: depot.x + side.dir * world.trainsCfg.depotRamp, dir: side.dir });
    const station = stationOf(world);
    if (station && side.repaired) out.push({ x: station.x - side.dir * world.trainsCfg.stationRamp, dir: side.dir });
  }
  return out;
}
