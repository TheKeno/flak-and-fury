// Skill-level order check: the same plane on both sides, one at a higher level than the other, a slow fight
// and a fast head-on start, from both sides of the map. The higher level should win (ace > normal > easy);
// easy against normal should still be a fair fight for a new player (the easy side wins sometimes).
//   node tools/skill-order.mjs [--seeds N] [--planes a,b,c] [--threads N]
import { availableParallelism } from 'node:os';
import { loadContent } from './content.mjs';
import { planDuels } from '../src/balance/duel.js';
import { pool } from './duels.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const seeds = Number(opt('--seeds', 8));
const planes = opt('--planes', 'spitfire,bf109g6,ki43,p47d').split(',');
const content = loadContent();
const starts = { slow: { stall: 1.5 }, fast: { speed: 0.8 } };
const PAIRS = [['ace', 'normal'], ['normal', 'easy'], ['ace', 'easy']];
const jobs = [];
const keys = [];
for (const plane of planes) for (const [start, s] of Object.entries(starts)) for (const [hi, lo] of PAIRS) {
  const duel = { id: `${plane}-${start}`, a: { plane, x: -300, h: 220, face: 1, ...s }, b: { plane, x: 300, h: 220, face: -1, ...s }, seconds: 150 };
  for (const j of planDuels([duel], seeds)) { jobs.push({ ...j, skill: [hi, lo] }); keys.push({ plane, start, hi, lo }); }
}
const results = await pool(jobs, Number(opt('--threads', availableParallelism())));
const table = {};
results.forEach((r, i) => {
  const k = keys[i];
  const t = (table[`${k.hi} v ${k.lo}`] ??= {});
  const c = (t[`${k.plane}/${k.start}`] ??= { hi: 0, lo: 0, draw: 0, own: 0 });
  if (r.winner === 0) c.hi++; else if (r.winner === 1) c.lo++; else c.draw++;
  if (r.sides[0].selfFault || r.sides[1].selfFault) c.own++;
});
for (const [pair, t] of Object.entries(table)) {
  console.log(pair);
  let hi = 0, lo = 0, n = 0;
  for (const [k, c] of Object.entries(t)) { hi += c.hi; lo += c.lo; n += c.hi + c.lo + c.draw; console.log(`  ${k.padEnd(18)} higher ${c.hi}, lower ${c.lo}, draw ${c.draw}, own-fault runs ${c.own}`); }
  console.log(`  total: higher ${hi}, lower ${lo}, draw ${n - hi - lo} of ${n}  (win share of decided ${(hi / Math.max(1, hi + lo)).toFixed(2)})`);
}
process.exit(0);
