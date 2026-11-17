// Dramatic crashes: glancing blows that tear parts off, and the many ways a plane goes in.
//
// A plane that only glances off something (a shallow scrape along the ground, a wing through a tree's
// crown, the wheels across a roof, two planes brushing) is not killed outright: it loses a part and flies
// on, damaged and lopsided, and the pilot may still nurse it home. Flying straight into things stays fatal.
//
// Parts that can come off (all plain fields on the plane, repaired by the ground crew):
//   wingTip  -1/0/1  outer wing torn away on that side: the plane pulls that way, banks (drawn), needs
//                    more speed to stay up and turns worse.
//   tailTorn bool    tail surfaces shredded: soft, porpoising pitch (tailDamage).
//   gearTorn bool    wheels ripped off: the only way down is on the belly.
//   propBent bool    propeller bent: less power, rough engine.
//   wing             a whole wing: the one fatal part. The plane tumbles down over a few seconds.
//
// A shot-down plane (dying) gets a death style picked from the world's random numbers, so no two
// fall alike: a nose-over spiral, a long burning arc, a flat spin, a tumble, or a near-recovery that fails.
import { angleDiff, clamp, wrapAngle } from './math.js';
import { damagePlane, shootDown } from './weapons.js';
import { damageGround } from './ground.js';

// Defaults; the live values sit in world.collisions (data/settings.json "collisions").
export const DEFAULT_CRASHES = {
  scrapeAngle: 0.3, // rad: a path into the ground shallower than this is a scrape, not a crash
  scrapeMinSpeed: 30, // slower than this, touching the ground is a landing matter, not a scrape
  scrapeDamage: 14, // hit points a scrape costs at its steepest (half at the shallowest)
  scrapeSpeedLoss: 0.18, // share of speed lost in a scrape
  scrapeKick: 18, // units/s the plane is bounced back up
  scrapeParts: 2, // with this many parts already gone, the next scrape is a crash
  clipDepth: 4, // world units: a structure's top caught no deeper than this is a glancing clip
  treeClipDepth: 9, // the same for a tree's crown (softer, deeper)
  clipDamage: 10, // hit points a clip costs
  clipSpeedLoss: 0.15,
  grazePartChance: 0.2, // chance a graze on the wing or tail tears that part (per share of the hit)
  hardPartChance: 0.7, // the same for a hard mid-air hit
  wingOffSpeed: 140, // closing speed from which a hard wing hit can take the whole wing
  wingTipPull: 0.35, // rad/s the nose is dragged towards a torn wingtip
  wingTipStall: 0.15, // stall speed raised by this share with a wingtip gone
  wingTipTurn: 0.15, // turn rate lowered by this share
  wingTipLean: 1, // roll-frame steps the drawn plane hangs towards the torn side
  tailTornDamage: 0.5, // tail authority lost with the tail torn
  tailWobble: 0.12, // rad/s of porpoising from a torn tail at full speed
  propHarm: 0.25, // engine damage from a bent propeller
  deathDive: 35, // relative chances of each death style (shot down)
  deathGlide: 25,
  deathFlatSpin: 15,
  deathNearRecovery: 15,
  deathTumble: 10,
};

const CLIP_PASS = 60; // ticks a clipped object is ignored while the plane passes through its top
const TREES = new Set(['tree', 'pine', 'oak', 'birch', 'poplar', 'appleTree', 'treeBelt']);
export const isTree = (obj) => TREES.has(obj.type);

const cfgOf = (world) => world.collisions;
const val = (world, k) => cfgOf(world)[k] ?? DEFAULT_CRASHES[k];

export const hasPart = (p, part) => {
  if (part === 'wingTip') return !p.wingTip;
  if (part === 'tail') return !p.tailTorn;
  if (part === 'gear') return !p.gearTorn && !p.belly && (p.def.fixedGear || p.gear > 0.5); // folded away, it can't be torn
  if (part === 'prop') return !p.propBent;
  return true;
};

