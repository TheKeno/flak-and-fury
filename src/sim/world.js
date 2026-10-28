// The simulation: pure game state + rules. No DOM, no audio, no Math.random.
// Each tick takes one command object per controller ("p1", "bot3", later remote players),
// so online play only has to deliver those commands.
import { createRng } from './math.js';
import { buildTerrain } from './terrain.js';
import { createPlane, spawnAtAirfield, stepPlane, NO_COMMAND } from './plane.js';
import { stepBullets, stepBombs, shootDown } from './weapons.js';
import { botCommand } from './ai.js';
import { DEFAULT_SERVICING } from './airfield.js';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

// bots: 'on' (fly and fight), 'passive' (fly but never shoot or bomb), 'off' (stay parked).
// autoGear: landing gear raises and lowers itself (G still overrides).
export const DEFAULT_RULES = { friendlyFire: false, ramming: true, bots: 'on', autoGear: true };

// servicing: ground-crew timings, kept as the caller's object so the tuning panel can edit it live.
export function createWorld({ map, planeDefs, weapons, rules = {}, servicing = { ...DEFAULT_SERVICING } }) {
  const world = {
    tick: 0,
    map: structuredClone(map),
    planeDefs,
    weapons,
    rules: { ...DEFAULT_RULES, ...rules },
    servicing,
    rng: createRng(map.seed ^ 0x5eed),
    planes: [],
    bullets: [],
    bombsInFlight: [],
    events: [], // things that happened this tick, for sound and effects
    nextId: 1,
  };
  world.terrain = buildTerrain(world.map);
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

function collide(world) {
  if (!world.rules.ramming) return;
  const air = world.planes.filter((p) => p.state === 'air');
  for (let i = 0; i < air.length; i++) {
    for (let j = i + 1; j < air.length; j++) {
      const a = air[i];
      const b = air[j];
      if (a.state !== 'air' || b.state !== 'air' || (a.dying && b.dying)) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > (a.def.hitRadius + b.def.hitRadius) * 0.8) continue;
      world.events.push({ type: 'collision', a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      if (!a.dying) shootDown(world, a, b.id);
      if (!b.dying) shootDown(world, b, a.id);
    }
  }
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
  stepBullets(world, DT);
  stepBombs(world, DT);
  collide(world);
}
