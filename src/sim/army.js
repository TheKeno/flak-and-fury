// The ground war: each side's tank depot sends out waves of tanks with infantry behind them, marching
// slowly towards the enemy's airfield. They stop to fight any enemy they meet and shell what they
// find: defences, buildings, the depot, the radar station, at last the hangar. Planes are the answer:
// bombs (a near miss will do) and, a little, guns from a steep dive onto the thin roof.
// A knocked-out tank blocks the way for a while. A river can only be crossed while its bridge stands;
// when it's down, each side sends engineers with its next wave to rebuild it.
// Damaging a depot slows and shrinks its waves; destroyed, it sends no more.
import { GRAVITY } from './plane.js';
import { makeGroundObject, surfaceAt, groundBox, blastGround, hurtSquad, damageGround, settleHull, mountPoint } from './ground.js';
import { angleDiff } from './math.js';
import { damagePlane } from './weapons.js';

export const DEFAULT_WAVES = { first: 15, interval: 75, tanks: 2, squads: 1, squadSize: 4, engineers: 3 };

const TANK_GUN = [12, 8]; // muzzle ahead of and above the tank's centre at the ground (along the hull)
const SHELL_DROP = 0.25;
const SHELL_LIFE = 2;
const CLEAR_WRECK = 90; // seconds before a tank wreck is cleared away
const CLEAR_SQUAD = 30; // and a squad that was wiped out

// Half the length of a ground object along the ground.
const halfLength = (o) => (o.soldiers ? Math.abs(o.soldiers[0].dx) + o.def.width / 2 : (o.width ?? o.def.width) / 2);

const bridgeOver = (world, river) =>
  world.ground.find((o) => o.type === 'bridge' && Math.abs(o.x - (river.x + river.width / 2)) < 1);

export function createArmy(world) {
  world.army = {};
  world.tankShells = [];
  const fields = world.map.airfields;
  for (const af of fields) {
    const enemy = fields.find((a) => a.team !== af.team);
    const dir = enemy && enemy.x > af.x ? 1 : -1;
    world.army[af.team] = { timer: world.waves.first, dir };
  }
}

function spawnWave(world, team, side, depot) {
  const cfg = world.waves;
  const health = depot.hp / depot.maxHp;
  const units = [];
  for (let i = 0; i < Math.max(1, Math.round(cfg.tanks * health)); i++) units.push(['tank']);
  for (let i = 0; i < Math.round(cfg.squads * health); i++) units.push(['infantry', cfg.squadSize]);
  const bridgeDown = world.ground.some((o) => o.type === 'bridge' && !o.alive);
  const engineersOut = world.ground.some((o) => o.type === 'engineers' && o.team === team && o.alive);
  if (bridgeDown && !engineersOut && cfg.engineers > 0) units.push(['engineers', cfg.engineers]);
  // The column forms up at the depot, leaders in front.
  let x = depot.x;
  for (const [type, squad] of units) {
    const u = makeGroundObject(world, type, team, x, { squad, mobile: true });
    u.dir = side.dir;
    u.moving = false;
    x -= side.dir * (halfLength(u) * 2 + u.def.gap + 4);
    u.x = Math.min(world.map.width - 5, Math.max(5, u.x));
    world.ground.push(u);
  }
  world.events.push({ type: 'waveOut', team, x: depot.x, units: units.length });
}

// What stops a unit moving on: null if nothing.
function holdUp(world, u) {
  const dir = u.dir;
  const engineers = u.type === 'engineers';
  for (const o of world.ground) {
    if (o === u) continue;
    const ahead = (o.x - u.x) * dir;
    if (ahead <= 0) continue;
    const clear = ahead - halfLength(u) - halfLength(o);
    // Engineers slip through their own column, and nobody queues behind them.
    if (o.mobile && o.alive && o.team === u.team && !engineers && o.type !== 'engineers' && clear < u.def.gap) return 'queue';
    if (o.type === 'tank' && !o.alive && world.tick - o.wreckedAt < o.def.wreckBlock * 60 && clear < 1) return 'wreck';
    if (o.alive && o.team != null && o.team !== u.team && clear < u.def.engageRange) return 'fight';
  }
  for (const river of world.map.rivers ?? []) {
    const bank = dir > 0 ? river.x : river.x + river.width;
    const ahead = (bank - u.x) * dir;
    if (ahead > 0 && ahead < halfLength(u) + 2 && !bridgeOver(world, river)?.alive) return 'river';
  }
  const edge = dir > 0 ? world.map.width - 8 : 8;
  if ((edge - u.x) * dir < halfLength(u)) return 'edge';
  return null;
}

