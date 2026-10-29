import { angleDiff, clamp, wrapAngle } from './math.js';
import { armPlane, updateWeapons, updateDamage } from './weapons.js';
import { updateServicing, ownAirfieldAt } from './airfield.js';
import { clearRunway } from './runway.js';

export { clearRunway };

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
const BOUNCE_KICK = 14; // upward speed (units/s) a hard landing throws the plane back up at
const BOUNCE_SETTLE = 0.06; // nose below the slope after a bounce (rad), to come down again
const BELLY_SPEED_MARGIN = 1.15; // a belly landing survives up to 115% of the normal landing speed
const STRANDED_TIME = 5; // seconds stopped away from home before the plane is recovered
const TAXI_ROLL_SPEED = 5; // below this, Shift turns the plane round on the ground; above, it rolls (and crashes)
const SPAWN_INSET = 15; // a plane starts this far into the clear stretch (counted in def.runwayNeeded)
const GRASS_FRICTION = 1.6; // rolling on grass off the runway drags more
const GEAR_JOLT_LIMIT = 320; // upward acceleration (units/s²) the gear survives when the ground rises

export const NO_COMMAND = Object.freeze({ turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false });

const isBot = (p) => p.seats.some((s) => s.controller.startsWith('bot'));

// Taildraggers sit tail-down on the ground: tilted nose-up about the main wheels until the tail wheel
// touches. As the take-off roll picks up speed the tail lifts, and the plane rolls level from about
// tailUpSpeed (share of take-off speed). Kept in the sim (p.groundTilt) because the guns point along
// the fuselage: standing on the ground they fire up at this angle. Wheel points in world units.
const MAIN_WHEEL_BOTTOM = [3.5, -3.6 - 1.4];
const TAIL_WHEEL_BOTTOM = [-10.5, -1.6 - 0.8];
const TAIL_DOWN = Math.atan2(TAIL_WHEEL_BOTTOM[1] - MAIN_WHEEL_BOTTOM[1], MAIN_WHEEL_BOTTOM[0] - TAIL_WHEEL_BOTTOM[0]);

function updateTilt(p, dt) {
  let target = 0;
  if (p.state === 'ground' && !p.belly && p.gear >= 1) {
    const t = clamp(p.speed / (p.def.takeoffSpeed * (p.def.tailUpSpeed ?? 0.85)), 0, 1);
    target = TAIL_DOWN * (1 - t * t * (3 - 2 * t));
  }
  p.groundTilt = (p.groundTilt ?? target) + (target - (p.groundTilt ?? target)) * Math.min(1, dt * 3.5);
}

// The plane as it actually sits: its angle and pivot with the ground tilt applied (rotated nose-up
// about the main wheel's contact point, so the main wheels stay on the ground).
export function attitude(p) {
  const tilt = p.groundTilt ?? 0;
  if (Math.abs(tilt) < 0.001) return { angle: p.angle, x: p.x, y: p.y };
  const angle = p.angle + (Math.cos(p.angle) >= 0 ? tilt : -tilt);
  const f = p.inverted ? -1 : 1;
  const [mx, my] = MAIN_WHEEL_BOTTOM;
  const off = (a) => [Math.cos(a) * mx - Math.sin(a) * my * f, Math.sin(a) * mx + Math.cos(a) * my * f];
  const [ox, oy] = off(p.angle);
  const [nx, ny] = off(angle);
  return { angle, x: p.x + ox - nx, y: p.y + oy - ny };
}

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
    fireLeft: 0, // seconds until a fire finishes the plane
    fireOut: 0, // seconds spent putting a fire out
    fireCough: false, // engine misfiring from the fire
    fireStopped: false, // engine stopped by the fire (it can be restarted once the fire is out)
    dying: false, // shot down: out of control until it hits the ground
    lastHitBy: null,
    kills: 0,
    deaths: 0,
    score: 0, // points for destroyed ground targets
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
  // Never in a crater: at the start (in the take-off direction) of the longest clear stretch.
  const clear = af.height != null ? clearRunway(world, af) : null;
  const length = clear ? clear.to - clear.from : 0;
  if (af.height != null && length < (p.def.runwayNeeded ?? 0)) {
    // Too short to take off: the plane waits off the runway (not counted as lost) until the crew have
    // filled enough craters. stepPlane tries again every tick.
    p.state = 'dead';
    p.waiting = true;
    p.respawnTimer = 0;
    p.x = facingRight ? af.x + 50 : af.x + af.width - 50;
    p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
    p.speed = p.vx = p.vy = p.sink = 0;
    p.service = null;
    p.burning = p.dying = false;
    return false;
  }
  p.waiting = false;
  if (clear && length > 40) p.x = facingRight ? clear.from + SPAWN_INSET : clear.to - SPAWN_INSET;
  else p.x = facingRight ? af.x + 50 : af.x + af.width - 50;
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
  p.fireLeft = p.fireOut = 0;
  p.fireCough = p.fireStopped = false;
  p.downCause = null;
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
  return true;
}

