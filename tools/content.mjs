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

// FF_WEAPONS='{"hispano_20":{"damage":2.7}}': { weaponId: { field: value } } over data/weapons.json, for
// trying a gun change in the tools (every plane carrying that gun gets it).
function weaponsWithEnv(weapons) {
  const env = process.env.FF_WEAPONS ? JSON.parse(process.env.FF_WEAPONS) : null;
  if (!env) return weapons;
  for (const [id, v] of Object.entries(env)) {
    if (!weapons[id]) throw new Error(`FF_WEAPONS: no weapon ${id}`);
    weapons[id] = { ...weapons[id], ...v };
  }
  return weapons;
}

export function loadContent(maps = ['countryside']) {
  const content = cleanContent({
    planes: readJson('data/planes.json'),
    weapons: weaponsWithEnv(readJson('data/weapons.json')),
    ground: readJson('data/ground.json'),
    settings: readJson('data/settings.json'),
    tactics: readJson('data/bot-tactics.json'),
    maps: Object.fromEntries(maps.map((m) => [m, readJson(`maps/${m}.ldtk`)])),
  });
  const tuned = envOverrides();
  if (tuned) content.planeDefs = applyOverrides(content.planeDefs, tuned);
  // FF_TACTICS: { planeId: { knob: value } } over data/bot-tactics.json, for trying a tactic in the tools.
  const tac = process.env.FF_TACTICS ? JSON.parse(process.env.FF_TACTICS) : null;
  if (tac) content.tactics = { ...content.tactics, planes: Object.fromEntries(Object.entries({ ...content.tactics?.planes, ...tac })
    .map(([id, v]) => [id, { ...content.tactics?.planes?.[id], ...v }])) };
  // FF_FLIGHT: { key: value } over settings.flight (thin air, src/sim/air.js), for trying flight rules in the tools.
  if (process.env.FF_FLIGHT) content.settings = { ...content.settings, flight: { ...content.settings.flight, ...JSON.parse(process.env.FF_FLIGHT) } };
  return content;
}
