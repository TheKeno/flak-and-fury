// Probe one duel run: a compact line every half second for side a (and b's position). Debugging only.
//   node tools/probe-duel.mjs <duel id> [seed] [mirror 0/1] [seconds]
import { readFileSync } from 'node:fs';
import { loadContent } from './content.mjs';
import { runDuel } from '../src/balance/duel.js';
const [id, seed = '700', mir = '0', secs = '40'] = process.argv.slice(2);
const content = loadContent();
const duel = JSON.parse(readFileSync(new URL('../balance/duels.json', import.meta.url))).duels.find((d) => d.id === id);
const r = runDuel(content, { ...duel, seconds: Number(secs) }, {
  seed: Number(seed), mirror: mir === '1',
  onTick(world, [a, b], t) {
    if (t % 30) return;
    const g = (p) => Math.round(p.y - world.terrain.heightAt(p.x));
    const ph = a.bot?.mode === 'chase' && a.bot.zoom ? a.bot.zoom.phase : a.bot?.mode;
    const deg = (x) => Math.round((x * 180) / Math.PI);
    console.log(`${(t / 60).toFixed(1)} ${ph} h${g(a)} v${Math.round(a.speed)}/${Math.round(a.def.stallSpeed)} ang${deg(a.angle)} ${a.stalled ? 'STALL' : ''} | b ${b.bot?.mode} dx${Math.round(b.x - a.x)} dy${Math.round(b.y - a.y)} v${Math.round(b.speed)} ${b.stalled ? 'STALL' : ''} hp ${Math.round(a.hp)}/${Math.round(b.hp)}`);
  },
});
console.log(r.winner, r.how, r.time);
