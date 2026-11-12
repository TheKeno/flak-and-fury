// The Balance Lab's match runner: one headless bot-vs-bot match with each side locked to one plane type,
// recording the front and per-side stats. Pure (no DOM, no Node APIs), so the CLI (tools/balance.mjs)
// and the Lab's Web Workers (src/balance/worker.js) run the very same code and get the same numbers.
// The sim is not changed for it: everything is read from world.events and the world each tick.
import { importLdtk } from '../content/ldtk.js';
import { createWorld, setBots, stepWorld, TICK_RATE } from '../sim/world.js';
import { applyOverrides } from './levers.js';

// Kills scored with the killer this much higher than the victim count as "from above" (world units).
const ABOVE = 25;
// A side has reached the enemy's depot or hangar when its most forward unit is this close to it.
const REACH = 140;
// The units that make the front: tanks and infantry squads (trucks only carry them).
const FRONT_KINDS = new Set(['tank', 'infantry']);

// content: { planeDefs, weapons, groundDefs, settings, maps: { name: ldtk project }, tactics } as loaded
// from the data files (notes removed). Kept untouched: each match takes its own copies of what the sim
// edits. tactics: bot tactics to fly by instead of content.tactics (a table, or one per team).
export function buildWorld(content, { map = 'countryside', seed = 1, tactics = content.tactics ?? null, arena = false } = {}) {
  const s = content.settings;
  const project = content.maps[map];
  if (!project) throw new Error(`Unknown map "${map}"`);
  const world = createWorld({
    hangarStart: true, // like the game: planes come out of the hangar one by one
    seed: seed >>> 0,
    map: importLdtk(project),
    planeDefs: content.planeDefs,
    weapons: content.weapons,
    groundDefs: content.groundDefs,
    servicing: { ...s.servicing },
    collisions: { ...s.collisions },
    fire: { ...s.fire },
    emergency: { ...s.emergency },
    flight: { ...s.flight },
    damage: { ...s.damage },
    waves: { ...s.waves },
    pads: s.pads,
    zones: s.zones,
    landing: { ...s.landing },
    takeoff: { ...s.takeoff },
    weight: { ...s.weight },
    decor: s.decor,
    bots: structuredClone(s.bots),
    radar: { ...s.radar },
    bailout: { ...s.bailout },
    tactics,
    rules: { ...s.rules, bots: 'on' },
  });
  if (arena) clearForArena(world);
  return world;
}

// The bot trainer's air-only arena: the same map and airfields, but no ground war (no tank waves, no
// troops) and no flak or MG nests, so only the planes decide a fight and a match runs much faster.
const ARMED_GROUND = new Set(['flak', 'mgNest']);
export function clearForArena(world) {
  world.army = null;
  world.ground = world.ground.filter((o) => !o.mobile && !ARMED_GROUND.has(o.type));
}

const emptyStats = () => ({
  airKills: 0, deaths: 0, tankKills: 0, truckKills: 0, soldierKills: 0, otherGroundKills: 0,
  shots: 0, hits: 0, damageTaken: 0, aliveTime: 0, airTime: 0, serviceTime: 0,
  killsAbove: 0, killsLevel: 0, killsBelow: 0,
  deathBy: { fighter: 0, flak: 0, tankMg: 0, groundFire: 0, crash: 0, collision: 0, other: 0 },
  bombsDropped: 0, bombKills: 0, strafeKills: 0,
});

// The front: halfway between each side's most forward tank or infantry squad; a side with none out is
// at its own depot. Returned as how far team 0 has pushed it from the middle (positive: towards team 1).
function frontOf(world, home) {
  const fwd = [null, null];
  for (const o of world.ground) {
    if (!o.mobile || !o.alive || o.returning || !FRONT_KINDS.has(o.type) || (o.team !== 0 && o.team !== 1)) continue;
    const dir = Math.sign(home[1 - o.team] - home[o.team]) || 1;
    if (fwd[o.team] == null || o.x * dir > fwd[o.team] * dir) fwd[o.team] = o.x;
  }
  const a = fwd[0] ?? home[0];
  const b = fwd[1] ?? home[1];
  return { x: (a + b) / 2, fwd: [a, b] };
}