// Tears a part off plane p. side: which way a wing part pulls (+1 counter-clockwise on screen).
// by: who caused it (a plane id, or null). Returns true if the part came off.
export function losePart(world, p, part, side = 1, by = null) {
  if (part !== 'wing' && !hasPart(p, part)) return false;
  const s = side >= 0 ? 1 : -1;
  if (part === 'wingTip') {
    p.wingTip = s;
    const max = (world.collisions.wingPull ?? 0.6) * 2;
    p.wingPull = clamp(p.wingPull + s * val(world, 'wingTipPull'), -max, max);
  } else if (part === 'tail') {
    p.tailTorn = true;
    p.tailDamage = Math.max(p.tailDamage, val(world, 'tailTornDamage'));
  } else if (part === 'gear') {
    p.gearTorn = true;
    p.gear = 0;
    p.gearDown = false;
  } else if (part === 'prop') {
    p.propBent = true;
    p.engineDamage = clamp(p.engineDamage + val(world, 'propHarm'), 0, 1);
  }
  world.events.push({ type: 'partLost', plane: p.id, part, side: s, x: p.x, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle });
  if (part === 'wing' && !p.dying) {
    p.spinDir = s;
    shootDown(world, p, by ?? p.lastHitBy, 'collision');
    p.deathStyle = 'tumble';
  }
  return true;
}

// How many parts the plane has lost (a bent propeller counts, however it was bent).
export const partsLost = (p) => (p.wingTip ? 1 : 0) + (p.tailTorn ? 1 : 0) + (p.gearTorn ? 1 : 0) + (p.propBent ? 1 : 0);

// The first part on the list the plane still has; null if none.
const firstLeft = (p, list) => list.find((part) => hasPart(p, part)) ?? null;

// The plane meets the ground at a shallow angle, too fast or too crooked to land: it scrapes along,
// loses a part and bounces back up. Returns false when it is no scrape (the caller crashes it).
// noseUp: the nose against the slope (< 0 nose down).
export function scrapeGround(world, p, ground, groundHeading, noseUp, upright) {
  if (p.dying || p.state !== 'air' || p.speed < val(world, 'scrapeMinSpeed')) return false;
  if (!upright) return false; // canopy and fin first: no glancing off that
  if (partsLost(p) >= val(world, 'scrapeParts')) return false; // too broken to bounce off again
  // How steeply the path runs into the ground, along the direction of travel.
  const slope = world.terrain.slopeAngle(p.x);
  const nx = -Math.sin(slope);
  const ny = Math.cos(slope);
  const into = -(p.vx * nx + p.vy * ny);
  const along = Math.abs(p.vx * Math.cos(slope) + p.vy * Math.sin(slope));
  const glance = Math.atan2(Math.max(0, into), along);
  const limit = val(world, 'scrapeAngle');
  if (glance >= limit) return false;
  // Which part takes it: the propeller if the nose is down, the tail if it is up, else the wheels,
  // else a wingtip dug in. A part already gone passes the blow to the next.
  const order = noseUp < -0.15 ? ['prop', 'gear', 'wingTip'] : noseUp > 0.25 ? ['tail', 'gear', 'wingTip'] : ['gear', 'wingTip', 'prop', 'tail'];
  if (world.rng.next() < 0.3) order.push(order.shift()); // not always the obvious one
  const part = firstLeft(p, order);
  if (!part) return false; // nothing left to give: it goes in
  const severity = glance / limit;
  world.events.push({ type: 'scrape', plane: p.id, part, x: p.x, y: ground - 3, speed: p.speed, severity });
  losePart(world, p, part, world.rng.sign());
  // Bounced back up, nose just above the slope, slower.
  const facingRight = Math.cos(p.angle) >= 0;
  p.y = ground + 1;
  p.angle = wrapAngle(groundHeading + (facingRight ? 0.08 : -0.08));
  p.speed *= 1 - val(world, 'scrapeSpeedLoss') * (0.6 + 0.4 * severity);
  p.sink = -val(world, 'scrapeKick') * (0.6 + 0.4 * severity);
  p.stalled = false;
  shake(world, p, 0.4 + 0.4 * severity);
  damagePlane(world, p, val(world, 'scrapeDamage') * (0.5 + 0.5 * severity), p.lastHitBy, p.x, p.y, 'ground');
  return true;
}

