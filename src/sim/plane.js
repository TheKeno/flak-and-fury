import { angleDiff, clamp, wrapAngle } from './math.js';
import { armPlane, updateWeapons, updateDamage, allGuns, flyingDef } from './weapons.js';
import { updateServicing, ownAirfieldAt, sendPushCrew, sendParkCrew, serviceFully, servicingValue } from './airfield.js';
import { clearRunway } from './runway.js';
import { crashShockwave } from './ground.js';

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
const STRANDED_TIME = 5; // seconds before the crew tow a plane stuck on its own airfield out
const TAXI_ROLL_SPEED = 5; // below this, Shift turns the plane round on the ground; above, it ground-loops (and crashes)
const LOOP_SLOWDOWN = 2.5; // a ground-looping plane sheds this share of its speed per second, skidding round
const SPAWN_INSET = 15; // a plane starts this far into the clear stretch (counted in def.runwayNeeded)
const GRASS_FRICTION = 1.6; // rolling on grass off the runway drags more
const GRASS_TAKEOFF_MARGIN = 1.15; // ...but never so much that full throttle tops out below take-off speed (+15% for slopes)
const GEAR_JOLT_LIMIT = 320; // upward acceleration (units/s²) the gear survives when the ground rises

export const NO_COMMAND = Object.freeze({ turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false, hangar: null }); // hangar: 'call' (park in) | 'out' (roll out of the hangar), one tick

const isBot = (p) => p.seats.some((s) => s.controller.startsWith('bot'));

// Taildraggers sit tail-down on the ground: tilted nose-up about the main wheels until the tail wheel
// touches. As the take-off roll picks up speed the tail lifts, and the plane rolls level from about
// tailUpSpeed (share of take-off speed). Kept in the sim (p.groundTilt) because the guns point along
// the fuselage: standing on the ground they fire up at this angle. Wheel points in world units, from
// the plane's def.wheels (the renderer draws the gear from the same numbers) or these defaults.
export const DEFAULT_WHEELS = [
  { leg: [3, -2], wheel: [3.5, -3.6], stowed: [3.5, -0.8], r: 1.4 },
  { leg: [-10, -0.5], wheel: [-10.5, -1.6], stowed: [-10.5, -0.1], r: 0.8, tail: true },
];
const geometry = new WeakMap();
// Bottoms of the main and tail wheels, and the tail-down angle they give.
export function wheelGeometry(def) {
  let g = geometry.get(def);
  if (!g) {
    const wheels = def.wheels ?? DEFAULT_WHEELS;
    const bottom = (w) => [w.wheel[0], w.wheel[1] - w.r];
    const main = bottom(wheels.find((w) => !w.tail));
    const tail = bottom(wheels.find((w) => w.tail));
    g = { main, tail, tailDown: Math.atan2(tail[1] - main[1], main[0] - tail[0]) };
    geometry.set(def, g);
  }
  return g;
}

