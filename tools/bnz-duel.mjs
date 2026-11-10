// Boom and zoom against turn fighting in the same plane: the air-only arena, one side flying style 1
// (dive and climb), the other style 0 (turn-fight), both sides swapped to cancel the map. A check for
// step 3 of the roadmap's "Plane roles and balancing plan" (is boom and zoom viable?).
// With --vs: each plane flies the style (and, as a control, its trained tactics) against each listed
// opponent flying its own trained tactics: where does the style win and where does it lose?
//
//   node tools/bnz-duel.mjs [planes a,b,..] [--seeds N] [--minutes N] [--over H] [--style S] [--tac '{"breakOff":1.5}']
//   node tools/bnz-duel.mjs p47d,bf109g6 --style 0.5 --over 0 --vs bf109g6,spitfire,p47d,la5fn,ki43,b239
import { availableParallelism } from 'node:os';
import { loadContent, runPool } from './balance.mjs';
import { tacticsIn } from '../src/sim/tactics.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const planes = (args.find((a, i) => !a.startsWith('--') && !/^[\d.]+$/.test(a) && args[i - 1] !== '--tac' && args[i - 1] !== '--vs') ?? 'p47d,bf109g6,p38j').split(',');
const seeds = opt('--seeds', 6);
const minutes = opt('--minutes', 6);
const over = opt('--over', 150);
const style = opt('--style', 1);
const extra = args.includes('--tac') ? JSON.parse(args[args.indexOf('--tac') + 1]) : {};
const vs = args.includes('--vs') ? args[args.indexOf('--vs') + 1].split(',') : null;

const content = loadContent();
if (vs) {
  const jobs = [];
  for (const plane of planes) {
    const base = tacticsIn(content.tactics, plane);
    const mine = { ...base, style, heightOver: Math.max(base.heightOver, over), ...extra };
    const table = { default: content.tactics.default, planes: { ...content.tactics.planes, [plane]: mine } };
    for (const foe of vs) {
      for (const variant of ['style', 'trained']) {
        const t = variant === 'style' ? table : content.tactics;
        for (let i = 0; i < seeds; i++) {
          for (const side of [0, 1]) {
            jobs.push({ plane, foe, variant, side, a: side === 0 ? plane : foe, b: side === 0 ? foe : plane, seed: 500 + i, minutes, perSide: 2, skill: 'normal', map: 'countryside', sample: 30, arena: true, tactics: side === 0 ? [t, content.tactics] : [content.tactics, t] });
          }
        }
      }
    }
  }
  const res = new Array(jobs.length);
  await runPool(jobs, availableParallelism(), 'countryside', (i, r) => { res[i] = r; });
  const sum = {};
  for (let i = 0; i < jobs.length; i++) {
    const { plane, foe, variant, side } = jobs[i];
    const e = (sum[`${plane} ${foe} ${variant}`] ??= { k: 0, l: 0, fk: 0, fl: 0 });
    const me = res[i].stats[side];
    const them = res[i].stats[1 - side];
    e.k += me.airKills; e.l += me.deaths + res[i].perSide;
    e.fk += them.airKills; e.fl += them.deaths + res[i].perSide;
  }
  console.log(`kills per life: plane flying style ${style} (height ${over}) / its trained tactics, against each opponent's trained tactics; ${seeds} seeds x 2 sides, ${minutes} min, 2v2 arena`);
  for (const plane of planes) {
    console.log(plane);
    for (const foe of vs) {
      const a = sum[`${plane} ${foe} style`];
      const b = sum[`${plane} ${foe} trained`];
      const f = (x) => `${(x.k / x.l).toFixed(2)} vs ${(x.fk / x.fl).toFixed(2)}`;
      console.log(`  v ${foe.padEnd(9)} style: ${f(a)}   trained: ${f(b)}   gain ${(a.k / a.l - b.k / b.l >= 0 ? '+' : '')}${(a.k / a.l - b.k / b.l).toFixed(2)}`);
    }
  }
  process.exit(0);
}

const jobs = [];
for (const plane of planes) {
  // Both sides keep the plane's own trained values; only style and height differ.
  const base = tacticsIn(content.tactics, plane);
  const table = (t) => ({ default: content.tactics.default, planes: { ...content.tactics.planes, [plane]: t } });
  const bnz = table({ ...base, style, heightOver: Math.max(base.heightOver, over), ...extra });
  const turn = table({ ...base, style: 0 });
  for (let i = 0; i < seeds; i++) {
    for (const side of [0, 1]) {
      jobs.push({ plane, side, a: plane, b: plane, seed: 500 + i, minutes, perSide: 2, skill: 'normal', map: 'countryside', sample: 30, arena: true, tactics: side === 0 ? [bnz, turn] : [turn, bnz] });
    }
  }
}
const res = new Array(jobs.length);
await runPool(jobs, Math.max(1, availableParallelism() - 1), 'countryside', (i, r) => { res[i] = r; });
const sum = {};
for (let i = 0; i < jobs.length; i++) {
  const { plane, side } = jobs[i];
  const r = res[i];
  sum[plane] ??= [0, 1].map(() => ({ kills: 0, deaths: 0, own: 0, above: 0, lives: 0, shots: 0, hits: 0 }));
  for (const [who, team] of [[0, side], [1, 1 - side]]) { // who 0: boom and zoom, 1: turn fighter
    const s = r.stats[team];
    const e = sum[plane][who];
    e.kills += s.airKills; e.deaths += s.deaths; e.own += s.deathBy.crash + s.deathBy.collision + s.deathBy.other;
    e.above += s.killsAbove; e.lives += s.deaths + r.perSide; e.shots += s.shots; e.hits += s.hits;
  }
}
console.log(`style ${style} (height ${over}) ${JSON.stringify(extra)} vs style 0, same plane, ${seeds} seeds x 2 sides, ${minutes} min, 2v2 arena`);
for (const [plane, [b, t]] of Object.entries(sum)) {
  const f = (e) => `kills/life ${(e.kills / e.lives).toFixed(2)} (kills ${e.kills}, deaths ${e.deaths}, own-fault ${e.own}, from above ${e.above}, hit ${(100 * e.hits / Math.max(1, e.shots)).toFixed(1)}%)`;
  console.log(`${plane}\n  B&Z : ${f(b)}\n  turn: ${f(t)}`);
}