// A flying plane catches the top of a solid object (top: its height, reach: the plane's margin).
// Only the top few units (deeper for a tree's crown) and not diving steeply into it: the plane tears a
// part off, a tree loses its crown (it falls), a roof takes some damage. Returns false when it is a
// crash. The same object is met once per pass (CLIP_PASS ticks): the plane is still in it a moment after.
export function clipStructure(world, p, obj, top, reach) {
  if (p.dying || p.state !== 'air') return false;
  if (p.lastClip === obj.id && world.tick - p.lastClipTick < CLIP_PASS) return true;
  const tree = isTree(obj);
  const depth = top + reach - p.y;
  if (depth > val(world, tree ? 'treeClipDepth' : 'clipDepth')) return false;
  if (p.vy < -p.speed * 0.5) return false; // diving into it
  p.lastClip = obj.id;
  p.lastClipTick = world.tick;
  const r = world.rng.next();
  const order = tree
    ? r < 0.6 ? ['wingTip', 'tail', 'gear'] : r < 0.85 ? ['tail', 'wingTip'] : ['gear', 'wingTip', 'tail']
    : r < 0.5 ? ['gear', 'tail', 'wingTip'] : ['tail', 'wingTip', 'gear'];
  const part = firstLeft(p, order);
  world.events.push({ type: 'clip', plane: p.id, kind: obj.type, part, x: p.x, y: top, tree });
  if (part) losePart(world, p, part, world.rng.sign());
  damageGround(world, obj, tree ? Infinity : 20, null);
  p.speed *= 1 - val(world, 'clipSpeedLoss');
  shake(world, p, 0.3);
  const harm = val(world, 'clipDamage') * (part ? 1 : 2.5); // nothing left to tear: it all goes on the hull
  damagePlane(world, p, harm, p.lastHitBy, p.x, p.y, 'structure');
  return true;
}

// A short shake out of control (the tumble the mid-air collisions use).
function shake(world, p, seconds) {
  p.tumble = Math.max(p.tumble, seconds);
  p.tumbleMax = Math.max(p.tumble, 0.01);
  p.tumbleSpin = world.rng.sign() * world.rng.range(0.6, 1.2);
}

// Mid-air: a graze or hard hit on the wing or tail may tear it (src/sim/collision.js).
export function collisionParts(world, p, other, zone, severity, share, closing, side, rammed) {
  const chance = (severity === 'hard' ? val(world, 'hardPartChance') : val(world, 'grazePartChance')) * Math.min(1, share * 2);
  if (rammed) losePart(world, p, 'tail', side, other.id);
  else if (zone === 'tail' && world.rng.next() < chance) losePart(world, p, 'tail', side, other.id);
  if (zone !== 'wing') return;
  if (severity === 'hard' && closing >= val(world, 'wingOffSpeed') && world.rng.next() < share) losePart(world, p, 'wing', side, other.id);
  else if (world.rng.next() < chance) losePart(world, p, 'wingTip', side, other.id);
}

// The view of the plane's numbers a torn wingtip changes (src/sim/weapons.js flyingDef).
export const wingTipStall = (world) => 1 + val(world, 'wingTipStall');
export const wingTipTurn = (world) => 1 - val(world, 'wingTipTurn');

