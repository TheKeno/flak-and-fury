// The plain-numbers sheet of a plane: what its flight model and guns give, measured by flying the real
// sim (src/sim/plane.js) with a held command, so a later change to the flight model shows up here at
// once. The duel tool (src/balance/duel.js) names one of these numbers as the reason a duel's winner is
// expected to win. Pure (no DOM, no Node APIs).
import { buildWorld } from './runner.js';
import { addPlane, TICK_RATE } from '../sim/world.js';
import { stepPlane, stiffness } from '../sim/plane.js';

const DT = 1 / TICK_RATE;
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

// Steady level speed at full throttle.
function topSpeed(content, id) {
  const { p, step } = testFlight(content, id);
  launch(p, { x: 2000, y: 800, angle: 0, speed: content.planeDefs[id].maxSpeed * 0.8 });
  for (let i = 0; i < 40 * TICK_RATE; i++) {
    p.y = 800; // held level: the sheet number is the speed, not the plane's altitude habits
    p.angle = 0;
    step(NO_FIRE);
  }
  return p.speed;
}

// Full pull at full throttle from a start speed, until a whole circle is done (or the plane stalls out).
function turn(content, id, startSpeed) {
  const { p, step } = testFlight(content, id);
  launch(p, { x: 2000, y: 800, angle: 0, speed: startSpeed });
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
  return { time: t / TICK_RATE, done: turned >= Math.PI * 2, endSpeed: p.speed, minSpeed, lostHeight: 800 - p.y };
}

// Best steady climb at full throttle: the angle where speed times sine of the angle is highest, with the
// speed that angle settles at (never below 1.15 x stall).
function climb(content, id) {
  const d = content.planeDefs[id];
  let best = { rate: 0 };
  for (let deg = 5; deg <= 60; deg += 1) {
    const a = (deg * Math.PI) / 180;
    // thrust = drag x v^2 + gravity x sin(angle), with the sim's constants
    const { p, step } = testFlight(content, id);
    launch(p, { x: 2000, y: 800, angle: a, speed: d.maxSpeed * 0.7 });
    for (let i = 0; i < 25 * TICK_RATE; i++) {
      p.angle = a;
      step(NO_FIRE);
    }
    if (p.speed < d.stallSpeed * 1.15) continue;
    const rate = p.speed * Math.sin(a);
    if (rate > best.rate) best = { rate, angle: deg, speed: p.speed };
  }
  return best;
}

// A straight 60 degree dive from top speed until 300 units are lost, then a 60 degree zoom until the
// speed is down to 1.3 x stall: speed after the dive and the height the zoom gives back.
function diveZoom(content, id, top) {
  const d = content.planeDefs[id];
  const { p, step } = testFlight(content, id);
  const down = (-60 * Math.PI) / 180;
  launch(p, { x: 2000, y: 1500, angle: 0, speed: top });
  const y0 = p.y;
  for (let i = 0; i < 60 * TICK_RATE && y0 - p.y < 300; i++) {
    p.angle = down;
    step(NO_FIRE);
  }
  const diveSpeed = p.speed;
  const y1 = p.y;
  for (let i = 0; i < 60 * TICK_RATE && p.speed > d.stallSpeed * 1.3; i++) {
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
    dps += (w.damage * w.rpm) / 60;
    seconds = Math.min(seconds, (g.ammo ?? w.ammo) / (w.rpm / 60));
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
};

