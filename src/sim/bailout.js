// Leaving a plane. The plane is left to burn as an empty wreck and the pilot goes over the side: under a
// parachute in the air (a deserter holds a white flag), on foot on the ground. Once down he's a soldier
// for his side, marching with the rest. The player's plane stays dead meanwhile, its position following
// the man, so the camera and sound do too; after respawnDelay a fresh press of fire gets a new plane.
import { createPlane, spawnAtAirfield, crash } from './plane.js';
import { shootDown, armPlane } from './weapons.js';
import { makeGroundObject, surfaceAt } from './ground.js';

// respawnDelay: seconds you watch your pilot before fire gets you a new plane. switchWait: seconds
// between changes of side or plane. wreckBurn: seconds an abandoned plane burns on the ground before
// it blows. gravity, openTime, sink, tornSink, drag, safeLanding: the fall, in world units and seconds.
export const DEFAULT_BAILOUT = {
  respawnDelay: 3,
  switchWait: 5,
  wreckBurn: 10,
  gravity: 90,
  openTime: 1,
  sink: 16,
  tornSink: 70,
  drag: 1.2,
  safeLanding: 30,
};

const BODY_RADIUS = 3.5; // what a bullet must pass within to hit the man
const CANOPY_RADIUS = 9; // ...or the canopy, which tears
const CANOPY_HEIGHT = 15; // canopy centre above the man
const PROP_REACH = 8; // a plane this close goes through him
const FLAK_REACH = 30;

// Leaves p burning where it is, as a new pilotless plane. Numbers and flags carry over; guns don't.
export function makeWreck(world, p) {
  const w = createPlane(world.nextId++, p.def, { team: p.team, nation: p.nation, seats: [{ role: 'pilot', controller: 'wreck' }] });
  for (const k of Object.keys(p)) {
    if (k === 'id' || k === 'callsign' || k === 'kills' || k === 'deaths' || k === 'score') continue;
    if (['number', 'boolean', 'string'].includes(typeof p[k])) w[k] = p[k];
  }
  armPlane(w, world.weapons);
  w.wreck = true;
  w.engineRunning = false;
  w.throttle = 0;
  w.service = null;
  world.planes.push(w);
  if (w.state === 'ground') {
    w.burning = true;
    w.fireLeft = world.fire.burnTime;
    w.wreckBurn = world.bailout.wreckBurn;
    world.events.push({ type: 'fire', plane: w.id, x: w.x, y: w.y });
  } else if (!w.dying) shootDown(world, w, null, 'fire');
  return w;
}

// An abandoned plane on the ground rolls to a stop and burns until it blows. Damage can blow it sooner
// (shootDown lifts it into the 'air' state, where it falls and crashes like any other).
export function stepGroundWreck(world, w, dt) {
  const slow = Math.exp(-dt * 1.5);
  const before = world.terrain.heightAt(w.x);
  w.speed *= slow;
  w.vx *= slow;
  w.vy = 0;
  w.x = Math.max(1, Math.min(world.map.width - 1, w.x + w.vx * dt));
  w.y += world.terrain.heightAt(w.x) - before;
  w.wreckBurn -= dt;
  if (w.wreckBurn <= 0) crash(w, world, 'fire');
}

function makeSoldier(world, team, x, callsign, owner) {
  const u = makeGroundObject(world, 'infantry', team, x, { squad: 1, mobile: true });
  u.dir = world.army[team]?.dir ?? 1;
  u.moving = false;
  u.callsign = callsign;
  u.owner = owner;
  world.ground.push(u);
  return u;
}

// team: the side he comes down on (a deserter's new one). A plane already on the ground: he climbs out.
export function bailOut(world, p, { deserter = false, team = p.team } = {}) {
  makeWreck(world, p);
  const callsign = p.callsign ?? null;
  const b = { since: world.tick, chute: null, soldier: null, fireHeld: true, wanted: false };
  if (p.state === 'ground') b.soldier = makeSoldier(world, team, p.x, callsign, p.id).id;
  else {
    b.chute = world.nextId++;
    world.parachutes.push({
      id: b.chute, owner: p.id, team, callsign, flag: deserter, x: p.x, y: p.y, vx: p.vx, vy: p.vy + 15,
      since: world.tick, open: false, torn: false, dir: Math.cos(p.angle) >= 0 ? 1 : -1,
    });
  }
  world.events.push({ type: 'bailedOut', plane: p.id, deserter, x: p.x, y: p.y });
  p.bailout = b;
  p.fresh = false;
  p.state = 'dead';
  p.speed = p.vx = p.vy = 0;
  p.service = null;
  p.dying = p.burning = false;
  p.groundTurn = p.groundLoop = null;
}

// The player's pilot is no longer theirs: he carries on, but without the name.
export function releasePilot(world, p) {
  const b = p.bailout;
  if (!b) return;
  const chute = world.parachutes.find((c) => c.id === b.chute);
  if (chute) chute.callsign = null;
  const soldier = world.ground.find((o) => o.id === b.soldier);
  if (soldier) soldier.callsign = null;
  p.bailout = null;
}

