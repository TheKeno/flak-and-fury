// Guns, bombs, damage and explosions.
import { clamp } from './math.js';
import { GRAVITY } from './plane.js';
import { bulletHitsGround, bombStrikesGround, blastGround } from './ground.js';

const MAX_VOLLEYS_PER_SEC = 14; // a battery of guns is simulated as at most this many projectiles per second
const BOMB_INTERVAL = 0.35;
const TRACER_EVERY = 3;
const FIRE_DAMAGE_PER_SEC = 3;

// Recomputes how a battery of guns is merged into projectiles (after its rpm changes).
export function updateGunRates(g) {
  const roundsPerSec = (g.def.rpm / 60) * g.count;
  const volleyRate = Math.min(roundsPerSec, MAX_VOLLEYS_PER_SEC);
  g.roundsPerVolley = roundsPerSec / volleyRate;
  g.interval = 1 / volleyRate;
}

export function armPlane(p, weapons) {
  const arm = p.def.armament ?? { guns: [] };
  p.guns = arm.guns.map(({ weapon, count }) => {
    const w = weapons[weapon];
    const g = { weapon, def: w, count, ammo: w.ammo * count, cooldown: 0, fired: 0 }; // ammo in rounds
    updateGunRates(g);
    return g;
  });
  p.bombs = arm.bombs ? { weapon: arm.bombs.weapon, def: weapons[arm.bombs.weapon], count: arm.bombs.count, cooldown: 0 } : null;
  p.emptyClicked = false;
}

// Local offset on the plane (x forward, y up from the pilot's view) to a world position.
function localToWorld(p, [ox, oy]) {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  const f = p.inverted ? -1 : 1;
  return [p.x + c * ox - s * oy * f, p.y + s * ox + c * oy * f];
}

export function updateWeapons(p, cmd, world, dt) {
  const canFight = p.state === 'air' && !p.dying && !p.blackout;
  for (const g of p.guns) {
    g.cooldown = Math.max(0, g.cooldown - dt);
    if (!cmd.fire || !canFight || g.cooldown > 0) continue;
    if (g.ammo <= 0) {
      if (!p.emptyClicked) world.events.push({ type: 'empty', plane: p.id });
      p.emptyClicked = true;
      continue;
    }
    g.cooldown += g.interval;
    g.fired++;
    const rounds = Math.min(g.ammo, g.roundsPerVolley);
    g.ammo -= rounds;
    const w = g.def;
    const [x, y] = localToWorld(p, p.def.noseOffset);
    const a = p.angle + world.rng.range(-w.spread, w.spread);
    world.bullets.push({
      id: world.nextId++,
      owner: p.id,
      team: p.team,
      x,
      y,
      vx: p.vx + Math.cos(a) * w.velocity,
      vy: p.vy + Math.sin(a) * w.velocity,
      life: w.life,
      drop: w.drop,
      damage: w.damage * rounds,
      tracer: g.fired % TRACER_EVERY === 0, // every third round per gun battery is a tracer
    });
    world.events.push({ type: 'shot', plane: p.id, voice: w.voice, x, y });
  }
  if (!cmd.fire) p.emptyClicked = false;

  const b = p.bombs;
  if (b) {
    b.cooldown = Math.max(0, b.cooldown - dt);
    if (cmd.bomb && canFight && b.count > 0 && b.cooldown === 0) {
      b.count--;
      b.cooldown = BOMB_INTERVAL;
      const [x, y] = localToWorld(p, p.def.bombOffset ?? [0, -4]);
      const bomb = { id: world.nextId++, owner: p.id, team: p.team, def: b.def, x, y, vx: p.vx, vy: p.vy - 6 };
      world.bombsInFlight.push(bomb);
      world.events.push({ type: 'bombRelease', plane: p.id, bomb: bomb.id, x, y });
    }
  }
}

// cause: what did the damage, remembered if it brings the plane down ('guns', 'bomb', 'collision').
export function damagePlane(world, target, amount, byId, x, y, cause = 'guns') {
  if (target.state !== 'air' && target.state !== 'ground') return;
  target.hp -= amount;
  target.lastHitBy = byId;
  // Some hits find the engine; badly shot-up planes may catch fire.
  if (world.rng.next() < 0.25) target.engineDamage = clamp(target.engineDamage + amount / 90, 0, 1);
  if (!target.burning && target.hp < 30 && world.rng.next() < amount / 70) {
    target.burning = true;
    world.events.push({ type: 'fire', plane: target.id });
  }
  if (target.hp <= 0 && !target.dying) shootDown(world, target, byId, cause);
}

