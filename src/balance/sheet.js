// The plain-numbers sheet of a plane: what its flight model and guns give, measured by flying the real
// sim (src/sim/plane.js) with a held command, so a later change to the flight model shows up here at
// once. Flown at LOW (the ground war, full power) unless the number says High. The duel tool (src/balance/duel.js) names one of these numbers as the reason a duel's winner is
// expected to win. Pure (no DOM, no Node APIs).
import { buildWorld } from './runner.js';
import { addPlane, TICK_RATE } from '../sim/world.js';
import { stepPlane, stiffness, turnAuthority } from '../sim/plane.js';
import { turnAt } from '../sim/air.js';
import { flyingDef } from '../sim/weapons.js';

const DT = 1 / TICK_RATE;
// Heights the sheet flies at (absolute world y; src/sim/air.js). LOW: the ground war, under every plane's
// rated height, so the base numbers are full power. HIGH: the high band, where only the turbocharged
// planes keep their power (the *High numbers).
export const LOW = 300;
export const HIGH = 1000;
const NO_FIRE = { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false, abandon: false, emergency: false, hangar: null };

// Puts a plane into the air as the sim would have it (gear up, engine running, full throttle).
export function launch(p, { x, y, angle, speed, throttle = 1 }) {
  const left = Math.cos(angle) < 0;
  p.state = 'air';
  p.x = x;
  p.y = y;
  p.angle = angle;
  p.speed = speed;
  p.vx = Math.cos(angle) * speed;
  p.vy = Math.sin(angle) * speed;
  p.sink = 0;
  p.inverted = left; // facing left, upright: the sim's convention (spawnAtAirfield)
  p.rollAngle = left ? Math.PI : 0;
  p.gear = 0;
  p.gearDown = false;
  p.throttle = throttle;
  p.rpm = p.def.engine.cruiseRpm;
  p.fresh = false;
  p.engineRunning = true; // planes wait in the hangar with the engine off
  p.hold = false;
  p.park = null;
  p.groundTurn = null; // left at the hangar head-on frame, it held the guns silent (no duel ever fired)
  p.groundLoop = null;
  p.exitPhase = null;
  p.exitTo = null;
  p.liftBlend = 0;
  p.stalled = false;
}

// A lone plane in an empty sky, to fly with held commands.
function testFlight(content, id) {
  const world = buildWorld(content, { arena: true });
  world.planes.length = 0;
  const p = addPlane(world, { defId: id, team: 0, nation: content.planeDefs[id].nation, controller: 'sheet' });
  world.map.ceiling = 1e6; // nothing in the way
  return { world, p, step: (cmd) => { world.events.length = 0; world.tick++; stepPlane(p, cmd, world, DT); } };
}

// Steady level speed at full throttle, at height y.
function topSpeed(content, id, y = LOW) {
  const { p, step } = testFlight(content, id);
  launch(p, { x: 2000, y, angle: 0, speed: content.planeDefs[id].maxSpeed * 0.8 });
  for (let i = 0; i < 40 * TICK_RATE; i++) {
    p.y = y; // held level: the sheet number is the speed, not the plane's altitude habits
    p.angle = 0;
    step(NO_FIRE);
  }
  return p.speed;
}

// Full pull at full throttle from a start speed, until a whole circle is done (or the plane stalls out).
function turn(content, id, startSpeed, y0 = LOW) {
  const { p, step } = testFlight(content, id);
  launch(p, { x: 2000, y: y0, angle: 0, speed: startSpeed });
  let turned = 0;
  let minSpeed = p.speed;
  let t = 0;
  while (turned < Math.PI * 2 && t < 40 * TICK_RATE) {
    const before = p.angle;
    step({ ...NO_FIRE, turn: 1 });
    let d = p.angle - before;
    if (d < -Math.PI) d += Math.PI * 2;
    turned += d;
    minSpeed = Math.min(minSpeed, p.speed);
    t++;
  }
  return { time: t / TICK_RATE, done: turned >= Math.PI * 2, endSpeed: p.speed, minSpeed, lostHeight: y0 - p.y };
}

// Best steady climb at full throttle: the angle where speed times sine of the angle is highest, with the
// speed that angle settles at (never below 1.15 x stall). Held at height y (thin air above the rated height).
function climb(content, id, y = LOW) {
  const d = content.planeDefs[id];
  let best = { rate: 0 };
  for (let deg = 5; deg <= 60; deg += 1) {
    const a = (deg * Math.PI) / 180;
    // thrust = drag x v^2 + gravity x sin(angle), with the sim's constants
    const { world, p, step } = testFlight(content, id);
    launch(p, { x: 2000, y, angle: a, speed: d.maxSpeed * 0.7 });
    for (let i = 0; i < 25 * TICK_RATE; i++) {
      p.angle = a;
      p.y = y;
      step(NO_FIRE);
    }
    if (p.speed < flyingDef(p, world).stallSpeed * 1.15) continue; // stall rises with height
    const rate = p.speed * Math.sin(a);
    if (rate > best.rate) best = { rate, angle: deg, speed: p.speed };
  }
  return best;
}

