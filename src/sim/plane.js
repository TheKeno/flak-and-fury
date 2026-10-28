import { angleDiff, clamp, wrapAngle } from './math.js';
import { armPlane, updateWeapons, updateDamage } from './weapons.js';

export const GRAVITY = 90;
const GEAR_HEIGHT = 4; // pivot height above the ground when parked
const RESPAWN_TIME = 3;
const BLACKOUT_RECOVER = 0.4;
const BLACKOUT_SINK = 90;
const STALL_RECOVERY = 1.15; // stall clears at 115% of stall speed
const EDGE_MARGIN = 12;

export const NO_COMMAND = Object.freeze({ turn: 0, throttle: 0, roll: false, fire: false, bomb: false });

// "Upright" means the pilot's head points at the sky: flying right normally, or flying left after a roll.
export const isUpright = (p) => Math.cos(p.angle) >= 0 !== p.inverted;

export function createPlane(id, def, { team, nation, seats }) {
  return {
    id,
    def,
    team,
    nation,
    seats, // [{ role: 'pilot', controller: 'p1' }, ...] — gunner/bomb-aimer seats come later
    state: 'ground', // 'ground' | 'air' | 'dead'
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    vx: 0,
    vy: 0,
    sink: 0,
    inverted: false,
    throttle: 0,
    rpm: def.engine.idleRpm,
    load: 0,
    stalled: false,
    consciousness: 1,
    blackout: false,
    spinDir: 1,
    respawnTimer: 0,
    prevRoll: false,
    turnDir: 0,
    turnHold: 0, // seconds the current turn key has been held, for fine aiming
    hp: def.hp,
    engineDamage: 0, // 0 = healthy, 1 = wrecked: less power, rough running
    burning: false,
    dying: false, // shot down: out of control until it hits the ground
    lastHitBy: null,
    kills: 0,
    deaths: 0,
    guns: [],
    bombs: null,
  };
}

export function spawnAtAirfield(p, world) {
  const af = world.map.airfields.find((a) => a.team === p.team) ?? world.map.airfields[0];
  const facingRight = af.x + af.width / 2 < world.map.width / 2;
  p.x = facingRight ? af.x + 50 : af.x + af.width - 50;
  p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
  p.angle = facingRight ? 0 : Math.PI;
  p.inverted = !facingRight;
  p.state = 'ground';
  p.speed = p.vx = p.vy = p.sink = 0;
  p.throttle = 0;
  p.rpm = p.def.engine.idleRpm;
  p.consciousness = 1;
  p.blackout = false;
  p.stalled = false;
  p.hp = p.def.hp;
  p.engineDamage = 0;
  p.burning = p.dying = false;
  p.lastHitBy = null;
  armPlane(p, world.weapons);
  world.events.push({ type: 'spawn', plane: p.id, x: p.x, y: p.y });
}

function crash(p, world) {
  world.events.push({ type: 'crash', plane: p.id, x: p.x, y: p.y, speed: p.speed, by: p.dying ? p.lastHitBy : null });
  p.state = 'dead';
  p.deaths++;
  p.respawnTimer = RESPAWN_TIME;
  p.speed = p.vx = p.vy = 0;
}

function updateEngine(p, dt) {
  const e = p.def.engine;
  let target = e.idleRpm + (e.cruiseRpm - e.idleRpm) * p.throttle * (1 - p.engineDamage * 0.35);
  // Airspeed drives the propeller: dives over-rev the engine, slow climbs drag it down.
  if (p.state === 'air') target += (p.speed / p.def.maxSpeed - 0.75) * 700 * (0.4 + 0.6 * p.throttle);
  target = clamp(target, e.idleRpm * 0.85, e.maxRpm * 1.1);
  p.rpm += (target - p.rpm) * Math.min(1, dt * 2.2);
  p.load += (p.throttle - p.load) * Math.min(1, dt * 5);
}

