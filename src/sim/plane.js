import { angleDiff, clamp, wrapAngle } from './math.js';
import { armPlane, updateWeapons, updateDamage } from './weapons.js';
import { updateServicing, ownAirfieldAt } from './airfield.js';

export const GRAVITY = 90;
const GEAR_HEIGHT = 4; // pivot height above the ground when parked
const RESPAWN_TIME = 3;
const BLACKOUT_RECOVER = 0.4;
const BLACKOUT_SINK = 90;
const STALL_RECOVERY = 1.15; // stall clears at 115% of stall speed
const EDGE_MARGIN = 12;
const LOW_FUEL = 0.15; // warning level
const STARVE_FUEL = 0.04; // below this the engine coughs and cuts in and out
// Landing gear comes up once climbing away and goes down when low and slow (with a gap between the
// two thresholds so it doesn't flip back and forth).
const GEAR_UP_ALT = 60;
const GEAR_UP_SPEED = 120;
const GEAR_DOWN_ALT = 25;
const GEAR_DOWN_SPEED = 105;
const GEAR_DRAG = 0.3; // gear fully down adds 30% drag
const BELLY_HEIGHT = 2.5; // pivot height when lying on the belly
const BELLY_FRICTION = 55;
const BELLY_SPEED_MARGIN = 1.15; // a belly landing survives up to 115% of the normal landing speed
const STRANDED_TIME = 5; // seconds stopped away from home before the plane is recovered
const GRASS_FRICTION = 1.6; // rolling on grass off the runway drags more
const GEAR_JOLT_LIMIT = 320; // upward acceleration (units/s²) the gear survives when the ground rises

export const NO_COMMAND = Object.freeze({ turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false });

const isBot = (p) => p.seats.some((s) => s.controller.startsWith('bot'));

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
    fuel: 1, // 0..1 of a full tank
    engineRunning: true,
    starved: false, // momentary fuel starvation (coughing on the last drops)
    lowFuelWarned: false,
    power: 1, // share of engine power reaching the propeller
    service: null, // ground crew at work: { wait, phase, rearmT }
    gear: 1, // 0 = retracted, 1 = down and locked
    gearDown: true, // where the gear is heading
    gearManual: false, // pilot has taken over the gear with G this flight
    prevGear: false,
    gearWarning: false, // low and slow with the gear up
    belly: false, // landed (or slid to a stop) on its belly
    strandedTimer: 0,
    tumble: 0, // seconds left out of control after a collision
    tumbleMax: 0,
    tumbleSpin: 0,
    tailDamage: 0, // 0..1: lost rudder/elevator authority
    wingPull: 0, // rad/s of drift from a damaged wing (sign = direction)
    propBent: false,
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
  p.fuel = 1;
  p.engineRunning = true;
  p.starved = p.lowFuelWarned = false;
  p.service = null;
  p.gear = 1;
  p.gearDown = true;
  p.gearManual = p.gearWarning = p.belly = false;
  p.strandedTimer = 0;
  p.tumble = p.tumbleSpin = p.tailDamage = p.wingPull = 0;
  p.propBent = false;
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

// Fuel burns faster at high throttle. On the last drops the engine coughs; when the tank is dry it
// stops, and the propeller only windmills in the airflow until the plane is refuelled.
function updateFuel(p, world, dt) {
  if (!p.engineRunning) return;
  p.fuel = Math.max(0, p.fuel - ((0.12 + 0.88 * p.throttle) / p.def.endurance) * dt);
  if (!p.lowFuelWarned && p.fuel < LOW_FUEL) {
    p.lowFuelWarned = true;
    world.events.push({ type: 'fuelLow', plane: p.id });
  }
  if (p.fuel < STARVE_FUEL) {
    if (world.rng.next() < dt * 6) p.starved = world.rng.next() < 0.45 + 0.5 * (1 - p.fuel / STARVE_FUEL);
  } else p.starved = false;
  if (p.fuel <= 0) {
    p.engineRunning = false;
    p.starved = false;
    world.events.push({ type: 'engineOut', plane: p.id, x: p.x, y: p.y });
  }
}

function updateEngine(p, world, dt) {
  const e = p.def.engine;
  updateFuel(p, world, dt);
  const firing = p.engineRunning && !p.starved;
  p.power = firing ? 1 - p.engineDamage * 0.5 : 0;
  let target;
  if (firing) {
    target = e.idleRpm + (e.cruiseRpm - e.idleRpm) * p.throttle * (1 - p.engineDamage * 0.35);
    // Airspeed drives the propeller: dives over-rev the engine, slow climbs drag it down.
    if (p.state === 'air') target += (p.speed / p.def.maxSpeed - 0.75) * 700 * (0.4 + 0.6 * p.throttle);
    target = clamp(target, e.idleRpm * 0.85, e.maxRpm * 1.1);
  } else {
    // Dead engine: the airflow turns the propeller, which stops on the ground.
    target = p.state === 'air' ? clamp(p.speed / p.def.maxSpeed, 0, 1.3) * e.cruiseRpm * 0.55 : 0;
  }
  p.rpm += (target - p.rpm) * Math.min(1, dt * (firing ? 2.2 : 0.8));
  p.load += (p.throttle * (firing ? 1 : 0) - p.load) * Math.min(1, dt * 5);
}