// A straight 60 degree dive from top speed until 300 units are lost, then a 60 degree zoom until the
// speed is down to 1.3 x stall: speed after the dive and the height the zoom gives back. From the
// middle band (LOW + 300) down to LOW, the dive a boom-and-zoom plane makes onto the ground war.
function diveZoom(content, id, top) {
  const d = content.planeDefs[id];
  const { world, p, step } = testFlight(content, id);
  const down = (-60 * Math.PI) / 180;
  launch(p, { x: 2000, y: LOW + 300, angle: 0, speed: top });
  const y0 = p.y;
  for (let i = 0; i < 60 * TICK_RATE && y0 - p.y < 300; i++) {
    p.angle = down;
    step(NO_FIRE);
  }
  const diveSpeed = p.speed;
  const y1 = p.y;
  for (let i = 0; i < 60 * TICK_RATE && p.speed > flyingDef(p, world).stallSpeed * 1.3; i++) {
    p.angle = -down;
    step(NO_FIRE);
  }
  return { diveSpeed, zoomed: p.y - y1 };
}

// Damage per second of all the pilot's guns firing (units of hit points).
function firepower(content, id) {
  const { world, p } = testFlight(content, id);
  let dps = 0;
  let seconds = Infinity;
  for (const g of p.guns) {
    const w = world.weapons[g.weapon] ?? g.def ?? null;
    if (!w) continue;
    // A mount fires `count` guns at once, and g.ammo is the rounds of all of them.
    const count = g.count ?? 1;
    if (count <= 0) continue;
    dps += ((w.damage * w.rpm) / 60) * count;
    seconds = Math.min(seconds, (g.ammo ?? w.ammo * count) / ((w.rpm / 60) * count));
  }
  return { dps, burstSeconds: Number.isFinite(seconds) ? seconds : 0 };
}

export function planeSheet(content, id) {
  const d = content.planeDefs[id];
  const top = topSpeed(content, id);
  const fast = turn(content, id, top * 0.8);
  const slow = turn(content, id, d.stallSpeed * 1.4);
  const c = climb(content, id);
  const dz = diveZoom(content, id, top);
  const fp = firepower(content, id);
  const high = { top: topSpeed(content, id, HIGH), climb: climb(content, id, HIGH) };
  // The high band's turns: less grip, less power to turn above the rated height, a higher stall.
  const { world: hw, p: hp } = testFlight(content, id);
  hp.y = HIGH;
  const stallHigh = flyingDef(hp, hw).stallSpeed;
  // Turn rates, not circles: a whole loop that high stalls out most planes (the side view's turns are
  // loops). Degrees per second the controls give at HIGH (thin-air grip, the power the turn needs, the
  // slow-turn bonus under its risen slowTurnSpeed), at 80% of its top speed there and at 1.4 x its stall.
  const hd = flyingDef(hp, hw);
  const rateAt = (v) => (hd.turnRate * turnAt(hw, hd, HIGH) * turnAuthority(hd, v) * 180) / Math.PI;
  high.fast = rateAt(high.top * 0.8);
  high.slow = rateAt(stallHigh * 1.4);
  const round = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;
  return {
    id,
    name: d.name,
    role: d.airRole ?? null,
    topSpeed: round(top, 0), // units/s, level, full throttle
    stallSpeed: d.stallSpeed,
    turnTime: round(fast.time), // seconds for a full circle, full pull and throttle, from 80% of top speed
    turnSpeedLeft: round(fast.endSpeed, 0), // speed at the end of that circle (turn bleed)
    slowTurnTime: round(slow.time), // the same from 1.4 x stall (the slow fight)
    slowTurnSpeedLeft: round(slow.endSpeed, 0),
    climbRate: round(c.rate, 0), // units/s, best steady climb
    climbAngle: c.angle ?? null,
    ratedHeight: d.ratedHeight ?? null, // full engine power up to here (src/sim/air.js)
    topSpeedHigh: round(high.top, 0), // top speed and climb at HIGH: the high band, thin air
    climbRateHigh: round(high.climb.rate ?? 0, 0),
    stallSpeedHigh: round(stallHigh, 0), // stall speed rises with height
    turnRateHigh: round(high.fast, 0), // deg/s the controls give at HIGH at 80% of its top speed there
    slowTurnRateHigh: round(high.slow, 0), // the same at 1.4 x its stall there (the slow fight up high)
    diveSpeed: round(dz.diveSpeed, 0), // speed after a 60 degree dive losing 300 units from top speed
    zoomHeight: round(dz.zoomed, 0), // height that speed buys back in a 60 degree zoom
    zoomShare: round(dz.zoomed / 300, 2),
    diveTurn: round(d.turnRate * stiffness(d, dz.diveSpeed), 2), // rad/s it can still turn at that dive speed (stiff controls)
    hp: d.hp,
    toughness: d.toughness ?? 1, // collisions only: bullets just take hp
    firepower: round(fp.dps, 1), // hit points of damage per second, all guns
    burstSeconds: round(fp.burstSeconds, 0), // seconds of fire the ammunition lasts
  };
}

// Which sheet numbers help a plane win, and which way: 'high' = bigger is better.
export const BETTER = {
  topSpeed: 'high', turnTime: 'low', slowTurnTime: 'low', climbRate: 'high', diveSpeed: 'high',
  zoomHeight: 'high', diveTurn: 'high', hp: 'high', firepower: 'high', turnSpeedLeft: 'high',
  topSpeedHigh: 'high', climbRateHigh: 'high', turnRateHigh: 'high', slowTurnRateHigh: 'high',
};