function updateConsciousness(p, cmd, world, dt) {
  const over = p.y - world.map.ceiling;
  if (over > 0) p.consciousness -= dt * (0.35 + over / 250);
  else p.consciousness += dt * 0.3;
  // Working the stick while blacked out helps the pilot come round.
  if (p.blackout && cmd.turn !== 0) p.consciousness += dt * 0.6;
  p.consciousness = clamp(p.consciousness, 0, 1);

  if (!p.blackout && p.consciousness <= 0) {
    p.blackout = true;
    p.spinDir = world.rng.sign();
    world.events.push({ type: 'blackout', plane: p.id });
  } else if (p.blackout && p.consciousness >= BLACKOUT_RECOVER && over < 0) {
    p.blackout = false;
    world.events.push({ type: 'wake', plane: p.id });
  }
}

function stepGround(p, cmd, world, dt) {
  const d = p.def;
  const facingRight = Math.cos(p.angle) >= 0;

  // Turn around when (nearly) stopped.
  if (cmd.roll && !p.prevRoll && p.speed < 5) {
    p.angle = wrapAngle(p.angle + Math.PI);
    p.inverted = !p.inverted;
  }

  const slope = world.terrain.slopeAngle(p.x);
  const heading = facingRight ? slope : Math.PI + slope;
  const friction = p.speed > 0 ? d.groundFriction * (p.throttle < 0.05 ? 2.5 : 1) : 0;
  const thrust = d.thrust * p.throttle * (1 - p.engineDamage * 0.5);
  p.speed += (thrust - d.dragCoef * p.speed * p.speed - friction - GRAVITY * Math.sin(heading)) * dt;
  p.speed = Math.max(0, p.speed);

  p.angle = heading;
  p.x += Math.cos(heading) * p.speed * dt;
  if (p.x < EDGE_MARGIN || p.x > world.map.width - EDGE_MARGIN) {
    p.x = clamp(p.x, EDGE_MARGIN, world.map.width - EDGE_MARGIN);
    p.speed = 0;
  }
  p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
  p.vx = Math.cos(heading) * p.speed;
  p.vy = Math.sin(heading) * p.speed;

  // Rotating the nose upwards at flying speed lifts off: counter-clockwise facing right, clockwise facing left.
  const noseUp = facingRight ? 1 : -1;
  if (cmd.turn * noseUp > 0 && p.speed >= d.takeoffSpeed) {
    p.state = 'air';
    p.angle = wrapAngle(p.angle + noseUp * 0.1);
    p.y += 1;
    world.events.push({ type: 'takeoff', plane: p.id, x: p.x, y: p.y });
  }
}