function updateTilt(p, dt) {
  let target = 0;
  if (p.state === 'ground' && !p.belly && p.gear >= 1) {
    const t = clamp(p.speed / (p.def.takeoffSpeed * (p.def.tailUpSpeed ?? 0.85)), 0, 1);
    target = wheelGeometry(p.def).tailDown * (1 - t * t * (3 - 2 * t)) + (p.rotation ?? 0);
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
  const [mx, my] = wheelGeometry(p.def).main;
  const off = (a) => [Math.cos(a) * mx - Math.sin(a) * my * f, Math.sin(a) * mx + Math.cos(a) * my * f];
  const [ox, oy] = off(p.angle);
  const [nx, ny] = off(angle);
  return { angle, x: p.x + ox - nx, y: p.y + oy - ny };
}

// Main wheels' ground contact point: the ground turn pivots about it, and the renderer anchors the
// ground frames there.
export function mainWheelContact(p) {
  const f = p.inverted ? -1 : 1;
  const [mx, my] = wheelGeometry(p.def).main;
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return { x: p.x + c * mx - s * my * f, y: p.y + s * mx + c * my * f };
}

// The roll as drawn (visual only: p.inverted flips at once, as it always has). rollAngle runs 0..2PI,
// 0 upright as drawn, PI upside down, and always turns the same way, so one roll shows the top and the
// next the belly. Anything else that flips the plane over (map edges, turning round) just snaps it.
function updateRoll(p, dt) {
  const rest = p.inverted ? Math.PI : 0;
  if (!p.rolling || p.state !== 'air') {
    p.rolling = false;
    p.rollAngle = rest;
    return;
  }
  const left = (((rest - p.rollAngle) % TAU) + TAU) % TAU;
  const step = (Math.PI / (p.def.rollTime ?? 0.5)) * dt;
  if (left <= step + 1e-9) {
    p.rollAngle = rest;
    p.rolling = false;
  } else p.rollAngle = (p.rollAngle + step) % TAU;
}
const TAU = Math.PI * 2;

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
    rotation: 0, // nose pitch rotated up on the wheels during the take-off (rad)
    liftBlend: 0, // seconds left of the climb-out blend after lift-off
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
    rollAngle: 0, // visual roll, see updateRoll
    rolling: false,
    exitTo: null, // x the plane rolls to after a respawn out of the hangar (null = not leaving it)
    exitPhase: null, // wait (hidden, doors/queue) | out (rolls towards the camera) | turn | roll (to exitTo) | shove (pushed up the queue)
    exitT: 0, // 0..1 through the roll-out towards the camera: the plane is drawn bigger as it comes
    exitSeq: 0, // place in the hangar queue
    park: null, // being pushed into the hangar (H standing still): { phase: call | roll | turn | in, t, to } (stepParkIn)
    hold: false, // inside the hangar after a park-in: stays behind the closed doors until the hangar panel is closed
    edgeLevel: null, // seconds into levelling out before a map-edge swing (null: not doing that); see stepAir
    edgeLevelTime: 0, // how long that levelling takes
    edgeLevelDiff: 0, // the angle the plane started it from, relative to level
    edgeLevelOff: 0, // what the pilot steered in meanwhile, fading out
    edgeTurn: null, // 0..1 through the swing round at a map edge (see stepAir)
    edgeDir: 0, // which edge: -1 left, 1 right
    edgeFlip: 0, // counts the flips at the half way mark, so the drawing can tell
    groundTurn: null, // 0..1 through turning round on the ground (pivoting on the main wheels)
    groundLoop: null, // 0..1 through a ground loop (Shift while taxiing): it ends with a wingtip in the ground
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
    gunChoice: null, // the pilot's chosen guns [{mount, weapon, count, ammo}] (null: the standard fit, gunsOf)
    stdGunKg: 0, // weight of the standard guns and ammunition, the zero point of the weight model (armPlane)
    loadout: null, // the pilot's chosen bombs [{hardpoint, weapon, count}] (null: the plane's default, loadoutOf)
    stations: [], // bomb stations (armPlane)
    bombCooldown: 0,
    bombHeld: false,
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

// fromHangar: a respawn, which rolls out of the hangar (the first spawn of a game or a seat starts on the runway).
export function spawnAtAirfield(p, world, fromHangar = false) {
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
  p.rolling = false;
  p.rollAngle = p.inverted ? Math.PI : 0;
  p.groundTurn = p.groundLoop = p.edgeTurn = p.edgeLevel = null;
  // Out of the hangar (a respawn): it starts inside, facing the camera, engine idling. stepHangarExit waits for
  // the doors and a free place, then the crew push it out; it turns into the runway and is rolled to
  // its place in the line. Not with the hangar destroyed (no doors, no crew): it appears on the runway.
  p.exitTo = null;
  p.exitPhase = null;
  p.exitT = 0;
  p.park = null;
  p.hold = false;
  const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === p.team && o.alive);
  if (hangar && fromHangar) placeInHangar(p, world, hangar, facingRight ? 1 : -1);
  armPlane(p, world.weapons);
  world.events.push({ type: 'spawn', plane: p.id, x: p.x, y: p.y });
  return true;
}

// Stands the plane behind the doors, waiting for its turn out (a respawn, or a park-in). dir: the take-off way.
function placeInHangar(p, world, hangar, dir) {
  // The first place in the line: clear of the hangar, or the runway start (where the plane is now) if that is further.
  const to = hangar.x + dir * (hangar.def.width / 2 + (hangar.def.exitClear ?? 12));
  p.exitTo = dir > 0 ? Math.max(p.x, to) : Math.min(p.x, to);
  // Its main wheels stand in the door centre (the turn pivots on them, so nothing hops when it starts).
  p.x = hangar.x + dir * wheelGeometry(p.def).main[0];
  p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
  p.exitPhase = 'wait';
  p.exitSeq = world.nextId++;
  // Pointing away from the take-off way: the turn into the runway flips it round (stepGroundTurn).
  p.angle = dir > 0 ? Math.PI : 0;
  p.inverted = dir > 0;
  p.rollAngle = p.inverted ? Math.PI : 0;
  p.groundTurn = 0.5; // the head-on frame, held until the turn
}

// Park-in (H on the ground, standing still, on your own airfield): why the crew cannot be called, or null.
export function parkInBlocker(p, world) {
  if (p.state !== 'ground' || p.wreck) return 'air';
  if (p.exitTo != null || p.park || p.groundTurn != null || p.groundLoop != null || p.dying || p.burning || p.belly) return 'busy';
  if (!world.ground.some((o) => o.type === 'hangar' && o.team === p.team && o.alive)) return 'nohangar';
  if (!ownAirfieldAt(world, p)) return 'field';
  if (Math.abs(p.speed) > 2 || (p.throttle >= 0.05 && p.engineRunning)) return 'moving';
  return null;
}

const takeoffDir = (world, p) => {
  const af = world.map.airfields.find((a) => a.team === p.team) ?? world.map.airfields[0];
  return af.x + af.width / 2 < world.map.width / 2 ? 1 : -1;
};