export function shootDown(world, p, byId, cause = 'guns') {
  p.dying = true;
  p.downCause = cause;
  if (byId != null) p.lastHitBy = byId;
  p.hp = Math.min(p.hp, 0);
  p.burning = true;
  if (p.state === 'ground') p.state = 'air';
  world.events.push({ type: 'shotDown', plane: p.id, by: byId ?? null, x: p.x, y: p.y });
  const killer = world.planes.find((k) => k.id === byId);
  if (killer && killer.team !== p.team) killer.kills++;
}

export function updateDamage(p, world, dt) {
  if (p.burning && p.state !== 'dead') {
    p.hp -= FIRE_DAMAGE_PER_SEC * dt;
    if (p.hp <= 0 && !p.dying) shootDown(world, p, p.lastHitBy, 'fire');
  }
}

const canHit = (world, team, owner, p) =>
  p.state !== 'dead' && p.id !== owner && (world.rules.friendlyFire || p.team !== team);

// Distance from point (px,py) to the segment (ax,ay)-(bx,by).
function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

export function stepBullets(world, dt) {
  const list = world.bullets;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    const ox = b.x;
    const oy = b.y;
    b.vy -= GRAVITY * b.drop * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let gone = b.life <= 0 || b.x < 0 || b.x > world.map.width;

    if (!gone) {
      for (const p of world.planes) {
        if (!canHit(world, b.team, b.owner, p)) continue;
        if (segDist(ox, oy, b.x, b.y, p.x, p.y) > p.def.hitRadius) continue;
        const dmg = b.damage * world.rng.range(0.5, 1.5); // the random damage of the old classics
        damagePlane(world, p, dmg, b.owner, b.x, b.y, b.cause ?? 'guns');
        world.events.push({ type: 'hit', plane: p.id, by: b.owner, x: b.x, y: b.y, damage: dmg });
        gone = true;
        break;
      }
    }
    if (!gone) gone = bulletHitsGround(world, b, ox, oy);
    if (!gone && b.y <= world.terrain.heightAt(b.x)) {
      world.events.push({ type: 'impact', surface: 'ground', x: b.x, y: world.terrain.heightAt(b.x) });
      gone = true;
    }
    if (gone) list.splice(i, 1);
  }
}

export function explode(world, x, y, def, ownerId, team) {
  world.events.push({ type: 'explosion', x, y, radius: def.blastRadius, owner: ownerId });
  for (const p of world.planes) {
    if (p.state === 'dead') continue;
    if (!world.rules.friendlyFire && p.team === team && p.id !== ownerId) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < def.blastRadius) damagePlane(world, p, def.blastDamage * (1 - d / def.blastRadius), ownerId, p.x, p.y, 'bomb');
  }
  blastGround(world, x, y, def, ownerId, team);
  if (y - world.terrain.heightAt(x) < def.craterRadius) world.terrain.crater(x, def.craterRadius, def.craterDepth);
}

export function stepBombs(world, dt) {
  const list = world.bombsInFlight;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    const k = b.def.drag;
    b.vx -= b.vx * k * dt;
    b.vy -= (GRAVITY + b.vy * k) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // A bomb that strikes a plane destroys it outright.
    const struck = world.planes.find(
      (p) => p.state === 'air' && p.id !== b.owner && Math.hypot(p.x - b.x, p.y - b.y) < p.def.hitRadius,
    );
    if (struck) shootDown(world, struck, b.owner, 'bomb');

    const ground = world.terrain.heightAt(b.x);
    if (struck || b.y <= ground || b.x < 0 || b.x > world.map.width || bombStrikesGround(world, b)) {
      list.splice(i, 1);
      explode(world, b.x, Math.max(b.y, ground), b.def, b.owner, b.team);
      world.events.push({ type: 'bombExplode', bomb: b.id, x: b.x, y: Math.max(b.y, ground) });
    }
  }
}