// Nearest enemy ground target for a tank's main gun: other tanks first, then defences, then the rest.
function gunTarget(world, u) {
  const rank = (o) => (o.type === 'tank' ? 0 : o.type === 'flak' || o.type === 'mgNest' || o.soldiers ? 1 : 2);
  let best = null;
  let bestKey = Infinity;
  for (const o of world.ground) {
    if (!o.alive || o.team == null || o.team === u.team) continue;
    const d = Math.abs(o.x - u.x);
    if (d > u.def.gunRange || (o.x - u.x) * u.dir < -10) continue;
    const key = rank(o) * 10000 + d;
    if (key < bestKey) {
      best = o;
      bestKey = key;
    }
  }
  return best;
}

function fireGun(world, u, target) {
  const def = u.def;
  const [x, y] = mountPoint(world, u, TANK_GUN[0], TANK_GUN[1]);
  // Aim at the middle of the target, or at the nearest man of a squad.
  const [, b, , t] = groundBox(world, target);
  const man = target.soldiers?.filter((s) => s.hp > 0).sort((m, n) => Math.abs(target.x + m.dx - x) - Math.abs(target.x + n.dx - x))[0];
  const tx = man ? target.x + man.dx : target.x;
  const ty = man ? b + 3 : b + (t - b) * 0.5;
  // A low, flat shot; aim high by the drop over the flight time.
  const flight = Math.hypot(tx - x, ty - y) / def.gunVelocity;
  const angle = Math.atan2(ty - y + 0.5 * GRAVITY * SHELL_DROP * flight * flight, tx - x);
  // The gun only elevates and depresses so far from the hull, so a tank on a slope can't hit everything.
  const elevation = u.dir > 0 ? angleDiff(angle, u.tilt ?? 0) : angleDiff(Math.PI + (u.tilt ?? 0), angle);
  if (elevation < -(def.gunDepression ?? 0.2) || elevation > (def.gunElevation ?? 0.5)) return false;
  const a = angle + world.rng.range(-0.02, 0.02);
  u.gunAim = angle - (u.tilt ?? 0); // relative to the hull, so the gun rides with it between shots
  world.tankShells.push({ id: world.nextId++, owner: u.id, team: u.team, def, x, y, vx: Math.cos(a) * def.gunVelocity, vy: Math.sin(a) * def.gunVelocity, life: SHELL_LIFE });
  world.events.push({ type: 'tankFire', id: u.id, x, y, angle: a });
  return true;
}

function burstShell(world, s) {
  const def = s.def;
  world.events.push({ type: 'tankShellBurst', x: s.x, y: s.y });
  blastGround(world, s.x, s.y, { blastRadius: def.shellRadius, blastDamage: def.shellDamage }, s.owner, s.team, { spareNeutral: true });
  for (const p of world.planes) {
    if (p.state === 'dead' || p.team === s.team) continue;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < def.shellRadius) damagePlane(world, p, def.shellDamage * (1 - d / def.shellRadius), s.owner, p.x, p.y, 'tank');
  }
  if (s.y - world.terrain.heightAt(s.x) < 3) world.terrain.crater(s.x, 4, 1.5);
}

function stepTankShells(world, dt) {
  const list = world.tankShells;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    s.vy -= GRAVITY * SHELL_DROP * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    const struck = world.ground.some((o) => {
      if (!o.alive || o.team == null || o.team === s.team) return false;
      const [l, b, r, t] = groundBox(world, o);
      return s.x >= l && s.x <= r && s.y >= b && s.y <= t;
    });
    const ground = surfaceAt(world, s.x);
    if (struck || s.y <= ground || s.life <= 0 || s.x < 0 || s.x > world.map.width) {
      s.y = Math.max(s.y, ground);
      burstShell(world, s);
      list.splice(i, 1);
    }
  }
}