// Each tick of a plane waiting on its pilot: the view follows him, and fire (once allowed) gets a new plane.
export function stepBailedPilot(world, p, cmd, dt) {
  const b = p.bailout;
  const chute = world.parachutes.find((c) => c.id === b.chute);
  const soldier = world.ground.find((o) => o.id === b.soldier);
  if (chute) {
    p.x = chute.x;
    p.y = chute.y;
  } else if (soldier?.alive) {
    p.x = soldier.x;
    p.y = surfaceAt(world, soldier.x) + 3;
  }
  const fire = Boolean(cmd?.fire);
  const allowed = (world.tick - b.since) * dt >= world.bailout.respawnDelay;
  if (allowed && fire && !b.fireHeld) b.wanted = true;
  b.fireHeld = fire;
  // A closed runway keeps him waiting; the press still counts.
  if (b.wanted && spawnAtAirfield(p, world)) releasePilot(world, p);
}

function killPilot(world, c, cause, by = null, dir = 0) {
  const i = world.parachutes.indexOf(c);
  if (i >= 0) world.parachutes.splice(i, 1);
  world.events.push({ type: 'pilotKilled', id: c.id, plane: c.owner, team: c.team, x: c.x, y: c.y, cause, by, dir: dir || c.dir, open: c.open });
}

// How near point (x, y) comes to a bullet's path over this tick.
function passDistance(b, x, y, dt) {
  const dx = b.vx * dt;
  const dy = b.vy * dt;
  const t = Math.max(0, Math.min(1, ((x - (b.x - dx)) * dx + (y - (b.y - dy)) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(b.x - dx + dx * t - x, b.y - dy + dy * t - y);
}

function bulletsAt(world, c, dt) {
  for (let i = world.bullets.length - 1; i >= 0; i--) {
    const b = world.bullets[i];
    if (b.team === c.team && !world.rules.friendlyFire) continue;
    if (passDistance(b, c.x, c.y, dt) < BODY_RADIUS) {
      world.bullets.splice(i, 1);
      killPilot(world, c, 'bullet', b.owner, Math.sign(b.vx));
      return true;
    }
    if (c.open && !c.torn && passDistance(b, c.x, c.y + CANOPY_HEIGHT, dt) < CANOPY_RADIUS) {
      world.bullets.splice(i, 1);
      c.torn = true;
      world.events.push({ type: 'chuteTorn', id: c.id, plane: c.owner, x: c.x, y: c.y + CANOPY_HEIGHT });
    }
  }
  return false;
}

function strikes(world, c) {
  for (const p of world.planes) {
    // Not the wreck: he has only just left it, and its propeller has stopped.
    if (p.state !== 'air' || p.wreck || Math.hypot(p.x - c.x, p.y - c.y) > PROP_REACH) continue;
    killPilot(world, c, 'runDown', p.id, Math.cos(p.angle) >= 0 ? 1 : -1);
    world.events.push({ type: 'runDown', plane: p.id, dir: Math.cos(p.angle) >= 0 ? 1 : -1, x: c.x, y: c.y });
    return true;
  }
  for (const e of world.events) {
    const reach = e.type === 'explosion' ? e.radius : e.type === 'flakBurst' ? FLAK_REACH : 0;
    if (reach && Math.hypot(e.x - c.x, e.y - c.y) < reach) {
      killPilot(world, c, 'blast', e.owner ?? null, Math.sign(c.x - e.x));
      return true;
    }
  }
  return false;
}

export function stepParachutes(world, dt) {
  const cfg = world.bailout;
  for (let i = world.parachutes.length - 1; i >= 0; i--) {
    const c = world.parachutes[i];
    if (!c.open && (world.tick - c.since) * dt >= cfg.openTime) {
      c.open = true;
      world.events.push({ type: 'chuteOpen', id: c.id, x: c.x, y: c.y });
    }
    c.vx *= Math.exp(-dt * cfg.drag);
    c.vy -= cfg.gravity * dt;
    // Under the canopy the fall eases to the sink rate; a torn one holds back far less.
    if (c.open) c.vy = Math.max(c.vy, -(c.torn ? cfg.tornSink : cfg.sink));
    c.x = Math.max(1, Math.min(world.map.width - 1, c.x + c.vx * dt));
    c.y += c.vy * dt;
    if (bulletsAt(world, c, dt) || strikes(world, c)) continue;
    if (c.y > surfaceAt(world, c.x)) continue;
    c.y = surfaceAt(world, c.x);
    if (-c.vy > cfg.safeLanding) {
      killPilot(world, c, 'fall');
      continue;
    }
    world.parachutes.splice(i, 1);
    const u = makeSoldier(world, c.team, c.x, c.callsign, c.owner);
    const p = world.planes.find((o) => o.id === c.owner && o.bailout?.chute === c.id);
    if (p) {
      p.bailout.chute = null;
      p.bailout.soldier = u.id;
    }
    world.events.push({ type: 'pilotLanded', id: u.id, plane: c.owner, team: c.team, x: c.x, y: c.y });
  }
}
