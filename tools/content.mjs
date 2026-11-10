// Loads the data files as the balance tools want them (shared; no worker code, so a worker may import it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { cleanContent } from '../src/balance/plan.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

export function loadContent(maps = ['countryside']) {
  return cleanContent({
    planes: readJson('data/planes.json'),
    weapons: readJson('data/weapons.json'),
    ground: readJson('data/ground.json'),
    settings: readJson('data/settings.json'),
    tactics: readJson('data/bot-tactics.json'),
    maps: Object.fromEntries(maps.map((m) => [m, readJson(`maps/${m}.ldtk`)])),
  });
}
