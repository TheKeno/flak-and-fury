// Balance Lab report: turns a run's match results into the strength list, matchup grid, front charts,
// stats table, quick per-matchup analysis and a plain-words summary. No AI: the words come from
// templates. It shows what differs between planes, not proven causes. Pure; used by the CLI and the page.

export const METRES = 0.4; // one world unit is about 0.4 m
const Z = 2; // a difference counts as real when bigger than this many standard errors (about 95% sure)
const MIN_N = 3; // fewer matches than this never count as a real difference

const mean = (xs) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0);
function spread(xs) {
  if (xs.length < 2) return { mean: mean(xs), sd: 0, se: Infinity, n: xs.length };
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((n, x) => n + (x - m) ** 2, 0) / (xs.length - 1));
  return { mean: m, sd, se: sd / Math.sqrt(xs.length), n: xs.length };
}
const round = (x, d = 0) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

// How far a match pushed the front for one plane: the mean of the front over the whole match, in
// metres, positive towards the enemy. The mean is steadier than the last sample.
export function matchPush(m, plane) {
  const push = mean(m.front) * METRES;
  return m.a === plane ? push : -push;
}
const sideOf = (m, plane) => (m.a === plane ? 0 : 1);

// The extra stats compared per matchup. per(stats, match): the value for one side of one match, or
// null when it can't be had (no shots: no hit rate). better: which way is good for the plane (1 higher,
// -1 lower, 0 neither). floor: differences below this are too small to mention. look: what to look at
// in TUNING.md.
const lives = (s, m) => s.deaths + m.perSide;
export const METRICS = [
  { key: 'airKills', label: 'air kills per match', per: (s) => s.airKills, better: 1, floor: 0.5, look: 'Planes: turnRate, thrust, maxSpeed; Weapons: damage of its guns' },
  { key: 'deaths', label: 'deaths per match', per: (s) => s.deaths, better: -1, floor: 0.5, look: 'Planes: hp, hitRadius, turnRate, maxSpeed' },
  { key: 'kpl', label: 'kills per life', per: (s, m) => s.airKills / lives(s, m), better: 1, floor: 0.05, look: 'Planes: turnRate, hp, armament' },
  { key: 'shots', label: 'gun volleys per match', per: (s) => s.shots, better: 0, floor: 20, look: 'Planes: armament (ammo, guns); Bots: firing range' },
  { key: 'hitRate', label: 'hit rate', pct: true, per: (s) => (s.shots ? s.hits / s.shots : null), better: 1, floor: 0.03, look: 'Weapons: spread, velocity, drop; Planes: turnRate, fineTurn' },
  { key: 'dmgLife', label: 'damage taken per life', per: (s, m) => s.damageTaken / lives(s, m), better: -1, floor: 5, look: 'Planes: hitRadius (size), hp' },
  { key: 'lifeTime', label: 'seconds alive per life', per: (s, m) => s.aliveTime / lives(s, m), better: 1, floor: 15, look: 'Planes: hp, hitRadius, maxSpeed' },
  { key: 'above', label: 'share of kills from above', pct: true, per: (s) => (s.airKills ? s.killsAbove / s.airKills : null), better: 0, floor: 0.1, look: 'Planes: thrust (climb), maxSpeed' },
  { key: 'level', label: 'share of kills level or turning', pct: true, per: (s) => (s.airKills ? (s.killsLevel + s.killsBelow) / s.airKills : null), better: 0, floor: 0.1, look: 'Planes: turnRate, slowTurnBonus' },
  { key: 'byFighter', label: 'deaths to fighters per match', per: (s) => s.deathBy.fighter, better: -1, floor: 0.5, look: 'Planes: turnRate, maxSpeed, hp, hitRadius' },
  { key: 'byFlak', label: 'deaths to flak per match', per: (s) => s.deathBy.flak, better: -1, floor: 0.3, look: 'Planes: hp, hitRadius; Ground targets: flak' },
  { key: 'byTankMg', label: 'deaths to tank MGs per match', per: (s) => s.deathBy.tankMg + s.deathBy.groundFire, better: -1, floor: 0.3, look: 'Planes: hp, hitRadius; Ground targets: tank aa* values, mgNest' },
  { key: 'byCrash', label: 'crashes and stalls per match', per: (s) => s.deathBy.crash, better: -1, floor: 0.3, look: 'Planes: stallSpeed, slowTurnBonus, turnRate, maxLandingSpeed' },
  { key: 'byCollision', label: 'collisions per match', per: (s) => s.deathBy.collision, better: -1, floor: 0.3, look: 'Planes: hitRadius, toughness; Settings: collisions' },
  { key: 'service', label: 'seconds servicing per match', per: (s) => s.serviceTime, better: -1, floor: 20, look: 'Planes: endurance, armament ammo; Settings: servicing' },
  { key: 'bombs', label: 'bombs dropped per match', per: (s) => s.bombsDropped, better: 0, floor: 1, look: 'Planes: loadout, loadoutPresets' },
  { key: 'tankPerBomb', label: 'tank kills per bomb', per: (s) => (s.bombsDropped ? s.tankKills / s.bombsDropped : null), better: 1, floor: 0.05, look: 'Weapons: bomb blastRadius, blastDamage; Ground targets: tank bombFactor' },
  { key: 'tankKills', label: 'tank kills per match', per: (s) => s.tankKills, better: 1, floor: 0.5, look: 'Planes: loadout; Ground targets: tank roofFactor, bombFactor' },
  { key: 'strafe', label: 'strafing kills per match', per: (s) => s.strafeKills, better: 1, floor: 0.5, look: 'Weapons: gun damage; Ground targets: bulletFactor, roofFactor' },
  { key: 'soldiers', label: 'soldiers killed per match', per: (s) => s.soldierKills, better: 1, floor: 2, look: 'Weapons: gun damage; Ground targets: infantry' },
];

