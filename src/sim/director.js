// The battle director, one per side. For now only a seed of it: every few minutes each side sends a raid
// of AI bombers against the enemy's tank depot or radar station, while one stands. The raid is called
// ahead of time (the 'raidWarning' event, and world.director[team].raid for the radar marker), then the
// bombers come in over their own map edge, fly straight and level in the high band, bomb, swing round and
// fly home the same way. Flying straight is what the heavy flak punishes, so the guns by the target
// decide how many get there.
// The bombers are planes like any other (world.planes, marked p.raid, controller 'raid'): no seat, no
// respawn. They are taken out of the world when they crash or reach their own edge again.
import { createPlane, turnBack } from './plane.js';
import { armPlane, bombsLeft } from './weapons.js';
import { bombImpact } from './ai.js';
import { makeWreck } from './bailout.js';
import { angleDiff } from './math.js';

// first, interval: seconds to the first raid and between raids (0: no raids). warning: seconds from the
// call to the bombers coming in. height: the height they fly at (world y). bombers: how many a raid.
// spacing: gap between them. speed: what they cruise at. aimError: how far off the bomb aimer may be
// (world units either way). planes: the bomber each team flies.
export const DEFAULT_RAIDS = { first: 100, interval: 200, warning: 20, height: 1000, bombers: 2, spacing: 90, speed: 90, aimError: 50, bomb: 'bomb_50', bombs: 4, bombGap: 1.2, abortHp: 0.5, planes: ['blenheim4', 'pe3'] };

const TARGETS = ['depot', 'radar'];
const ENTRY = 40; // the last bomber comes in this far from its own map edge
const LEAVE = 110; // and a bomber going home leaves the map this far from it (before the map-edge turn would start)
const LANE = 70; // the two sides' raids meet head-on in the middle: each side's flies this much lower than the one before
const STEP_UP = 18; // each bomber flies this much higher than the one ahead
const TURN_AFTER = 1.5; // seconds from the last bomb to the turn for home
const OVERSHOOT = 250; // a bomber this far past its target without having bombed gives up

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createDirector(world) {
  world.director = {};
  const fields = world.map.airfields;
  for (const af of fields) {
    const enemy = fields.find((a) => a.team !== af.team);
    const dir = enemy ? Math.sign(enemy.x - af.x) || 1 : af.x + af.width / 2 < world.map.width / 2 ? 1 : -1;
    world.director[af.team] = { dir, lane: Object.keys(world.director).length, timer: world.raids.first, raid: null };
  }
}

// What a raid can go for: the enemy's standing depot and radar stations.
const targetsOf = (world, team) => world.ground.filter((o) => o.alive && TARGETS.includes(o.type) && o.team != null && o.team !== team);

export const raidPlanes = (world, raid) => world.planes.filter((p) => p.raid?.id === raid.id);

function callRaid(world, team, side) {
  const cfg = world.raids;
  const targets = targetsOf(world, team);
  if (!targets.length || !world.planeDefs[cfg.planes?.[team]]) return;
  const target = targets[Math.floor(world.rng.next() * targets.length)];
  const count = Math.max(1, Math.round(cfg.bombers));
  // x: where the leader comes in; the others follow behind it.
  const x = side.dir > 0 ? ENTRY + (count - 1) * cfg.spacing : world.map.width - ENTRY - (count - 1) * cfg.spacing;
  side.raid = { id: world.nextId++, target: target.id, kind: target.type, x, y: Math.min(cfg.height, world.map.ceiling - 60 - count * STEP_UP) - side.lane * LANE, eta: cfg.warning, count, flying: false };
  world.events.push({ type: 'raidWarning', team, raid: side.raid.id, kind: target.type, x, y: side.raid.y, eta: cfg.warning });
}

function launchRaid(world, team, side) {
  const cfg = world.raids;
  const raid = side.raid;
  const def = world.planeDefs[cfg.planes[team]];
  const angle = side.dir > 0 ? 0 : Math.PI;
  for (let i = 0; i < raid.count; i++) {
    const p = createPlane(world.nextId++, def, { team, nation: def.nation, seats: [{ role: 'pilot', controller: 'raid' }] });
    armPlane(p, world.weapons);
    // Its load for the raid: light bombs dropped one by one in a long stick (one station each).
    const bomb = world.weapons[cfg.bomb];
    if (bomb && def.hardpoints?.length) p.stations = Array.from({ length: Math.max(0, Math.round(cfg.bombs)) }, () => ({ hp: def.hardpoints[0].id, def: bomb, loaded: 1 }));
    Object.assign(p, {
      // slot: its place in the line; aim: its bomb aimer's error; wait: seconds left before the turn home.
      raid: { id: raid.id, slot: i, phase: 'in', aim: world.rng.range(-cfg.aimError, cfg.aimError), wait: 0, gap: 0 },
      state: 'air',
      x: raid.x - side.dir * i * cfg.spacing,
      y: raid.y + i * STEP_UP,
      angle,
      speed: cfg.speed,
      vx: side.dir * cfg.speed,
      vy: 0,
      inverted: side.dir < 0, // facing left, upright (as spawnAtAirfield)
      rollAngle: side.dir < 0 ? Math.PI : 0,
      gear: 0,
      gearDown: false,
      throttle: 0.7,
      rpm: def.engine.cruiseRpm,
    });
    world.planes.push(p);
    world.events.push({ type: 'spawn', plane: p.id, x: p.x, y: p.y });
  }
  raid.flying = true;
  world.events.push({ type: 'raidIn', team, raid: raid.id, kind: raid.kind, x: raid.x, y: raid.y });
}

