// The simulation: pure game state + rules. No DOM, no audio, no Math.random.
// Each tick takes one command object per controller ("p1", "bot3", later remote players),
// so online play only has to deliver those commands.
import { createRng } from './math.js';
import { buildTerrain, structurePads, DEFAULT_PADS, DEFAULT_ZONES } from './terrain.js';
import { createPlane, spawnAtAirfield, stepPlane, crash, NO_COMMAND, DEFAULT_LANDING } from './plane.js';
import { stepBullets, stepBombs } from './weapons.js';
import { collide, DEFAULT_COLLISIONS } from './collision.js';
import { botCommand, DEFAULT_BOTS, DEFAULT_RADAR } from './ai.js';
import { DEFAULT_SERVICING, stepCrew } from './airfield.js';
import { createGround, planesHitStructures } from './ground.js';
import { stepDefences, stepShells } from './defences.js';
import { DEFAULT_FIRE } from './fire.js';
import { createArmy, stepArmy, DEFAULT_WAVES } from './army.js';
import { stepRunways, DEFAULT_RUNWAY } from './runway.js';
import { DEFAULT_DECOR } from './decor.js';
import { DEFAULT_BAILOUT, bailOut, stepBailedPilot, stepGroundWreck, stepParachutes } from './bailout.js';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

// bots: 'on' (fly and fight), 'passive' (fly but never shoot or bomb), 'off' (stay parked).
// autoGear: landing gear raises and lowers itself (G still overrides).
// wingmen, enemies: how many bots fly with you and against you; wingmanSkill, enemySkill: their level
// (easy, normal, ace). Read by the game's setup (src/main.js) and the tuning panel.
export const DEFAULT_RULES = {
  friendlyFire: false,
  ramming: true,
  bots: 'on',
  autoGear: true,
  wingmen: 1,
  enemies: 2,
  wingmanSkill: 'normal',
  enemySkill: 'normal',
};

// servicing: ground-crew timings, kept as the caller's object so the tuning panel can edit it live.
// waves: how often and how big the tank columns are (src/sim/army.js).
// fire: how fires burn and are put out (src/sim/fire.js).
// decor: hedges, walls and trees placed from the map's zones (src/sim/decor.js).
// landing: how forgiving touchdowns are (src/sim/plane.js).
// runway: crater sizes on concrete, crater filling and runway points (src/sim/runway.js).
// bots: bot pilots' numbers and difficulty levels (src/sim/ai.js); radar: what their radar picture sees.
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
  zones = { ...DEFAULT_ZONES },
  runway = { ...DEFAULT_RUNWAY },
  landing = { ...DEFAULT_LANDING },
  decor = { ...DEFAULT_DECOR },
  bots = structuredClone(DEFAULT_BOTS),
  radar = { ...DEFAULT_RADAR },
  bailout = { ...DEFAULT_BAILOUT },
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
    landing,
    decor,
    bots,
    radar,
    bailout,
    collisionGrace: new Map(), // pair of plane ids -> tick until which they can't collide again
    rng: createRng(map.seed ^ 0x5eed),
    planes: [],
    bullets: [],
    bombsInFlight: [],
    shells: [], // flak shells in flight
    parachutes: [], // pilots coming down (src/sim/bailout.js)
    crew: [], // ground crew on foot (src/sim/airfield.js)
    crewDown: {}, // team -> seconds until a killed crew is replaced
    events: [], // things that happened this tick, for sound and effects
    nextId: 1,
  };
  world.terrain = buildTerrain(world.map, structurePads(world.map, groundDefs, pads), zones);
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
  p.fresh = true; // not flown yet: can still change side or plane for free (src/sim/seats.js)
  world.planes.push(p);
  spawnAtAirfield(p, world);
  return p;
}

// Sets a side's bots to count planes at the given level, adding or removing bot planes (humans are
// left alone). defId, nation: what new ones fly.
export function setBots(world, { team, count, skill, defId, nation }) {
  const bots = world.planes.filter((p) => p.team === team && p.seats.some((s) => s.controller.startsWith('bot')));
  for (const p of bots.slice(count)) world.planes.splice(world.planes.indexOf(p), 1);
  for (const p of bots.slice(0, count)) p.seats[0].controller = `bot:${skill}`;
  for (let i = bots.length; i < count; i++) addPlane(world, { defId, team, nation, controller: `bot:${skill}` });
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
    } else if (!p.wreck) {
      if (p.fresh && (cmd?.throttle > 0 || cmd?.fire || cmd?.bomb)) p.fresh = false;
      if (p.bailout) {
        stepBailedPilot(world, p, cmd, DT);
        continue;
      }
      // Players can go over the side anywhere, any time, by accident too.
      if (cmd?.abandon && p.state !== 'dead') {
        bailOut(world, p);
        continue;
      }
    }
    if (p.wreck && p.state === 'ground') stepGroundWreck(world, p, DT);
    else stepPlane(p, cmd ?? NO_COMMAND, world, DT);
  }
  // Wrecks are gone once they've hit the ground.
  for (let i = world.planes.length - 1; i >= 0; i--) if (world.planes[i].wreck && world.planes[i].state === 'dead') world.planes.splice(i, 1);
  stepCrew(world, DT);
  stepArmy(world, DT);
  stepDefences(world, DT);
  stepBullets(world, DT);
  stepShells(world, DT);
  stepBombs(world, DT);
  stepParachutes(world, DT);
  stepRunways(world, DT);
  collide(world);
  planesHitStructures(world, crash);
}
