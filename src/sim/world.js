// The simulation: pure game state + rules. No DOM, no audio, no Math.random.
// Each tick takes one command object per controller ("p1", "bot3", later remote players),
// so online play only has to deliver those commands.
import { createRng } from './math.js';
import { buildTerrain, structurePads, DEFAULT_PADS } from './terrain.js';
import { createPlane, spawnAtAirfield, stepPlane, crash, NO_COMMAND } from './plane.js';
import { stepBullets, stepBombs } from './weapons.js';
import { collide, DEFAULT_COLLISIONS } from './collision.js';
import { botCommand } from './ai.js';
import { DEFAULT_SERVICING } from './airfield.js';
import { createGround, planesHitStructures } from './ground.js';
import { stepDefences, stepShells } from './defences.js';
import { DEFAULT_FIRE } from './fire.js';
import { createArmy, stepArmy, DEFAULT_WAVES } from './army.js';
import { stepRunways, DEFAULT_RUNWAY } from './runway.js';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

// bots: 'on' (fly and fight), 'passive' (fly but never shoot or bomb), 'off' (stay parked).
// autoGear: landing gear raises and lowers itself (G still overrides).
export const DEFAULT_RULES = { friendlyFire: false, ramming: true, bots: 'on', autoGear: true };

// servicing: ground-crew timings, kept as the caller's object so the tuning panel can edit it live.
// waves: how often and how big the tank columns are (src/sim/army.js).
// fire: how fires burn and are put out (src/sim/fire.js).
// runway: crater sizes on concrete, crater filling and runway points (src/sim/runway.js).
// groundDefs: ground object types (data/ground.json), shared the same way.
export function createWorld({
  map,
  planeDefs,
  weapons,
  groundDefs = {},
  rules = {},
  servicing = { ...DEFAULT_SERVICING },
  collisions = { ...DEFAULT_COLLISIONS },
  fire = { ...DEFAULT_FIRE },
  waves = { ...DEFAULT_WAVES },
  pads = { ...DEFAULT_PADS },
  runway = { ...DEFAULT_RUNWAY },
}) {
  const world = {
    tick: 0,
    map: structuredClone(map),
    planeDefs,
    weapons,
    groundDefs,
    rules: { ...DEFAULT_RULES, ...rules },
    servicing,
    collisions,
    fire,
    waves,
    runway,
    collisionGrace: new Map(), // pair of plane ids -> tick until which they can't collide again
    rng: createRng(map.seed ^ 0x5eed),
    planes: [],
    bullets: [],
    bombsInFlight: [],
    shells: [], // flak shells in flight
    events: [], // things that happened this tick, for sound and effects
    nextId: 1,
  };
  world.terrain = buildTerrain(world.map, structurePads(world.map, groundDefs, pads));
  createGround(world);
  createArmy(world);
  return world;
}

// controller: an input name ("p1") or "bot:<skill>" for a computer pilot.
export function addPlane(world, { defId, team, nation, controller }) {
  const def = world.planeDefs[defId];
  if (!def) throw new Error(`Unknown plane "${defId}"`);
  const p = createPlane(world.nextId++, def, {
    team,
    nation,
    seats: [{ role: 'pilot', controller }],
  });
  world.planes.push(p);
  spawnAtAirfield(p, world);
  return p;
}

export function stepWorld(world, commands) {
  world.events.length = 0;
  world.tick++;
  for (const p of world.planes) {
    const pilot = p.seats.find((s) => s.role === 'pilot');
    const ctl = pilot?.controller ?? '';
    let cmd = commands[ctl];
    if (ctl.startsWith('bot')) {
      if (world.rules.bots === 'off') cmd = NO_COMMAND;
      else cmd = botCommand(world, p, ctl.split(':')[1]);
      if (world.rules.bots === 'passive') cmd = { ...cmd, fire: false, bomb: false };
    }
    stepPlane(p, cmd ?? NO_COMMAND, world, DT);
  }
  stepArmy(world, DT);
  stepDefences(world, DT);
  stepBullets(world, DT);
  stepShells(world, DT);
  stepBombs(world, DT);
  stepRunways(world, DT);
  collide(world);
  planesHitStructures(world, crash);
}