// One metric for one plane over a list of matches: mean, standard error.
function metricOver(metric, matches, plane) {
  const vals = [];
  for (const m of matches) {
    const v = metric.per(m.stats[sideOf(m, plane)], m);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  return spread(vals);
}

// Mean front over time for a set of matches, from one plane's side, with a spread band (± one sd).
function frontSeries(matches, plane) {
  const len = Math.min(...matches.map((m) => m.front.length));
  const out = { t: [], mean: [], lo: [], hi: [] };
  if (!matches.length || !Number.isFinite(len)) return out;
  const sample = matches[0].sample ?? 10;
  for (let i = 0; i < len; i++) {
    const vals = matches.map((m) => m.front[i] * METRES * (m.a === plane || plane == null ? 1 : -1));
    const s = spread(vals);
    out.t.push(i * sample);
    out.mean.push(round(s.mean, 1));
    out.lo.push(round(s.mean - s.sd, 1));
    out.hi.push(round(s.mean + s.sd, 1));
  }
  return out;
}

// Totals of one plane's side over matches (for the stats table).
function totals(matches, plane) {
  const t = { matches: matches.length, lives: 0, airKills: 0, deaths: 0, tankKills: 0, truckKills: 0, soldierKills: 0, otherGroundKills: 0, depot: 0, hangar: 0 };
  for (const m of matches) {
    const side = sideOf(m, plane);
    const s = m.stats[side];
    t.lives += lives(s, m);
    for (const k of ['airKills', 'deaths', 'tankKills', 'truckKills', 'soldierKills', 'otherGroundKills']) t[k] += s[k];
    if (m.reached[side].depot != null) t.depot++;
    if (m.reached[side].hangar != null) t.hangar++;
  }
  return t;
}

export function analyse(run) {
  const names = run.names ?? {};
  const name = (id) => names[id] ?? id;
  const planes = run.planes;
  const matches = run.matches;
  const baseline = matches.filter((m) => m.a === m.b);
  const mixed = matches.filter((m) => m.a !== m.b);
  const minutes = run.scenario.minutes;

  // Baselines: same plane both sides. The push from team 0's side shows map bias; its spread the noise.
  const baselines = planes.map((id) => {
    const ms = baseline.filter((m) => m.a === id);
    const s = spread(ms.map((m) => matchPush(m, id)));
    return { id, name: name(id), n: s.n, push: round(s.mean), sd: round(s.sd), series: frontSeries(ms, null) };
  });
  const drift = mean(baseline.map((m) => Math.abs(matchPush(m, m.a))));
  // The noise between seeds: how much one match's push scatters when both sides are equal (root mean
  // square of the baseline pushes, map bias included, so on the safe side). A matchup's own scatter
  // can look small by chance with few matches, so its error is never taken below this.
  const noiseSd = baseline.length ? Math.sqrt(mean(baseline.map((m) => matchPush(m, m.a) ** 2))) : 0;
  const noisy = (s) => ({ ...s, se: Math.max(s.se, noiseSd / Math.sqrt(s.n || 1)) });

  // Matchups: x against y (both ways round), push from x's side.
  const matchups = [];
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const x = planes[i];
      const y = planes[j];
      const ms = mixed.filter((m) => (m.a === x && m.b === y) || (m.a === y && m.b === x));
      if (!ms.length) continue;
      const s = noisy(spread(ms.map((m) => matchPush(m, x))));
      const real = s.n >= MIN_N && Math.abs(s.mean) > Z * s.se;
      const compare = METRICS.map((metric) => {
        const mx = metricOver(metric, ms, x);
        const my = metricOver(metric, ms, y);
        const diff = mx.mean - my.mean;
        const se = Math.hypot(mx.se, my.se);
        const big = Math.max(Math.abs(mx.mean), Math.abs(my.mean));
        return {
          key: metric.key, label: metric.label, pct: !!metric.pct, look: metric.look, better: metric.better,
          x: mx.n ? mx.mean : null, y: my.n ? my.mean : null, diff,
          size: big ? Math.abs(diff) / big : 0,
          real: mx.n >= MIN_N && my.n >= MIN_N && Math.abs(diff) > Z * se,
          worth: Math.abs(diff) >= metric.floor,
        };
      });
      const top = compare.filter((c) => c.worth && c.x != null && c.y != null).sort((p, q) => (q.real - p.real) || q.size - p.size).slice(0, 4);
      matchups.push({
        x, y, n: s.n, push: round(s.mean), se: round(s.se, 1), real,
        series: frontSeries(ms, x),
        compare,
        notes: top.map((c) => differenceSentence(c, name(x), name(y))),
        reachedX: totals(ms, x).depot, reachedY: totals(ms, y).depot,
      });
    }
  }

  // Strength list: each plane's push over all its matchups, sorted, flagged only when beyond the noise.
  const strength = planes.map((id) => {
    const ms = mixed.filter((m) => m.a === id || m.b === id);
    const s = noisy(spread(ms.map((m) => matchPush(m, id))));
    const t = totals(ms, id);
    return {
      id, name: name(id), n: s.n, push: round(s.mean), se: round(s.se, 1),
      flag: s.n >= MIN_N && Math.abs(s.mean) > Z * s.se ? (s.mean > 0 ? 'strong' : 'weak') : null,
      stats: {
        airKills: round(t.airKills / (t.matches || 1), 1),
        deaths: round(t.deaths / (t.matches || 1), 1),
        killsPerLife: round(t.airKills / (t.lives || 1), 2),
        tankKills: round(t.tankKills / (t.matches || 1), 2),
        otherGround: round((t.truckKills + t.soldierKills + t.otherGroundKills) / (t.matches || 1), 1),
        reachedDepot: t.matches ? round(t.depot / t.matches, 2) : null,
        reachedHangar: t.matches ? round(t.hangar / t.matches, 2) : null,
      },
    };
  }).sort((p, q) => q.push - p.push);

  const report = {
    run: { mode: run.mode, scenario: run.scenario.name, started: run.started, finished: run.finished, planned: run.planned, done: matches.length },
    gameHours: round((matches.length * minutes) / 60, 1),
    drift: round(drift),
    noise: round(noiseSd),
    strength, baselines, matchups,
  };
  report.summary = summarise(report, run);
  return report;
}

