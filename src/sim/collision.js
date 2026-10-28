// Mid-air collisions, graded by how hard the planes meet.
//
//   fatal: head-on (noses pointing at each other) or any very fast impact. Both planes go down.
//   hard:  steep crossing or fast overtake. Heavy damage, a long tumble, maybe fire.
//   graze: planes just touch. Light damage, a short shake out of control, shoved apart.
//
// A hard hit or graze isn't shared equally. Each plane's share of the damage depends on how much of
// the closing speed it brought (driving into someone costs you more), whether it was turning away at
// the moment of contact (evasion softens your share), and its airframe toughness.
// Where the planes touch matters too: a propeller chewing into a tail (the Soviet "taran") wrecks
// the victim's tail and bends the rammer's prop; a clipped wing makes the plane pull to one side.
import { clamp } from './math.js';
import { damagePlane, shootDown } from './weapons.js';

export const DEFAULT_COLLISIONS = {
  headOnSpeed: 110, // closing speed at which noses meeting is always fatal
  fatalSpeed: 180, // closing speed that is fatal from any angle
  hardSpeed: 80, // closing speed separating a graze from a hard hit
  grazeDamage: 8,
  hardDamage: 35,
  grazeTumble: 1,
  hardTumble: 1.8,
  driveWeight: 0.6, // 0 = always shared equally, 1 = all on whoever drove into the other
  evadeBonus: 0.33, // share removed for a plane turning away at contact
  hardFireChance: 0.35,
  propStrikes: true,
  tailDamage: 0.6, // tail damage from a propeller strike (1 = no tail authority left)
  wingPull: 0.6, // rad/s of drift from a fully damaged wing
  pushApart: 1,
  grace: 1, // seconds before the same two planes can collide again
};

const NOSE = 0.6; // cos of the angle within which the other plane counts as "in front"

