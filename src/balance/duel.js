// Set-piece duels: two bots started in the exact situation a plane role is about (a slow turning fight,
// a dive from height, a chase of a diver), in the air-only arena, with an expected winner that comes from
// the plane sheet (src/balance/sheet.js). Pure (no DOM, no Node APIs), deterministic: the same content,
// duel and seed give the same result, so it runs in worker threads (tools/duels.mjs) and is the gate for
// the later plane auto-tuner and a lasting test that each flight or gun mechanic does what it should.
//
// A duel (balance/duels.json): { id, title, why, a, b, expect, basis, seconds }
//   a, b: one side { plane, tactics?, x, h, face, speed?, stall?, pitch? }. In the frame of the duel
//     team 0 starts left of the middle facing right. x: units from the middle (team 0 frame, a negative x
//     is left); h: height above the ground; face: 1 right, -1 left; speed: share of the plane's maxSpeed
//     (or stall: multiple of its stall speed); pitch: degrees (negative dives). tactics: bot tactics on top
//     of the trained ones (e.g. { style: 0.5 } forces boom and zoom, as the tuner will).
//   expect: 'a' | 'b' | 'even'. basis: the sheet number that says why (BETTER in sheet.js): the winner
//     must have the better one (the tests check it), 'turnTime' being lower-is-better.
// Each duel runs `seeds` times from each side of the map (a plays team 0, then team 1 with the picture
// mirrored), so the map's bias cancels.
import { buildWorld } from './runner.js';
import { setBots, stepWorld, TICK_RATE } from '../sim/world.js';
import { launch, BETTER } from './sheet.js';
import { tacticsIn } from '../sim/tactics.js';

export const PASS_SCORE = 0.3; // (wins - losses) / runs the expected winner needs
export const EVEN_SCORE = 0.4; // 'even' duels: no side further ahead than this
const CONE = 0.35; // rad: the enemy is in front of the nose by this much or less ...
const CONE_RANGE = 500; // ... and this close: "on its sights"
const POSITION_GAP = 8; // seconds on the enemy's sights more than the other side ...
const POSITION_RATIO = 1.5; // ... and this many times as long decide a fight nobody won by damage
const HP_MARGIN = 0.2; // at the time limit the side that lost this much less of its hit points wins

// Small deterministic jitter so the seeds differ in more than the bots' reaction times.
function jitter(seed, n) {
  let t = (seed * 2654435761 + n * 40503) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; // -1..1
}

function table(content, spec) {
  const base = tacticsIn(content.tactics, spec.plane);
  return { default: content.tactics.default, planes: { ...content.tactics.planes, [spec.plane]: { ...base, ...spec.tactics } } };
}