const fmt = (c, v) => (v == null ? '–' : c.pct ? `${Math.round(v * 100)}%` : Math.abs(v) >= 10 ? `${Math.round(v)}` : `${round(v, 2)}`);

function differenceSentence(c, nx, ny) {
  const [hi, lo, vh, vl] = c.diff >= 0 ? [nx, ny, c.x, c.y] : [ny, nx, c.y, c.x];
  const luck = c.real ? '' : ' (could be luck)';
  return `${hi} has more ${c.label} than ${lo}: ${fmt(c, vh)} against ${fmt(c, vl)}${luck}. Look at ${c.look}.`;
}

// The plain-words summary on top of the report, written so anyone can read it.
function summarise(r, run) {
  const out = [];
  const s = run.scenario;
  const done = run.matches.length;
  out.push(`We flew ${done} matches (${r.gameHours} hours of game time): ${s.perSide} against ${s.perSide} ${s.skill} bots, ${s.minutes} minutes each, on ${s.map}.`);
  if (done < run.planned) out.push(`The run stopped early: ${done} of ${run.planned} matches. Fewer matches means more luck in the numbers.`);
  if (r.baselines.some((b) => b.n)) {
    out.push(`When both sides fly the same plane, the front still wanders about ${r.drift} m in a match just by luck. That is the noise; smaller differences mean nothing.`);
  }
  const ranked = r.strength.filter((p) => p.n);
  if (ranked.length >= 2) {
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    out.push(best.flag === 'strong'
      ? `${best.name} pushes the front the most: ${best.push} m towards the enemy on average (± ${round(Z * best.se)} m). That is more than luck can explain, so ${best.name} is probably too strong.`
      : `${best.name} pushes the front the most (${best.push} m on average), but that is within the noise (± ${round(Z * best.se)} m), so it may just be luck.`);
    out.push(worst.flag === 'weak'
      ? `${worst.name} loses the most ground: ${-worst.push} m on average (± ${round(Z * worst.se)} m). That is more than luck, so ${worst.name} is probably too weak.`
      : `${worst.name} loses the most ground (${-worst.push} m), but that is within the noise (± ${round(Z * worst.se)} m).`);
  }
  const unfair = r.matchups.filter((m) => m.real);
  if (r.matchups.length) {
    if (!unfair.length) out.push(`${r.matchups.length === 1 ? 'The matchup is not' : `None of the ${r.matchups.length} matchups is`} clearly one-sided. ${done < 30 * r.matchups.length ? 'A full run can show smaller differences.' : ''}`.trim());
    else {
      const worst = unfair.reduce((p, q) => (Math.abs(q.push) > Math.abs(p.push) ? q : p));
      const [w, l] = worst.push > 0 ? [worst.x, worst.y] : [worst.y, worst.x];
      out.push(`${unfair.length} of ${r.matchups.length} matchups are clearly one-sided. The most one-sided: ${run.names[w]} against ${run.names[l]}, the front moves ${Math.abs(worst.push)} m (± ${round(Z * worst.se)} m) for ${run.names[w]}.`);
      const note = worst.notes[0];
      if (note) out.push(`What differs most there: ${note}`);
    }
  }
  out.push('These numbers show what differs between the planes, not why. Change one value, run again and compare the two runs.');
  return out;
}