const heading = (p) => [Math.cos(p.angle), Math.sin(p.angle)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

// Is the pilot's current turn swinging the nose away from direction n?
function turningAway(p, n) {
  if (!p.turnDir) return false;
  const [hx, hy] = heading(p);
  return p.turnDir * (-hy * n[0] + hx * n[1]) < 0;
}

// Where on plane p did it touch the other plane, which lies in direction n?
function contactZone(p, n) {
  const f = dot(heading(p), n);
  return f > NOSE ? 'nose' : f < -NOSE ? 'tail' : 'wing';
}

function knock(world, p, n, push, speedLoss) {
  p.x -= n[0] * push;
  p.y -= n[1] * push;
  // Nose shoved away from the other plane, and some speed lost.
  const side = Math.sign(cross(heading(p), n)) || 1;
  p.angle -= side * 0.12;
  p.speed *= 1 - speedLoss;
}

function startTumble(world, p, seconds, strength) {
  p.tumble = Math.max(p.tumble, seconds);
  p.tumbleMax = Math.max(p.tumble, 0.01);
  p.tumbleSpin = world.rng.sign() * strength * world.rng.range(0.8, 1.2);
}

function resolve(world, a, b, cfg, dist) {
  const n = [(b.x - a.x) / dist, (b.y - a.y) / dist]; // from a towards b
  const nb = [-n[0], -n[1]];
  const approachA = a.vx * n[0] + a.vy * n[1];
  const approachB = b.vx * nb[0] + b.vy * nb[1];
  const closing = Math.max(5, approachA + approachB);
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;

  const zoneA = contactZone(a, n);
  const zoneB = contactZone(b, nb);
  const headOn = zoneA === 'nose' && zoneB === 'nose';

  if (closing >= cfg.fatalSpeed || (headOn && closing >= cfg.headOnSpeed)) {
    world.events.push({ type: 'collision', severity: 'fatal', a: a.id, b: b.id, x, y, closing });
    if (!a.dying) shootDown(world, a, b.id, 'collision');
    if (!b.dying) shootDown(world, b, a.id, 'collision');
    return;
  }

  const evadeA = turningAway(a, n);
  const evadeB = turningAway(b, nb);
  let severity = closing >= cfg.hardSpeed ? 'hard' : 'graze';
  if (severity === 'hard' && evadeA && evadeB) severity = 'graze'; // both pulled away at the last moment

  // Who brought the impact: share 0.5 each, shifted towards the plane that did the closing.
  const drive = (Math.max(0, approachA) + 1) / (Math.max(0, approachA) + Math.max(0, approachB) + 2);
  let shareA = 0.5 + cfg.driveWeight * (drive - 0.5);
  let shareB = 1 - shareA;
  if (evadeA) shareA *= 1 - cfg.evadeBonus;
  if (evadeB) shareB *= 1 - cfg.evadeBonus;

  const base = severity === 'hard' ? cfg.hardDamage * (closing / 115) : cfg.grazeDamage * (0.5 + closing / 80);
  const tumble = severity === 'hard' ? cfg.hardTumble : cfg.grazeTumble;
  const spin = severity === 'hard' ? 3.2 : 1.4;

  // Propeller into a tail: the taran.
  const taranA = cfg.propStrikes && zoneA === 'nose' && zoneB === 'tail';
  const taranB = cfg.propStrikes && zoneB === 'nose' && zoneA === 'tail';

  world.events.push({ type: 'collision', severity, a: a.id, b: b.id, x, y, closing, taran: taranA || taranB });

  const apply = (p, other, share, zone, dirToOther, rammer, rammed) => {
    const toughness = p.def.toughness ?? 1;
    const dmg = (base * 2 * share) / toughness;
    startTumble(world, p, tumble * (0.5 + share), spin * (0.6 + share));
    knock(world, p, dirToOther, cfg.pushApart * (2 + share * 4), (severity === 'hard' ? 0.15 : 0.05) * share * 2);
    if (rammer) {
      p.engineDamage = clamp(p.engineDamage + 0.35, 0, 1); // bent propeller
      p.propBent = true;
    }
    if (rammed) p.tailDamage = clamp(p.tailDamage + cfg.tailDamage, 0, 1);
    else if (zone === 'tail') p.tailDamage = clamp(p.tailDamage + cfg.tailDamage * 0.4 * share * 2, 0, 1);
    if (zone === 'wing') {
      // A damaged wing drags the plane round towards the side that was hit.
      const side = Math.sign(cross(heading(p), dirToOther)) || 1;
      const bend = severity === 'hard' ? 0.5 : 0.2;
      p.wingPull = clamp(p.wingPull + side * cfg.wingPull * bend * share * 2, -cfg.wingPull * 2, cfg.wingPull * 2);
    }
    if (severity === 'hard' && !p.burning && world.rng.next() < cfg.hardFireChance * share * 2) {
      p.burning = true;
      world.events.push({ type: 'fire', plane: p.id });
    }
    if (!p.dying) damagePlane(world, p, dmg, other.id, x, y, 'collision');
  };
  apply(a, b, shareA, zoneA, n, taranA, taranB);
  apply(b, a, shareB, zoneB, nb, taranB, taranA);
}

export function collide(world) {
  if (!world.rules.ramming) return;
  const cfg = world.collisions;
  const air = world.planes.filter((p) => p.state === 'air');
  for (let i = 0; i < air.length; i++) {
    for (let j = i + 1; j < air.length; j++) {
      const a = air[i];
      const b = air[j];
      if (a.state !== 'air' || b.state !== 'air' || (a.dying && b.dying)) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > (a.def.hitRadius + b.def.hitRadius) * 0.8 || dist < 0.001) continue;
      const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      if ((world.collisionGrace.get(key) ?? -1) > world.tick) continue;
      world.collisionGrace.set(key, world.tick + Math.round(cfg.grace * 60));
      resolve(world, a, b, cfg, dist);
    }
  }
}
