// Energy trace of one boom-and-zoom bot: speed and height through its dive and zoom phases, in the
// air-only arena against turn-fighting bots in the same plane. Prints one line per phase.
//
//   node tools/bnz-trace.mjs [plane] [--seed N] [--minutes N] [--over H]
import { loadContent, } from './balance.mjs';
import { buildWorld } from '../src/balance/runner.js';
import { setBots, stepWorld, TICK_RATE } from '../src/sim/world.js';
import { tacticsIn } from '../src/sim/tactics.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const plane = args.find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a)) ?? 'p47d';
const over = opt('--over', 150);
const content = loadContent();
const base = tacticsIn(content.tactics, plane);
const table = (t) => ({ default: content.tactics.default, planes: { ...content.tactics.planes, [plane]: t } });
const world = buildWorld(content, { seed: opt('--seed', 500), arena: true, tactics: [table({ ...base, style: 1, heightOver: Math.max(base.heightOver, over) }), table({ ...base, style: 0 })] });
for (const team of [0, 1]) setBots(world, { team, count: 2, skill: 'normal', defId: plane, nation: content.planeDefs[plane].nation });

const ticks = opt('--minutes', 4) * 60 * TICK_RATE;
let watch = null; // the first team-0 plane in the air
let seg = null;
const out = [];
const close = (why) => {
  if (!seg) return;
  const s = seg;
  out.push(`${s.phase.padEnd(6)} ${((world.tick - s.t0) / TICK_RATE).toFixed(1).padStart(5)} s  speed ${s.v0.toFixed(0)}->${watch.speed.toFixed(0)} (max ${s.vmax.toFixed(0)}, min ${s.vmin.toFixed(0)})  height ${s.h0.toFixed(0)}->${watch.y.toFixed(0)}  over enemy ${s.over0.toFixed(0)}  closest ${s.dmin.toFixed(0)}  firing ${(s.fire / TICK_RATE).toFixed(1)} s  ${why ?? ''}`);
  seg = null;
};
for (let t = 0; t < ticks; t++) {
  stepWorld(world, {});
  if (!watch) watch = world.planes.find((p) => p.team === 0 && p.state === 'air' && p.bot);
  if (!watch) continue;
  if (watch.state !== 'air') {
    close(`-> ${watch.state}`);
    out.push(`--- plane ${watch.state} at ${(world.tick / TICK_RATE).toFixed(0)} s`);
    watch = null;
    continue;
  }
  const b = watch.bot;
  const phase = b.mode === 'chase' ? (b.zoom?.phase ?? 'chase') : b.mode;
  const tgt = world.planes.find((p) => p.id === b.target);
  if (!seg || seg.phase !== phase) {
    close();
    seg = { phase, t0: world.tick, v0: watch.speed, vmax: watch.speed, vmin: watch.speed, h0: watch.y, over0: tgt ? watch.y - tgt.y : 0, fire: 0, dmin: Infinity };
  }
  seg.vmax = Math.max(seg.vmax, watch.speed);
  seg.vmin = Math.min(seg.vmin, watch.speed);
  if (tgt) seg.dmin = Math.min(seg.dmin, Math.hypot(tgt.x - watch.x, tgt.y - watch.y));
  if (world.events.some((e) => e.type === 'shot' && e.plane === watch.id && !e.gunner)) seg.fire++;
}
close('(end)');
console.log(out.filter((l) => !/^\S+\s+0\.[0-2] s/.test(l)).join('\n'));
