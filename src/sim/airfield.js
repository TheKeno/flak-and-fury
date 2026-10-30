// Ground crew at your own airfield. Roll to a stop on your runway with the throttle at idle and they
// walk out from the hangar to repair, then refuel, then rearm, in that order, and walk back when done.
// Opening the throttle sends them away; work already done is kept. Roll into them and they die; others
// take over after a while. A dry engine is started again once the tank is full.
import { clamp } from './math.js';
import { hangarHealth, hangarX } from './ground.js';
import { allGuns } from './weapons.js';

const FULL_TANK = 0.99;
const TOP_UP_BELOW = 0.9; // once serviced, an idling engine only brings the crew back below this

export const DEFAULT_SERVICING = { crewDelay: 1.2, crewWalkSpeed: 50, crewRespawn: 3, repairPerSec: 25, refuelTime: 5, rearmTime: 3, recoveryTime: 20 };

// The ground crew are two mechanics in world.crew: { id, team, plane (the id they're sent to, null
// once they head home), slot, x, y, state, t }. state: wait (at the hangar, reacting), out (walking to
// the plane), work (at their job), back (walking home). Slot 0 works at the nose, slot 1 at the wing.
const CREW_AT = [9, -3]; // where along the plane each slot works, ahead of its centre
const CREW_LAG = 0.25; // seconds the second man sets off after the first
// Seconds the crew stand frozen at the job when the engine opens up: long enough for a plane opening
// the throttle fully to start rolling into them (the throttle takes about a second to open).
const CREW_STARTLE = 1.2;
const KILL_SPEED = 2.5; // a plane rolling faster than this runs down crew under its nose and wings
const DT_MIN = 1e-3; // keeps a waiting service's wait above 0
const walkSpeed = (cfg) => cfg.crewWalkSpeed ?? DEFAULT_SERVICING.crewWalkSpeed;
const facing = (p) => (Math.cos(p.angle) >= 0 ? 1 : -1);

// Sends out whoever the plane's crew is missing.
function sendCrew(world, p, crew) {
  const x = hangarX(world, ownAirfieldAt(world, p));
  const sent = [];
  for (let slot = 0; slot < CREW_AT.length; slot++) {
    if (crew.some((c) => c.slot === slot)) continue;
    sent.push({
      id: world.nextId++, team: p.team, plane: p.id, slot, x, y: world.terrain.heightAt(x),
      state: 'wait', t: world.servicing.crewDelay + sent.length * CREW_LAG,
    });
  }
  world.crew.push(...sent);
  world.events.push({ type: 'crewOut', plane: p.id, x: p.x, y: p.y });
  return sent;
}

// linger: seconds before they set off (caught out at the job by the engine opening up).
function sendBack(c, linger = 0) {
  c.plane = null;
  c.state = linger > 0 ? 'wait' : 'back';
  c.t = linger;
}

// Walks the crew, and kills any a rolling plane runs into. A dead crew is replaced crewRespawn
// seconds later: the next one walks out to whichever of the team's planes is waiting.
export function stepCrew(world, dt) {
  for (const team in world.crewDown) world.crewDown[team] = Math.max(0, world.crewDown[team] - dt);
  const speed = walkSpeed(world.servicing);
  for (let i = world.crew.length - 1; i >= 0; i--) {
    const c = world.crew[i];
    const p = c.plane != null ? world.planes.find((o) => o.id === c.plane) : null;
    if (c.plane != null && !p?.service) sendBack(c, c.state === 'work' ? CREW_STARTLE : 0);
    if (c.state === 'wait') {
      c.t -= dt;
      if (c.t <= 0) c.state = c.plane == null ? 'back' : 'out';
    } else {
      const target = c.state === 'back'
        ? hangarX(world, world.map.airfields.find((a) => a.team === c.team))
        : p.x + facing(p) * CREW_AT[c.slot];
      const d = target - c.x;
      if (Math.abs(d) <= speed * dt) {
        c.x = target;
        if (c.state === 'back') {
          world.crew.splice(i, 1);
          continue;
        }
        c.state = 'work';
      } else c.x += Math.sign(d) * speed * dt;
    }
    c.y = world.terrain.heightAt(c.x);
    const by = world.planes.find((o) => o.state === 'ground' && o.speed > KILL_SPEED && underPlane(o, c.x));
    if (by) killCrew(world, i, by);
  }
}

// Between the tail and just ahead of the propeller.
function underPlane(p, x) {
  const along = (x - p.x) * facing(p);
  return along > -p.def.hitRadius * 1.2 && along < (p.def.noseOffset?.[0] ?? 8) + 2;
}

function killCrew(world, i, p) {
  const c = world.crew[i];
  world.crew.splice(i, 1);
  world.crewDown[c.team] = world.servicing.crewRespawn ?? DEFAULT_SERVICING.crewRespawn;
  // Force in a soldier's hit points, as for infantry: the faster the plane, the worse it is.
  world.events.push({
    type: 'crewKilled', id: c.id, team: c.team, slot: c.slot, plane: p.id, x: c.x, y: c.y,
    dir: facing(p), force: Math.max(2, p.speed / 3), cause: 'runDown',
  });
}

// Planes hold still for the crew in front of them.
export const crewAhead = (world, p, range) =>
  world.crew.some((c) => c.team === p.team && (c.x - p.x) * facing(p) > -p.def.hitRadius * 1.2 && (c.x - p.x) * facing(p) < range);

export const ownAirfieldAt = (world, p) =>
  world.map.airfields.find((a) => a.team === p.team && p.x >= a.x && p.x <= a.x + a.width);

