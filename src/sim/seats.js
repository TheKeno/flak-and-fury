// Who flies where. Each side has a number of planes; players take their places and bots fill the rest,
// so bots move when a player changes side. A side never has more than MAX_PER_SIDE players, and if
// players outnumber a side's planes both sides grow to match: 1 v 1 with both players together is
// those two against two bots.
import { createPlane, spawnAtAirfield } from './plane.js';
import { setBots } from './world.js';
import { armPlane } from './weapons.js';
import { bailOut, makeWreck } from './bailout.js';

export const MAX_PLAYERS = 4;
export const MAX_PER_SIDE = 2;

const controllerOf = (p) => p.seats[0]?.controller ?? '';
export const isPlayer = (p) => !p.wreck && !controllerOf(p).startsWith('bot');
export const isBot = (p) => controllerOf(p).startsWith('bot');
export const playersOn = (world, team) => world.planes.filter((p) => p.team === team && isPlayer(p));

// sides: [{ team, defId, nation, skill, planes }]: what each side's bots fly, how good they are, and
// the planes the side should have (players included).
export function placeBots(world, sides) {
  const most = Math.max(...sides.map((s) => playersOn(world, s.team).length));
  for (const s of sides) {
    // A changed bot plane takes effect by replacing them.
    for (const p of world.planes.filter((o) => o.team === s.team && isBot(o) && o.def !== world.planeDefs[s.defId])) world.planes.splice(world.planes.indexOf(p), 1);
    const size = Math.max(s.planes, most);
    setBots(world, { team: s.team, defId: s.defId, nation: s.nation, skill: s.skill, count: size - playersOn(world, s.team).length });
  }
}

// The side a new player starts on: the one with fewer players, or null if the room is full.
export function freeSide(world, teams) {
  const total = teams.reduce((n, t) => n + playersOn(world, t).length, 0);
  if (total >= MAX_PLAYERS) return null;
  return teams.reduce((best, t) => (playersOn(world, t).length < playersOn(world, best).length ? t : best));
}

// Turns p into a fresh plane of the given type and side, keeping who flies it and their record.
function refit(world, p, def, team) {
  const keep = { kills: p.kills, deaths: p.deaths, score: p.score, callsign: p.callsign, switchedAt: p.switchedAt, fresh: p.fresh, bailout: p.bailout };
  Object.assign(p, createPlane(p.id, def, { team, nation: def.nation, seats: p.seats }), keep);
  armPlane(p, world.weapons);
}

// A player changes side, plane or both. Returns null, or why not: 'full' or 'wait'.
// - Not flown yet: simply swapped, at the airfield.
// - Already down: takes effect for the next plane.
// - Flying, new side: he deserts (the plane burns, he parachutes out with a white flag).
// - Flying, new plane: the old one burns and he starts again at the airfield.
export function changeSeat(world, p, { team = p.team, defId = null }, dt) {
  const def = (defId && world.planeDefs[defId]) || p.def;
  const newSide = team !== p.team;
  if (!newSide && def === p.def) return null;
  if (newSide && playersOn(world, team).length >= MAX_PER_SIDE) return 'full';
  if (p.fresh && p.state === 'ground') {
    refit(world, p, def, team);
    spawnAtAirfield(p, world);
    return null;
  }
  if (p.switchedAt != null && (world.tick - p.switchedAt) * dt < world.bailout.switchWait) return 'wait';
  p.switchedAt = world.tick;
  if (p.state === 'dead') {
    const { x, y, respawnTimer } = p;
    refit(world, p, def, team);
    Object.assign(p, { state: 'dead', x, y, respawnTimer });
    return null;
  }
  if (newSide) {
    bailOut(world, p, { deserter: true, team });
    const { x, y } = p;
    refit(world, p, def, team);
    Object.assign(p, { state: 'dead', x, y, respawnTimer: 0 });
    return null;
  }
  makeWreck(world, p);
  refit(world, p, def, team);
  spawnAtAirfield(p, world);
  return null;
}
