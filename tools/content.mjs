// Loads the data files as the balance tools want them (shared; no worker code, so a worker may import it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { cleanContent } from '../src/balance/plan.js';
import { applyOverrides } from '../src/balance/levers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

// FF_PLANES='{"p47d":{"hp":0.95}}': tuned plane numbers (lever multipliers, src/balance/levers.js) for
// every tool that loads the data here: the auto-tuner's confirm runs fly the tuned planes this way
// (tools/balance.mjs, tools/duels.mjs and their worker threads, which share the environment).
export const envOverrides = () => (process.env.FF_PLANES ? JSON.parse(process.env.FF_PLANES) : null);

export function loadContent(maps = ['countryside']) {
  const content = cleanContent({
    planes: readJson('data/planes.json'),
    weapons: readJson('data/weapons.json'),
    ground: readJson('data/ground.json'),
    settings: readJson('data/settings.json'),
    tactics: readJson('data/bot-tactics.json'),
    maps: Object.fromEntries(maps.map((m) => [m, readJson(`maps/${m}.ldtk`)])),
  });
  const tuned = envOverrides();
  if (tuned) content.planeDefs = applyOverrides(content.planeDefs, tuned);
  return content;
}