// Two runs side by side: each plane's push before and after, and every matchup's.
export function compareRuns(before, after) {
  const a = analyse(before);
  const b = analyse(after);
  const planes = [...new Set([...a.strength.map((p) => p.id), ...b.strength.map((p) => p.id)])];
  const find = (r, id) => r.strength.find((p) => p.id === id);
  const rows = planes.map((id) => {
    const p = find(a, id);
    const q = find(b, id);
    const change = p && q ? q.push - p.push : null;
    const se = p && q ? Math.hypot(p.se, q.se) : null;
    return { id, name: (q ?? p).name, before: p?.push ?? null, after: q?.push ?? null, change: round(change), real: change != null && Math.abs(change) > Z * se };
  });
  const key = (m) => `${m.x}|${m.y}`;
  const mb = new Map(b.matchups.map((m) => [key(m), m]));
  const matchups = a.matchups.filter((m) => mb.has(key(m))).map((m) => {
    const n = mb.get(key(m));
    return { x: m.x, y: m.y, before: m.push, after: n.push, change: round(n.push - m.push), real: Math.abs(n.push - m.push) > Z * Math.hypot(m.se, n.se) };
  });
  const calmer = rows.filter((r) => r.real && Math.abs(r.after) < Math.abs(r.before));
  const wilder = rows.filter((r) => r.real && Math.abs(r.after) > Math.abs(r.before));
  const summary = [
    `Before: ${before.matches.length} matches; after: ${after.matches.length}.`,
    calmer.length ? `Closer to even now: ${calmer.map((r) => r.name).join(', ')}.` : 'No plane moved clearly closer to even.',
    wilder.length ? `Further from even now: ${wilder.map((r) => r.name).join(', ')}.` : 'No plane moved clearly further from even.',
    'Changes smaller than the noise are not marked.',
  ];
  return { before: a, after: b, rows, matchups, summary };
}