// Landing gear. Automatic by default: up once climbing away, down when low and slow. Pressing G takes
// over for the rest of the flight (bots always use automatic). The gear can't be raised on the ground.
function updateGear(p, cmd, world, dt) {
  const pressed = cmd.gear && !p.prevGear;
  p.prevGear = cmd.gear;
  if (p.belly) {
    p.gearWarning = false;
    return;
  }
  const alt = p.y - world.terrain.heightAt(p.x) - GEAR_HEIGHT;
  let want = p.gearDown;
  if (p.state === 'ground') {
    want = true;
    p.gearManual = false;
  } else if (pressed && !p.dying) {
    want = !p.gearDown;
    p.gearManual = true;
  } else if ((world.rules.autoGear || isBot(p)) && !p.gearManual) {
    if (p.gearDown && (alt > GEAR_UP_ALT || p.speed > GEAR_UP_SPEED)) want = false;
    else if (!p.gearDown && alt < GEAR_DOWN_ALT && p.speed < GEAR_DOWN_SPEED) want = true;
  }
  if (want !== p.gearDown) {
    p.gearDown = want;
    world.events.push({ type: 'gearMove', plane: p.id, down: want, x: p.x, y: p.y });
  }

  // Warning horn: throttled back, low and slow, and the gear isn't coming down.
  const warn = p.state === 'air' && !p.gearDown && alt < GEAR_DOWN_ALT && p.speed < GEAR_DOWN_SPEED && p.throttle < 0.5;
  if (warn && !p.gearWarning) world.events.push({ type: 'gearWarning', plane: p.id });
  p.gearWarning = warn;

  const target = p.gearDown ? 1 : 0;
  if (p.gear === target) return;
  const step = dt / (p.def.gearTime ?? 1.6);
  p.gear = p.gearDown ? Math.min(1, p.gear + step) : Math.max(0, p.gear - step);
  if (p.gear === target) world.events.push({ type: 'gearLocked', plane: p.id, down: p.gearDown, x: p.x, y: p.y });
}