// cause: why it went in. A plane already shot down keeps the cause of that ('guns', 'bomb', ...).
// what: the thing it flew into, for cause 'structure'.
export function crash(p, world, cause, what = null) {
  const why = p.dying ? p.downCause ?? 'guns' : cause;
  world.events.push({ type: 'crash', plane: p.id, x: p.x, y: p.y, speed: p.speed, by: p.dying ? p.lastHitBy : null, cause: why, what });
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
  const firing = p.engineRunning && !p.starved && !(p.burning && p.fireCough);
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
  if (p.hp <= 0) crash(p, world, 'belly');
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

  // Shift on the ground: (nearly) stopped, the plane is turned round to face the other way, upright.
  // Rolling while taxiing digs a wingtip in and cartwheels the plane into a wreck.
  if (cmd.roll && !p.prevRoll && !p.belly) {
    if (p.speed < TAXI_ROLL_SPEED) {
      p.angle = wrapAngle(p.angle + Math.PI);
      p.inverted = !p.inverted;
    } else {
      world.events.push({ type: 'roll', plane: p.id });
      crash(p, world, 'taxiRoll');
      return;
    }
  }
  const facingRight = Math.cos(p.angle) >= 0;

  const slope = world.terrain.slopeAngle(p.x);
  const heading = facingRight ? slope : Math.PI + slope;
  const onRunway = world.map.airfields.some((a) => p.x >= a.x && p.x <= a.x + a.width);
  const rolling = p.belly ? BELLY_FRICTION : d.groundFriction * (p.throttle < 0.05 ? 2.5 : 1) * (onRunway ? 1 : GRASS_FRICTION);
  const friction = p.speed <= 0 ? 0 : rolling;
  // On its wheels a propeller pulls less than in flight, so the take-off roll builds speed slowly.
  const thrust = d.thrust * p.throttle * p.power * (d.groundThrust ?? 1);
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
      crash(p, world, 'rough');
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
  if (p.y <= ground) touchDown(p, world, ground, gearReady);
}

// cleanAngle: nose this close to the ground's slope (rad) is a clean landing; hardSpeed and hardAngle:
// up to these (share of max landing speed, rad) it's a hard landing that bounces and damages the plane;
// hardDamage: hit points at the worst of that; collapseFrom: past this share of the hard band the gear
// may fold; stallSink and plopDamage: a stall this slow sinking (units/s) is a tail-first plop.
export const DEFAULT_LANDING = { cleanAngle: 0.35, hardSpeed: 1.15, hardAngle: 0.6, hardDamage: 30, collapseFrom: 0.5, stallSink: 35, plopDamage: 6 };

// How a landing here would go right now, for the HUD's approach cues: speed and nose angle against the
// landing limits, each 'ok' (clean), 'hard' (bounce) or 'bad' (crash). noseUp < 0: nose below the slope.
export function approach(p, world) {
  const cfg = world.landing;
  const facingRight = Math.cos(p.angle) >= 0;
  const slope = world.terrain.slopeAngle(p.x);
  const noseUp = angleDiff(p.angle, facingRight ? slope : Math.PI + slope) * (facingRight ? 1 : -1);
  const share = p.speed / p.def.maxLandingSpeed;
  const grade = (v, clean, hard) => (v < clean ? 'ok' : v < hard ? 'hard' : 'bad');
  return { speed: grade(share, 1, cfg.hardSpeed), angle: grade(Math.abs(noseUp), cfg.cleanAngle, cfg.hardAngle), noseUp };
}

