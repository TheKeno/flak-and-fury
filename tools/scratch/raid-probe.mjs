// Scratch: fly raids headless and print what happens. node tools/scratch/raid-probe.mjs [flak|noflak] [seeds]
import { readFileSync } from 'node:fs';
import { importLdtk } from '../../src/content/ldtk.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
const load = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const mode = process.argv[2] ?? 'flak';
const seeds = Number(process.argv[3] ?? 6);
const verbose = process.argv.includes('-v');
const groundDefs = load('data/ground.json'); delete groundDefs._notes;
const settings = load('data/settings.json');
if (process.env.FLAK) Object.assign(groundDefs.flak, JSON.parse(process.env.FLAK));
const over = process.env.RAIDS ? JSON.parse(process.env.RAIDS) : {};
const tot = [0, 1].map(() => ({ sent: 0, abort: 0, home: 0, lostIn: 0, lostOut: 0, bombs: 0, dmg: 0, n: 0 }));
for (let seed = 1; seed <= seeds; seed++) {
  const world = createWorld({ map: importLdtk(load('maps/countryside.ldtk')), planeDefs: load('data/planes.json'), weapons: load('data/weapons.json'), groundDefs,
    flight: settings.flight, raids: { ...settings.raids, first: 1, interval: 1000, ...over }, waves: { ...settings.waves, first: 1e9 }, seed });
  if (mode === 'noflak') for (const o of world.ground) if (o.type === 'flak') o.alive = false;
  const hp0 = new Map(world.ground.map((o) => [o.id, o.hp]));
  const bombed = new Set();
  for (let t = 0; t < 60 * 150; t++) {
    stepWorld(world, {});
    for (const e of world.events) {
      if (e.type === 'raidWarning' && verbose) console.log(seed, (t / 60).toFixed(1), 'warning', e.team, e.kind);
      if (e.type === 'raidIn') tot[e.team].sent += world.planes.filter((p) => p.raid?.id === e.raid).length, tot[e.team].n++;
      if (e.type === 'raidBombs') bombed.add(e.plane);
      if (e.type === 'bombRelease') { const p = world.planes.find((q) => q.id === e.plane); if (p) tot[p.team].bombs++; }
      if (e.type === 'raidAbort') tot[e.team].abort++;
      if (e.type === 'raidHome') tot[e.team].home++;
      if (e.type === 'shotDown') { const p = world.planes.find((q) => q.id === e.plane); if (p?.raid) { tot[p.team][bombed.has(p.id) ? 'lostOut' : 'lostIn']++; if (verbose) console.log(seed, (t / 60).toFixed(1), 'down', p.team, Math.round(e.x), Math.round(e.y), bombed.has(p.id) ? 'after bombing' : 'before'); } }
      if (verbose && ['raidBombs', 'raidHome', 'raidOver'].includes(e.type)) console.log(seed, (t / 60).toFixed(1), e.type, e.team, Math.round(e.x ?? 0));
    }
    if (verbose && t % 300 === 0) for (const p of world.planes) console.log('  ', (t / 60).toFixed(0), p.team, Math.round(p.x), Math.round(p.y), Math.round(p.speed), p.raid.phase, Math.round(p.hp), p.throttle.toFixed(2));
  }
  for (const o of world.ground) if ((o.type === 'depot' || o.type === 'radar') && o.hp < hp0.get(o.id)) { tot[1 - o.team].dmg += (hp0.get(o.id) - Math.max(0, o.hp)) / o.maxHp; if (verbose) console.log(seed, o.type, o.team, Math.round(o.hp), '/', o.maxHp); }
}
for (const t of [0, 1]) console.log(mode, 'team', t, JSON.stringify(tot[t]), 'target damage per raid', (tot[t].dmg / tot[t].n).toFixed(2));