// Runs one match. a, b: plane ids for team 0 and team 1. Returns plain data (JSON-safe).
// onProgress(share 0..1) is called about once per game-second.
// arena: the air-only arena (no ground war); tactics: bot tactics instead of content.tactics.
// overrides: tuned plane numbers ({ planeId: { lever: multiplier } }, src/balance/levers.js), the auto-tuner's trials.
export function runMatch(content, { a, b, seed = 1, minutes = 20, perSide = 4, skill = 'normal', map = 'countryside', sample = 10, arena = false, tactics, overrides, onProgress } = {}) {
  if (overrides) content = { ...content, planeDefs: applyOverrides(content.planeDefs, overrides) };
  const world = buildWorld(content, { map, seed, arena, ...(tactics !== undefined && { tactics }) });
  for (const [team, defId] of [[0, a], [1, b]]) {
    const def = content.planeDefs[defId];
    if (!def) throw new Error(`Unknown plane "${defId}"`);
    setBots(world, { team, count: perSide, skill, defId, nation: def.nation });
  }
  const teamOf = new Map(world.planes.map((p) => [p.id, p.team]));
  const depot = (team) => world.ground.find((o) => o.type === 'depot' && o.team === team);
  const hangar = (team) => world.ground.find((o) => o.type === 'hangar' && o.team === team);
  const home = [depot(0)?.x ?? hangar(0).x, depot(1)?.x ?? hangar(1).x];
  const middle = (home[0] + home[1]) / 2;
  const dir0 = Math.sign(home[1] - home[0]);
  const stats = [emptyStats(), emptyStats()];
  const reached = [{ depot: null, hangar: null }, { depot: null, hangar: null }];
  const destroyed = [{ depot: null, hangar: null }, { depot: null, hangar: null }]; // when each side's lost them
  const front = [];
  // Who a bullet, shell or bomb owner is: a plane (its team), or a ground object (its type), at the time.
  const whoIs = (id) => {
    if (id == null) return null;
    if (teamOf.has(id)) return { plane: true, team: teamOf.get(id) };
    const o = world.ground.find((g) => g.id === id);
    return o ? { plane: false, kind: o.type, team: o.team } : null;
  };
  const planeById = (id) => world.planes.find((p) => p.id === id);

  const ticks = Math.round(minutes * 60 * TICK_RATE);
  const every = Math.round(sample * TICK_RATE);
  const dt = 1 / TICK_RATE;
  for (let t = 0; t <= ticks; t++) {
    if (t > 0) stepWorld(world, {});
    if (t % every === 0) {
      const f = frontOf(world, home);
      front.push(Math.round((f.x - middle) * dir0 * 10) / 10);
      for (const team of [0, 1]) {
        const enemy = 1 - team;
        const dir = Math.sign(home[enemy] - home[team]) || 1;
        const ahead = (target) => target && (target.x - f.fwd[team]) * dir < REACH && f.fwd[team] !== home[team];
        if (reached[team].depot == null && ahead(depot(enemy))) reached[team].depot = world.tick / TICK_RATE;
        if (reached[team].hangar == null && ahead(hangar(enemy))) reached[team].hangar = world.tick / TICK_RATE;
      }
    }
    if (t === 0) continue;
    for (const p of world.planes) {
      const s = stats[teamOf.get(p.id)];
      if (!s || p.wreck) continue;
      if (p.state !== 'dead') s.aliveTime += dt;
      if (p.state === 'air') s.airTime += dt;
      if (p.service?.phase && p.service.phase !== 'done') s.serviceTime += dt;
    }
    const bombers = new Set(world.events.filter((e) => e.type === 'explosion' && e.owner != null).map((e) => e.owner));
    for (const e of world.events) {
      switch (e.type) {
        case 'shot':
          if (!e.gunner && teamOf.has(e.plane)) stats[teamOf.get(e.plane)].shots++;
          break;
        case 'hit': {
          const victim = teamOf.get(e.plane);
          if (victim == null) break;
          stats[victim].damageTaken += e.damage;
          const by = whoIs(e.by);
          if (by?.plane && by.team !== victim) stats[by.team].hits++;
          break;
        }
        case 'shrapnel':
          if (teamOf.has(e.plane)) stats[teamOf.get(e.plane)].damageTaken += e.damage;
          break;
        case 'bombRelease':
          if (teamOf.has(e.plane)) stats[teamOf.get(e.plane)].bombsDropped++;
          break;
        case 'shotDown': {
          const victim = teamOf.get(e.plane);
          const by = whoIs(e.by);
          if (victim == null || !by?.plane || by.team === victim) break;
          const s = stats[by.team];
          s.airKills++;
          const killer = planeById(e.by);
          const dy = killer ? killer.y - e.y : 0;
          if (dy > ABOVE) s.killsAbove++;
          else if (dy < -ABOVE) s.killsBelow++;
          else s.killsLevel++;
          break;
        }
        case 'crash': {
          const victim = teamOf.get(e.plane);
          if (victim == null) break;
          const s = stats[victim];
          s.deaths++;
          const by = whoIs(e.by);
          let cause = 'other';
          if (e.cause === 'collision') cause = 'collision';
          else if (by?.plane) cause = by.team === victim ? 'other' : 'fighter';
          else if (by?.kind === 'flak') cause = 'flak';
          else if (by?.kind === 'tank') cause = 'tankMg';
          else if (by) cause = 'groundFire';
          else if (e.by == null) cause = 'crash';
          s.deathBy[cause]++;
          break;
        }
        case 'groundDestroyed':
        case 'squadWiped': {
          if (e.kind === 'depot' || e.kind === 'hangar') {
            const o = world.ground.find((g) => g.id === e.id);
            if (o && (o.team === 0 || o.team === 1) && destroyed[o.team][e.kind] == null) destroyed[o.team][e.kind] = world.tick / TICK_RATE;
          }
          const by = whoIs(e.by);
          if (!by?.plane || e.type === 'squadWiped') break;
          const s = stats[by.team];
          if (e.kind === 'tank') s.tankKills++;
          else if (e.kind === 'truck') s.truckKills++;
          else s.otherGroundKills++;
          if (bombers.has(e.by)) s.bombKills++;
          else s.strafeKills++;
          break;
        }
        case 'soldierKilled': {
          const by = whoIs(e.by);
          if (by?.plane) stats[by.team].soldierKills++;
          break;
        }
      }
    }
    if (onProgress && t % TICK_RATE === 0) onProgress(t / ticks);
  }
  for (const s of stats) for (const k of ['damageTaken', 'aliveTime', 'airTime', 'serviceTime']) s[k] = Math.round(s[k] * 10) / 10;
  const idOf = (def) => Object.keys(content.planeDefs).find((id) => content.planeDefs[id] === def) ?? null;
  // What each side ended up flying: a check that the bots stayed locked to their type.
  const flown = [0, 1].map((team) => [...new Set(world.planes.filter((p) => p.team === team && !p.wreck).map((p) => idOf(p.def)))]);
  return { a, b, seed, minutes, perSide, skill, map, sample, arena, front, reached, destroyed, stats, flown };
}
