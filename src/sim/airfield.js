// Ground crew at your own airfield. Roll to a stop on your runway with the throttle at idle and they
// come out to repair, then refuel, then rearm, in that order. Opening the throttle sends them away;
// work already done is kept. A dry engine is started again once the tank is full.
import { clamp } from './math.js';
import { hangarHealth, hangarX } from './ground.js';
import { allGuns } from './weapons.js';

const FULL_TANK = 0.99;
const TOP_UP_BELOW = 0.9; // once serviced, an idling engine only brings the crew back below this

export const DEFAULT_SERVICING = { crewDelay: 1.2, crewWalkSpeed: 50, repairPerSec: 25, refuelTime: 5, rearmTime: 3, recoveryTime: 20 };

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
  if (!parked) {
    if (p.service && p.service.phase && p.service.phase !== 'done') world.events.push({ type: 'serviceAbort', plane: p.id });
    p.service = null;
    return;
  }
  if (!p.service) {
    // The crew always walk from the hangar, so a plane that stops far down the strip waits longer.
    const fromX = hangarX(world, ownAirfieldAt(world, p));
    const walk = Math.abs(p.x - fromX) / (cfg.crewWalkSpeed ?? DEFAULT_SERVICING.crewWalkSpeed);
    p.service = { wait: cfg.crewDelay + walk, phase: null, rearmT: 0, fromX, walk };
    world.events.push({ type: 'crewOut', plane: p.id, x: p.x, y: p.y });
  }
  const s = p.service;
  if (s.wait > 0) {
    s.wait -= dt;
    return;
  }
  dt *= hangar;

  const phase = needs(p, s.phase === 'done');
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