// The plane meets the ground. Clean: inside the landing limits. Hard: a little over them, it bounces
// back up, damaged (nose-down bends the propeller; a bad one can fold the gear). A stall in the last
// metre is a heavy tail-first plop. Worse is a crash, and the report says which limit was broken.
function touchDown(p, world, ground, gearReady) {
  const d = p.def;
  const cfg = world.landing;
  const facingRight = Math.cos(p.angle) >= 0;
  const slope = world.terrain.slopeAngle(p.x);
  const groundHeading = facingRight ? slope : Math.PI + slope;
  const noseUp = angleDiff(p.angle, groundHeading) * (facingRight ? 1 : -1); // < 0: nose below the slope
  const misalign = Math.abs(noseUp);
  const share = p.speed / d.maxLandingSpeed;
  const able = isUpright(p) && !p.blackout && !p.dying;
  const land = () => {
    p.state = 'ground';
    p.y = ground;
    p.angle = groundHeading;
    p.sink = 0;
    p.stalled = false;
    world.events.push({ type: 'touchdown', plane: p.id, x: p.x, y: p.y, speed: p.speed, misalign });
  };

  if (able && !gearReady && misalign < cfg.cleanAngle && share < BELLY_SPEED_MARGIN) {
    p.angle = groundHeading;
    bellyLand(p, world, ground);
    return;
  }
  if (able && gearReady && misalign < cfg.cleanAngle && share < 1 && !p.stalled) {
    land();
    return;
  }
  if (able && gearReady && p.stalled && -p.vy < cfg.stallSink && misalign < cfg.hardAngle && share < 1) {
    land();
    p.hp -= cfg.plopDamage;
    world.events.push({ type: 'hardLanding', plane: p.id, x: p.x, y: p.y, severity: 0, plop: true });
    if (p.hp <= 0) crash(p, world, 'hardLanding');
    return;
  }
  if (able && gearReady && !p.stalled && share < cfg.hardSpeed && misalign < cfg.hardAngle) {
    const s = clamp(Math.max((share - 1) / (cfg.hardSpeed - 1), (misalign - cfg.cleanAngle) / (cfg.hardAngle - cfg.cleanAngle)), 0, 1);
    p.hp -= cfg.hardDamage * (0.3 + 0.7 * s);
    const noseDown = noseUp < 0;
    if (noseDown) {
      p.propBent = true; // the propeller bites the ground
      p.engineDamage = clamp(p.engineDamage + 0.15, 0, 1);
    }
    world.events.push({ type: 'hardLanding', plane: p.id, x: p.x, y: p.y, severity: s, noseDown });
    if (p.hp <= 0) {
      crash(p, world, 'hardLanding');
      return;
    }
    if (s > cfg.collapseFrom && world.rng.next() < s) {
      p.angle = groundHeading;
      bellyLand(p, world, ground); // the gear folds
      return;
    }
    // Bounce: kicked back up off the gear, having lost some speed, nose just below the slope so that
    // once the kick (a negative sink) dies away the plane settles again.
    p.y = ground + 0.5;
    p.angle = wrapAngle(groundHeading - (facingRight ? BOUNCE_SETTLE : -BOUNCE_SETTLE));
    p.speed *= 0.85;
    p.sink = -BOUNCE_KICK * (0.5 + 0.5 * s);
    return;
  }

  let cause = 'ground';
  let what = null;
  if (p.blackout) cause = 'blackout';
  else if (!isUpright(p)) cause = 'inverted';
  else if (p.dying || misalign > 1) cause = 'ground';
  else if (p.stalled) [cause, what] = ['stall', { sink: -p.vy, limit: cfg.stallSink }];
  else if (share >= (gearReady ? cfg.hardSpeed : BELLY_SPEED_MARGIN)) [cause, what] = ['tooFast', { speed: p.speed, limit: d.maxLandingSpeed }];
  else [cause, what] = [noseUp < 0 ? 'tooSteep' : 'tailFirst', { angle: misalign, limit: gearReady ? cfg.hardAngle : cfg.cleanAngle }];
  crash(p, world, cause, what);
}

// Stopped away from home with a dead engine or on the belly, or stuck anywhere (a crater) with the
// throttle open and going nowhere: after a few seconds the plane is recovered to its own airfield (it
// isn't counted as lost).
function updateStranded(p, world, dt) {
  // Not while a fire is being put out: the engine may start again after that.
  const stranded = (p.belly || !p.engineRunning) && !ownAirfieldAt(world, p);
  p.stuckInCrater = p.engineRunning && !p.belly && p.throttle > 0.5 && !p.service;
  const stuck = p.speed < 1 && (stranded || p.stuckInCrater) && !p.burning;
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
  updateTilt(p, dt);
  if (p.state !== 'dead') updateWeapons(p, cmd, world, dt);
  if (p.state !== 'dead') updateServicing(p, world, dt);
  if (p.state !== 'dead') updateGear(p, cmd, world, dt);
  if (p.state === 'ground') updateStranded(p, world, dt);

  p.prevRoll = cmd.roll;
}
