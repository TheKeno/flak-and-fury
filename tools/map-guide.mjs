// Draws the background guide image an LDtk map shows behind its objects: the game's hills (built from
// the map's seed), the runways and the ceiling, so objects can be placed on the ground line.
// The hills aren't stored in the map, so run this again after changing the seed, terrain or airfields:
//   node tools/map-guide.mjs countryside
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { importLdtk } from '../src/content/ldtk.js';
import { buildTerrain } from '../src/sim/terrain.js';
import { encodePngRgba } from './png.mjs';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function writeGuide(ldtkUrl) {
  const project = JSON.parse(readFileSync(ldtkUrl, 'utf8'));
  const level = project.levels[0];
  const map = importLdtk(project);
  const terrain = buildTerrain(structuredClone(map));
  const w = level.pxWid;
  const h = level.pxHei;
  const rgba = new Uint8Array(w * h * 4);
  const sky = hex(map.sky.low);
  const above = hex(map.sky.space);
  for (let x = 0; x < w; x++) {
    const ground = terrain.heightAt(x + 0.5);
    const runway = map.airfields.some((a) => x >= a.x && x < a.x + a.width);
    for (let r = 0; r < h; r++) {
      const y = h - r - 0.5; // world height of this row
      let c;
      if (y > ground) {
        c = y > map.ceiling ? above : sky;
        if (x % 500 === 0) c = c.map((v) => v * 0.8); // distance ticks every 500 units
        else if (x % 100 === 0) c = c.map((v) => v * 0.92);
        if (Math.abs(y - map.ceiling) < 1) c = [200, 60, 60];
      } else if (ground - y < 2) c = runway ? [156, 154, 142] : [158, 196, 92];
      else c = ground - y < 6 ? (runway ? [106, 104, 94] : [122, 168, 71]) : [107, 82, 54];
      rgba.set([...c.map(Math.round), 255], (r * w + x) * 4);
    }
  }
  const out = new URL(level.bgRelPath, ldtkUrl);
  writeFileSync(out, encodePngRgba(w, h, rgba));
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const name = process.argv[2] ?? 'countryside';
  const out = writeGuide(new URL(`../maps/${name}.ldtk`, import.meta.url));
  console.log(`wrote ${fileURLToPath(out)}`);
}