// Wheels-up landing: the propeller strikes and stops, the airframe is damaged and the plane slides
// to a stop. A gear caught half-way collapses.
function bellyLand(p, world, groundY) {
  const collapsed = p.gear > 0.1;
  p.state = 'ground';
  p.belly = true;
  p.gear = 0;
  p.gearDown = false;
  p.y = groundY;
  p.sink = 0;
  p.stalled = false;
  p.engineRunning = false;
  p.starved = false;
  p.engineDamage = clamp(p.engineDamage + 0.3, 0, 1);
  p.propBent = true;
  p.hp -= 12 + p.speed * 0.25;
  world.events.push({ type: 'bellyLanding', plane: p.id, x: p.x, y: p.y, speed: p.speed, collapsed });
  if (p.hp <= 0) crash(p, world);
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
  if (cmd.roll && !p.prevRoll && p.speed < 5 && !p.belly) {
    p.angle = wrapAngle(p.angle + Math.PI);
    p.inverted = !p.inverted;
  }

  const slope = world.terrain.slopeAngle(p.x);
  const heading = facingRight ? slope : Math.PI + slope;
  const onRunway = world.map.airfields.some((a) => p.x >= a.x && p.x <= a.x + a.width);
  const rolling = p.belly ? BELLY_FRICTION : d.groundFriction * (p.throttle < 0.05 ? 2.5 : 1) * (onRunway ? 1 : GRASS_FRICTION);
  const friction = p.speed <= 0 ? 0 : rolling;
  const thrust = d.thrust * p.throttle * p.power;
  p.speed += (thrust - d.dragCoef * p.speed * p.speed - friction - GRAVITY * Math.sin(heading)) * dt;
  p.speed = Math.max(0, p.speed);

  const lift = p.belly ? BELLY_HEIGHT : GEAR_HEIGHT;
  const oldX = p.x;
  const oldY = p.y;
  p.angle = heading;
  p.x += Math.cos(heading) * p.speed * dt;
  if (p.x < EDGE_MARGIN || p.x > world.map.width - EDGE_MARGIN) {
    p.x = clamp(p.x, EDGE_MARGIN, world.map.width - EDGE_MARGIN);
    p.speed = 0;
  }
  p.vx = Math.cos(heading) * p.speed;
  p.vy = Math.sin(heading) * p.speed;
  const groundY = world.terrain.heightAt(p.x) + lift;

  // A plane isn't a car. Near take-off speed the wings carry most of its weight, so where the
  // ground curves away (a crest, the drop at the end of the runway) it flies off along its path
  // instead of hugging the slope. Where the ground curves sharply upwards, the gear takes the jolt,
  // and too hard a jolt is a crash.
  const dx = p.x - oldX;
  if (Math.abs(dx) > 0.01) {
    const curvature = (world.terrain.slopeAngle(p.x) - slope) / dx; // > 0: the ground bends upwards
    const wingLift = p.belly ? 0 : clamp((p.speed / d.takeoffSpeed) ** 2, 0, 1);
    const weight = GRAVITY * (1 - 0.9 * wingLift) * Math.cos(slope);
    const pull = p.speed * p.speed * curvature; // acceleration needed to follow the ground
    if (!p.belly && -pull > weight) {
      p.state = 'air';
      p.y = Math.max(oldY + p.vy * dt, groundY + 0.1);
      world.events.push({ type: 'leftGround', plane: p.id, x: p.x, y: p.y, speed: p.speed });
      return;
    }
    if (pull > GEAR_JOLT_LIMIT) {
      crash(p, world);
      return;
    }
  }
  p.y = groundY;

  // Rotating the nose upwards at flying speed lifts off: counter-clockwise facing right, clockwise facing left.
  const noseUp = facingRight ? 1 : -1;
  if (cmd.turn * noseUp > 0 && p.speed >= d.takeoffSpeed && !p.belly) {
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
  // A damaged tail answers the controls only weakly; a damaged wing drags the nose round.
  let turn = p.blackout ? 0 : cmd.turn * d.turnRate * authority * ramp * (1 - p.tailDamage * 0.75) + p.wingPull;

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
  // Knocked about after a collision: the controls don't answer until the tumble dies away.
  if (p.tumble > 0) {
    turn = p.tumbleSpin * (0.4 + 0.6 * (p.tumble / p.tumbleMax)) + p.wingPull;
    p.tumble = Math.max(0, p.tumble - dt);
  }
  // A shot-down plane noses over and goes in, spinning.
  if (p.dying) {
    const toDown = angleDiff(-Math.PI / 2, p.angle);
    turn = Math.sign(toDown) * Math.min(Math.abs(toDown), 1) * 1.6 + p.spinDir * 0.6;
  }

  p.angle = wrapAngle(p.angle + turn * dt);

  const thrust = d.thrust * p.throttle * p.power;
  const drag = d.dragCoef * p.speed * p.speed * (1 + GEAR_DRAG * p.gear);
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

  const gearReady = p.gear >= 0.9;
  const ground = world.terrain.heightAt(p.x) + (gearReady ? GEAR_HEIGHT : BELLY_HEIGHT);
  if (p.y <= ground) {
    const facingRight = Math.cos(p.angle) >= 0;
    const slope = world.terrain.slopeAngle(p.x);
    const groundHeading = facingRight ? slope : Math.PI + slope;
    const misalign = Math.abs(angleDiff(groundHeading, p.angle));
    const controlled = isUpright(p) && !p.blackout && !p.dying && misalign < 0.35;
    if (controlled && !gearReady && p.speed < d.maxLandingSpeed * BELLY_SPEED_MARGIN) {
      p.angle = groundHeading;
      bellyLand(p, world, ground);
    } else if (controlled && p.speed < d.maxLandingSpeed) {
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

// Stopped away from home with a dead engine or on the belly: after a few seconds the plane is
// recovered to its own airfield (it isn't counted as lost).
function updateStranded(p, world, dt) {
  const stuck = p.speed < 1 && (p.belly || !p.engineRunning) && !ownAirfieldAt(world, p);
  p.strandedTimer = stuck ? p.strandedTimer + dt : 0;
  if (p.strandedTimer >= STRANDED_TIME) {
    world.events.push({ type: 'recovered', plane: p.id, x: p.x, y: p.y });
    spawnAtAirfield(p, world);
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
  updateEngine(p, world, dt);
  updateDamage(p, world, dt);

  if (p.state === 'ground') stepGround(p, cmd, world, dt);
  else stepAir(p, cmd, world, dt);
  if (p.state !== 'dead') updateWeapons(p, cmd, world, dt);
  if (p.state !== 'dead') updateServicing(p, world, dt);
  if (p.state !== 'dead') updateGear(p, cmd, world, dt);
  if (p.state === 'ground') updateStranded(p, world, dt);

  p.prevRoll = cmd.roll;
}
