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
// down to SYNC_MIN at idle; 0 with the propeller stopped. The gear is driven by the engine, so a
// stopped engine can't fire; but WWII's gears (electric or hydraulic, several impulses a turn) and
// constant-speed propellers cost a cowl gun only a little of its rate, so it never falls far.
const SYNC_FULL = 0.6;
const SYNC_MIN = 0.7;
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
  // Bomb stations: one per loadout entry. Plain data (the hardpoint is looked up by id in p.def).
  p.stations = loadoutOf(p).map(({ hardpoint, weapon, count = 1 }) => ({ hp: hardpoint, def: weapons[weapon], loaded: count }));
  p.bombCooldown = 0;
  p.bombHeld = false;
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

export const hardpointOf = (p, st) => p.def.hardpoints.find((h) => h.id === st.hp);
// Bombs still carried, and carried when fully loaded.
export const bombsLeft = (p) => (p.stations ?? []).reduce((n, s) => n + s.loaded, 0);
export const bombsFull = (p) => loadoutOf(p).reduce((n, l) => n + (l.count ?? 1), 0);
// The station the next release uses: lowest group first (the crutch before the racks), then list order.
export function nextStation(p) {
  let best = null;
  for (const s of p.stations ?? []) if (s.loaded > 0 && (!best || hardpointOf(p, s).group < hardpointOf(p, best).group)) best = s;
  return best;
}
// Reload every station to the plane's loadout.
export function rearmBombs(p) {
  loadoutOf(p).forEach((l, i) => (p.stations[i].loaded = l.count ?? 1));
}

// The bombs a plane is set to carry: the pilot's choice (p.loadout, plain data, set in the hangar) or the
// plane's default. Bots never choose, so theirs is always the default.
export const loadoutOf = (p) => p.loadout ?? p.def.loadout ?? [];

// Checks a loadout list [{hardpoint, weapon, count}] against a plane def and returns it cleaned (only
// fields we know, in hardpoint order), or null if it is not allowed. Rules: every hardpoint exists and
// is used once; the weapon is a bomb with a weight no heavier than the hardpoint's maxKg; the count is a
// whole number from 1 up to what the default loadout puts on that hardpoint (its capacity); the total
// weight stays within maxLoad. An empty list is a clean plane. Input from guests is untrusted, so
// everything is checked, not assumed.
export function validateLoadout(def, list, weapons) {
  if (!def.hardpoints || !Array.isArray(list)) return null;
  const used = new Set();
  const out = [];
  let kg = 0;
  for (const l of list) {
    if (!l || typeof l !== 'object') return null;
    const hp = def.hardpoints.find((h) => h.id === l.hardpoint);
    const w = Object.hasOwn(weapons, l.weapon) ? weapons[l.weapon] : null;
    if (!hp || used.has(hp.id) || w?.type !== 'bomb' || !(w.weight > 0) || w.weight > hp.maxKg) return null;
    const cap = (def.loadout ?? []).find((d) => d.hardpoint === hp.id)?.count ?? 1;
    const count = l.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > cap) return null;
    used.add(hp.id);
    kg += w.weight * count;
    out.push({ hardpoint: hp.id, weapon: l.weapon, count });
  }
  if (def.maxLoad && kg > def.maxLoad) return null;
  const order = (e) => def.hardpoints.findIndex((h) => h.id === e.hardpoint);
  return out.sort((a, b) => order(a) - order(b));
}

// Sets the pilot's chosen loadout, when the plane is still being prepared: waiting behind the hangar
// doors, or down and about to come back. Returns true if taken; an invalid list or a plane already out
// of the doors is refused (the choice is locked once it rolls out). The stations are rebuilt full.
export function setLoadout(p, list, weapons) {
  const ok = validateLoadout(p.def, list, weapons);
  if (!ok || !(p.state === 'dead' || (p.state === 'ground' && p.exitPhase === 'wait'))) return false;
  p.loadout = ok;
  armPlane(p, weapons);
  return true;
}

// Weight: bombs carried as a share of what the plane can lift (0 for a plane without `maxLoad`).
export function loadFraction(p) {
  if (!p.def.maxLoad) return 0;
  const kg = (p.stations ?? []).reduce((n, s) => n + s.loaded * (s.def.weight ?? 0), 0);
  return clamp(kg / p.def.maxLoad, 0, 1);
}
// How much a full load costs (world.weight, data/settings.json): thrust and turn rate fall, stall and
// take-off speed rise, in proportion to the load carried.
export const DEFAULT_WEIGHT = { thrust: 0.06, stall: 0.05, takeoff: 0.04, turn: 0.06 };
// The plane's performance numbers as it is loaded now: its def when empty (so it is exactly as before),
// else a view of the def with the four numbers changed. Never stored, so snapshots don't see it.
export function flyingDef(p, world) {
  const f = loadFraction(p);
  if (f === 0) return p.def;
  const w = world.weight ?? DEFAULT_WEIGHT;
  const d = p.def;
  return Object.assign(Object.create(d), {
    thrust: d.thrust * (1 - w.thrust * f),
    stallSpeed: d.stallSpeed * (1 + w.stall * f),
    takeoffSpeed: d.takeoffSpeed * (1 + w.takeoff * f),
    turnRate: d.turnRate * (1 - w.turn * f),
  });
}

// Every gun on the plane, the pilot's and the gunners', for ammunition checks and rearming.
export const allGuns = (p) => [...p.guns, ...(p.turrets ?? [])];

// Local offset on the plane (x forward, y up from the pilot's view) to a world position, as the
// plane actually sits (tail-down on the ground).
export function localToWorld(p, [ox, oy]) {
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

  p.bombCooldown = Math.max(0, p.bombCooldown - dt);
  const fresh = cmd.bomb && !p.bombHeld; // a new press, not the key held down
  p.bombHeld = Boolean(cmd.bomb);
  const st = nextStation(p);
  if (cmd.bomb && canFight && st && p.bombCooldown === 0) {
    const hp = hardpointOf(p, st);
    // A crutch drops one bomb; a rack all its pair at once; a bay a salvo on a press, then (key held)
    // one by one at its interval.
    const n = Math.min(st.loaded, hp.kind === 'rack' ? st.loaded : hp.kind === 'bay' && fresh ? hp.salvo ?? 1 : 1);
    st.loaded -= n;
    p.bombCooldown = hp.interval ?? BOMB_INTERVAL;
    const [x, y] = localToWorld(p, hp.offset);
    for (let i = 0; i < n; i++) {
      const bomb = { id: world.nextId++, owner: p.id, team: p.team, def: st.def, x, y, vx: p.vx, vy: p.vy - 6 };
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
  if (killer && killer.team !== p.team && !p.wreck) killer.kills++;
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