function stepAir(p, cmd, world, dt) {
  const d = p.def;

  if (cmd.roll && !p.prevRoll && !p.blackout) {
    p.inverted = !p.inverted;
    world.events.push({ type: 'roll', plane: p.id });
  }

  // Rotation is absolute on screen: +1 counter-clockwise, -1 clockwise, whichever way up the plane is.
  // A tap turns gently (fineTurn) for precise aiming; holding the key ramps up to the full turn rate.
  const dirNow = Math.sign(cmd.turn);
  if (dirNow !== 0 && dirNow === p.turnDir) p.turnHold += dt;
  else p.turnHold = 0;
  p.turnDir = dirNow;
  const ramp = d.fineTurn + (1 - d.fineTurn) * clamp(p.turnHold / d.turnRampTime, 0, 1);
  // Slow flight turns tighter: from slowTurnSpeed down to the stall the turn rate climbs by up to
  // slowTurnBonus. Chopping the throttle to whip round is a trick, but turning bleeds speed and one
  // knot too slow is a stall. Below the stall the controls go soft.
  let authority;
  if (p.speed < d.stallSpeed) authority = clamp((p.speed - 15) / 70, 0.12, 1);
  else {
    const t = clamp((d.slowTurnSpeed - p.speed) / Math.max(1, d.slowTurnSpeed - d.stallSpeed), 0, 1);
    authority = 1 + d.slowTurnBonus * t * t * (3 - 2 * t);
  }
  let turn = p.blackout ? 0 : cmd.turn * d.turnRate * authority * ramp;

  // Below stall speed the wings stop lifting: controls go soft and the nose falls.
  // The stall only clears once the plane has picked up a margin of speed again.
  const wasStalled = p.stalled;
  p.stalled = p.speed < d.stallSpeed * (wasStalled ? STALL_RECOVERY : 1);
  if (p.stalled) {
    const severity = clamp(1 - p.speed / d.stallSpeed, 0, 1);
    const toDown = angleDiff(-Math.PI / 2, p.angle);
    turn = turn * 0.15 + Math.sign(toDown) * Math.min(Math.abs(toDown), 1) * 2.4 * (0.7 + severity);
    if (!wasStalled) world.events.push({ type: 'stall', plane: p.id });
  }
  if (p.blackout) turn = 3.2 * p.spinDir;
  // A shot-down plane noses over and goes in, spinning.
  if (p.dying) {
    const toDown = angleDiff(-Math.PI / 2, p.angle);
    turn = Math.sign(toDown) * Math.min(Math.abs(toDown), 1) * 1.6 + p.spinDir * 0.6;
  }

  p.angle = wrapAngle(p.angle + turn * dt);

  const thrust = d.thrust * p.throttle * (1 - p.engineDamage * 0.5);
  const drag = d.dragCoef * p.speed * p.speed;
  const induced = Math.abs(turn) * p.speed * 0.12; // hard turns bleed speed
  p.speed += (thrust - drag - induced - GRAVITY * Math.sin(p.angle)) * dt;
  p.speed = Math.max(0, p.speed);

  // Stalled planes mush downwards; a blacked-out pilot spirals down out of the thin air.
  let targetSink = p.stalled ? (0.3 + clamp(1 - p.speed / d.stallSpeed, 0, 1)) * 60 : 0;
  if (p.blackout) targetSink = Math.max(targetSink, BLACKOUT_SINK);
  p.sink += (targetSink - p.sink) * Math.min(1, dt * 3);

  p.vx = Math.cos(p.angle) * p.speed;
  p.vy = Math.sin(p.angle) * p.speed - p.sink;
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // Map edges turn the plane back, keeping the pilot upright.
  if (p.x < EDGE_MARGIN || p.x > world.map.width - EDGE_MARGIN) {
    p.x = clamp(p.x, EDGE_MARGIN, world.map.width - EDGE_MARGIN);
    p.angle = wrapAngle(Math.PI - p.angle);
    p.inverted = !p.inverted;
  }

  const ground = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
  if (p.y <= ground) {
    const facingRight = Math.cos(p.angle) >= 0;
    const slope = world.terrain.slopeAngle(p.x);
    const groundHeading = facingRight ? slope : Math.PI + slope;
    const misalign = Math.abs(angleDiff(groundHeading, p.angle));
    if (isUpright(p) && !p.blackout && !p.dying && misalign < 0.35 && p.speed < d.maxLandingSpeed) {
      p.state = 'ground';
      p.y = ground;
      p.angle = groundHeading;
      p.sink = 0;
      p.stalled = false;
      world.events.push({ type: 'touchdown', plane: p.id, x: p.x, y: p.y, speed: p.speed, misalign });
    } else {
      crash(p, world);
    }
  }
}

export function stepPlane(p, cmd, world, dt) {
  if (p.state === 'dead') {
    p.respawnTimer -= dt;
    if (p.respawnTimer <= 0) spawnAtAirfield(p, world);
    return;
  }

  if (p.dying) cmd = { ...NO_COMMAND, throttle: -1 };
  p.throttle = clamp(p.throttle + cmd.throttle * 0.7 * dt, 0, 1);
  updateConsciousness(p, cmd, world, dt);
  updateEngine(p, dt);
  updateDamage(p, world, dt);

  if (p.state === 'ground') stepGround(p, cmd, world, dt);
  else stepAir(p, cmd, world, dt);
  if (p.state !== 'dead') updateWeapons(p, cmd, world, dt);

  p.prevRoll = cmd.roll;
}