// One run of a duel: seed and mirrored (a flies team 1 from the right). Returns plain data.
export function runDuel(content, duel, { seed = 1, mirror = false, skill = 'normal' } = {}) {
  const specs = [duel.a, duel.b];
  const teamOf = mirror ? [1, 0] : [0, 1]; // team of a, of b
  const tactics = [null, null];
  specs.forEach((s, i) => { tactics[teamOf[i]] = table(content, s); });
  const world = buildWorld(content, { map: 'countryside', seed, arena: true, tactics });
  const middle = world.map.width / 2;
  const planes = [];
  specs.forEach((s, i) => {
    const def = content.planeDefs[s.plane];
    if (!def) throw new Error(`Unknown plane "${s.plane}" in duel ${duel.id}`);
    setBots(world, { team: teamOf[i], count: 1, skill, defId: s.plane, nation: def.nation });
    const p = world.planes.find((q) => q.team === teamOf[i]);
    const dir = mirror ? -1 : 1;
    const j = (k) => jitter(seed, i * 10 + k);
    const x = middle + dir * ((s.x ?? 0) + 25 * j(1));
    const face = (s.face ?? 1) * dir;
    const pitch = ((s.pitch ?? 0) * Math.PI) / 180;
    const angle = face > 0 ? pitch : Math.PI - pitch;
    const speed = (s.stall != null ? def.stallSpeed * s.stall : def.maxSpeed * (s.speed ?? 0.75)) * (1 + 0.03 * j(2));
    const y = world.terrain.heightAt(x) + (s.h ?? 200) + 10 * j(3);
    launch(p, { x, y, angle, speed });
    planes.push(p);
  });
  const [pa, pb] = planes;
  const mine = [pa, pb];
  const side = new Map([[pa.id, 0], [pb.id, 1]]);
  const per = [0, 1].map(() => ({ damage: 0, shots: 0, fireT: 0, hits: 0, cone: 0, stalled: 0, minSpeed: Infinity, selfFault: false, lost: null }));
  let result = null;
  const ticks = Math.round((duel.seconds ?? 150) * TICK_RATE);
  const dt = 1 / TICK_RATE;
  for (let t = 1; t <= ticks && !result; t++) {
    stepWorld(world, {});
    for (let k = 0; k < 2; k++) {
      const p = mine[k];
      const o = mine[1 - k];
      if (p.state !== 'air') continue;
      if (p.stalled) per[k].stalled += dt;
      per[k].minSpeed = Math.min(per[k].minSpeed, p.speed);
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      if (Math.hypot(dx, dy) < CONE_RANGE) {
        const off = Math.abs(((Math.atan2(dy, dx) - p.angle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (off < CONE) per[k].cone += dt;
      }
    }
    const fired = [false, false];
    for (const e of world.events) {
      if (e.type === 'shot' && !e.gunner && side.has(e.plane)) { per[side.get(e.plane)].shots++; fired[side.get(e.plane)] = true; }
      else if (e.type === 'hit' && side.has(e.plane) && side.has(e.by) && e.by !== e.plane) {
        per[side.get(e.by)].hits++;
        per[side.get(e.by)].damage += e.damage;
      } else if (e.type === 'shotDown' && side.has(e.plane) && !result) {
        const loser = side.get(e.plane);
        const by = side.get(e.by);
        if (by != null && by !== loser) result = { winner: by, how: 'kill', time: t * dt };
        else { per[loser].selfFault = true; result = { winner: 1 - loser, how: 'own fault', time: t * dt }; }
      } else if (e.type === 'crash' && side.has(e.plane) && !result) {
        const loser = side.get(e.plane);
        per[loser].selfFault = true;
        result = e.cause === 'collision' ? { winner: null, how: 'collision', time: t * dt } : { winner: 1 - loser, how: 'own fault', time: t * dt };
      }
    }
    for (let k = 0; k < 2; k++) if (fired[k]) per[k].fireT += dt;
  }
  const hpLeft = mine.map((p) => Math.max(0, p.hp) / p.def.hp);
  if (!result) {
    const limit = duel.seconds ?? 150;
    const lead = hpLeft[0] - hpLeft[1];
    const [c0, c1] = [per[0].cone, per[1].cone];
    if (Math.abs(lead) >= HP_MARGIN) result = { winner: lead > 0 ? 0 : 1, how: 'hit points', time: limit };
    // Nobody got a shot home: the side that held the other on its sights clearly longer had the upper hand.
    else if (Math.abs(c0 - c1) >= POSITION_GAP && Math.max(c0, c1) >= POSITION_RATIO * Math.min(c0, c1)) result = { winner: c0 > c1 ? 0 : 1, how: 'position', time: limit };
    else result = { winner: null, how: 'no result', time: limit };
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    seed, mirror, winner: result.winner, how: result.how, time: r2(result.time),
    sides: per.map((s, k) => ({ hpLeft: r2(hpLeft[k]), damage: r2(s.damage), shots: s.shots, fireT: r2(s.fireT), hits: s.hits, cone: r2(s.cone), stalled: r2(s.stalled), minSpeed: Math.round(s.minSpeed), selfFault: s.selfFault })),
  };
}

// The jobs of a duel list: every duel x seeds x both sides of the map (a plain-data list for the pool).
export function planDuels(duels, seeds = 8) {
  const jobs = [];
  for (let i = 0; i < seeds; i++) for (const duel of duels) for (const mirror of [false, true]) jobs.push({ duelJob: true, duel, seed: 700 + i, mirror });
  return jobs;
}

// Judges one duel from its runs: counts, score, pass or fail, and for a fail a guess whether the bot or the
// plane numbers are at fault. sheets: { planeId: sheet } (src/balance/sheet.js).
export function judgeDuel(duel, runs, sheets) {
  const n = runs.length;
  const wins = [0, 0];
  let draws = 0;
  for (const r of runs) {
    const w = r.winner;
    if (w == null) { draws++; continue; }
    wins[w]++;
  }
  const by = {};
  for (const r of runs) if (r.winner != null) by[r.how] = (by[r.how] ?? 0) + 1;
  const score = (wins[0] - wins[1]) / n; // seen from a
  const want = duel.expect;
  const pass = want === 'even' ? Math.abs(score) <= EVEN_SCORE : (want === 'a' ? score : -score) >= PASS_SCORE;
  const avg = (k, f) => runs.reduce((s, r) => s + f(r.sides[k]), 0) / n;
  const stat = [0, 1].map((k) => ({
    wins: wins[k],
    damage: Math.round(avg(k, (s) => s.damage) * 10) / 10,
    fireSeconds: Math.round(avg(k, (s) => s.fireT) * 10) / 10,
    hitRate: (() => { const sh = avg(k, (s) => s.shots); return sh ? Math.round((100 * avg(k, (s) => s.hits)) / sh) : 0; })(),
    cone: Math.round(avg(k, (s) => s.cone) * 10) / 10,
    stalled: Math.round(avg(k, (s) => s.stalled) * 10) / 10,
    ownFault: runs.filter((r) => r.sides[k].selfFault).length,
  }));
  const out = {
    id: duel.id, title: duel.title, expect: want, basis: duel.basis ?? null, runs: n, wins: wins[0], losses: wins[1], draws, decidedBy: by, score: Math.round(score * 100) / 100,
    pass, stat, numbers: basisNumbers(duel, sheets),
  };
  if (!pass) out.blame = blame(duel, out);
  out.words = words(duel, out);
  return out;
}

// Does the number x beat y by at least 3% in the direction BETTER says?
export function numbersFavour(basis, x, y) {
  const high = BETTER[basis] !== 'low';
  return high ? x >= y * 1.03 : x <= y / 1.03;
}

function basisNumbers(duel, sheets) {
  if (!duel.basis || !sheets) return null;
  return { [duel.a.plane]: sheets[duel.a.plane]?.[duel.basis] ?? null, [duel.b.plane]: sheets[duel.b.plane]?.[duel.basis] ?? null, basis: duel.basis };
}

// A guess at where a failed duel points, from what the expected winner did: no hits or no firing = the bot
// could not use its edge; stalls and crashes = bot flying; had the enemy on its sights and still lost =
// plane numbers (or guns); never got on its sights while the numbers favour it = the bot lost the position.
function blame(duel, res) {
  const win = duel.expect === 'b' ? 1 : 0; // the side expected to win (for 'even': a)
  const w = res.stat[win];
  const l = res.stat[1 - win];
  const lines = [];
  const bn = res.numbers;
  if (bn && duel.expect !== 'even') {
    const [x, y] = duel.expect === 'a' ? [bn[duel.a.plane], bn[duel.b.plane]] : [bn[duel.b.plane], bn[duel.a.plane]];
    if (x != null && y != null && !numbersFavour(duel.basis, x, y)) lines.push({ kind: 'planes', why: `the sheet itself does not give the expected winner a clear edge in ${duel.basis} (${x} against ${y})` });
  }
  if (duel.expect === 'even') return { kind: 'sides', why: 'same plane, same tactics, yet one side wins: map or start-position bias in the duel or the arena, not a plane or bot fault' };
  if (w.ownFault >= res.runs * 0.2) lines.push({ kind: 'bot', why: `the expected winner crashed or collided by itself in ${w.ownFault} of ${res.runs} runs` });
  if (w.stalled >= 4) lines.push({ kind: 'bot', why: `the expected winner spent ${w.stalled} s stalled per run: it flies the fight into stalls` });
  if (w.fireSeconds < 1.5 && l.fireSeconds < 1.5) lines.push({ kind: 'bot', why: `neither bot fired (${w.fireSeconds} s and ${l.fireSeconds} s per run): the fight stays a circle or a missed pass, so the position is never turned into shots` });
  else if (w.fireSeconds < 1.5) lines.push({ kind: 'bot', why: `the expected winner fired only ${w.fireSeconds} s per run: it never lined up a shot` });
  else if (w.cone < l.cone * 0.8) lines.push({ kind: 'bot', why: `the expected winner had the enemy on its sights ${w.cone} s per run against ${l.cone} s: it lost the position it should win by its numbers` });
  else if (w.cone >= l.cone * 0.8 && w.damage < l.damage) lines.push({ kind: 'planes', why: `the expected winner had the position (${w.cone} s on its sights against ${l.cone} s) but dealt ${w.damage} damage against ${l.damage}: guns, toughness or hit points do not convert it` });
  if (!lines.length) lines.push({ kind: 'planes', why: `the expected winner flew cleanly (on its sights ${w.cone} s against ${l.cone} s, damage ${w.damage} against ${l.damage}) and still did not win: the plane numbers do not give the edge the duel claims` });
  return { kind: lines[0].kind, why: lines.map((x) => x.why).join('; '), all: lines };
}

function words(duel, r) {
  const A = duel.a.plane;
  const B = duel.b.plane;
  const tally = `${A} won ${r.wins}, ${B} won ${r.losses}, ${r.draws} undecided, of ${r.runs}`;
  const nums = r.numbers ? ` (${r.numbers.basis}: ${A} ${r.numbers[A]}, ${B} ${r.numbers[B]})` : '';
  const want = r.expect === 'even' ? 'expected even' : `expected ${r.expect === 'a' ? A : B} to win`;
  return `${r.pass ? 'PASS' : 'FAIL'} ${duel.title}: ${want}${nums}. ${tally}${Object.keys(r.decidedBy).length ? ` (decided by ${Object.entries(r.decidedBy).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}.${r.blame ? ` Points at the ${r.blame.kind === 'bot' ? 'BOT' : r.blame.kind === 'planes' ? 'PLANE NUMBERS' : 'DUEL'}: ${r.blame.why}.` : ''}`;
}