// The crew come out (those already servicing the plane take over), push it to the door, turn it nose-first
// into the hangar and push it in; the doors close and it holds inside (p.hold) until released. Farther from
// the hangar means a longer walk out and a longer push.
function startParkIn(p, world) {
  const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === p.team);
  // It stops with its main wheels in the door centre, where the turn pivots (as when rolling out).
  p.park = { phase: 'call', t: 0, to: hangar.x - (Math.cos(p.angle) >= 0 ? 1 : -1) * wheelGeometry(p.def).main[0] };
  p.service = null;
  sendParkCrew(world, p, hangar);
  world.events.push({ type: 'parkCall', plane: p.id, x: p.x, y: p.y });
}

// The call is dropped (throttle opened, hangar lost): the crew walk home and the plane stays where it is.
function cancelPark(p, world) {
  p.park = null;
  p.groundTurn = null;
  p.speed = p.vx = p.vy = 0;
  world.events.push({ type: 'parkCancel', plane: p.id, x: p.x, y: p.y });
}

function stepParkIn(p, world, dt) {
  const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === p.team);
  const park = p.park;
  if (!hangar?.alive || p.dying || p.burning) return cancelPark(p, world);
  p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
  if (park.phase === 'call') {
    p.speed = p.vx = p.vy = 0;
    const crew = world.crew.filter((c) => c.park && c.pushing === p.id);
    if (!crew.length) return cancelPark(p, world);
    if (crew.every((c) => c.state === 'at')) {
      park.phase = 'roll';
      for (const c of crew) c.state = 'push';
    }
  } else if (park.phase === 'roll') {
    // Pushed along the runway, whichever way it faces.
    const dir = park.to >= p.x ? 1 : -1;
    const speed = servicingValue(world, 'parkPushSpeed');
    const slope = world.terrain.slopeAngle(p.x);
    p.angle = Math.cos(p.angle) >= 0 ? slope : Math.PI + slope;
    const left = Math.abs(park.to - p.x);
    if (left <= speed * dt) {
      p.x = park.to;
      p.speed = p.vx = p.vy = 0;
      park.phase = 'turn';
      p.groundTurn = 0;
    } else {
      p.x += dir * speed * dt;
      p.speed = speed;
      p.vx = dir * speed;
      p.vy = 0;
    }
    p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
  } else if (park.phase === 'turn') {
    // Half a turn on the main wheels: the middle frame of the turn row, nose away from the camera.
    p.speed = p.vx = p.vy = 0;
    p.groundTurn = Math.min(0.5, p.groundTurn + dt / (p.def.groundTurnTime ?? 1.5));
    if (p.groundTurn >= 0.5) {
      park.phase = 'in';
      park.t = 0;
    }
  } else {
    // In: drawn smaller and fainter as it goes into the dark (the roll-out reversed).
    park.t = Math.min(1, park.t + dt / servicingValue(world, 'parkInTime'));
    if (park.t >= 1) {
      serviceFully(p);
      p.park = null;
      p.speed = p.vx = p.vy = p.throttle = 0;
      placeInHangar(p, world, hangar, takeoffDir(world, p));
      p.hold = true;
      world.events.push({ type: 'parkedIn', plane: p.id, x: p.x, y: p.y });
    }
  }
}

