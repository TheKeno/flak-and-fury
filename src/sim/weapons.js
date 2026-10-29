// Guns, bombs, damage and explosions.
import { clamp } from './math.js';
import { GRAVITY, attitude } from './plane.js';
import { bulletHitsGround, bombStrikesGround, blastGround } from './ground.js';
import { ignite, fireHit, stepFire } from './fire.js';
import { digCrater } from './runway.js';

const MAX_VOLLEYS_PER_SEC = 14; // a battery of guns is simulated as at most this many projectiles per second
const BOMB_INTERVAL = 0.35;
const TRACER_EVERY = 3;

// Firing rate of synchronized (through-the-propeller) guns, 0..1: full from SYNC_FULL of max RPM,
// down to SYNC_MIN at idle; 0 with the propeller stopped.
const SYNC_FULL = 0.8;
const SYNC_MIN = 0.35;
export function syncRate(p) {
  if (p.rpm < 60) return 0;
  return Math.min(1, Math.max(SYNC_MIN, p.rpm / (p.def.engine.maxRpm * SYNC_FULL)));
}

// Recomputes how a battery of guns is merged into projectiles (after its rpm changes).
export function updateGunRates(g) {
  const roundsPerSec = (g.def.rpm / 60) * g.count;
  const volleyRate = Math.min(roundsPerSec, MAX_VOLLEYS_PER_SEC);
  g.roundsPerVolley = roundsPerSec / volleyRate;
  g.interval = 1 / volleyRate;
}

export function armPlane(p, weapons) {
  const arm = p.def.armament ?? { guns: [] };
  p.guns = arm.guns.map(({ weapon, count, synced = false }) => {
    const w = weapons[weapon];
    const g = { weapon, def: w, count, synced, ammo: w.ammo * count, cooldown: 0, fired: 0 }; // ammo in rounds
    updateGunRates(g);
    return g;
  });
  p.bombs = arm.bombs ? { weapon: arm.bombs.weapon, def: weapons[arm.bombs.weapon], count: arm.bombs.count, cooldown: 0 } : null;
  // Gunners' guns (a rear gunner, a turret): aimed by an AI gunner within an arc, in the plane's own
  // frame in degrees (0 = straight ahead, 90 = up over the canopy, 180 = straight back).
  p.turrets = (arm.turrets ?? []).map(({ weapon, count = 1, offset, arc }) => {
    const w = weapons[weapon];
    const [a0, a1] = arc.map((deg) => (deg * Math.PI) / 180);
    const t = { weapon, def: w, count, offset, arc: [a0, a1], aim: (a0 + a1) / 2, ammo: w.ammo * count, cooldown: 0, fired: 0 };
    updateGunRates(t);
    return t;
  });
  p.emptyClicked = false;
}

// Every gun on the plane, the pilot's and the gunners', for ammunition checks and rearming.
export const allGuns = (p) => [...p.guns, ...(p.turrets ?? [])];

// Local offset on the plane (x forward, y up from the pilot's view) to a world position, as the
// plane actually sits (tail-down on the ground).
function localToWorld(p, [ox, oy]) {
  const { angle, x, y } = attitude(p);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const f = p.inverted ? -1 : 1;
  return [x + c * ox - s * oy * f, y + s * ox + c * oy * f];
}

