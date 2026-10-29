// Fire. A burning plane has a set time to live (burnTime) whatever its hit points: enough to put it
// down in the nearest field, rarely enough to make it home. Hits while burning shorten it. As the
// fire takes hold the engine coughs and loses power, and near the end it quits.
// Rolled to a stop, the pilot beats the fire out himself (pilotTime); on your own airstrip the
// ground crew have it out fast (crewTime). The time keeps running out while they work.
import { ownAirfieldAt } from './airfield.js';
import { hangarHealth } from './ground.js';

export const DEFAULT_FIRE = {
  burnTime: 20,
  hitShortens: 0.15,
  roughAt: 0.5,
  quitAt: 4,
  pilotTime: 5,
  crewTime: 1.5,
  engineHarm: 0.3,
};

// Sets a plane on fire. Returns false if it already burns or is past saving.
export function ignite(world, p) {
  if (p.burning || p.dying || p.state === 'dead') return false;
  p.burning = true;
  p.fireLeft = world.fire.burnTime;
  p.fireOut = 0;
  p.fireCough = false;
  world.events.push({ type: 'fire', plane: p.id, x: p.x, y: p.y });
  return true;
}

// Damage taken while burning feeds the fire.
export function fireHit(world, p, amount) {
  if (p.burning && !p.dying) p.fireLeft -= amount * world.fire.hitShortens;
}

// How far the fire has got, 0 (just caught) to 1 (about to finish the plane). For effects too.
export const fireStage = (world, p) => (p.burning ? 1 - Math.max(0, p.fireLeft) / world.fire.burnTime : 0);

function putOut(world, p, crew) {
  p.burning = false;
  p.fireOut = 0;
  p.fireCough = false;
  p.engineDamage = Math.min(1, p.engineDamage + world.fire.engineHarm);
  world.events.push({ type: 'fireOut', plane: p.id, crew, x: p.x, y: p.y });
  // An engine the fire stopped can be started again; one that ran dry can't.
  if (!p.engineRunning && p.fireStopped && p.fuel > 0) {
    p.engineRunning = true;
    world.events.push({ type: 'engineStart', plane: p.id, x: p.x, y: p.y });
  }
  p.fireStopped = false;
}

// shootDown is passed in to keep this module free of an import cycle with weapons.js.
export function stepFire(p, world, dt, shootDown) {
  if (!p.burning || p.dying || p.state === 'dead') return;
  const cfg = world.fire;
  p.fireLeft -= dt;

  // The engine: coughs and loses power more and more once the fire is past roughAt of its time...
  const left = Math.max(0, p.fireLeft) / cfg.burnTime;
  if (left < cfg.roughAt && world.rng.next() < dt * 5) p.fireCough = world.rng.next() < (1 - left / cfg.roughAt) * 0.6;
  // ...and quits in the last quitAt seconds.
  if (p.engineRunning && p.fireLeft < cfg.quitAt) {
    p.engineRunning = false;
    p.fireStopped = true;
    world.events.push({ type: 'engineFire', plane: p.id, x: p.x, y: p.y });
  }

  if (p.state === 'ground' && p.speed < 2) {
    // The ground crew, if their hangar still stands (slower as it's damaged); otherwise the pilot alone.
    const hangar = hangarHealth(world, p.team);
    const crew = Boolean(ownAirfieldAt(world, p)) && hangar > 0;
    p.fireOut += dt;
    if (p.fireOut >= (crew ? Math.min(cfg.pilotTime, cfg.crewTime / hangar) : cfg.pilotTime)) {
      putOut(world, p, crew);
      return;
    }
  } else p.fireOut = 0;

  if (p.fireLeft <= 0) shootDown(world, p, p.lastHitBy, 'fire');
}