// Engineers at the bank of a river whose bridge is down rebuild it; then they head home.
function stepEngineers(world, u, dt) {
  if (u.returning) return;
  if (!world.ground.some((o) => o.type === 'bridge' && !o.alive)) {
    // Nothing left to rebuild (the other side's engineers got there first): go home.
    u.returning = true;
    u.working = false;
    u.dir = -u.dir;
    return;
  }
  for (const river of world.map.rivers ?? []) {
    const bank = u.dir > 0 ? river.x : river.x + river.width;
    if (Math.abs(bank - u.x) > halfLength(u) + 3) continue;
    const bridge = bridgeOver(world, river);
    if (!bridge || bridge.alive) continue;
    const working = u.soldiers.filter((s) => s.hp > 0).length / u.soldiers.length;
    bridge.hp += (bridge.maxHp / bridge.def.rebuildTime) * working * dt;
    u.working = true;
    if (bridge.hp >= bridge.maxHp) {
      bridge.hp = bridge.maxHp;
      bridge.alive = true;
      world.events.push({ type: 'bridgeRebuilt', id: bridge.id, team: u.team, x: bridge.x, y: river.bank });
      u.working = false;
      u.returning = true;
      u.dir = -u.dir;
    }
    return;
  }
  u.working = false;
}

// A bridge that falls takes whatever is on it down into the river.
function dropOffBridges(world) {
  for (const river of world.map.rivers ?? []) {
    if (bridgeOver(world, river)?.alive) continue;
    for (const u of world.ground) {
      if (!u.mobile || !u.alive || u.x <= river.x + 2 || u.x >= river.x + river.width - 2) continue;
      if (u.soldiers) hurtSquad(world, u, Infinity, null);
      else damageGround(world, u, Infinity, null);
    }
  }
}

export function stepArmy(world, dt) {
  if (!world.army) return;
  for (const [teamKey, side] of Object.entries(world.army)) {
    const team = Number(teamKey);
    const depot = world.ground.find((o) => o.type === 'depot' && o.team === team);
    if (!depot?.alive) continue;
    side.timer -= dt;
    if (side.timer <= 0) {
      spawnWave(world, team, side, depot);
      side.timer = world.waves.interval * (1 + 1.5 * (1 - depot.hp / depot.maxHp));
    }
  }

  dropOffBridges(world);
  for (let i = world.ground.length - 1; i >= 0; i--) {
    const u = world.ground[i];
    if (!u.mobile) continue;
    if (!u.alive) {
      // Old wrecks and fallen squads are cleared away, so a long match doesn't fill up.
      if (world.tick - u.wreckedAt > (u.soldiers ? CLEAR_SQUAD : CLEAR_WRECK) * 60) world.ground.splice(i, 1);
      continue;
    }
    if (u.type === 'engineers') stepEngineers(world, u, dt);
    // Engineers back at their depot are done.
    if (u.returning) {
      const depot = world.ground.find((o) => o.type === 'depot' && o.team === u.team);
      if (!depot || (depot.x - u.x) * u.dir <= 0) {
        world.ground.splice(i, 1);
        continue;
      }
    }
    const why = u.working ? 'working' : u.returning ? null : holdUp(world, u);
    u.moving = !why;
    if (u.moving) {
      // Slower uphill, a little quicker downhill.
      const slope = world.terrain.slopeAngle(u.x) * u.dir;
      u.x += u.dir * u.def.speed * Math.min(1.3, Math.max(0.3, 1 - slope * 2)) * dt;
    }
    if (u.type === 'tank') {
      settleHull(world, u, dt);
      u.gunCooldown = Math.max(0, (u.gunCooldown ?? world.rng.range(0, u.def.gunInterval)) - dt);
      const target = u.gunCooldown <= 0 ? gunTarget(world, u) : null;
      // Out of the gun's reach from this slope: try again shortly, as the tank moves on.
      if (target) u.gunCooldown = fireGun(world, u, target) ? u.def.gunInterval * world.rng.range(0.85, 1.15) : 0.5;
    }
  }
  stepTankShells(world, dt);
}
