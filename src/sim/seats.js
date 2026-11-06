// Who flies where. Each side has a number of planes; players take their places and bots fill the rest,
// so bots move when a player changes side. A side never has more than MAX_PER_SIDE players, and if
// players outnumber a side's planes both sides grow to match: 1 v 1 with both players together is
// those two against two bots.
import { createPlane, spawnAtAirfield, holdForPilot } from './plane.js';
import { setBots } from './world.js';
import { armPlane, validateLoadout, setLoadout, validateGuns, setGuns, canPrepare } from './weapons.js';
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
    if (s.defId) for (const p of world.planes.filter((o) => o.team === s.team && isBot(o) && o.def !== world.planeDefs[s.defId])) world.planes.splice(world.planes.indexOf(p), 1);
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
function refit(world, p, def, team, loadout = null, guns = null) {
  const keep = { kills: p.kills, deaths: p.deaths, score: p.score, callsign: p.callsign, switchedAt: p.switchedAt, fresh: p.fresh, bailout: p.bailout };
  Object.assign(p, createPlane(p.id, def, { team, nation: def.nation, seats: p.seats }), keep);
  p.loadout = loadout && validateLoadout(def, loadout, world.weapons);
  p.gunChoice = guns && validateGuns(def, guns, world.weapons);
  armPlane(p, world.weapons);
}

// A player changes side, plane, loadout, guns or all. loadout: [{hardpoint, weapon, count}] and guns: [{mount, weapon,
// count, ammo}] for the plane the player ends up in (checked by validateLoadout / validateGuns; a bad list falls back
// to the plane's default; guns [] is a plane with none). Returns null, or why
// not: 'full', 'wait', or for a loadout alone 'locked' (the plane is already out of the hangar doors) and
// 'invalid' (not allowed on this plane).
// - Waiting behind the hangar doors: swapped, the roll-out restarts.
// - Not flown yet: simply swapped, at the airfield.
// - Already down: takes effect for the next plane.
// - Flying, new side: he deserts (the plane burns, he parachutes out with a white flag).
// - Flying, new plane: the old one burns and he starts again at the airfield.
export function changeSeat(world, p, { team = p.team, defId = null, loadout = null, guns = null }, dt) {
  const def = (defId && world.planeDefs[defId]) || p.def;
  const newSide = team !== p.team;
  if (!newSide && def === p.def) {
    if (!loadout && !guns) return null;
    if (loadout && !validateLoadout(def, loadout, world.weapons)) return 'invalid';
    if (guns && !validateGuns(def, guns, world.weapons)) return 'invalid';
    if (!canPrepare(p)) return 'locked';
    if (loadout) setLoadout(p, loadout, world.weapons);
    if (guns) setGuns(p, guns, world.weapons);
    return null;
  }
  if (newSide && playersOn(world, team).length >= MAX_PER_SIDE) return 'full';
  // Still behind the hangar doors (not pushed out yet): the plane standing there is swapped and the roll-out
  // starts again from the queue's end. No wreck: nothing has flown.
  if (p.state === 'ground' && p.exitPhase === 'wait') {
    const hold = p.hold; // a parked-in plane stays inside after the swap
    refit(world, p, def, team, loadout, guns);
    spawnAtAirfield(p, world, true);
    p.hold = hold && p.exitPhase === 'wait';
    return null;
  }
  if (p.fresh && p.state === 'ground') {
    refit(world, p, def, team, loadout, guns);
    spawnAtAirfield(p, world, world.hangarStart);
    holdForPilot(p); // a new plane waits in the hangar for the pilot's choice
    return null;
  }
  if (p.switchedAt != null && (world.tick - p.switchedAt) * dt < world.bailout.switchWait) return 'wait';
  p.switchedAt = world.tick;
  if (p.state === 'dead') {
    const { x, y, respawnTimer } = p;
    refit(world, p, def, team, loadout, guns);
    Object.assign(p, { state: 'dead', x, y, respawnTimer });
    return null;
  }
  if (newSide) {
    bailOut(world, p, { deserter: true, team });
    const { x, y } = p;
    refit(world, p, def, team, loadout, guns);
    Object.assign(p, { state: 'dead', x, y, respawnTimer: 0 });
    return null;
  }
  makeWreck(world, p);
  refit(world, p, def, team, loadout, guns);
  spawnAtAirfield(p, world, world.hangarStart);
  holdForPilot(p);
  return null;
}