export function updateWeapons(p, cmd, world, dt) {
  // On the ground too: guns point skywards on a taildragger, and a bomb lands right under you.
  const canFight = (p.state === 'air' || p.state === 'ground') && !p.dying && !p.blackout;
  for (const g of p.guns) {
    g.cooldown = Math.max(0, g.cooldown - dt);
    if (!cmd.fire || !canFight || g.cooldown > 0) continue;
    if (g.ammo <= 0) {
      if (!p.emptyClicked) world.events.push({ type: 'empty', plane: p.id });
      p.emptyClicked = true;
      continue;
    }
    // Guns firing through the propeller are timed to miss the blades: they slow with the engine, and
    // with the propeller stopped they can't fire at all.
    const rate = g.synced ? syncRate(p) : 1;
    if (rate <= 0) continue;
    g.cooldown += g.interval / rate;
    g.fired++;
    const rounds = Math.min(g.ammo, g.roundsPerVolley);
    g.ammo -= rounds;
    const w = g.def;
    const [x, y] = localToWorld(p, p.def.noseOffset);
    const a = attitude(p).angle + world.rng.range(-w.spread, w.spread); // along the fuselage, nose-up on the ground
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
  updateTurrets(p, world, dt, canFight);

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

// AI gunners: each turns its gun towards the nearest enemy plane within its arc and reach, leading it
// by the rounds' flight time, and fires once on target. Gunners are bots too: they hold fire unless
// the rules' bots are on.
const GUNNER_TRAVERSE = 2.5; // rad/s the gun swings
const GUNNER_ON_TARGET = 0.08; // rad off the aim point at which the gunner opens fire
const GUNNER_SPREAD = 2; // times the weapon's own spread: a gunner on a moving plane is less steady
const wrap2pi = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
function updateTurrets(p, world, dt, canFight) {
  if (!p.turrets.length) return;
  const { angle } = attitude(p);
  const f = p.inverted ? -1 : 1;
  for (const t of p.turrets) {
    t.cooldown = Math.max(0, t.cooldown - dt);
    const w = t.def;
    const [x, y] = localToWorld(p, t.offset);
    // The target: the nearest enemy whose lead point lies inside the arc, within 80% of the reach.
    let want = null;
    let best = w.velocity * w.life * 0.8;
    if (canFight && world.rules.bots === 'on' && t.ammo > 0) {
      for (const e of world.planes) {
        if (e.team === p.team || (e.state !== 'air' && e.state !== 'ground')) continue;
        const dist = Math.hypot(e.x - x, e.y - y);
        if (dist >= best) continue;
        const time = dist / w.velocity;
        const local = wrap2pi(f * (Math.atan2(e.y + (e.vy - p.vy) * time - y, e.x + (e.vx - p.vx) * time - x) - angle));
        if (local < t.arc[0] || local > t.arc[1]) continue;
        best = dist;
        want = local;
      }
    }
    const goal = want ?? (t.arc[0] + t.arc[1]) / 2; // no target: back to the middle of the arc
    t.aim += clamp(goal - t.aim, -GUNNER_TRAVERSE * dt, GUNNER_TRAVERSE * dt);
    if (want == null || Math.abs(want - t.aim) > GUNNER_ON_TARGET || t.cooldown > 0) continue;
    t.cooldown += t.interval;
    t.fired++;
    const rounds = Math.min(t.ammo, t.roundsPerVolley);
    t.ammo -= rounds;
    const a = angle + f * t.aim + world.rng.range(-w.spread, w.spread) * GUNNER_SPREAD;
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
      tracer: t.fired % TRACER_EVERY === 0,
    });
    world.events.push({ type: 'shot', plane: p.id, voice: w.voice, x, y, gunner: true });
  }
}

// cause: what did the damage, remembered if it brings the plane down ('guns', 'bomb', 'collision').
export function damagePlane(world, target, amount, byId, x, y, cause = 'guns') {
  if (target.state !== 'air' && target.state !== 'ground') return;
  target.hp -= amount;
  target.lastHitBy = byId;
  fireHit(world, target, amount);
  // Some hits find the engine; badly shot-up planes may catch fire.
  if (world.rng.next() < 0.25) target.engineDamage = clamp(target.engineDamage + amount / 90, 0, 1);
  if (target.hp < 30 && world.rng.next() < amount / 70) ignite(world, target);
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
  stepFire(p, world, dt, shootDown);
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
  if (y - world.terrain.heightAt(x) < def.craterRadius) digCrater(world, x, def.craterRadius, def.craterDepth, ownerId);
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