function needs(p, serviced) {
  if (p.hp < p.def.hp || p.engineDamage > 0 || p.burning || p.belly || p.tailDamage > 0 || p.wingPull !== 0 || p.propBent) return 'repair';
  // A stopped engine is started at the end of refuelling, even when the tank is already full.
  if (p.fuel < (serviced ? TOP_UP_BELOW : FULL_TANK) || !p.engineRunning) return 'refuel';
  const fullBombs = p.def.armament?.bombs?.count ?? 0;
  if (allGuns(p).some((g) => g.ammo < g.def.ammo * g.count) || (p.bombs && p.bombs.count < fullBombs)) return 'rearm';
  return 'done';
}

export function rearmFully(p) {
  for (const g of allGuns(p)) g.ammo = g.def.ammo * g.count;
  if (p.bombs) p.bombs.count = p.def.armament.bombs.count;
}

// How far along the current job is (0..1), for the HUD.
export function serviceProgress(p, world) {
  const s = p.service;
  if (!s || s.wait > 0) return 0;
  if (s.phase === 'repair') return clamp(p.hp / p.def.hp, 0, 1);
  if (s.phase === 'refuel') return p.fuel;
  if (s.phase === 'rearm') return clamp(s.rearmT / world.servicing.rearmTime, 0, 1);
  return 1;
}

// The crew work slower as their hangar is shelled, and not at all once it's destroyed.
export function updateServicing(p, world, dt) {
  const cfg = world.servicing;
  const hangar = hangarHealth(world, p.team);
  // With the engine stopped the throttle does nothing, so it needn't be at idle.
  const idle = p.throttle < 0.05 || !p.engineRunning;
  const parked = p.state === 'ground' && !p.dying && p.speed < 2 && idle && ownAirfieldAt(world, p) && hangar > 0;
  // Without a service the plane's crew walk back to the hangar (stepCrew).
  if (!parked) {
    if (p.service && p.service.phase && p.service.phase !== 'done') world.events.push({ type: 'serviceAbort', plane: p.id });
    p.service = null;
    return;
  }
  if (!p.service) p.service = { wait: 0, phase: null, rearmT: 0 };
  const s = p.service;
  const phase = needs(p, s.phase === 'done');
  const crew = world.crew.filter((c) => c.plane === p.id);
  if (phase === 'done') {
    if (s.phase !== 'done') {
      s.phase = 'done';
      world.events.push({ type: 'serviceDone', phase, plane: p.id, x: p.x, y: p.y });
    }
    s.wait = 0;
    for (const c of crew) sendBack(c);
    return;
  }
  if (crew.length < CREW_AT.length && !(world.crewDown[p.team] > 0)) {
    crew.push(...sendCrew(world, p, crew));
  }
  // Nothing is done until the whole crew are at the plane. wait: an estimate of the seconds until
  // then, for the HUD and the sound (a man who was killed is replaced after crewRespawn).
  if (crew.length < CREW_AT.length || crew.some((c) => c.state !== 'work')) {
    const home = hangarX(world, ownAirfieldAt(world, p));
    const walkFrom = (x) => Math.abs(p.x - x) / walkSpeed(cfg);
    const missing = crew.length < CREW_AT.length ? (world.crewDown[p.team] ?? 0) + cfg.crewDelay + walkFrom(home) : 0;
    const coming = crew.map((c) => (c.state === 'wait' ? c.t : 0) + (c.state === 'work' ? 0 : walkFrom(c.x)));
    s.wait = Math.max(missing, ...coming) + DT_MIN;
    return;
  }
  s.wait = 0;
  dt *= hangar;

  if (phase !== s.phase) {
    s.phase = phase;
    s.rearmT = 0;
    world.events.push({ type: phase === 'done' ? 'serviceDone' : 'servicePhase', phase, plane: p.id, x: p.x, y: p.y });
  }

  if (phase === 'repair') {
    // A fire is the crew's first job; it's put out by the fire rules (src/sim/fire.js).
    p.hp = Math.min(p.def.hp, p.hp + cfg.repairPerSec * dt);
    p.engineDamage = Math.max(0, p.engineDamage - (cfg.repairPerSec / p.def.hp) * dt);
    p.tailDamage = Math.max(0, p.tailDamage - (cfg.repairPerSec / p.def.hp) * dt);
    if (p.engineDamage <= 0) p.propBent = false; // new propeller fitted with the engine work
    const wingFix = (cfg.repairPerSec / p.def.hp) * dt;
    p.wingPull = Math.abs(p.wingPull) <= wingFix ? 0 : p.wingPull - Math.sign(p.wingPull) * wingFix;
    // Last job after a belly landing: jack the plane up, new propeller, gear down and locked.
    if (p.belly && p.hp >= p.def.hp && p.engineDamage <= 0) {
      p.belly = false;
      p.gear = 1;
      p.gearDown = true;
      world.events.push({ type: 'gearLocked', plane: p.id, down: true, x: p.x, y: p.y });
    }
  } else if (phase === 'refuel') {
    p.fuel = Math.min(1, p.fuel + dt / cfg.refuelTime);
    if (p.fuel >= FULL_TANK) {
      p.fuel = 1;
      p.lowFuelWarned = false;
      if (!p.engineRunning) {
        p.engineRunning = true;
        world.events.push({ type: 'engineStart', plane: p.id, x: p.x, y: p.y });
      }
    }
  } else if (phase === 'rearm') {
    s.rearmT += dt;
    if (s.rearmT >= cfg.rearmTime) rearmFully(p);
  }
}
