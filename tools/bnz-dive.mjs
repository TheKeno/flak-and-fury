// One diving bot's passes tick by tick: distance, nose error against the true lead, speed, closing
// speed, whether it fires. For the dive-from-height tactic (style 0.5+).
//
//   node tools/bnz-dive.mjs [plane] [--seed N] [--minutes N] [--style S]
import { loadContent } from './balance.mjs';
import { buildWorld } from '../src/balance/runner.js';
import { setBots, stepWorld, TICK_RATE } from '../src/sim/world.js';
import { tacticsIn } from '../src/sim/tactics.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const plane = args.find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a)) ?? 'p47d';
const content = loadContent();
const base = tacticsIn(content.tactics, plane);
const table = (t) => ({ default: content.tactics.default, planes: { ...content.tactics.planes, [plane]: t } });
const world = buildWorld(content, { seed: opt('--seed', 500), arena: true, tactics: [table({ ...base, style: opt('--style', 0.5), heightOver: 0 }), table({ ...base, style: 0 })] });
for (const team of [0, 1]) setBots(world, { team, count: 2, skill: 'normal', defId: plane, nation: content.planeDefs[plane].nation });
let watch = null;
let was = false;
for (let t = 0; t < opt('--minutes', 4) * 60 * TICK_RATE; t++) {
  stepWorld(world, {});
  if (!watch || watch.state !== 'air') watch = world.planes.find((p) => p.team === 0 && p.state === 'air' && p.bot);
  if (!watch) continue;
  const b = watch.bot;
  const dive = b.mode === 'chase' && b.zoom?.phase === 'dive';
  const o = world.planes.find((q) => q.id === b.target);
  if (dive && o) {
    if (!was) console.log('--- dive');
    const fired = world.events.some((e) => e.type === 'shot' && e.plane === watch.id && !e.gunner);
    if (t % 15 === 0 || fired) {
      const los = Math.atan2(o.y - watch.y, o.x - watch.x);
      const closing = ((o.x - watch.x) * (watch.vx - o.vx) + (o.y - watch.y) * (watch.vy - o.vy)) / Math.hypot(o.x - watch.x, o.y - watch.y);
      console.log(`d ${Math.hypot(o.x - watch.x, o.y - watch.y).toFixed(0).padStart(4)} speed ${watch.speed.toFixed(0)} closing ${closing.toFixed(0).padStart(4)} noseVsLos ${(((watch.angle - los + 3 * Math.PI) % (2 * Math.PI)) - Math.PI).toFixed(2)} dh ${(watch.y - o.y).toFixed(0)} tgtSpeed ${o.speed.toFixed(0)} ${fired ? 'FIRE' : ''}`);
    }
  }
  was = dive && !!o;
}
