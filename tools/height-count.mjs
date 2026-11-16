// The height count in the real arena (Decisions, "Main fighters tuned per band", stage 4): full matches on the
// countryside map with the ground war, both kinds of flak and the bomber raids, every pairing of the six main
// fighters both ways round plus a same-plane match each, and where the fighters were shot down: by band
// (low, mid, high; src/balance/runner.js killsAt, lostAt). No plane changed.
//   node tools/height-count.mjs [--seeds 201-208] [--minutes 10] [--threads 8] [--planes a,b,...] [--label text]
// FF_TACTICS, FF_PLANES, FF_FLIGHT and FF_WEAPONS apply as in the other tools (tools/content.mjs).
// Prints progress; the results also go to notes/height-count-<date>.txt (appended), every line with the clock time.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPool } from './balance.mjs';
import { planMatches } from '../src/balance/plan.js';
import { heightCount } from '../src/balance/report.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const planes = opt('--planes', 'b239,la5fn,spitfire,a6m5,bf109g6,p47d').split(',');
const [s0, s1] = opt('--seeds', '201-208').split('-').map(Number);
const minutes = Number(opt('--minutes', 10));
const threads = Math.min(8, Number(opt('--threads', 8)));
const label = opt('--label', '');
const logFile = `${root}notes/height-count-${new Date().toISOString().slice(0, 10)}.txt`;
const clock = () => new Date().toLocaleTimeString('sv-SE');
const stamp = (line) => line.replace(/^(\n*)/, `$1[${clock()}] `);
const say = (line) => {
  console.log(stamp(line));
  appendFileSync(logFile, stamp(line) + '\n');
};

const jobs = planMatches({ planes, perSide: 4, minutes, skill: 'normal', map: 'countryside', sample: 10, seed: s0, sizes: { quick: s1 - s0 + 1 } }, 'quick');
say(`\nHeight count ${new Date().toISOString().slice(0, 16)}${label ? ` (${label})` : ''}: ${jobs.length} matches of ${minutes} min, seeds ${s0}-${s1}, ${threads} threads.`
  + ['FF_FLIGHT', 'FF_TACTICS', 'FF_PLANES', 'FF_WEAPONS'].filter((k) => process.env[k]).map((k) => ` ${k}=${process.env[k]}`).join(''));
const t0 = Date.now();
const results = new Array(jobs.length);
let done = 0;
let lastShown = 0;
await runPool(jobs, threads, 'countryside', (i, r) => {
  results[i] = r;
  done++;
  const now = Date.now();
  if (now - lastShown > 15000 || done === jobs.length) {
    lastShown = now;
    const s = (now - t0) / 1000;
    console.log(`[${clock()}]   ${done} of ${jobs.length} matches, ${Math.round(s / 60)} min, about ${Math.round(((jobs.length - done) * s) / done / 60)} min left`);
  }
});

const h = heightCount(results, planes);
const pct = (x) => `${Math.round(x * 100)}%`.padStart(5);
const row = (name, c) => `${name.padEnd(10)} ${c.killShare.map(pct).join('')}   ${c.lostShare.map(pct).join('')}   ${String(c.kills.reduce((n, x) => n + x, 0)).padStart(5)} ${String(c.lost.reduce((n, x) => n + x, 0)).padStart(5)}`;
say(`\n== where fighters were shot down (${Math.round((Date.now() - t0) / 1000)} s)`);
say('           kills by band     lost by band      kills  lost   (kills: by its fighters; lost: to anything of the enemy\'s)');
say('             low  mid high     low  mid high');
for (const p of planes) say(row(p, h.planes[p]));
say(row('all', h.all));
// Exchange share against the other types (kills / (kills + losses to fighters)), the mixed matches only.
const ex = Object.fromEntries(planes.map((p) => [p, [0, 0]]));
for (const m of results) {
  if (m.a === m.b) continue;
  [m.a, m.b].forEach((id, side) => {
    ex[id][0] += m.stats[side].airKills;
    ex[id][1] += m.stats[1 - side].airKills;
  });
}
say('exchange share against the other types: ' + planes.map((p) => `${p} ${Math.round((100 * ex[p][0]) / (ex[p][0] + ex[p][1] || 1))}%`).join(', '));
const r = h.raid;
say(`raids: ${r.raids} flown, ${r.sent} bombers: ${r.bombed} bombed, ${r.aborted} turned back hit, ${r.lostToFighters} shot down by fighters, ${r.lostToFlak} by flak, ${r.lostOther} lost otherwise, ${r.home} came home.`);
const front = results.reduce((n, m) => n + Math.abs(m.front[m.front.length - 1]), 0) / results.length;
const depots = results.reduce((n, m) => n + m.destroyed.filter((d) => d.depot != null).length, 0);
say(`ground war: the front ends ${Math.round(front)} units from the middle on average; ${depots} depots destroyed in ${results.length} matches.`);
say('\nHeight count done.');