// cause: why it went in. A plane already shot down keeps the cause of that ('guns', 'bomb', ...).
// what: the thing it flew into, for cause 'structure'.
export function crash(p, world, cause, what = null) {
  const why = p.dying ? p.downCause ?? 'guns' : cause;
  world.events.push({ type: 'crash', plane: p.id, x: p.x, y: p.y, speed: p.speed, by: p.dying ? p.lastHitBy : null, cause: why, what });
  crashShockwave(world, p.x, p.y);
  p.state = 'dead';
  p.park = null;
  p.hold = false;
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
// over for the rest of the flight (bots always use automatic). Raising the gear on the ground drops the plane on its belly.
function updateGear(p, cmd, world, dt) {
  const pressed = cmd.gear && !p.prevGear;
  p.prevGear = cmd.gear;
  if (p.belly) {
    p.gearWarning = false;
    return;
  }
  // Fixed gear (the Stuka): always down, no G, no warning horn, no belly landing by choice.
  if (p.def.fixedGear) {
    p.gearDown = true;
    p.gear = 1;
    p.gearWarning = false;
    return;
  }
  const alt = p.y - world.terrain.heightAt(p.x) - GEAR_HEIGHT;
  let want = p.gearDown;
  if (p.state === 'ground') {
    // G on the ground folds the gear: down on the belly (not while the ground crew works on it).
    if (pressed && !p.dying && !(p.service?.phase && p.service.phase !== 'done')) {
      bellyLand(p, world, world.terrain.heightAt(p.x) + BELLY_HEIGHT);
      return;
    }
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

// Leaving the hangar after a respawn (see spawnAtAirfield), one plane of a team at a time, oldest first.
// wait: hidden inside until the doors are open, nobody else is on the way out and there is room in the
// line. out: pushed towards the camera (drawn bigger). turn: round into the runway. roll: pushed to its
// place in the line. A plane idling in the way is shoved up the line (phase shove) to make room.
function stepHangarExit(p, world, dt) {
  const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === p.team);
  const cfg = hangar?.def ?? {};
  const speed = servicingValue(world, 'parkPushSpeed'); // the crew push out as fast as they push in
  const early = p.exitPhase === 'wait' || p.exitPhase === 'out' || p.exitPhase === 'turn';
  if (early && !hangar?.alive) {
    // Hangar shelled meanwhile: the plane appears at its place on the runway.
    const dir = Math.cos(p.angle) >= 0 ? -1 : 1;
    p.x = p.exitTo;
    p.angle = dir > 0 ? 0 : Math.PI;
    p.inverted = dir < 0;
    p.rollAngle = p.inverted ? Math.PI : 0;
    p.groundTurn = null;
    p.exitTo = null;
    p.exitPhase = null;
    p.hold = false;
    p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
    return;
  }
  if (p.exitPhase === 'wait') {
    if (p.hold) return; // parked in: stays inside until the pilot lets it out
    if ((hangar.door ?? 1) < 1) return; // doors still opening
    const shoves = canLeaveHangar(p, world, cfg);
    if (!shoves) return;
    for (const [o, to] of shoves) {
      o.exitTo = to;
      o.exitPhase = 'shove';
      if (!world.crew.some((c) => c.push && c.pushing === o.id && c.state === 'push')) sendPushCrew(world, o, hangar); // a shoved plane is pushed too, until it stops
    }
    p.exitPhase = 'out';
    p.exitT = 0;
    sendPushCrew(world, p, hangar);
    return;
  }
  if (p.exitPhase === 'out') {
    p.exitT = Math.min(1, p.exitT + dt / servicingValue(world, 'parkInTime'));
    if (p.exitT >= 1) p.exitPhase = 'turn';
    return;
  }
  if (p.exitPhase === 'turn') {
    stepGroundTurn(p, world, dt);
    if (p.groundTurn == null) p.exitPhase = 'roll';
    return;
  }
  // roll / shove: along the runway at parkPushSpeed, engine off.
  const dir = Math.cos(p.angle) >= 0 ? 1 : -1;
  const slope = world.terrain.slopeAngle(p.x);
  p.angle = dir > 0 ? slope : Math.PI + slope;
  p.speed = speed;
  p.x += dir * speed * dt;
  p.vx = Math.cos(p.angle) * speed;
  p.vy = Math.sin(p.angle) * speed;
  p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
  if ((p.x - p.exitTo) * dir >= 0) {
    p.x = p.exitTo;
    p.exitTo = null;
    p.exitPhase = null;
    p.speed = p.vx = p.vy = 0;
  }
}

// Can this waiting plane come out now? Not while a plane of its team is on the way out or waiting ahead
// of it, nor with the line full. Returns the planes to shove up the line to make room as [plane, x]
// (empty list = none needed), or null for "not yet".
function canLeaveHangar(p, world, cfg) {
  const mates = world.planes.filter((o) => o !== p && o.team === p.team && o.state === 'ground' && !o.wreck);
  // A human pilot goes before any bot, whatever the order they arrived in; otherwise first come, first out.
  const human = (o) => Boolean(o.seats?.[0]?.controller) && !o.seats[0].controller.startsWith('bot');
  const before = (o) => (human(o) !== human(p) ? human(o) : o.exitSeq < p.exitSeq);
  if (mates.some((o) => o.exitPhase === 'out' || o.exitPhase === 'turn' || o.exitPhase === 'roll' || (o.exitPhase === 'wait' && !o.hold && before(o)))) return null;
  const dir = Math.cos(p.angle) >= 0 ? -1 : 1; // the take-off way
  const gap = cfg.slotGap ?? 34;
  const size = cfg.queueSize ?? 3;
  const base = p.exitTo;
  const ahead = (o) => (o.x - base) * dir;
  const line = mates.filter((o) => (!o.exitPhase || o.exitPhase === 'shove') && ahead(o) > -gap / 2 && ahead(o) < size * gap && Math.abs(o.speed) < 5).sort((a, b) => ahead(a) - ahead(b));
  if (line.length >= size) return null;
  const shoves = [];
  let prev = base;
  for (const o of line) {
    const want = o.exitPhase === 'shove' ? o.exitTo : o.x;
    if ((want - prev) * dir >= gap * 0.9) {
      prev = want;
      continue;
    }
    if (o.throttle > 0.05) return null; // the pilot has opened the throttle to go: wait behind
    prev += dir * gap;
    shoves.push([o, prev]);
  }
  return shoves;
}

function stepGround(p, cmd, world, dt) {
  const d = flyingDef(p, world);

  if (p.groundTurn != null) {
    stepGroundTurn(p, world, dt);
    return;
  }
  // Shift on the ground: (nearly) stopped, the plane pivots round on its main wheels to face the other
  // way, upright. Rolling while taxiing ground-loops it: it spins round, tips over and digs a wingtip in.
  if (cmd.roll && !p.prevRoll && !p.belly && p.groundLoop == null) {
    if (p.speed < TAXI_ROLL_SPEED) {
      p.groundTurn = 0;
      p.speed = p.vx = p.vy = 0;
      world.events.push({ type: 'groundTurn', plane: p.id, x: p.x, y: p.y });
      return;
    }
    p.groundLoop = 0;
    world.events.push({ type: 'roll', plane: p.id });
    world.events.push({ type: 'groundLoop', plane: p.id, x: p.x, y: p.y, speed: p.speed });
  }
  if (p.groundLoop != null) {
    // Out of control, skidding round; the crash comes when the wingtip hits the ground.
    p.groundLoop += dt / (d.groundLoopTime ?? 0.9);
    p.speed *= Math.max(0, 1 - LOOP_SLOWDOWN * dt);
    if (p.groundLoop >= 1) {
      crash(p, world, 'taxiRoll');
      return;
    }
  }
  const facingRight = Math.cos(p.angle) >= 0;

  const slope = world.terrain.slopeAngle(p.x);
  const heading = facingRight ? slope : Math.PI + slope;
  const onRunway = world.map.airfields.some((a) => p.x >= a.x && p.x <= a.x + a.width);
  let grass = onRunway ? 1 : GRASS_FRICTION;
  if (!onRunway) {
    // Weaker engines (P-47, Bf 110) would otherwise be capped by grass drag below the speed they need to fly.
    const spare = d.thrust * (d.groundThrust ?? 1) - d.dragCoef * (d.takeoffSpeed * GRASS_TAKEOFF_MARGIN) ** 2;
    grass = clamp(spare / d.groundFriction, 1, GRASS_FRICTION);
  }
  const rolling = p.belly ? BELLY_FRICTION : d.groundFriction * (p.throttle < 0.05 ? 2.5 : 1) * grass;
  const friction = p.speed <= 0 ? 0 : rolling;
  // On its wheels a propeller pulls less than in flight, so the take-off roll builds speed slowly.
  const thrust = p.groundLoop != null ? 0 : d.thrust * p.throttle * p.power * (d.groundThrust ?? 1);
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
    if (!p.belly && -pull > weight && p.groundLoop == null) {
      p.state = 'air';
      p.rotation = 0;
      p.liftBlend = (world.takeoff ?? DEFAULT_TAKEOFF).blendTime;
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

  // Pulling the nose up at flying speed rotates it on the main wheels (counter-clockwise facing right,
  // clockwise facing left) at rotateRate; the plane leaves the ground once it has come up liftoffPitch.
  // Let go and the nose settles back. The pitch is drawn through the ground tilt (updateTilt).
  const noseUp = facingRight ? 1 : -1;
  const to = world.takeoff ?? DEFAULT_TAKEOFF;
  const pulling = cmd.turn * noseUp > 0 && p.speed >= d.takeoffSpeed && !p.belly && p.groundLoop == null;
  p.rotation = pulling ? (p.rotation ?? 0) + to.rotateRate * dt : Math.max(0, (p.rotation ?? 0) - to.rotateRate * 2 * dt);
  if (pulling && p.rotation >= to.liftoffPitch) {
    // Carry on from the pose it is drawn in, so there is no jump.
    const a = attitude(p);
    p.state = 'air';
    p.angle = wrapAngle(a.angle);
    p.x = a.x;
    p.y = Math.max(a.y, p.y) + 0.5;
    p.groundTilt = 0;
    p.rotation = 0;
    p.liftBlend = to.blendTime;
    world.events.push({ type: 'takeoff', plane: p.id, x: p.x, y: p.y });
  }
}

// Turning round on the ground: the plane stands still on its main wheels while the tail swings round
// (it can't move or take off, and can still be shot). Done, it faces the other way, upright, with the
// main wheels where they were.
function stepGroundTurn(p, world, dt) {
  p.speed = p.vx = p.vy = 0;
  p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
  p.groundTurn += dt / (p.def.groundTurnTime ?? 1.5);
  if (p.groundTurn < 1) return;
  const dir = Math.cos(p.angle) >= 0 ? 1 : -1;
  p.groundTurn = null;
  p.x = clamp(p.x + 2 * dir * wheelGeometry(p.def).main[0], EDGE_MARGIN, world.map.width - EDGE_MARGIN);
  p.y = world.terrain.heightAt(p.x) + GEAR_HEIGHT;
  p.angle = wrapAngle(p.angle + Math.PI);
  p.inverted = !p.inverted;
  world.events.push({ type: 'turnedRound', plane: p.id, x: p.x, y: p.y });
}

const smooth01 = (t) => {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};

// The map-edge turn-back, worked out for a plane heading out (out: 1 right, -1 left) at its current angle
// and position: how long it needs to level out, how far that carries it towards the wall (travel), and the
// swing's drift plus the pivot's shift (drift), so the plane stops at the wall. The speed is held at the
// current one, but never below flying speed. A steeper entry takes longer (levelRate: the fastest the nose
// moves, rad/s); if the path would put it in the ground or the thin air at the top it levels faster, up to
// about twice as fast.
function levelPlan(p, world, out, to, swing) {
  const d = flyingDef(p, world);
  const speed = Math.max(p.speed, d.stallSpeed * STALL_RECOVERY * 1.02);
  const target = out > 0 ? 0 : Math.PI;
  const diff = wrapAngle(p.angle - target);
  const base = Math.max(0.15, (1.5 * Math.abs(diff)) / (to.levelRate ?? DEFAULT_TAKEOFF.levelRate));
  const ceiling = world.map.ceiling - 40;
  let plan = null;
  let normalTravel = null;
  for (const k of [1, 1.3, 1.7, 2.2]) {
    const time = Math.max(0.15, base / k);
    let x = p.x;
    let y = p.y;
    let ok = true;
    for (let i = 1; i <= 12; i++) {
      const a = target + diff * (1 - smooth01(i / 12));
      x += (Math.cos(a) * speed * time) / 12;
      y += (Math.sin(a) * speed * time) / 12;
      if (y < world.terrain.heightAt(x) + 40 || y > ceiling) ok = false;
    }
    plan = { time, travel: out * (x - p.x), speed, ok };
    normalTravel ??= plan.travel;
    if (ok) break;
  }
  // The start is always timed for the normal level-out, so a plane diving at the ground has not left it
  // too late to level faster; if it does level faster it just stops a little short of the wall.
  plan.travel = normalTravel;
  plan.drift = (speed * swing) / Math.PI + 2 * Math.abs(wheelGeometry(d).main[0]) + 4; // the pivot's shift, and a little to spare
  return plan;
}

function stepAir(p, cmd, world, dt) {
  const d = flyingDef(p, world);
  // At a map edge the plane levels out, swings round and flies back level (see the edge code below): rolling
  // is locked throughout (guns still work), steering fades out over the first moments of the levelling
  // and stays locked through the swing.
  // A plane that is shot down, blacks out or is knocked about is on its own: no autopilot.
  if ((p.dying || p.blackout || p.tumble > 0) && (p.edgeLevel != null || p.edgeTurn != null)) {
    p.edgeLevel = p.edgeTurn = null;
    p.edgeDir = 0;
  }
  const edging = p.edgeLevel != null || p.edgeTurn != null;
  if (edging) cmd = { ...cmd, turn: p.edgeTurn != null ? 0 : cmd.turn, roll: false };

  if (cmd.roll && !p.prevRoll && !p.blackout) {
    p.inverted = !p.inverted;
    p.rolling = true;
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
  // Just after lift-off the nose keeps turning at the ground rotation rate and eases up to the full
  // flying rate over blendTime, so the climb-out has no kink where the two models meet.
  if (p.liftBlend > 0) {
    const to = world.takeoff ?? DEFAULT_TAKEOFF;
    p.liftBlend = Math.max(0, p.liftBlend - dt);
    const k = to.blendTime > 0 ? 1 - p.liftBlend / to.blendTime : 1;
    const e = k * k * (3 - 2 * k);
    if (Math.abs(turn) > to.rotateRate) turn = Math.sign(turn) * (to.rotateRate + (Math.abs(turn) - to.rotateRate) * e);
  }

  // Below stall speed the wings stop lifting: controls go soft and the nose falls.
  // The stall only clears once the plane has picked up a margin of speed again.
  const wasStalled = p.stalled;
  p.stalled = !edging && p.speed < d.stallSpeed * (wasStalled ? STALL_RECOVERY : 1);
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

  if (p.edgeLevel != null) {
    // Levelling out: the nose follows a smooth path to level. What the pilot is still steering in during the
    // first 0.3 s rides on top of it as an offset that dies away over the levelling, so nothing snatches
    // the stick.
    p.edgeLevel += dt;
    p.edgeLevelOff += turn * dt * (1 - smooth01(p.edgeLevel / 0.3));
    const u = p.edgeLevel / p.edgeLevelTime;
    const target = p.edgeDir > 0 ? 0 : Math.PI;
    p.angle = wrapAngle(target + p.edgeLevelDiff * (1 - smooth01(u)) + p.edgeLevelOff * (1 - smooth01(u)));
  } else p.angle = wrapAngle(p.angle + turn * dt);

  // The autopilot holds the speed it started with (a steep climb into the wall must not stall mid-turn).
  if (!edging) {
    const thrust = d.thrust * p.throttle * p.power;
    const drag = d.dragCoef * p.speed * p.speed * (1 + GEAR_DRAG * p.gear);
    const induced = Math.abs(turn) * p.speed * 0.12; // hard turns bleed speed
    p.speed += (thrust - drag - induced - GRAVITY * Math.sin(p.angle)) * dt;
    p.speed = Math.max(0, p.speed);
  }

  // Stalled planes mush downwards; a blacked-out pilot spirals down out of the thin air.
  let targetSink = p.stalled ? (0.3 + clamp(1 - p.speed / d.stallSpeed, 0, 1)) * 60 : 0;
  if (p.blackout) targetSink = Math.max(targetSink, BLACKOUT_SINK);
  p.sink += (targetSink - p.sink) * Math.min(1, dt * 3);

  p.vx = Math.cos(p.angle) * p.speed;
  p.vy = Math.sin(p.angle) * p.speed - p.sink;
  // Map edges: the plane doesn't bounce, it turns back in three steps. 1) It levels out (edgeLevel), the
  // nose easing to horizontal along a smooth path; a steeper entry takes longer (takeoff.levelRate), and
  // near the ground or the ceiling it levels faster if it has to. 2) The swing round (edgeTurn 0..1, drawn
  // with the runway turn-round frames) keeps some forward drift that slows to a stop at the half way mark,
  // where the plane flips (angle mirrored, pilot kept upright), then speeds up the other way: the outward
  // speed follows cos(PI t), so it starts and ends at the normal flying speed. 3) It flies on level.
  // Both steps are timed so the plane stops at the wall, never out of the world: they start as far from it
  // as the levelling and the swing's drift need (levelPlan).
  const to = world.takeoff ?? DEFAULT_TAKEOFF;
  const swing = to.edgeTurnTime ?? DEFAULT_TAKEOFF.edgeTurnTime;
  if (p.edgeLevel != null && p.edgeLevel >= p.edgeLevelTime) {
    p.edgeLevel = null;
    p.angle = p.edgeDir > 0 ? 0 : Math.PI;
    p.edgeTurn = 0;
    p.rolling = false;
    world.events.push({ type: 'edgeTurn', plane: p.id, x: p.x, y: p.y });
  }
  if (p.edgeTurn != null) {
    const before = p.edgeTurn;
    p.edgeTurn += dt / swing;
    if (before < 0.5 && p.edgeTurn >= 0.5) {
      // The plane pivots on its main wheels, as in the ground turn: the wheels stay put and the plane
      // moves to the other side of them (the drawn frames are anchored there, so they don't jump).
      const wheels = mainWheelContact(p);
      p.angle = wrapAngle(Math.PI - p.angle);
      p.inverted = !p.inverted;
      p.x += wheels.x - mainWheelContact(p).x;
      p.edgeFlip = (p.edgeFlip ?? 0) + 1; // tells the drawing not to blend this tick's angle and position (src/render/interpolate.js)
    }
    p.vx = p.edgeDir * Math.abs(Math.cos(p.angle)) * p.speed * Math.cos(Math.PI * Math.min(1, p.edgeTurn));
    p.vy = Math.sin(p.angle) * p.speed;
    if (p.edgeTurn >= 1) {
      p.edgeTurn = null;
      p.edgeDir = 0;
    }
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (!edging && p.vx !== 0) {
    const out = p.vx > 0 ? 1 : -1;
    const room = out > 0 ? world.map.width - EDGE_MARGIN - p.x : p.x - EDGE_MARGIN;
    if (!(p.dying || p.blackout || p.tumble > 0)) {
      // Far from the wall nothing needs working out; close enough, the plan says go.
      if (room < 900) {
        const plan = levelPlan(p, world, out, to, swing);
        if (room <= plan.travel + plan.drift + plan.speed * dt) { // (plus a tick's travel, so it never starts a tick late)
          p.edgeLevel = 0;
          p.edgeLevelTime = plan.time;
          p.edgeLevelDiff = wrapAngle(p.angle - (out > 0 ? 0 : Math.PI));
          p.edgeLevelOff = 0;
          p.edgeDir = out;
          p.speed = plan.speed;
          p.stalled = false;
          p.rolling = false; // a roll still being drawn snaps to rest
        }
      }
    } else if (room <= 0) {
      // A plane that is dying, blacked out or tumbling gets no autopilot: it just bounces off, as before.
      p.x = clamp(p.x, EDGE_MARGIN, world.map.width - EDGE_MARGIN);
      p.angle = wrapAngle(Math.PI - p.angle);
      p.inverted = !p.inverted;
      p.edgeFlip = (p.edgeFlip ?? 0) + 1;
    }
  }
  if (!edging) p.x = clamp(p.x, EDGE_MARGIN, world.map.width - EDGE_MARGIN);

  const gearReady = p.gear >= 0.9;
  const ground = world.terrain.heightAt(p.x) + (gearReady ? GEAR_HEIGHT : BELLY_HEIGHT);
  if (p.y <= ground) touchDown(p, world, ground, gearReady);
}

// cleanAngle: nose this close to the ground's slope (rad) is a clean landing; hardSpeed and hardAngle:
// up to these (share of max landing speed, rad) it's a hard landing that bounces and damages the plane;
// hardDamage: hit points at the worst of that; collapseFrom: past this share of the hard band the gear
// may fold; stallSink and plopDamage: a stall this slow sinking (units/s) is a tail-first plop.
// rotateRate: how fast the nose comes up on the wheels at take-off (rad/s); liftoffPitch: the pitch it
// leaves the ground at (rad); blendTime: seconds the turn rate takes to ease up to the flying rate.
export const DEFAULT_TAKEOFF = { rotateRate: 0.4, liftoffPitch: 0.14, blendTime: 0.8, edgeTurnTime: 1.2, levelRate: 1.2 };
export const DEFAULT_LANDING ={ cleanAngle: 0.35, hardSpeed: 1.15, hardAngle: 0.6, hardDamage: 30, collapseFrom: 0.5, stallSink: 35, plopDamage: 6 };

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
  p.edgeTurn = p.edgeLevel = null;
  const d = flyingDef(p, world);
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
// throttle open and going nowhere: the pilot waits for recovery (the plane is brought home, damage and
// all, and isn't counted as lost) or abandons it (B: a fresh plane at home, counted as lost). Stuck on
// its own airfield, the crew tow it out after a few seconds. Stopped in a field with a good engine the
// pilot can take off again, or abandon.
function updateStranded(p, cmd, world, dt) {
  const home = ownAirfieldAt(world, p);
  // Not while a fire is being put out: the engine may start again after that.
  const stranded = (p.belly || !p.engineRunning) && !home;
  p.stuckInCrater = p.engineRunning && !p.belly && p.throttle > 0.5 && !p.service;
  const stuck = p.speed < 1 && (stranded || p.stuckInCrater) && !p.burning;
  p.strandedTimer = stuck ? p.strandedTimer + dt : 0;
  if (cmd.abandon && p.speed < 1 && !home) {
    abandon(p, world);
    return;
  }
  if (p.strandedTimer >= recoveryTime(p, world)) recover(p, world);
}

export const recoveryTime = (p, world) => (ownAirfieldAt(world, p) ? STRANDED_TIME : world.servicing.recoveryTime);

// Brought home as it is: the crew there repair, refuel and rearm it.
function recover(p, world) {
  world.events.push({ type: 'recovered', plane: p.id, x: p.x, y: p.y });
  const kept = {
    hp: p.hp, engineDamage: p.engineDamage, tailDamage: p.tailDamage, wingPull: p.wingPull, propBent: p.propBent,
    belly: p.belly, gear: p.gear, gearDown: p.gearDown, fuel: p.fuel, engineRunning: p.engineRunning,
  };
  const ammo = allGuns(p).map((g) => g.ammo);
  const bombs = p.stations.map((s) => s.loaded);
  if (!spawnAtAirfield(p, world)) return; // runway closed: it waits, and comes back new
  Object.assign(p, kept);
  allGuns(p).forEach((g, i) => (g.ammo = ammo[i]));
  p.stations.forEach((s, i) => (s.loaded = bombs[i]));
  p.y = world.terrain.heightAt(p.x) + (p.belly ? BELLY_HEIGHT : GEAR_HEIGHT);
}

function abandon(p, world) {
  world.events.push({ type: 'abandoned', plane: p.id, x: p.x, y: p.y });
  p.deaths++;
  p.state = 'dead';
  p.respawnTimer = RESPAWN_TIME;
  p.speed = p.vx = p.vy = 0;
  p.service = null;
}

export function stepPlane(p, cmd, world, dt) {
  if (p.state === 'dead') {
    p.groundTurn = p.groundLoop = p.edgeTurn = p.edgeLevel = null;
    p.respawnTimer -= dt;
    if (p.respawnTimer <= 0) spawnAtAirfield(p, world, true);
    return;
  }

  if (p.dying) cmd = { ...NO_COMMAND, throttle: -1 };
  // Once the turn is done a human pilot can take over: opening the throttle ends the push at once (the
  // crew let go and walk home). Bots are pushed all the way to their place.
  if (p.exitPhase === 'roll' && cmd.throttle > 0 && !p.seats[0]?.controller?.startsWith('bot')) {
    p.exitTo = null;
    p.exitPhase = null;
  }
  // H standing still calls the crew to park the plane in; opening the throttle before it is turned in cancels
  // that. H in the hangar panel (closing it) lets a parked plane out.
  if (cmd.hangar === 'call' && !parkInBlocker(p, world)) startParkIn(p, world);
  if (cmd.hangar === 'out' && p.hold) {
    p.hold = false;
    p.exitSeq = world.nextId++; // a fresh place in the queue
  }
  if (p.park && (p.park.phase === 'call' || p.park.phase === 'roll') && cmd.throttle > 0) cancelPark(p, world);
  // Rolling out of the hangar (or into it) the plane is on rails: no guns, no throttle.
  if (p.exitTo != null || p.park) cmd = { ...NO_COMMAND, throttle: 0 };
  // Turning round or ground-looping, the guns point nowhere useful.
  if (p.groundTurn != null || p.groundLoop != null) cmd = { ...cmd, fire: false, bomb: false };
  p.throttle = clamp(p.throttle + cmd.throttle * 0.7 * dt, 0, 1);
  updateConsciousness(p, cmd, world, dt);
  updateEngine(p, world, dt);
  updateDamage(p, world, dt);

  if (p.state === 'ground' && p.park) stepParkIn(p, world, dt);
  else if (p.state === 'ground' && p.exitTo != null) stepHangarExit(p, world, dt);
  else if (p.state === 'ground') stepGround(p, cmd, world, dt);
  else stepAir(p, cmd, world, dt);
  updateTilt(p, dt);
  updateRoll(p, dt);
  if (p.state !== 'dead') updateWeapons(p, cmd, world, dt);
  if (p.state !== 'dead') updateServicing(p, world, dt);
  if (p.state !== 'dead') updateGear(p, cmd, world, dt);
  if (p.state === 'ground') updateStranded(p, cmd, world, dt);

  p.prevRoll = cmd.roll;
}