export function stepDirector(world, dt) {
  if (!world.director || world.rules.bots === 'off') return;
  const cfg = world.raids;
  for (const [teamKey, side] of Object.entries(world.director)) {
    const team = Number(teamKey);
    const raid = side.raid;
    if (raid && !raid.flying) {
      raid.eta -= dt;
      if (raid.eta <= 0) launchRaid(world, team, side);
    } else if (raid) {
      // A bomber that came down in one piece is left where it lies, as a wreck.
      for (const p of raidPlanes(world, raid)) {
        if (p.state !== 'ground') continue;
        makeWreck(world, p);
        world.planes.splice(world.planes.indexOf(p), 1);
      }
      if (!raidPlanes(world, raid).length) {
        world.events.push({ type: 'raidOver', team, raid: raid.id });
        side.raid = null;
      }
    }
    if (!(cfg.interval > 0) || !(cfg.bombers > 0)) continue;
    side.timer -= dt;
    if (side.timer <= 0 && !side.raid) {
      side.timer = cfg.interval;
      callRaid(world, team, side);
    }
  }
}

// One bomber's command for this tick. Returns null once it has left the map (the caller drops it).
export function raidCommand(world, p) {
  const cfg = world.raids;
  const side = world.director?.[p.team];
  const r = p.raid;
  const cmd = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false, emergency: false, hangar: null };
  if (p.state !== 'air' || !side) return cmd;
  const dir = Math.cos(p.angle) >= 0 ? 1 : -1;
  const turning = p.edgeLevel != null || p.edgeTurn != null;

  if (r.phase === 'in') {
    // The target the raid was sent for; if it is gone, another one still ahead; with none, home.
    let target = world.ground.find((o) => o.id === side.raid?.target && o.alive);
    target ??= targetsOf(world, p.team).find((o) => (o.x - p.x) * side.dir > 0);
    const impact = target && world.rules.bots === 'on' ? bombImpact(world, p) : null;
    // Badly hit or burning, it gives up the run and turns for home with its bombs still on.
    const mauled = p.burning || p.hp < p.def.hp * cfg.abortHp;
    if (mauled && bombsLeft(p) > 0) world.events.push({ type: 'raidAbort', team: p.team, plane: p.id, x: p.x, y: p.y });
    if (mauled || !target || bombsLeft(p) === 0 || (p.x - target.x) * side.dir > OVERSHOOT) {
      r.phase = 'home';
      r.wait = mauled ? 0 : TURN_AFTER;
    } else if (impact) {
      // The stick is laid across the target: the first bomb falls short by half the stick's length.
      const half = r.bombing ? 0 : ((bombsLeft(p) - 1) * cfg.bombGap * p.speed) / 2;
      if (r.bombing || (impact.x - (target.x + r.aim - side.dir * half)) * side.dir >= 0) {
        if (!r.bombing) world.events.push({ type: 'raidBombs', team: p.team, plane: p.id, kind: target.type, x: p.x, y: p.y });
        r.bombing = true;
        // One bomb every bombGap seconds: a press, then the button let go.
        r.gap -= 1 / 60;
        if (r.gap <= 0) {
          cmd.bomb = true;
          r.gap = cfg.bombGap;
        }
      }
    }
  } else if (!turning && dir === side.dir) {
    // Bombs gone: a moment more on course, then round for home.
    r.wait -= 1 / 60;
    if (r.wait <= 0) turnBack(p, world);
  } else if (!turning) {
    const room = side.dir > 0 ? p.x : world.map.width - p.x;
    if (room < LEAVE) {
      world.events.push({ type: 'raidHome', team: p.team, plane: p.id, x: p.x, y: p.y });
      return null;
    }
  }

  // Straight and level at its own height and the raid's speed.
  const y = (side.raid?.y ?? cfg.height) + r.slot * STEP_UP;
  const pitch = clamp((y - p.y) / 250, -0.25, 0.25);
  const want = dir > 0 ? pitch : Math.PI - pitch;
  cmd.turn = clamp(angleDiff(want, p.angle) / 0.15, -1, 1);
  const level = clamp(0.7 + (cfg.speed - p.speed) * 0.05, 0, 1);
  cmd.throttle = clamp((level - p.throttle) * 10, -1, 1);
  if (p.inverted !== dir < 0 && !turning && !p.rolling) cmd.roll = true; // knocked over: roll upright
  return cmd;
}
