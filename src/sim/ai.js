// Bot pilots. A bot produces the same command object a human's keyboard does, from world state only,
// so bots stay deterministic (world.rng) and could later run on the host of an online match.
//
// Two layers. The decision layer picks a mode a few times a second (as fast as the skill level reacts):
// patrol behind the front, chase an enemy plane, evade one on its tail, attack ground targets near
// home, go home to land and be serviced, or put a burning or dead-engined plane down. The flying layer
// turns "point the nose here, at this speed" into keys, and keeps the plane out of the ground, the
// stall, the blackout ceiling, the map edges and enemy flak.
//
// Bots see enemy planes within their lookout range; further out only what their side's radar shows
// (plotted once a sweep, missing low flyers, degraded as the radar station is damaged).
import { angleDiff, clamp } from './math.js';
import { isUpright, GRAVITY, stiffness, turnAuthority } from './plane.js';
import { ownAirfieldAt, crewAhead } from './airfield.js';
import { hangarHealth, radarHealth, surfaceAt } from './ground.js';
import { allGuns, flyingDef, loadFraction, bombsLeft, bombsFull, nextStation } from './weapons.js';
import { tacticsFor } from './tactics.js';
import { DEFAULT_FLIGHT, turnAt, cutsOut } from './air.js';

const DT = 1 / 60;
const GENTLE_PUSH = new Set(['patrol', 'chase', 'attack', 'evade', 'extend']); // modes where a carburettor bot avoids negative g
const PULL_ROLL_HOLD = 90; // ticks a bot stays rolled over after rolling to pull instead of push

// Shared numbers, then one block per difficulty level. Kept as the caller's object (settings.bots) so
// the tuning panel edits them live.
export const DEFAULT_BOTS = {
  names: [], // callsigns bots draw from (settings.bots.names)
  cruiseHeight: 220, // patrol height above the ground
  terrainClear: 55, // ground clearance kept in ordinary flight
  rushExit: 1, // patrol: too slow for a turn right round, a bot flies on until this many times the entry speed (1 = off; in fights it hurt the duels)
  patrolSplitHeight: 0, // patrol: 0 off; else above this height over the ground the reversal at the end of the beat is a split-S, below it a half loop (off: it flew lower, into flak and buildings, 3d)
  patrolSpan: 500, // length of the patrol beat behind the front
  flakMargin: 80, // extra distance kept outside enemy flak's reach
  groundRange: 2300, // how far from their hangar bots go after ground targets
  bomberRange: 3500, // the same for a dive bomber with bombs aboard (it goes under flak too)
  bombHeight: 110, // level bombing height
  strafePullout: 40, // height at which a strafing dive pulls out
  playerPull: 300, // a human enemy counts as this much nearer when a bot picks whom to fight
  bomberFightRange: 450, // a dive bomber with bombs aboard ignores enemy planes farther than this and bombs its target
  boomHeight: 150, // least height over the enemy a dive-from-above style (tactics style 0.5+) climbs to first
  approachLength: 500, // final approach: distance from the gate to the touchdown point
  glideSlope: 0.12, // final approach descent (rad)
  approachSpeed: 0.8, // share of the plane's max landing speed on final
  fuelReserve: 0.08, // fuel kept over what the trip home needs
  takeoffGap: 4, // seconds between bots of one side taking off together
  mixFighter: 75, // what a new bot flies, as weights (any scale): fighters, heavy fighters, dive bombers
  mixHeavy: 20,
  mixDiveBomber: 5,
  switchMin: 2, // a bot changes plane after this many deaths at least, this many at most
  switchMax: 4,
  emergencyWear: 0.25, // a bot stops using emergency power once its engine is this worn
  emergencyRange: 350, // limping home, a bot uses it when an enemy is this close
  levels: {
    easy: { turnFight: 0, reaction: 0.6, lookout: 380, aimError: 0.06, leadError: 0.25, turnError: 0.6, aimTolerance: 0.1, fireRange: 200, evadeChance: 0.3, stallMargin: 0.35, turnHard: 0.75, flakAvoid: 0.4, bombError: 30, hpReturn: 0.25, ammoReturn: 0.05 },
    normal: { turnFight: 0.5, reaction: 0.35, lookout: 520, aimError: 0.03, leadError: 0.15, turnError: 0.4, aimTolerance: 0.07, fireRange: 230, evadeChance: 0.6, stallMargin: 0.2, turnHard: 0.9, flakAvoid: 0.8, bombError: 15, hpReturn: 0.35, ammoReturn: 0.1 },
    ace: { turnFight: 0.5, reaction: 0.18, lookout: 700, aimError: 0.01, leadError: 0.07, turnError: 0.2, aimTolerance: 0.045, fireRange: 250, evadeChance: 0.9, stallMargin: 0.1, turnHard: 1, flakAvoid: 1, bombError: 6, hpReturn: 0.45, ammoReturn: 0.15 },
  },
};

// The radar numbers bots use (settings.radar): seconds per sweep, the low-level gap, and how often a
// damaged station drops a contact.
export const DEFAULT_RADAR = { sweepTime: 2.5, lowGap: 60, dropout: 0.6 };
export const levelOf = (world, name) => world.bots.levels[name] ?? world.bots.levels.normal;

const IDLE = () => ({ turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false, emergency: false });
const isBotPlane = (p) => p.seats.some((s) => s.controller.startsWith('bot'));
// Absolute nose angle for flying towards dir (1 right, -1 left) at a pitch (rad, + up).
const angleFor = (dir, pitch) => (dir > 0 ? pitch : Math.PI - pitch);
const facing = (p) => (Math.cos(p.angle) >= 0 ? 1 : -1);
const homeField = (world, team) => world.map.airfields.find((a) => a.team === team) ?? world.map.airfields[0];
// Which way the enemy lies from a side's airfield.
function enemyDir(world, team) {
  const own = homeField(world, team);
  const other = world.map.airfields.find((a) => a.team !== team);
  if (!other) return own.x + own.width / 2 < world.map.width / 2 ? 1 : -1;
  return Math.sign(other.x - own.x) || 1;
}

export function botCommand(world, p, skillName = 'normal') {
  const skill = levelOf(world, skillName);
  if (p.state === 'dead') {
    p.bot = null;
    return IDLE();
  }
  const b = (p.bot ??= newMemory(world, p));
  b.skill = skill;
  b.aimOff = clamp(b.aimOff + world.rng.range(-1, 1) * skill.aimError * DT * 4, -skill.aimError, skill.aimError);
  // The pilot's judgement of the lead wanders the same way: how far ahead the target will be (leadOff, a
  // share of the true lead) and how much a turning target bends away (turnOff).
  const lead = skill.leadError ?? 0;
  const bend = skill.turnError ?? 0;
  b.leadOff = clamp((b.leadOff ?? 0) + world.rng.range(-1, 1) * lead * DT * 4, -lead, lead);
  b.turnOff = clamp((b.turnOff ?? 0) + world.rng.range(-1, 1) * bend * DT * 4, -bend, bend);
  if (p.state === 'ground') return groundCommand(world, p, b);

  b.think -= DT;
  if (b.think <= 0) {
    b.think = skill.reaction * world.rng.range(0.7, 1.3);
    decide(world, p, b, skill);
  }
  const cmd = airCommand(world, p, b, skill);
  b.lastSpeed = p.speed;
  return cmd;
}

function newMemory(world, p) {
  const mates = world.planes.filter((o) => o.team === p.team && isBotPlane(o));
  const index = Math.max(0, mates.indexOf(p));
  // A bot alongside a human waits its turn behind the human.
  const humans = world.planes.some((o) => o.team === p.team && !isBotPlane(o));
  return {
    mode: 'patrol',
    think: 0,
    index,
    wait: p.state === 'ground' ? world.bots.takeoffGap * (index + (humans ? 1 : 0)) : 0,
    aimOff: 0,
    leadOff: 0,
    turnOff: 0,
    target: null, // enemy plane id (chase, evade) or ground object id (attack)
    leg: 1, // patrol beat end, or approach leg
    run: null, // ground attack pass: { dir, phase }
    evadeT: 0,
    evadeDir: 1,
    bombOff: 0,
    lastSpeed: p.speed,
    site: null, // emergency landing spot: { x, dir, home }
    taxi: false,
  };
}

// ---------------------------------------------------------------------------------------------------
// On the ground: wait for the crew, line up on the longest run towards the enemy, take off.

// Does this plane want the ground crew? (Like the crew's own list in airfield.js.)
function needsService(p) {
  if (p.hp < p.def.hp || p.engineDamage > 0 || p.tailDamage > 0 || p.wingPull !== 0 || p.propBent || p.belly) return true;
  if (p.fuel < 0.9 || !p.engineRunning) return true;
  return allGuns(p).some((g) => g.ammo < g.full) || bombsLeft(p) < bombsFull(p);
}

