// Bot pilots. A bot produces the same command object a human's keyboard does, from world state only,
// so bots stay deterministic and could later run on the host of an online match.
// This is the simple milestone-2 sparring bot; proper tactics (evade, return to base) come in milestone 5.
import { angleDiff, clamp } from './math.js';
import { isUpright } from './plane.js';

const SKILL = {
  target: { aimTolerance: 0.07, fireRange: 230, chaseRange: 520, cruiseAlt: 260 },
};

export function botCommand(world, p, skillName = 'target') {
  const skill = SKILL[skillName] ?? SKILL.target;
  const cmd = { turn: 0, throttle: p.throttle < 0.92 ? 1 : 0, roll: false, fire: false, bomb: false };
  if (p.state === 'dead') return cmd;

  const facingRight = Math.cos(p.angle) >= 0;
  if (p.state === 'ground') {
    if (p.speed > p.def.takeoffSpeed + 6) cmd.turn = facingRight ? 1 : -1;
    return cmd;
  }

  // Stay the right way up (rolling only every half second gives the sim a clean key press).
  if (!isUpright(p) && world.tick % 30 === 0) cmd.roll = true;

  const groundClearance = p.y - world.terrain.heightAt(p.x + p.vx * 0.8);
  let desired;
  const enemy = nearestEnemy(world, p, skill.chaseRange);
  if (groundClearance < 70) {
    desired = facingRight ? 0.6 : Math.PI - 0.6; // pull up, terrain ahead
  } else if (enemy) {
    // Lead the target by the bullet's flight time.
    const dist = Math.hypot(enemy.x - p.x, enemy.y - p.y);
    const t = dist / (p.guns[0]?.def.velocity ?? 300);
    desired = Math.atan2(enemy.y + enemy.vy * t - p.y, enemy.x + enemy.vx * t - p.x);
    const aimError = Math.abs(angleDiff(desired, p.angle));
    cmd.fire = dist < skill.fireRange && aimError < skill.aimTolerance;
  } else {
    const climb = clamp((skill.cruiseAlt - p.y) / 250, -0.35, 0.45);
    desired = facingRight ? climb : Math.PI - climb;
  }
  // Break away from a head-on pass: swing the nose off the other plane's line.
  const threat = headOnThreat(world, p);
  if (threat) {
    desired = p.angle + (threat.side > 0 ? -1.2 : 1.2);
    cmd.fire = false;
  }
  if (p.stalled) desired = -Math.PI / 2 + (facingRight ? 0.6 : -0.6);

  const diff = angleDiff(desired, p.angle);
  cmd.turn = clamp(diff / 0.15, -1, 1);
  return cmd;
}

const HEAD_ON_LOOKOUT = 150;

function headOnThreat(world, p) {
  const hx = Math.cos(p.angle);
  const hy = Math.sin(p.angle);
  for (const o of world.planes) {
    if (o === p || o.state !== 'air') continue;
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > HEAD_ON_LOOKOUT || d < 1) continue;
    const ahead = (hx * dx + hy * dy) / d; // other plane in front of me
    const facing = -(Math.cos(o.angle) * dx + Math.sin(o.angle) * dy) / d; // and pointing back at me
    if (ahead > 0.8 && facing > 0.6) return { side: Math.sign(hx * dy - hy * dx) || 1 };
  }
  return null;
}

function nearestEnemy(world, p, range) {
  let best = null;
  let bestD = range;
  for (const o of world.planes) {
    if (o.team === p.team || o.state !== 'air' || o.dying) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

// Autopilot while the player is in free look: level flight at a set height above the ground ahead,
// throttle at cruise, turning back at the ends of the map. On the ground it idles where it stands.
// state: { dir } kept by the caller between ticks (the way it's heading: 1 right, -1 left).
export function autopilotCommand(world, p, height, state) {
  const cmd = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false };
  if (p.state === 'dead') return cmd;
  if (p.state === 'ground') {
    cmd.throttle = p.throttle > 0 ? -1 : 0;
    return cmd;
  }
  cmd.throttle = p.throttle < 0.8 ? 1 : p.throttle > 0.9 ? -1 : 0;
  if (!isUpright(p) && world.tick % 30 === 0) cmd.roll = true;

  const margin = 250;
  if (p.x > world.map.width - margin) state.dir = -1;
  else if (p.x < margin) state.dir = 1;
  state.dir ??= Math.cos(p.angle) >= 0 ? 1 : -1;

  // Hold the height over the highest ground in the next few seconds of flight, under the ceiling.
  let ground = world.terrain.heightAt(p.x);
  for (let k = 40; k <= 400; k += 40) ground = Math.max(ground, world.terrain.heightAt(p.x + state.dir * k));
  const want = Math.min(ground + height, world.map.ceiling - 30);
  const climb = clamp((want - p.y) / 150, -0.35, 0.45);
  let desired = state.dir > 0 ? climb : Math.PI - climb;
  if (p.stalled) desired = -Math.PI / 2 + (state.dir > 0 ? 0.6 : -0.6);

  let diff = angleDiff(desired, p.angle);
  // Turning back, go round over the top (a half loop) rather than diving into the ground.
  if (Math.abs(diff) > 2.5) diff = Math.cos(p.angle) >= 0 ? Math.abs(diff) : -Math.abs(diff);
  cmd.turn = clamp(diff / 0.15, -1, 1);
  return cmd;
}
