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
    const t = dist / 440;
    desired = Math.atan2(enemy.y + enemy.vy * t - p.y, enemy.x + enemy.vx * t - p.x);
    const aimError = Math.abs(angleDiff(desired, p.angle));
    cmd.fire = dist < skill.fireRange && aimError < skill.aimTolerance;
  } else {
    const climb = clamp((skill.cruiseAlt - p.y) / 250, -0.35, 0.45);
    desired = facingRight ? climb : Math.PI - climb;
  }
  if (p.stalled) desired = -Math.PI / 2 + (facingRight ? 0.6 : -0.6);

  const diff = angleDiff(desired, p.angle);
  cmd.turn = clamp(diff / 0.15, -1, 1);
  return cmd;
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