function groundCommand(world, p, b) {
  const cmd = IDLE();
  b.mode = 'ground';
  b.site = null;
  b.run = null;
  b.emergency = false;
  b.climbOut = undefined;
  b.think = 0;
  const home = ownAirfieldAt(world, p);
  // Burning, on the belly or with a dead engine: sit still for the fire to go out or the recovery crew.
  if (p.burning || p.belly || !p.engineRunning) {
    cmd.throttle = -1;
    return cmd;
  }
  const crew = home && hangarHealth(world, p.team) > 0;
  if (crew && (needsService(p) || (p.service && p.service.phase !== 'done'))) {
    cmd.throttle = -1;
    b.taxi = false;
    return cmd;
  }
  // Our own mechanics under the nose or walking the runway ahead: wait for them to get clear.
  if (p.speed < 15 && crewAhead(world, p, 150)) {
    cmd.throttle = -1;
    return cmd;
  }
  if (b.wait > 0) {
    b.wait -= DT;
    cmd.throttle = -1;
    return cmd;
  }
  const dir = facing(p);
  // Rolling for take-off: committed, full power; lift off at take-off speed with a margin, or at the
  // bare speed when the runway is running out.
  if (p.speed > 15 && !b.taxi) {
    const af = home && home.height != null ? home : null;
    const left = af ? (dir > 0 ? af.x + af.width - p.x : p.x - af.x) : Infinity;
    cmd.throttle = 1;
    if (p.speed >= flyingDef(p, world).takeoffSpeed + (left > 60 ? 5 : 0)) cmd.turn = dir;
    return cmd;
  }
  // Someone of ours rolling ahead, or just off the ground in front: let them get clear.
  for (const o of world.planes) {
    if (o === p || o.team !== p.team || o.state === 'dead') continue;
    const ahead = (o.x - p.x) * dir;
    const low = o.state === 'air' && o.y - world.terrain.heightAt(o.x) < 60;
    if (ahead > 0 && ahead < 200 && ((o.state === 'ground' && o.speed > 3) || low)) {
      cmd.throttle = -1;
      return cmd;
    }
  }

  // Take off towards the enemy if the runway allows; otherwise taxi to the far end and turn round.
  // The whole runway is clear now: take off from the far end unless most of it lies ahead.
  // Planes queued out of the hangar stand further down the runway: that is not "too short", so the queue's length is allowed for.
  const hd = world.ground.find((o) => o.type === 'hangar' && o.team === p.team)?.def ?? {};
  const queue = (hd.queueSize ?? 3) * (hd.slotGap ?? 34);
  const need = home ? home.width - 60 - queue : 0;
  const toward = enemyDir(world, p.team);
  if (home && home.height != null && p.speed < 25) {
    const clear = { from: home.x, to: home.x + home.width };
    const run = (d) => (d > 0 ? clear.to - p.x : p.x - clear.from);
    // Room enough towards the enemy but facing the other way (after a landing roll): turn round.
    if (!b.taxi && dir !== toward && run(toward) >= need && p.speed < 4) {
      cmd.roll = !p.prevRoll;
      cmd.throttle = -1;
      return cmd;
    }
    if (!b.taxi && run(toward) < need && run(-toward) > 20) b.taxi = true;
    if (b.taxi) {
      if (dir === toward) {
        if (p.speed < 4) cmd.roll = !p.prevRoll; // stopped: turn round to taxi back
        cmd.throttle = -1;
        return cmd;
      }
      if (run(dir) > 18) {
        cmd.throttle = p.speed < 10 ? 1 : -1;
        return cmd;
      }
      // At the end: stop, then turn to face the enemy.
      cmd.throttle = -1;
      if (p.speed < 4) {
        cmd.roll = !p.prevRoll;
        b.taxi = false;
      }
      return cmd;
    }
  }
  // In a field: take off only with a clear run ahead (grass is slower); turn round for one behind; with
  // neither, give the plane up (B) rather than sit there.
  if (!home && p.speed < 4) {
    const length = need * 1.4;
    if (!fieldRun(world, p.x, dir, length)) {
      if (fieldRun(world, p.x, -dir, length)) cmd.roll = !p.prevRoll;
      else cmd.abandon = true;
      cmd.throttle = -1;
      return cmd;
    }
  }
  cmd.throttle = 1;
  if (p.speed >= flyingDef(p, world).takeoffSpeed + 5) cmd.turn = dir;
  return cmd;
}

// A take-off run of length from x in direction dir over open ground: no steep slope, nothing standing
// in the way, no river, not off the map.
function fieldRun(world, x, dir, length) {
  const end = x + dir * length;
  if (Math.min(x, end) < 20 || Math.max(x, end) > world.map.width - 20) return false;
  for (let k = 10; k <= length; k += 10) if (Math.abs(world.terrain.slopeAngle(x + dir * k)) > 0.15) return false;
  const lo = Math.min(x, end);
  const hi = Math.max(x, end);
  if ((world.map.rivers ?? []).some((r) => r.x < hi && r.x + r.width > lo)) return false;
  return !world.ground.some((o) => o.alive && (o.def.solid || o.def.obstacle || o.mobile) && o.x + 12 > lo && o.x - 12 < hi && (o.x - x) * dir > 8);
}

// ---------------------------------------------------------------------------------------------------
// What the bot knows about enemy planes.

// The radar picture of each side, refreshed once a sweep: enemy planes above the low-level gap, some
// dropping out and drifting as the station is damaged.
function radarPicture(world, team) {
  world.botRadar ??= {};
  let r = world.botRadar[team];
  if (!r) r = world.botRadar[team] = { next: 0, plots: new Map() };
  if (world.tick < r.next) return r.plots;
  const cfg = world.radar;
  r.next = world.tick + Math.round(cfg.sweepTime * 60);
  r.plots = new Map();
  const health = radarHealth(world, team);
  if (health <= 0) return r.plots;
  for (const o of world.planes) {
    if (o.team === team || o.state !== 'air' || o.dying) continue;
    if (o.y - world.terrain.heightAt(o.x) < cfg.lowGap) continue;
    if (world.rng.next() < (1 - health) * cfg.dropout) continue;
    const blur = (1 - health) * 80;
    r.plots.set(o.id, { x: o.x + world.rng.range(-blur, blur), y: o.y + world.rng.range(-blur, blur) });
  }
  return r.plots;
}

// Enemy planes in the air this bot knows of: { plane, seen, x, y, d }.
function knownEnemies(world, p, skill) {
  const plots = radarPicture(world, p.team);
  const out = [];
  for (const o of world.planes) {
    if (o.team === p.team || o.state !== 'air' || o.dying) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < skill.lookout) out.push({ plane: o, seen: true, x: o.x, y: o.y, d });
    else {
      const plot = plots.get(o.id);
      if (plot) out.push({ plane: o, seen: false, x: plot.x, y: plot.y, d: Math.hypot(plot.x - p.x, plot.y - p.y) });
    }
  }
  return out;
}