// Porpoising from a torn tail: a slow nod, stronger the faster the plane flies (rad/s, deterministic).
export function tailWobble(p, world) {
  if (!p.tailTorn) return 0;
  const t = world.tick / 60;
  return val(world, 'tailWobble') * Math.min(1, p.speed / 200) * (Math.sin(t * 2.1 + p.id) + 0.5 * Math.sin(t * 5.3 + p.id * 2));
}

const STYLES = ['dive', 'glide', 'flatSpin', 'nearRecovery', 'tumble'];
const WEIGHT_KEYS = ['deathDive', 'deathGlide', 'deathFlatSpin', 'deathNearRecovery', 'deathTumble'];

// Picks how a shot-down plane falls (called from shootDown). Fatal collisions tumble more often.
export function pickDeathStyle(world, p, cause) {
  const w = WEIGHT_KEYS.map((k) => Math.max(0, val(world, k)));
  if (cause === 'collision') w[4] += w.reduce((a, b) => a + b, 0) * 0.5;
  const total = w.reduce((a, b) => a + b, 0);
  let r = world.rng.next() * total;
  let style = 'dive';
  for (let i = 0; i < STYLES.length; i++) {
    r -= w[i];
    if (r < 0) {
      style = STYLES[i];
      break;
    }
  }
  p.deathStyle = style;
  p.deathT = 0;
  p.deathAim = world.rng.range(0.45, 0.85); // how steep a glide ends up (rad below level)
}

// How a dying plane turns and sinks this tick: { turn (rad/s), sink (target units/s), drag (share of
// speed lost per second) }. Upright or not, "down" is -PI/2 on screen.
export function dyingFlight(p, world, dt) {
  p.deathT = (p.deathT ?? 0) + dt;
  const toDown = angleDiff(-Math.PI / 2, p.angle);
  const towards = (target, rate) => {
    const d = angleDiff(target, p.angle);
    return Math.sign(d) * Math.min(Math.abs(d), 1) * rate;
  };
  const right = Math.cos(p.angle) >= 0;
  const below = (a) => (right ? -a : Math.PI + a); // a heading a rad below level, the way it flies
  switch (p.deathStyle) {
    case 'glide': // a long burning arc: the nose sags slowly to a shallow dive
      return { turn: towards(below(p.deathAim), 0.35) + p.spinDir * 0.05, sink: 4, drag: 0 };
    case 'flatSpin': // the nose swings round and round while the plane drops almost flat
      return { turn: p.spinDir * (1.6 + Math.min(1.6, p.deathT * 0.6)), sink: Math.min(60, 15 + p.deathT * 12), drag: 0.9 };
    case 'tumble': // end over end, slowing
      return { turn: p.spinDir * Math.min(5, 2.5 + p.deathT * 1.5), sink: Math.min(55, 10 + p.deathT * 15), drag: 0.6 };
    case 'nearRecovery': {
      // Goes over, then the pilot drags the nose back towards level... and it drops again.
      const alt = p.y - world.terrain.heightAt(p.x);
      if (p.deathPhase == null) p.deathPhase = 0;
      if (p.deathPhase === 0 && (p.deathT > 2.5 || alt < 180)) [p.deathPhase, p.deathT] = [1, 0];
      if (p.deathPhase === 1 && p.deathT > 1.6) [p.deathPhase, p.deathT] = [2, 0];
      if (p.deathPhase === 1) return { turn: towards(below(0.1), 1.3), sink: 6, drag: 0.3 };
      if (p.deathPhase === 2) return { turn: towards(-Math.PI / 2, 1.2) + p.spinDir * 0.9, sink: 12, drag: 0 };
      return { turn: Math.sign(toDown) * Math.min(Math.abs(toDown), 1) * 1.4, sink: 0, drag: 0 };
    }
    default: // 'dive': noses over and goes in, spiralling
      return { turn: Math.sign(toDown) * Math.min(Math.abs(toDown), 1) * 1.6 + p.spinDir * 0.6, sink: 0, drag: 0 };
  }
}