// An enemy close behind with its nose on us.
function tailThreat(world, p, known) {
  const hx = Math.cos(p.angle);
  const hy = Math.sin(p.angle);
  let best = null;
  for (const k of known) {
    if (!k.seen || k.d > 350 || k.d < 1) continue;
    const o = k.plane;
    const rx = (p.x - o.x) / k.d;
    const ry = (p.y - o.y) / k.d;
    const aimed = Math.cos(o.angle) * rx + Math.sin(o.angle) * ry; // its nose towards us
    const behind = -(hx * rx + hy * ry); // it's not in front of us
    if (aimed > 0.94 && behind < 0.3 && (!best || k.d < best.d)) best = k;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------
// Ground defences seen from the air.

// How deep (world units) the point is inside an enemy flak gun's reach, above its minimum height; 0 if
// outside every one.
function flakDepth(world, team, x, y) {
  let depth = 0;
  for (const o of world.ground) {
    if (o.type !== 'flak' || !o.alive || o.team === team) continue;
    if (y - world.terrain.heightAt(x) < (o.def.minAltitude ?? 0)) continue;
    const d = Math.hypot(x - o.x, y - surfaceAt(world, o.x));
    depth = Math.max(depth, o.def.range + world.bots.flakMargin - d);
  }
  return depth;
}

// How far towards the enemy a side's planes can patrol before enemy flak reaches them at cruise height.
function flakLine(world, team) {
  const dir = enemyDir(world, team);
  let line = dir > 0 ? world.map.width : 0;
  for (const o of world.ground) {
    if (o.type !== 'flak' || !o.alive || o.team === team) continue;
    const reach = Math.sqrt(Math.max(0, o.def.range ** 2 - world.bots.cruiseHeight ** 2)) + world.bots.flakMargin;
    const edge = o.x - dir * reach;
    line = dir > 0 ? Math.min(line, edge) : Math.max(line, edge);
  }
  return line;
}

// Lowest safe height (absolute y) at x with enemy MG nests about: out of their reach, as far as the
// bot bothers (flakAvoid).
function nestFloor(world, team, x, skill) {
  let floor = -Infinity;
  for (const o of world.ground) {
    if (o.type !== 'mgNest' || !o.alive || o.team === team) continue;
    const dx = Math.abs(x - o.x);
    if (dx > o.def.range) continue;
    floor = Math.max(floor, surfaceAt(world, o.x) + Math.sqrt(o.def.range ** 2 - dx * dx) * skill.flakAvoid + 15);
  }
  return floor;
}

// The highest thing at x a plane can hit: the ground, or a tree, tower, building or mast on it.
// Cached per 10-unit column, rebuilt every second.
function skyline(world, x) {
  const s = world.botSkyline;
  if (!s || world.tick >= s.until) {
    const cols = new Float32Array(Math.ceil(world.map.width / 10) + 1).fill(-Infinity);
    for (const o of world.ground) {
      if (!o.alive || !o.def.solid) continue;
      const half = (o.width ?? o.def.width) / 2;
      const top = surfaceAt(world, o.x) + (o.height ?? o.def.height);
      for (let c = Math.floor((o.x - half) / 10); c <= Math.floor((o.x + half) / 10); c++) if (c >= 0 && c < cols.length) cols[c] = Math.max(cols[c], top);
    }
    world.botSkyline = { cols, until: world.tick + 60 };
  }
  const c = Math.floor(x / 10);
  const top = world.botSkyline.cols[c] ?? -Infinity;
  return Math.max(world.terrain.heightAt(x), top);
}

// Highest ground (and anything standing on it) from x over the next `span` units in direction dir.
function floorAhead(world, x, dir, span) {
  let floor = skyline(world, x);
  // Every 10 units: a tower or a pine is only 10 wide.
  for (let k = 10; k <= span; k += 10) floor = Math.max(floor, skyline(world, clamp(x + dir * k, 0, world.map.width)));
  return floor;
}

// ---------------------------------------------------------------------------------------------------
// Decisions.

function teamFront(world, team) {
  const dir = enemyDir(world, team);
  let ours = null;
  let theirs = null;
  for (const o of world.ground) {
    if (!o.mobile || !o.alive || o.team == null) continue;
    if (o.team === team) ours = ours === null ? o.x : dir > 0 ? Math.max(ours, o.x) : Math.min(ours, o.x);
    else theirs = theirs === null ? o.x : dir > 0 ? Math.min(theirs, o.x) : Math.max(theirs, o.x);
  }
  if (ours !== null && theirs !== null) return (ours + theirs) / 2;
  if (ours !== null || theirs !== null) return ours ?? theirs;
  return world.ground.find((o) => o.type === 'bridge')?.x ?? world.map.width / 2;
}

const ammoShare = (p) => {
  let have = 0;
  let full = 0;
  for (const g of p.guns) {
    have += g.ammo * g.def.damage;
    full += g.full * g.def.damage;
  }
  return full > 0 ? have / full : 0;
};

// Where a side's planes touch down: inside the clear stretch at the end facing the enemy, rolling
// out towards the hangar.
function touchdown(world, team) {
  const af = homeField(world, team);
  const dir = enemyDir(world, team);
  const clear = { from: af.x, to: af.x + af.width };
  // end: the far end of the clear stretch, where the roll-out must have stopped.
  return { x: dir > 0 ? clear.to - 20 : clear.from + 20, y: (af.height ?? world.terrain.heightAt(af.x)) + 4, roll: -dir, end: dir > 0 ? clear.from : clear.to };
}

function wantsHome(world, p, skill, tac = null) {
  const cfg = world.bots;
  const t = touchdown(world, p.team);
  const homeX = t?.x ?? homeField(world, p.team).x;
  const burn = (0.12 + 0.88 * 0.85) / p.def.endurance; // per second at cruise
  const trip = (Math.abs(p.x - homeX) + cfg.approachLength + 400) / 120;
  if (p.fuel < trip * burn + cfg.fuelReserve) return true;
  // Tactics fightDamaged 1 stays in the fight to half the hit points, and with a worse engine.
  const stay = tac?.fightDamaged ?? 0;
  if (p.hp < p.def.hp * skill.hpReturn * (1 - 0.5 * stay) || p.engineDamage > 0.5 + 0.25 * stay || p.tailDamage > 0.5 || Math.abs(p.wingPull) > 0.3) return true;
  return ammoShare(p) < skill.ammoReturn && bombsLeft(p) === 0;
}

function decide(world, p, b, skill) {
  // Burning or engine dead: committed to putting it down, home or in a field. No more fighting.
  if ((p.burning || !p.engineRunning) && !b.emergency) {
    b.emergency = true;
    b.site = landingSite(world, p);
    b.mode = b.site.home ? 'home' : 'emergency';
    b.leg = 0;
  }
  if (b.emergency) return;
  b.tac = tacticsFor(world, p); // per plane, read again each decision so the tuning panel applies at once
  const known = knownEnemies(world, p, skill);
  // Final approach is only broken off for a plane on the tail, and only by the alert.
  const threat = tailThreat(world, p, known);
  // How long an enemy has sat on our tail: the measure of a losing fight (it fades twice as fast).
  const since = b.lastDecide != null ? (world.tick - b.lastDecide) / 60 : 0;
  b.lastDecide = world.tick;
  b.tailTime = threat ? (b.tailTime ?? 0) + since : Math.max(0, (b.tailTime ?? 0) - since * 2);
  if (b.mode === 'extend') {
    if (b.extendT > 0) return;
    b.tailTime = 0;
  }
  // Losing for longer than this plane's tactics allow: give the fight up and dive away at full power.
  const fighting = b.mode === 'chase' || b.mode === 'evade' || b.mode === 'patrol';
  if (threat && fighting && b.tac.breakOff > 0 && b.tailTime >= b.tac.breakOff) {
    b.mode = 'extend';
    b.extendT = world.rng.range(3, 5);
    b.target = threat.plane.id;
    return;
  }
  // Low on final, breaking hard is worse than the attacker: carry on and land.
  const shortFinal = b.mode === 'final' && p.y - world.terrain.heightAt(p.x) < 60;
  // A boom-and-zoom bot running out after a pass, faster than the plane behind it, runs on instead of
  // breaking into a turn (which throws away the speed that is its whole defence).
  // With height to spare it dives away even when slower: a break turn this slow ends in a stall.
  // Never from a human on its tail: diving away again and again from the player (never fighting back) was
  // dull and too easy (part 3e); it breaks and fights instead. Bots against bots keep the rule.
  const room = p.y - world.terrain.heightAt(p.x) > 180;
  if (threat && isBotPlane(threat.plane) && b.mode === 'chase' && b.tac.style >= 0.5 && b.zoom?.phase === 'climb' && (room || p.speed > threat.plane.speed + 10)) {
    b.mode = 'extend';
    b.extendT = world.rng.range(2, 3);
    b.target = threat.plane.id;
    return;
  }
  if (threat && !shortFinal && world.rng.next() < skill.evadeChance * (b.mode === 'final' ? 0.5 : 1)) {
    if (b.mode !== 'evade') {
      const hx = Math.cos(p.angle);
      const hy = Math.sin(p.angle);
      const side = Math.sign(hx * (threat.y - p.y) - hy * (threat.x - p.x)) || 1;
      const low = p.y - world.terrain.heightAt(p.x) < 140;
      // Break towards the attacker to make it overshoot; low down, always break upwards.
      b.evadeDir = low ? facing(p) : side;
      b.evadeT = world.rng.range(1, 2);
    }
    b.mode = 'evade';
    b.target = threat.plane.id;
    return;
  }
  if (b.mode === 'evade' && b.evadeT > 0) return;
  if (b.mode === 'home' || b.mode === 'final') return; // stays on its way home once decided
  if (wantsHome(world, p, skill, b.tac)) {
    b.mode = 'home';
    b.leg = 0;
    return;
  }
  let enemy = pickEnemy(world, p, skill, known);
  // A dive bomber with bombs aboard goes for its ground target; it fights only an enemy that has come close
  // (a Stuka turn-fighting fighters stalled 60 times in 6 minutes and never bombed: part 3d).
  if (enemy && p.def.role === 'dive bomber' && bombsLeft(p) > 0 && enemy.d > (world.bots.bomberFightRange ?? 450)) enemy = null;
  if (enemy) {
    // A new fight starts with a new plan; back from running out on the same enemy, the pass plan goes on.
    if ((b.mode !== 'chase' && b.mode !== 'extend') || b.target !== enemy.plane.id) b.zoom = null;
    b.mode = 'chase';
    b.target = enemy.plane.id;
    return;
  }
  const ground = pickGroundTarget(world, p, b);
  if (ground) {
    if (b.mode !== 'attack' || b.target !== ground.id) {
      b.run = { dir: Math.sign(ground.x - p.x) || facing(p), phase: 'in' };
      b.bombOff = world.rng.range(-1, 1) * skill.bombError;
    }
    b.mode = 'attack';
    b.target = ground.id;
    return;
  }
  b.mode = 'patrol';
  b.target = null;
}

function pickEnemy(world, p, skill, known) {
  if (ammoShare(p) <= 0) return null;
  const depthLimit = (1 - skill.flakAvoid) * 700;
  let best = null;
  let bestScore = Infinity;
  for (const k of known) {
    if (flakDepth(world, p.team, k.x, k.y) > depthLimit) continue;
    // Prefer planes we can see, and ones already being hunted by us.
    // Damaged or smoking ones count as nearer (tactics finishBonus).
    const hurt = clamp(1 - k.plane.hp / k.plane.def.hp + (k.plane.engineDamage > 0 ? 0.3 : 0), 0, 1);
    // A human counts as nearer (playerPull): bots that went for the nearest plane spent much of a fight on the
    // player's wingman and flew off in front of the player (part 3e). No humans in bot-only matches.
    const score = k.d + (k.seen ? 0 : 300) - (k.plane.id === p.bot?.target ? 150 : 0) - hurt * (p.bot?.tac?.finishBonus ?? 0)
      - (isBotPlane(k.plane) ? 0 : world.bots.playerPull ?? 0);
    if (score < bestScore) {
      best = k;
      bestScore = score;
    }
  }
  return best;
}

// Enemy ground units worth a pass: tanks for bombs, soldiers and loaded trucks for the guns. Closer to home counts more,
// and anything near our own engineers or on the bridge. Never under enemy flak, never on or by our own
// runway (we'd crater it), and no bombs on a tank by a standing bridge (the bridge would go too).
function pickGroundTarget(world, p, b) {
  const cfg = world.bots;
  const af = homeField(world, p.team);
  const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === p.team);
  const homeX = hangar?.x ?? af.x + af.width / 2;
  const bombs = bombsLeft(p);
  const guns = ammoShare(p) > 0.15;
  const engineers = world.ground.filter((o) => o.type === 'engineers' && o.alive && o.team === p.team);
  const bridge = world.ground.find((o) => o.type === 'bridge');
  // A dive bomber with bombs aboard reaches farther and goes for tanks under the enemy's flak as well: kept
  // within groundRange and out of the flak it found no tank most of the time and patrolled instead,
  // climbing in the patrol sawtooth (part 3e: the owner saw no Stuka bomb). It dies no more often for it
  // (6-minute runs against two Spitfires: bombs 0.8 -> 8.8 a run, deaths 10.8 -> 10.5).
  const bomber = p.def.role === 'dive bomber' && bombs > 0;
  const range = bomber ? cfg.bomberRange ?? cfg.groundRange : cfg.groundRange;
  let best = null;
  let bestScore = -Infinity;
  for (const o of world.ground) {
    if (!o.alive || !o.mobile || o.team == null || o.team === p.team) continue;
    const tank = o.type === 'tank';
    const loaded = o.type === 'truck' && o.passengers?.length > 0;
    if (tank ? bombs === 0 : !guns || !(o.soldiers || loaded)) continue;
    const fromHome = Math.abs(o.x - homeX);
    if (fromHome > range) continue;
    if (o.x > af.x - 40 && o.x < af.x + af.width + 40) continue;
    if (tank && bridge?.alive && Math.abs(o.x - bridge.x) < bridge.def.width / 2 + 50) continue;
    if (!(bomber && tank) && flakDepth(world, p.team, o.x, surfaceAt(world, o.x) + cfg.bombHeight) > 0) continue;
    let score = (tank ? 3 : loaded ? 2 : 1) + (1 - fromHome / range) * 3;
    if (engineers.some((e) => Math.abs(e.x - o.x) < 250)) score += 2;
    if (o.type === 'engineers' && bridge && Math.abs(o.x - bridge.x) < 200) score += 2;
    if (o.id === b.target) score += 1; // finish what we started
    score -= Math.abs(o.x - p.x) / 2000;
    if (score > bestScore) {
      best = o;
      bestScore = score;
    }
  }
  return best;
}

// Somewhere to put a burning or dead-engined plane down: home if it can make it, otherwise a flat, clear
// stretch towards home within reach (away from the enemy's guns), failing that the nearest one ahead.
function landingSite(world, p) {
  const t = touchdown(world, p.team);
  if (t) {
    const dist = Math.abs(p.x - t.x) + world.bots.approachLength;
    const height = p.y - world.terrain.heightAt(p.x);
    // A burning plane needs time to slow, land and stop for the crew too.
    const reachable = p.burning ? dist / Math.max(80, p.speed) + 8 < p.fireLeft : p.engineRunning || dist < height * 7;
    if (reachable) return { home: true };
  }
  const ahead = Math.sign(p.vx) || facing(p);
  const homeward = -enemyDir(world, p.team);
  // How far it can get: a burning plane by the fire's clock (a turn round costs some), a glider by
  // its height.
  const reach = p.burning ? Math.max(0, p.fireLeft - 5) * Math.max(80, p.speed) * 0.8 : (p.y - world.terrain.heightAt(p.x)) * 7;
  for (const dir of homeward === ahead ? [ahead] : [homeward, ahead]) {
    const far = dir === ahead ? Math.max(reach, 400) : reach - 250;
    for (let k = dir === ahead ? 120 : 250; k < Math.min(far, 1600); k += 20) {
      const x = p.x + dir * k;
      if (fieldClear(world, x, dir)) return { home: false, x, dir };
    }
  }
  return { home: false, x: p.x + ahead * 300, dir: ahead };
}

// Room to land at x rolling in direction dir: gentle slope, nothing standing in the way, no river.
function fieldClear(world, x, dir) {
  const end = x + dir * 180;
  if (Math.min(x, end) < 30 || Math.max(x, end) > world.map.width - 30) return false;
  for (let k = 0; k <= 180; k += 10) if (Math.abs(world.terrain.slopeAngle(x + dir * k)) > 0.07) return false;
  const lo = Math.min(x, end) - 10;
  const hi = Math.max(x, end) + 10;
  if ((world.map.rivers ?? []).some((r) => r.x < hi && r.x + r.width > lo)) return false;
  if (world.ground.some((o) => o.alive && (o.def.solid || o.def.obstacle || o.mobile) && o.x > lo && o.x < hi)) return false;
  // Nothing tall on the way in either, where the plane is already low.
  const ground = world.terrain.heightAt(x);
  for (let k = 10; k <= 160; k += 10) if (skyline(world, x - dir * k) > ground + 6 + k * 0.08) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------
// Flying the chosen mode.

function airCommand(world, p, b, skill) {
  const cfg = world.bots;
  const cmd = IDLE();
  let want; // { angle, throttle | speed, clear, avoidFlak }
  const ground = world.terrain.heightAt(p.x);
  const height = p.y - ground;
  const tgtPlane = (id) => world.planes.find((o) => o.id === id && o.state === 'air' && !o.dying);

  // Just off the runway: climb straight out before doing anything else.
  if (height < 70 && b.mode !== 'final' && b.mode !== 'emergency' && b.mode !== 'attack' && p.speed < 110 && b.climbOut !== false) {
    b.climbOut = true;
    want = { angle: angleFor(facing(p), 0.3), throttle: 1, clear: 20 };
    return fly(world, p, b, skill, want, cmd);
  }
  b.climbOut = false;

  switch (b.mode) {
    case 'evade': {
      b.evadeT -= DT;
      want = { angle: p.angle + b.evadeDir * 1.5, throttle: 1, clear: cfg.terrainClear * 0.7 };
      if (b.evadeT <= 0) b.think = 0;
      break;
    }
    case 'extend':
      want = extendWant(world, p, b);
      break;
    case 'chase': {
      const o = tgtPlane(b.target);
      if (!o) {
        b.think = 0;
        want = patrolWant(world, p, b);
        break;
      }
      want = chaseWant(world, p, b, skill, o, cmd);
      break;
    }
    case 'attack':
      want = attackWant(world, p, b, skill, cmd);
      break;
    case 'home':
    case 'final':
      want = homeWant(world, p, b, skill);
      break;
    case 'emergency':
      want = emergencyWant(world, p, b);
      break;
    default:
      want = patrolWant(world, p, b);
  }

  // Break away from a head-on pass: the higher plane goes over, the lower one under. The break is
  // held until the two have passed each other.
  if (b.mode !== 'final' && b.mode !== 'emergency') {
    const o = b.breakOff && world.planes.find((q) => q.id === b.breakOff.id && q.state === 'air');
    const passing = o && (o.x - p.x) * (o.vx - p.vx) + (o.y - p.y) * (o.vy - p.vy) < 0;
    if (!passing || world.tick > b.breakOff.until) b.breakOff = null;
    const found = headOnThreat(world, p);
    if (found && !b.breakOff) b.breakOff = { ...found, until: world.tick + 90 };
    const threat = b.breakOff;
    if (threat) {
      want.angle = angleFor(facing(p), threat.level ? 0.05 : threat.over ? 0.6 : -0.45);
      want.avoidFlak = false; // a collision is worse than flak
      cmd.fire = false;
    }
  }
  const out = fly(world, p, b, skill, want, cmd);
  // The key is a toggle: press only when the wish differs from the state.
  out.emergency = wantsEmergency(world, p, b) !== p.emergency;

  return out;
}

// Bots use emergency power to survive, never to win a fight: only while breaking away from a plane on
// the tail (or limping home with an enemy near), only while the engine is little worn and cool.
function wantsEmergency(world, p, b) {
  const cfg = world.bots;
  if (p.engineDamage > cfg.emergencyWear || (p.emergency ? p.heat > 0.8 : p.heat > 0.35)) return false;
  if (b.mode === 'evade' || b.mode === 'extend') return true;
  // Tactics emergencyUse: 0.5 also runs out and climbs back after a diving pass, 1 also catches an enemy
  // running away.
  const use = b.tac?.emergencyUse ?? 0;
  if (b.mode === 'chase') {
    if (use >= 0.5 && b.tac.style >= 0.5 && b.zoom?.phase === 'climb') return true;
    const o = use >= 1 && world.planes.find((q) => q.id === b.target && q.state === 'air');
    return !!o && Math.hypot(o.x - p.x, o.y - p.y) > 250 && (o.x - p.x) * o.vx > 0 && o.speed > p.speed - 10;
  }
  if (b.mode !== 'home') return false;
  return world.planes.some((o) => o.team !== p.team && o.state === 'air' && !o.dying && Math.hypot(o.x - p.x, o.y - p.y) < cfg.emergencyRange);
}

function patrolWant(world, p, b) {
  const cfg = world.bots;
  const dir = enemyDir(world, p.team);
  // The beat: from the front (or short of the enemy flak, if that's nearer home) back towards home.
  const front = teamFront(world, p.team);
  const line = flakLine(world, p.team);
  const fore = dir > 0 ? Math.min(front, line) : Math.max(front, line);
  const aft = fore - dir * cfg.patrolSpan;
  const lo = Math.min(fore, aft);
  const hi = Math.max(fore, aft);
  if (b.leg !== 1 && b.leg !== -1) b.leg = 1;
  const x = clamp(b.leg > 0 ? hi : lo, 250, world.map.width - 250) + b.index * 40 * -dir;
  if ((x - p.x) * b.leg < 40) {
    b.leg = -b.leg;
    // Decided once, as the beat ends: deciding by height every tick flip-flopped (a dive below the limit
    // turned into a loop at the bottom).
    b.split = cfg.patrolSplitHeight > 0 && p.y - world.terrain.heightAt(p.x) > cfg.patrolSplitHeight;
    b.splitNew = true; // this tick's aim is still at the old end of the beat
  }
  // A loaded plane cruises slower on the same throttle, and too near the stall it can't turn round (the
  // bot flies on to build speed first): it opens the throttle with the load.
  const want = cruiseTo(world, p, x, cfg.cruiseHeight + b.index * 45, 0.8 + 0.2 * loadFraction(p));
  // Turning round at the end of the beat: a half loop bleeds so much speed (about 60 over the top, more in
  // thin air) that the bots crept up in a long climb to the ceiling. With height to spare it turns the
  // nose down through the reversal instead (a split-S), which gives the speed back (part 3d).
  // Turning round over the top takes full throttle, not cruise: with the propeller physics (src/sim/air.js)
  // a half loop on cruise throttle ran out of speed at the top, and the bot crept up on the retries
  // (2026-11-12).
  if (Math.abs(angleDiff(want.angle, p.angle)) > 1.2) want.throttle = 1;
  if (b.split && !b.splitNew && Math.abs(angleDiff(want.angle, p.angle)) < 1.2) b.split = false; // round and heading the new way
  b.splitNew = false;
  if (b.split) want.short = true;
  return want;
}

// Fly towards x at a height above the ground (and enemy MG nests) on the way.
function cruiseTo(world, p, x, height, throttle) {
  const dir = Math.sign(x - p.x) || facing(p);
  const floor = floorAhead(world, p.x, dir, 400);
  const y = Math.min(Math.max(floor + height, nestFloor(world, p.team, p.x + dir * 150, p.bot.skill)), world.map.ceiling - 60);
  const pitch = clamp((y - p.y) / 200, -0.35, 0.45);
  return { angle: angleFor(dir, pitch), throttle, clear: world.bots.terrainClear, avoidFlak: true };
}

// Aim angle and flight time for our guns to meet plane o (rounds keep our velocity and drop). With the
// pilot's memory b, as a human judges it: the lead and drop off by b.leadOff (a share of the flight
// time), and a turning target (o.turn, rad/s) bending away by an error that grows with how hard it turns
// and how long the rounds fly. So a slow gun misses more than a fast one, and a hard-turning target more
// than a straight one.
export function gunLead(p, o, b = null) {
  const w = (p.guns.find((g) => g.ammo > 0) ?? p.guns[0])?.def ?? { velocity: 300, drop: 0 };
  let t = Math.hypot(o.x - p.x, o.y - p.y) / w.velocity;
  for (let i = 0; i < 3; i++) {
    const rx = o.x + o.vx * t - (p.x + p.vx * t);
    const ry = o.y + o.vy * t - (p.y + p.vy * t) + 0.5 * GRAVITY * w.drop * t * t;
    t = Math.hypot(rx, ry) / w.velocity;
  }
  const tj = t * (1 + (b?.leadOff ?? 0)); // the flight time as judged
  const rx = o.x + o.vx * tj - (p.x + p.vx * tj);
  const ry = o.y + o.vy * tj - (p.y + p.vy * tj) + 0.5 * GRAVITY * w.drop * tj * tj;
  // The angle a turning target's path bends away over the flight, seen from here: about its turn times
  // the flight time, times its speed against the rounds'.
  const bend = b ? b.turnOff * Math.abs(o.turn ?? 0) * t * (Math.hypot(o.vx, o.vy) / w.velocity) : 0;
  return { angle: Math.atan2(ry, rx) + bend, dist: Math.hypot(o.x - p.x, o.y - p.y), t };
}

// How far out a bot opens fire: its skill's range times its tactics (further on a diving pass), and with
// wing guns no further than convergenceFire times the convergence, past which the rounds spread wide.
function fireRangeOf(p, skill, tac, diving) {
  const r = skill.fireRange * tac.fireRange * (diving ? DIVE_RANGE : 1);
  return p.def.convergence ? Math.min(r, p.def.convergence * (tac.convergenceFire ?? 1.5)) : r;
}

const DIVE_LEAD = 0.5; // the most the dive-from-height nose lead may swing off the line of sight (rad)
const DIVE_START = 350; // a dive starts no closer than this: closer is no pass, just a head-on merge
const DIVE_RANGE = 1.6; // the dive opens fire this much further out
const BAND_FIGHT = 250; // closer than this a diving style fights where it is instead of climbing to its band
const RUN_OUT_TIME = 4; // seconds the run-out after a pass lasts at most before the climb back

function chaseWant(world, p, b, skill, o, cmd) {
  const d = Math.hypot(o.x - p.x, o.y - p.y);
  const seen = d < skill.lookout;
  if (!seen) {
    // A radar contact: fly towards where it was plotted.
    const plot = radarPicture(world, p.team).get(o.id) ?? { x: o.x, y: o.y };
    return { angle: Math.atan2(plot.y - p.y, plot.x - p.x), throttle: 1, clear: world.bots.terrainClear, avoidFlak: true };
  }
  // A teammate closer in on the same target and near us leads the attack: hold above and behind it to
  // cover, ready to take over, rather than queue up on its tail.
  const leader = world.planes.find(
    (m) => m !== p && m.team === p.team && m.state === 'air' && m.bot?.mode === 'chase' && m.bot.target === o.id
      && Math.hypot(m.x - o.x, m.y - o.y) < d && Math.hypot(m.x - p.x, m.y - p.y) < 250,
  );
  if (leader) {
    const back = Math.sign(o.vx) || 1;
    const x = o.x - back * 120;
    const y = Math.min(o.y + 100, world.map.ceiling - 80);
    return { angle: Math.atan2(y - p.y, x - p.x), throttle: 0.85, clear: world.bots.terrainClear, avoidFlak: true };
  }
  const tac = b.tac ?? tacticsFor(world, p);
  const stall = flyingDef(p, world).stallSpeed;
  const height = p.y - world.terrain.heightAt(p.x);
  const clear = world.bots.terrainClear * 0.8;
  // Slower than this plane's tactics allow in a fight (and slower than the skill's own stall margin
  // already guards): stop pulling, dive to get the speed back, then fight on.
  const slowest = stall * tac.minFightSpeed;
  if (tac.minFightSpeed > 1 + skill.stallMargin && height > 80) {
    if (p.speed < slowest) b.unload = true;
    else if (p.speed > slowest * 1.15) b.unload = false;
  } else b.unload = false;
  if (b.unload) return { angle: angleFor(facing(p), -0.35), throttle: 1, clear, avoidFlak: true };
  // A turn fighter (chaseDiver 0) lets an enemy diving away go: it holds its height, nose loosely towards
  // it, and waits for it to come back up rather than follow it down where it can't catch it.
  const opening = (o.x - p.x) * (o.vx - p.vx) + (o.y - p.y) * (o.vy - p.vy) > 0;
  if (!tac.chaseDiver && o.y < p.y - 30 && o.vy < -0.25 * o.speed && o.speed > p.speed + 15 && opening) {
    const dir = Math.sign(o.x - p.x) || facing(p);
    return { angle: angleFor(dir, 0.04), throttle: 1, clear: world.bots.terrainClear, avoidFlak: true };
  }
  // Its height band: an enemy far above its engine's rated height is not climbed after. It waits under it
  // in its band, keeping speed, so the enemy has to come down into the band to fight.
  const band = (p.def.ratedHeight ?? Infinity) + (tac.bandMargin ?? 2000);
  if (o.y > band && p.y < o.y - 60) {
    const dir = d > 250 ? Math.sign(o.x - p.x) || facing(p) : facing(p);
    const y = Math.min(band - (tac.bandMargin ?? 0) * 0.5, o.y - 120);
    return { angle: angleFor(dir, clamp((y - p.y) / 200, -0.3, 0.35)), throttle: 1, clear: world.bots.terrainClear, avoidFlak: true };
  }
  // Far off with height to gain first: climb towards a point that much above it. Diving from above needs
  // the height (boomHeight at least): a dive from a little above is no dive, and with it alone the
  // style is a step down from turn fighting that the bot trainer's one-step search never gets past.
  // (heightOver adds to it: under boomHeight its steps did nothing, a trap for the trainer's search.)
  const heightOver = tac.style >= 0.5 ? (world.bots.boomHeight ?? 0) + tac.heightOver : tac.heightOver;
  // A diving style fights from its own height band (thin air: there its engine keeps its power and the
  // others' fade): it climbs to bandClimb x its rated height first, however low the enemy is, and dives
  // from there. Low down it has no speed edge over the others, only that height.
  const bandY = tac.style >= 0.5 && p.def.ratedHeight != null
    ? Math.min(p.def.ratedHeight * (tac.bandClimb ?? 1), world.map.ceiling - 100) : -Infinity;
  const goal = Math.max(o.y + heightOver, bandY);
  const over = goal - p.y;
  // (A diving bot already in its climb-back flies that instead: this climb heads for the enemy, which
  // behind it means a slow half loop.)
  const zooming = tac.style >= 0.5 && b.zoom?.phase === 'climb';
  // (Already above it by the dive height: make the pass first, the climb-back then goes to the band.)
  const toBand = goal > o.y + heightOver && d > BAND_FIGHT && p.y - o.y < heightOver;
  if (heightOver > 0 && (d > 400 || toBand) && over > heightOver * 0.3 && !zooming) {
    // Climbing to the band with the enemy near: away from it, so it climbs after us out of its own band.
    const dir = (toBand && d < 700 ? Math.sign(p.x - o.x) : Math.sign(o.x - p.x)) || facing(p);
    return { angle: angleFor(dir, clamp(over / 200, 0.1, 0.45)), throttle: 1, clear: world.bots.terrainClear, avoidFlak: true };
  }
  // Boom and zoom: attack only from above. Dive through firing (boom), run away from it at full speed,
  // climb at the speed that climbs best once clear (zoom), and come round for the next pass once well
  // above it. Never turns with it.
  // Style 0.5 mixes the two: the same dive from above, but after it a turn fight, unless it is clear of
  // the enemy with speed to spare for a free zoom back up.
  let boom = tac.style >= 0.5;
  if (boom) {
    const above = p.y - o.y;
    const want = Math.max(60, heightOver, bandY - o.y);
    const climbSpeed = stall * Math.max(1.55, tac.minFightSpeed);
    if (!b.zoom) b.zoom = { phase: above > want * 0.6 ? 'dive' : 'climb', since: world.tick };
    if (b.zoom.phase === 'climb') {
      // After a pass: run out straight away from it at full power until extendRange off (turning or a slow
      // climb close by hands it a target: the stall-and-get-caught failure), then climb back at zoomSpeed,
      // still heading away, until high enough to dive again. Caught up with on the climb: run out again.
      // Style 0.5 turn-fights only when the zoom has failed (slow, with the enemy close).
      const zoomV = stall * Math.max(tac.zoomSpeed ?? 1.6, tac.minFightSpeed);
      const runOut = tac.extendRange ?? 450;
      if (above >= want && d > DIVE_START) b.zoom = { phase: 'dive', since: world.tick };
      // (A pass broken off head-on always runs out: turning there hands it the tail.)
      else if (tac.style < 1 && !tac.zoomAfterPass && !b.zoom.broke && (p.speed < climbSpeed || d < 450)) boom = false; // turn-fight at once, unless a free zoom
      else if (tac.style < 1 && p.speed < stall * (1 + skill.stallMargin + 0.25) && d < 200) boom = false;
      else {
        // Out once far enough, or after RUN_OUT_TIME against an enemy as fast as itself (it never gets
        // the room, and zooming makes the chaser bleed speed as well).
        b.zoom.runT = (b.zoom.runT ?? 0) + (b.zoom.out ? 0 : DT);
        if (d >= runOut || b.zoom.runT > RUN_OUT_TIME) b.zoom.out = true;
        else if (d < runOut * 0.5) { b.zoom.out = false; b.zoom.runT = 0; }
        // The run-out climbs on the dive's speed while it has speed over the climb-back speed (it used to
        // sink, level or a little down, and the height edge was gone by the next pass), then runs level.
        const spare = (p.speed - zoomV * 1.15) / zoomV;
        const runPitch = spare > 0 ? clamp(spare, 0.04, 0.3) : height > 200 ? -0.08 : 0.02;
        const pitch = !b.zoom.out ? runPitch : clamp(((p.speed - zoomV) / zoomV) * 1.5 + 0.12, 0.04, 0.6);
        const dir = !b.zoom.out ? b.zoom.dir ?? (Math.sign(p.x - o.x) || facing(p)) : facing(p);
        return { angle: angleFor(dir, pitch), throttle: 1, clear: world.bots.terrainClear, avoidFlak: true };
      }
    }
  }
  // The pilot's picture of the target is refreshed as fast as it reacts; in between it aims at where the
  // target should be by then. A slow pilot's lead goes stale as soon as the target manoeuvres.
  const age = b.view?.id === o.id ? (world.tick - b.view.tick) / 60 : Infinity;
  if (age >= skill.reaction) {
    // How fast it is turning, from how its heading changed since the last look (none on a first look).
    const old = b.view?.id === o.id ? b.view : null;
    const heading = Math.atan2(o.vy, o.vx);
    const turn = old ? angleDiff(heading, old.heading) / Math.max(age, DT) : 0;
    b.view = { id: o.id, tick: world.tick, x: o.x, y: o.y, vx: o.vx, vy: o.vy, heading, turn };
  }
  const v = b.view;
  const dt = (world.tick - v.tick) / 60;
  const pictured = { x: v.x + v.vx * dt, y: v.y + v.vy * dt, vx: v.vx, vy: v.vy, turn: v.turn };
  const lead = gunLead(p, pictured, b);
  const aim = lead.angle + b.aimOff;
  let angle = d < 450 ? aim : Math.atan2(pictured.y + pictured.vy - p.y, pictured.x + pictured.vx - p.x);
  const diving = boom && b.zoom?.phase === 'dive';
  if (diving) {
    // A fast dive makes the gun lead swing faster than the plane can follow. Keep the nose within a
    // small angle of the line of sight so the aim settles instead of chasing it.
    const los = Math.atan2(pictured.y - p.y, pictured.x - p.x);
    angle = los + clamp(angleDiff(aim, los), -DIVE_LEAD, DIVE_LEAD);
    // Fast through the dive the line of sight swings faster than a stiff plane turns, so the nose
    // trails the aim the whole way down and never fires. Aim ahead of where the aim is swinging
    // (tactics passLead, seconds): the nose then leads, and the aim swings across it in range.
    const swing = b.lastAim != null ? angleDiff(aim, b.lastAim) / DT : 0;
    angle += clamp(swing * (tac.passLead ?? 0), -0.5, 0.5);
  }
  b.lastAim = aim;
  // Turning back from the climb-out into the dive: nose down (a wingover), not a slow half loop over the
  // top that ends in a stall.
  const shortWay = diving && p.y - o.y > 40;
  const closing = ((o.x - p.x) * (p.vx - o.vx) + (o.y - p.y) * (p.vy - o.vy)) / Math.max(1, d);
  let throttle = 1;
  let speed;
  const off = Math.abs(angleDiff(aim, p.angle));
  if (boom && b.zoom?.phase === 'dive') {
    // The pass is over once past it, once it has slipped out of the nose close in, or once it is the
    // higher one: zoom away rather than turn after it.
    if ((d < 90 && closing < 0) || (d < 220 && (off > 1.2 || p.y < o.y - 30))) b.zoom = { phase: 'climb', since: world.tick };
    // The target has turned head-on into the dive (its nose within passBreak of us) while our own nose is
    // not on it: break the pass off and run out straight on over it, climbing on the dive's speed, instead
    // of a merge where only its guns bear. It has to come round after a faster plane. (With our nose on it,
    // fire through: breaking then threw away the pass's own shots.) Lost in part 3c (P-47 on the Spitfire
    // -0.12 -> -0.53 over 16 seeds), so off by default; a knob for the trainer.
    else if (tac.passBreak > 0 && d < DIVE_START && d > 90 && off > 2 * (skill.aimTolerance + o.def.hitRadius / d)
      && Math.abs(angleDiff(Math.atan2(o.vy, o.vx), Math.atan2(p.y - o.y, p.x - o.x))) < tac.passBreak) {
      b.zoom = { phase: 'climb', since: world.tick, broke: true, dir: facing(p) };
    }
  } else if (skill.turnFight > 0 && off > 0.5 && height > 120 && tac.turnThrottle < 1) {
    // Turn fighting: far off the aim in a hard turn, a good pilot throttles back towards the speed where
    // the plane turns tightest (just over the stall), instead of going round the same circle at full
    // power. turnFight 0 never does, 1 goes right down to it; the plane's turnThrottle keeps power on.
    const tight = Math.max(stall * (1 + skill.stallMargin + 0.12), slowest * 1.05);
    speed = p.def.maxSpeed + (tight - p.def.maxSpeed) * skill.turnFight * (1 - tac.turnThrottle);
  }
  if (d < 110 && closing > 25) throttle = 0.4; // don't ram it
  if (d < 35) angle = p.angle + 1; // too close: get out of its way
  // Fire with the nose within the pilot's tolerance, widened by how big the target looks from here.
  // Wing guns only out to where their rounds still meet the target (fireRangeOf).
  else cmd.fire = d < fireRangeOf(p, skill, tac, diving) && off < skill.aimTolerance + o.def.hitRadius / d && ammoShare(p) > 0;

  return { angle, throttle, speed, clear, avoidFlak: true, short: shortWay };
}

// Breaking off a losing fight: dive away from the enemy on the tail at full power (emergency power
// too), straight on rather than turning, which would let it cut across. Low down, level instead.
function extendWant(world, p, b) {
  b.extendT -= DT;
  const o = world.planes.find((q) => q.id === b.target && q.state === 'air' && !q.dying);
  const height = p.y - world.terrain.heightAt(p.x);
  if (b.extendT <= 0 || !o || Math.hypot(o.x - p.x, o.y - p.y) > 500) {
    b.extendT = 0;
    b.think = 0;
  }
  const dir = o ? Math.sign(p.x - o.x) || facing(p) : facing(p);
  const pitch = height > 180 ? -0.3 : height > 100 ? -0.1 : 0.05;
  return { angle: angleFor(dir, pitch), throttle: 1, clear: world.bots.terrainClear, avoidFlak: true };
}

// A ground attack pass. Bombs: level run at bomb height, released when the predicted fall meets the
// target. Guns: a shallow dive with the guns on the soldiers, pulling out low. Either way, overshoot,
// fly on to get room, turn back and go again.
function attackWant(world, p, b, skill, cmd) {
  const cfg = world.bots;
  const o = world.ground.find((g) => g.id === b.target && g.alive);
  if (!o) {
    b.think = 0;
    return patrolWant(world, p, b);
  }
  const run = (b.run ??= { dir: Math.sign(o.x - p.x) || 1, phase: 'in' });
  const gy = surfaceAt(world, o.x);
  const ahead = (o.x - p.x) * run.dir; // target distance along the run
  const bombing = o.type === 'tank' && bombsLeft(p) > 0;
  if (run.phase === 'out') {
    // Fly on, climbing, until there's room to turn back and line up.
    if (-ahead > 380) {
      run.dir = -run.dir;
      run.phase = 'in';
    }
    return cruiseTo(world, p, p.x + run.dir * 400, bombing ? cfg.bombHeight + 60 : 170, 1);
  }
  if (bombing) {
    const want = cruiseTo(world, p, o.x, cfg.bombHeight, 0.9);
    want.avoidFlak = false;
    want.clear = cfg.bombHeight * 0.5;
    if (ahead < 700) {
      const impact = bombImpact(world, p);
      const vx = o.moving ? o.dir * o.def.speed : 0;
      if (impact) {
        const aimX = o.x + vx * impact.t + b.bombOff;
        const miss = (impact.x - aimX) * run.dir;
        if (isUpright(p) && Math.abs(miss) < 3 + Math.abs(p.vx) * DT * 1.5 && Math.abs(angleDiff(p.angle, angleFor(run.dir, 0))) < 0.35) {
          cmd.bomb = true;
          b.bombOff = world.rng.range(-1, 1) * skill.bombError;
          run.phase = 'out';
        } else if (miss > 40) run.phase = 'out'; // went past: go round
      }
    }
    if (facing(p) !== run.dir && ahead < 150) run.phase = 'out';
    return want;
  }
  // Strafing: line up level, then dive on the soldiers.
  const height = p.y - world.terrain.heightAt(p.x);
  if (ahead < 40 || height < cfg.strafePullout || ahead < 0) {
    run.phase = 'out';
    return cruiseTo(world, p, p.x + run.dir * 400, 170, 1);
  }
  if (ahead > 380) return { ...cruiseTo(world, p, o.x, 150, 0.9), avoidFlak: false };
  const point = { x: o.x, y: gy + 3, vx: o.moving ? o.dir * o.def.speed : 0, vy: 0 };
  const lead = gunLead(p, point);
  const aim = lead.angle + b.aimOff;
  cmd.fire = lead.dist < skill.fireRange && Math.abs(angleDiff(aim, p.angle)) < skill.aimTolerance * 1.5;
  return { angle: aim, throttle: 0.7, clear: cfg.strafePullout * 0.6, avoidFlak: false, dive: true };
}

// Where a bomb let go now would hit the ground: { x, t }, flying it as stepBombs does.
function bombImpact(world, p) {
  const def = nextStation(p)?.def;
  if (!def) return null;
  let x = p.x;
  let y = p.y - 4;
  let vx = p.vx;
  let vy = p.vy - 6;
  const k = def.drag;
  const h = 1 / 30;
  for (let t = 0; t < 8; t += h) {
    vx -= vx * k * h;
    vy -= (GRAVITY + vy * k) * h;
    x += vx * h;
    y += vy * h;
    if (y <= world.terrain.heightAt(x)) return { x, t };
  }
  return null;
}

// Going home: out to the gate on the enemy side of the runway, turn in, then down the glide slope.
function homeWant(world, p, b, skill) {
  const cfg = world.bots;
  const t = touchdown(world, p.team);
  const dir = enemyDir(world, p.team);
  if (!t) {
    // Runway too broken to land: hold over home until the crew have filled it, or until the fuel says
    // to put down anywhere.
    if (p.fuel < cfg.fuelReserve * 0.5) {
      b.mode = 'emergency';
      b.site = landingSite(world, p);
    }
    const af = homeField(world, p.team);
    if (b.leg !== 1 && b.leg !== -1) b.leg = 1;
    const x = af.x + af.width / 2 + b.leg * 300 + dir * 300;
    if ((x - p.x) * b.leg < 40) b.leg = -b.leg;
    return cruiseTo(world, p, x, cfg.cruiseHeight, 0.6);
  }
  const gateX = t.x + dir * cfg.approachLength;
  const gateY = t.y + cfg.approachLength * cfg.glideSlope;
  const past = (p.x - gateX) * dir; // > 0: beyond the gate, on the enemy side
  if (b.mode === 'final') return finalWant(world, p, b, t.x, t.roll, p.engineRunning && !p.burning, t.end);
  if (b.leg === 0) b.leg = past > 100 ? 2 : 1; // 1: out past the gate first, 2: in towards it
  if (b.leg === 1) {
    if (past > 300) b.leg = 2;
    const want = cruiseTo(world, p, gateX + dir * 450, gateY - t.y + 90, 0.8);
    return want;
  }
  // Leg 2: towards the gate, slowing down.
  if (past < 60 && facing(p) === t.roll) b.mode = 'final';
  const pitch = clamp((Math.max(gateY, floorAhead(world, p.x, t.roll, 300) + 40) - p.y) / 150, -0.3, 0.35);
  if (past < -60) b.leg = 1; // overshot the gate without turning in: round again
  // Slow down for the approach only once pointing the right way; turning round needs the speed.
  const lined = facing(p) === t.roll;
  return { angle: angleFor(t.roll, pitch), speed: lined ? p.def.maxLandingSpeed * 1.05 : undefined, throttle: 1, clear: 30, avoidFlak: true };
}

// Down the glide slope to touchX (rolling out in direction dir towards end), flaring just above the
// ground. home: abort and go round if it goes wrong (a field landing has to go on).
function finalWant(world, p, b, touchX, dir, home, end = touchX + dir * 140) {
  const cfg = world.bots;
  const along = (touchX - p.x) * dir; // distance still to go to the touchdown point
  // Height over the highest thing between here and the touchdown point (a runway raised on a bank,
  // a hedge or tree before a field), not just the ground below.
  const floor = floorAhead(world, p.x, dir, clamp(along + 20, 0, 120));
  const alt = p.y - floor - 4;
  const touchY = world.terrain.heightAt(touchX) + 4;
  const pathY = touchY + Math.max(0, along) * cfg.glideSlope;
  const speed = p.def.maxLandingSpeed * cfg.approachSpeed;
  const left = (end - p.x) * dir; // runway left to stop on
  if (home && (facing(p) !== dir || (along < 0 && alt > 25) || (left < 90 && alt > 2))) {
    // Missed it: power up, climb straight out and come round again.
    b.mode = 'home';
    b.leg = 1;
    b.climbOut = undefined;
    return { angle: angleFor(facing(p), 0.3), throttle: 1, clear: 20 };
  }
  // Steeper than the slope to get down onto it, but never steep close to the ground.
  // Far above the slope and still far out (a zoom on the way home left it high): it may dive steeper,
  // or with the throttle closed it can't get down in time, goes round and comes in just as high again.
  const steep = pathY - p.y < -60 && along > 200 ? -0.4 : -0.2;
  let pitch = -cfg.glideSlope + clamp((pathY - p.y) / 40, alt < 30 ? -0.08 : steep, 0.2);
  // Flare: ease the descent to settle gently onto the slope, keeping the power on (closing it this high
  // floats the plane into a stall) until the wheels are about to touch.
  // Engine dead (or dying in the fire): no power to hold the path, so trade height for speed.
  const powerless = !p.engineRunning || (p.burning && p.fireLeft < world.fire.quitAt + 1);
  if (powerless && p.speed < speed * 0.95 && alt > 12) pitch = Math.min(pitch, -0.12 - (speed - p.speed) / 100);
  const flare = Math.max(8, -p.vy * 0.7); // sinking fast, start sooner
  if (alt < 15 && along > 120) pitch = Math.max(pitch, 0.02); // ground rising on the way in: level off
  if (alt < 8 && along > 40) pitch = 0.06; // low short of the touchdown point: hold it up
  else if (alt < flare) pitch = world.terrain.slopeAngle(p.x) * dir - 0.07;
  // Keep clear of the ground well out; near the threshold the glide slope itself is the clearance.
  return { angle: angleFor(dir, pitch), speed: alt < 1.5 ? 0 : speed, clear: along > 300 ? 10 : null, landing: true, gear: alt < 90 };
}

function emergencyWant(world, p, b) {
  const site = (b.site ??= landingSite(world, p));
  // Into a field: glide down onto the start of the clear stretch. Coming in far too high for it, look
  // for one further on.
  let along = (site.x - p.x) * site.dir;
  const high = p.y - world.terrain.heightAt(site.x) - Math.max(0, along) * world.bots.glideSlope;
  if (along > 0 && along < 250 && high > 60 && facing(p) === site.dir) {
    for (let k = 300; k < 1200; k += 20) {
      const x = p.x + site.dir * k;
      if (fieldClear(world, x, site.dir)) {
        site.x = x;
        break;
      }
    }
    along = (site.x - p.x) * site.dir;
  }
  // Low over the field already (floated past the spot): keep it going and put it down.
  const low = p.y - world.terrain.heightAt(p.x) < 40 && facing(p) === site.dir && along > -250;
  if (!low && (facing(p) !== site.dir || along < -100 || along > 450)) {
    // Wrong way round, or still far off: head for it clear of the trees, not too fast.
    const want = cruiseTo(world, p, site.x - site.dir * 300, 80, 0.8);
    return { ...want, throttle: undefined, speed: p.def.maxLandingSpeed * 1.1, avoidFlak: false };
  }
  return finalWant(world, p, b, low && along < 20 ? p.x + site.dir * 20 : site.x + site.dir * 20, site.dir, false);
}

const HEAD_ON_TIME = 0.9; // seconds before meeting that a head-on pass is broken off (1.4 cost kills, saved no more planes)

// Another plane coming straight at us: { over, level } says which way to break. Level with each other,
// the side's number decides, so the two never break the same way. Too low to go under, the lower plane
// holds level and leaves the climb to the other (both climbing met each other half the time).
function headOnThreat(world, p) {
  const hx = Math.cos(p.angle);
  const hy = Math.sin(p.angle);
  for (const o of world.planes) {
    if (o === p || o.state !== 'air') continue;
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > (p.speed + o.speed) * HEAD_ON_TIME || d < 1) continue;
    const ahead = (hx * dx + hy * dy) / d; // other plane in front of me
    const facingMe = -(Math.cos(o.angle) * dx + Math.sin(o.angle) * dy) / d; // and pointing back at me
    if (ahead > 0.8 && facingMe > 0.6) {
      const over = Math.abs(dy) > 4 ? dy < 0 : p.team !== o.team ? p.team < o.team : p.id < o.id;
      const low = p.y - world.terrain.heightAt(p.x) < 90;
      return { id: o.id, over, level: !over && low };
    }
  }
  return null;
}

const CLOSE_CALL = 50; // a predicted pass closer than this is a near collision
const CLOSE_TIME = 1.8;
// Against the plane it is attacking, the look-ahead is shorter: aiming the gun lead is a collision
// course by design, and at 1.8 s the bot turned away before it was ever in range (no diving pass fired).
const ATTACK_CLOSE_TIME = 0.6;

// The plane we're about to hit (closest approach under CLOSE_CALL within CLOSE_TIME), as { side }:
// +1 if it passes on our left of the nose (counter-clockwise), -1 on the right.
function closeCall(world, p) {
  let best = null;
  let bestT = Infinity;
  const hx = Math.cos(p.angle);
  const hy = Math.sin(p.angle);
  for (const o of world.planes) {
    if (o === p || o.state !== 'air' || o.dying) continue;
    const rx = o.x - p.x;
    const ry = o.y - p.y;
    if (Math.abs(rx) > 400 || Math.abs(ry) > 400) continue;
    const vx = o.vx - p.vx;
    const vy = o.vy - p.vy;
    const v2 = vx * vx + vy * vy;
    const t = v2 > 1 ? clamp(-(rx * vx + ry * vy) / v2, 0, CLOSE_TIME) : 0;
    const mx = rx + vx * t;
    const my = ry + vy * t;
    const attacking = p.bot?.mode === 'chase' && p.bot.target === o.id;
    if (Math.hypot(mx, my) > CLOSE_CALL || t >= bestT || (attacking && t > ATTACK_CLOSE_TIME)) continue;
    bestT = t;
    // Dead ahead on the same line: the higher plane (or the lower id) goes up, the other down. As a side:
    // the other passing above us (side +1 facing right, -1 facing left) turns our nose down. (This was
    // once a fixed rotation, which sent a plane facing left up into the other one.)
    let side = Math.sign(hx * my - hy * mx);
    if (Math.abs(hx * my - hy * mx) < 2) side = ((ry !== 0 ? ry > 0 : p.id > o.id) ? 1 : -1) * (hx >= 0 ? 1 : -1);
    best = { side };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------
// The flying layer: from a wanted nose angle and speed to keys, with the safety rules every bot keeps.

function fly(world, p, b, skill, want, cmd) {
  let angle = want.angle;
  const dirH = Math.sign(p.vx) || facing(p);
  const margin = want.landing ? Math.min(skill.stallMargin, 0.12) : skill.stallMargin;

  // Enemy flak ahead: turn for home (an ace never flies in; an easy bot only notices deep inside).
  if (want.avoidFlak) {
    const depth = flakDepth(world, p.team, p.x + p.vx * 2, p.y + p.vy * 2);
    if (depth > (1 - skill.flakAvoid) * 700 + 1) angle = angleFor(-enemyDir(world, p.team), 0.15);
  }

  // Map edges: turn back well before them.
  if (!want.landing && ((p.x < 220 && dirH < 0) || (p.x > world.map.width - 220 && dirH > 0))) angle = angleFor(-dirH, 0.3);

  // The ceiling: stay under the thin air.
  if (p.y > world.map.ceiling - 50 && Math.sin(angle) > -0.1) angle = angleFor(Math.cos(angle) >= 0 ? 1 : -1, -0.15);

  // About to touch another plane, friend or foe: from the two flight paths, where will it pass us in
  // the next second and a half? Too close, and we turn away from that side (the other plane, seeing
  // it the other way round, turns away from us). Too low to risk a turn down, we hold level instead and
  // leave the climb to the other one (it turns up, away from us); turning up as well met it.
  const near = closeCall(world, p);
  if (near) {
    const low = p.y - world.terrain.heightAt(p.x) < 140; // a knock this low can be the end of us
    const away = near.side > 0 ? -1 : 1; // rotate away from the side it passes on
    const down = away !== facing(p); // that rotation takes the nose down
    angle = low && down ? angleFor(facing(p), 0.05) : p.angle + away * 0.9;
  }

  // The ground (and anything standing on it): pull up in time. What a pull-out costs grows with the
  // dive: the height lost turning the nose up at this speed, plus a moment to react.
  let pulling = false;
  if (want.clear != null) {
    const floor = floorAhead(world, p.x, dirH, Math.max(120, p.speed * 2.2));
    const dive = Math.asin(clamp(-p.vy / Math.max(1, p.speed), 0, 1));
    const react = (want.dive ? 0.3 : 0.6) + p.def.turnRampTime * 0.5; // the turn takes a moment to build
    const fd = flyingDef(p, world);
    // Stiff controls at speed (stiffness) make the pull-out wider: start it sooner.
    const loss = (p.speed / (fd.turnRate * stiffness(fd, p.speed))) * (1 - Math.cos(dive)) + Math.max(0, -p.vy) * react;
    const short = p.y - floor - loss;
    // Once started, the pull-out goes on until climbing with room to spare. It keeps its side while the
    // nose is near straight down (no flip-flop), but takes the nose's side otherwise: after a knock
    // spun the plane round, the old side meant turning the nose through straight down into the ground.
    if (short < want.clear || (b.pullDir && (p.vy < 0 || short < want.clear * 1.5))) {
      if (!b.pullDir || Math.abs(Math.cos(p.angle)) > 0.3) b.pullDir = facing(p);
      // As steep as the speed allows: a hard pull at landing speed is a stall.
      const steepest = clamp((p.speed - flyingDef(p, world).stallSpeed) / 60, 0.08, 0.9);
      angle = angleFor(b.pullDir, Math.min(steepest, clamp(0.3 + (want.clear - short) / 80, 0.3, 0.9)));
      pulling = true;
    } else b.pullDir = null;
  } else b.pullDir = null;

  // Too slow: lower the nose to keep flying speed.
  if (p.speed < flyingDef(p, world).stallSpeed * (1 + margin) && Math.sin(angle) > -0.1 && !(want.landing && want.speed === 0)) {
    const h = p.y - world.terrain.heightAt(p.x);
    if (h > 40) angle = angleFor(Math.cos(angle) >= 0 ? 1 : -1, -0.15);
  }
  if (p.stalled) angle = -Math.PI / 2 + (dirH > 0 ? 0.6 : -0.6);

  // On approach, put the gear down ourselves rather than wait for the automatic, and up again once
  // climbing away (pressing G takes the gear off automatic for the flight). A key press: every other tick.
  const height = p.y - world.terrain.heightAt(p.x);
  if (want.gear ? !p.gearDown && p.speed < 130 : p.gearManual && p.gearDown && height > 50) cmd.gear = !p.prevGear;

  // Stay the right way up (rolling only every third of a second gives the sim a clean key press), unless
  // just rolled over to pull instead of push (a carburettor engine, below).
  const rolledForPull = b.pullRoll != null && world.tick - b.pullRoll < PULL_ROLL_HOLD;
  if (!isUpright(p) && !rolledForPull && (world.tick + p.id) % 20 === 0) cmd.roll = true;

  let diff = angleDiff(angle, p.angle);
  // A turn right round goes over the top (a half loop), unless that's into the ceiling. It needs speed:
  // too slow, fly on and build it up first. Pulling out of a dive takes the short way.
  let rushing = false;
  // Hysteresis on patrol (part 3d): once rushing it goes on until 20% over the entry speed. Without it the plane pulled
  // up the moment it passed the limit, bled back under it, levelled again, and so crept up in a long climb
  // at the limit speed (to the ceiling in thin air) instead of ever turning round.
  const rushSpeed = flyingDef(p, world).stallSpeed * 1.5;
  if (Math.abs(diff) <= 2.2 || pulling || want.short) b.rushing = false;
  else if (p.speed < rushSpeed) b.rushing = true;
  else if (b.rushing && p.speed > rushSpeed * (b.mode === 'patrol' ? world.bots.rushExit ?? 1 : 1)) b.rushing = false;
  if (b.rushing) {
    // On patrol it builds the speed going down towards its patrol height, never level: with the propeller
    // pulling hard when slow (src/sim/air.js), each try at the loop gained height and the level run kept it,
    // so the bot ratcheted up to the ceiling (2026-11-12). In a fight it stays level (the duels).
    const wantPitch = Math.asin(clamp(Math.sin(want.angle), -1, 1));
    angle = angleFor(facing(p), b.mode === 'patrol' ? clamp(Math.min(0, wantPitch), -0.3, 0) : 0);
    diff = angleDiff(angle, p.angle);
    rushing = true; // full throttle to build the speed
  }
  if (Math.abs(diff) > 2.2 && !pulling) {
    const up = facing(p) > 0 ? 1 : -1;
    // want.short: turn the nose down through the reversal (a wingover into a dive), never over the top.
    const sign = want.short || p.y > world.map.ceiling - 220 ? -up : up;
    diff = sign * Math.abs(diff);
  }
  cmd.turn = clamp(diff / 0.15, -1, 1) * (pulling ? 1 : skill.turnHard);
  // A carburettor engine cuts out under a hard push (src/sim/air.js): fighting or on patrol its pilot
  // pushes the nose down gently, staying under the limit (bunting hard to escape is for injected
  // engines, step 3). Not on the way home and landing: the approach needs its pushes, and a second's
  // sputter there costs little.
  if (cutsOut(world, p.def) && GENTLE_PUSH.has(b.mode) && cmd.turn * (p.inverted ? -1 : 1) < 0) {
    const limit = (world.flight ?? DEFAULT_FLIGHT).negGLimit;
    const fd = flyingDef(p, world);
    // The push the sim would give at turn 1 next tick (as stepAir works it out, with the key's ramp).
    const hold = Math.sign(cmd.turn) === p.turnDir ? p.turnHold + DT : 0;
    const ramp = fd.fineTurn + (1 - fd.fineTurn) * clamp(hold / fd.turnRampTime, 0, 1);
    const full = fd.turnRate * turnAt(world, fd, p.y) * turnAuthority(fd, p.speed) * ramp * Math.max(30, p.speed); // g x GRAVITY
    const cap = (0.85 * limit * GRAVITY) / full;
    // A big push wanted: half-roll and pull it instead (rolling is instant in the sim; the roll back to
    // upright waits PULL_ROLL_HOLD). Meanwhile push gently.
    if (Math.abs(cmd.turn) > cap * 1.5 && Math.abs(diff) > 0.35 && !cmd.roll && !p.prevRoll && !rolledForPull) {
      cmd.roll = true;
      b.pullRoll = world.tick;
    }
    cmd.turn = Math.sign(cmd.turn) * Math.min(Math.abs(cmd.turn), cap);
  }

  // Throttle: a set level, or held to a speed (want.speed 0: closed).
  let level = rushing ? 1 : want.throttle ?? 0.8;
  if (want.speed != null && !rushing) {
    if (want.speed === 0) level = 0;
    else {
      const accel = (p.speed - b.lastSpeed) / DT;
      level = p.throttle + clamp((want.speed - p.speed) * 0.04 - accel * 0.02, -0.3, 0.3);
    }
  }
  level = clamp(level, 0, 1);
  cmd.throttle = clamp((level - p.throttle) * 10, -1, 1);
  return cmd;
}

// Autopilot while the player is in free look: level flight at a set height above the ground ahead,
// throttle at cruise, turning back at the ends of the map. On the ground it idles where it stands.
// state: { dir } kept by the caller between ticks (the way it's heading: 1 right, -1 left).
export function autopilotCommand(world, p, height, state) {
  const cmd = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false };
  if (p.state === 'dead') return cmd;
  if (p.state === 'ground') {
    cmd.throttle = p.throttle > 0 ? -1 : 0;
    return cmd;
  }
  cmd.throttle = p.throttle < 0.8 ? 1 : p.throttle > 0.9 ? -1 : 0;
  if (!isUpright(p) && world.tick % 30 === 0) cmd.roll = true;

  const margin = 250;
  if (p.x > world.map.width - margin) state.dir = -1;
  else if (p.x < margin) state.dir = 1;
  state.dir ??= Math.cos(p.angle) >= 0 ? 1 : -1;

  // Hold the height over the highest ground in the next few seconds of flight, under the ceiling.
  let ground = world.terrain.heightAt(p.x);
  for (let k = 40; k <= 400; k += 40) ground = Math.max(ground, world.terrain.heightAt(p.x + state.dir * k));
  const want = Math.min(ground + height, world.map.ceiling - 30);
  const climb = clamp((want - p.y) / 150, -0.35, 0.45);
  let desired = state.dir > 0 ? climb : Math.PI - climb;
  if (p.stalled) desired = -Math.PI / 2 + (state.dir > 0 ? 0.6 : -0.6);

  let diff = angleDiff(desired, p.angle);
  // Turning back, go round over the top (a half loop) rather than diving into the ground.
  if (Math.abs(diff) > 2.5) diff = Math.cos(p.angle) >= 0 ? Math.abs(diff) : -Math.abs(diff);
  cmd.turn = clamp(diff / 0.15, -1, 1);
  return cmd;
}
