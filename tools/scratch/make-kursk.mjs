// ONE-OFF: made maps/kursk.ldtk once (2026-11-17) from the layout in ROADMAP.md (Decisions, "Kursk map, first
// pass"). The map is now the owner's, edited in LDtk: never run this again over it (it refuses if the file exists).

//   node tools/scratch/make-kursk.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { importLdtk, GROUND_ENTITIES } from '../../src/content/ldtk.js';
import { buildTerrain, structurePads } from '../../src/sim/terrain.js';

const root = new URL('../../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const OUT = new URL('maps/kursk.ldtk', root);
if (existsSync(OUT)) throw new Error('maps/kursk.ldtk exists: it is the owner\'s now, edit it in LDtk');

const W = 6000;
const H = 800;
const groundDefs = read('data/ground.json');
const settings = read('data/settings.json');

// --- The layout: Germany (team 0) on the left. Each side's half is listed for Germany and mirrored. ---
// [piece, x, extra fields]. Scenery has no team.
const german = [
  ['Radar', 60],
  ['Windsock', 600],
  ['Flak', 640], ['LightFlak', 700], ['Flak', 770],
  ['Tent', 830], ['Tent', 860], ['Stores', 895],
  ['Flak', 1130], ['Depot', 1200], ['Flak', 1275], ['Tent', 1320],
  // The forward position: an izba village (houses from the zone), the orchard east of it with the Pak line.
  ['Windmill', 1570],
  ['LightFlak', 1650], ['LightFlak', 1790], ['MgNest', 1845],
  ['Infantry', 1905, { squad: 8 }],
  ['LightFlak', 1935], ['AtGun', 1990], ['AtGun', 2055],
  ['Dugout', 2100], ['MgNest', 2130], ['Infantry', 2160, { squad: 8 }], ['Wire', 2190], ['Hedgehog', 2215],
];
const orchard = [1870, 1882, 1958, 1968, 2018, 2030, 2078]; // apple trees between the guns
// The Soviet forward position mirrors the German one, but in its own look: trenches' dugouts and wire, the
// ZiS-3 battery down in a balka where the Germans have their orchard, a church where they have a windmill.
const swapForSoviets = { Windmill: 'Church' };
const sovietExtra = [['MineSign', 3835], ['Dugout', 3880], ['Wire', 3772]];

// The middle belongs to nobody: station, water tower and grain elevator west of Hill 252.2, a windmill-less
// bare hilltop, the collective farm east of it; telegraph poles along the railway.
const middle = [
  ['Stooks', 2226], ['Stooks', 2650],
  ['WaterTower', 2690], ['Station', 2735], ['Elevator', 2800], ['TradeRow', 2840],
  ['TownRuin', 2870],
  ['Cowshed', 3175], ['Haystack', 3215], ['Cowshed', 3250], ['Shed', 3295], ['Well', 3320],
  ['Sunflowers', 3338], ['Sunflowers', 3350], ['Sunflowers', 3775],
];
for (const x of [2655, 2875, 3135, 3345]) middle.push(['TelegraphPole', x]); // fields stay clear to land on

const zones = [
  ['Balka', 930, 130], ['Wood', 1240, 70],
  ['Village', 1590, 230],
  ['Field', 2240, 400], // wheat
  ['Village', 2660, 160], // the station hamlet
  ['Ridge', 2880, 240], // Hill 252.2
  ['Field', 3360, 400], // sunflowers
];
const mirrorZone = ([t, x, w]) => [t, W - x - w, w];
const sovietZones = [['Balka', 930, 130], ['Wood', 1240, 70], ['Village', 1590, 230], ['Balka', 1870, 220]].map(mirrorZone);

// --- Build the project from countryside's definitions. ---
const project = read('maps/countryside.ldtk');
let uid = project.nextUid;
const defs = project.defs;

function addBalkaDef(p) {
  if (p.defs.entities.some((e) => e.identifier === 'Balka')) return;
  const ridge = p.defs.entities.find((e) => e.identifier === 'Ridge');
  p.defs.entities.splice(p.defs.entities.indexOf(ridge) + 1, 0, {
    ...structuredClone(ridge), identifier: 'Balka', uid: p.nextUid++, color: '#5A4E3A',
    doc: 'A dry steppe ravine cut below the ground (settings zones: balkaDepth, balkaSide). Guns in it stand on its floor.',
  });
}
addBalkaDef(project);
uid = project.nextUid;

// A level field for the look of the country ('steppe').
const skyLow = defs.levelFields.find((f) => f.identifier === 'skyLow');
const styleDef = { ...structuredClone(skyLow), identifier: 'style', __type: 'String', type: 'F_String', uid: uid++, doc: "The look of the country: 'steppe' or empty." };
defs.levelFields.push(styleDef);

const nationEnum = defs.enums.find((e) => e.identifier === 'Nation');
const nationValue = (n) => nationEnum.values.find((v) => v.id.toLowerCase() === n).id;

const level = project.levels[0];
project.iid = randomUUID();
project.nextUid = uid + 1;
level.identifier = 'Kursk';
level.iid = randomUUID();
level.pxWid = W;
level.pxHei = H;
level.bgRelPath = 'kursk-guide.png';
level.__bgPos = level.__bgPos && { ...level.__bgPos, cropRect: [0, 0, W, H] };
const setField = (id, v) => {
  const f = level.fieldInstances.find((x) => x.__identifier === id);
  f.__value = v;
  f.realEditorValues = [{ id: typeof v === 'number' ? 'V_Int' : 'V_String', params: [v] }];
};
// Summer 1943: dust in the air, a pale washed-out sky.
setField('seed', 1943);
setField('terrainBase', 30);
setField('terrainAmplitude', 60);
for (const [id, hex] of [['skyLow', '#857f72'], ['skyHigh', '#4a4f55'], ['skySpace', '#161a20']]) {
  const f = level.fieldInstances.find((x) => x.__identifier === id);
  f.__value = hex;
  f.realEditorValues = [{ id: 'V_Int', params: [parseInt(hex.slice(1), 16)] }];
}
level.fieldInstances.push({ __identifier: 'style', __type: 'String', __value: 'steppe', __tile: null, defUid: styleDef.uid, realEditorValues: [{ id: 'V_String', params: ['steppe'] }] });

const [objects, zoneLayer] = level.layerInstances;
const template = Object.fromEntries(objects.entityInstances.map((e) => [e.__identifier, e]));
for (const L of level.layerInstances) {
  L.iid = randomUUID();
  L.__cWid = Math.ceil(W / L.__gridSize);
  L.entityInstances = [];
}
const piece = (id) => {
  const d = defs.entities.find((e) => e.identifier === id);
  if (!d) throw new Error(`no LDtk piece ${id}`);
  return d;
};

// x: the centre of a fixed-size piece, the left edge of a stretched one (airfield, zone).
function entity(id, x, y, width, fields = {}) {
  const d = piece(id);
  const w = width ?? d.width;
  const left = width == null ? x - w / 2 : x;
  const px = [Math.round(left + d.pivotX * w), Math.round(y)];
  const fieldInstances = d.fieldDefs.map((fd) => {
    const v = fields[fd.identifier];
    const old = template[id]?.fieldInstances.find((f) => f.__identifier === fd.identifier);
    const f = old ? structuredClone(old) : { __identifier: fd.identifier, __type: fd.__type, __tile: null, defUid: fd.uid };
    if (v !== undefined) {
      f.__value = v;
      f.realEditorValues = [{ id: typeof v === 'number' ? 'V_Int' : 'V_String', params: [v] }];
    }
    return f;
  });
  return {
    __identifier: id, __grid: [Math.floor(px[0] / 2), Math.floor(px[1] / 2)], __pivot: [d.pivotX, d.pivotY], __tags: [], __tile: null,
    __smartColor: d.color, iid: randomUUID(), width: w, height: d.height, defUid: d.uid, px, fieldInstances,
  };
}

const team = (t) => `Team_${t}`;
const placed = []; // [id, centre x, fields]
for (const [id, x, f = {}] of german) {
  const scenery = !piece(id).fieldDefs.some((fd) => fd.identifier === 'team');
  placed.push([id, x, scenery ? f : { team: team(0), ...f }]);
  placed.push([swapForSoviets[id] ?? id, W - x, scenery ? f : { team: team(1), ...f }]);
}
for (const x of orchard) placed.push(['AppleTree', x, {}]);
for (const [id, x] of sovietExtra) placed.push([id, x, {}]);
for (const [id, x] of middle) placed.push([id, x, {}]);
// Birches down in the Soviet battery's balka, scrub in the open-steppe balkas.
for (const x of [6000 - 1880, 6000 - 2075]) placed.push(['Birch', x, {}]);

// Airfields are placed by their left edge, everything else by its centre.
const airfields = [[140, 0, 'germany'], [W - 140 - 420, 1, 'ussr']];

// --- Ground heights for the y positions (only x matters to the game; y puts the pieces on the guide's ground line). ---
const map = {
  width: W, seed: 1943, terrain: { base: 30, amplitude: 60 },
  airfields: airfields.map(([x, t]) => ({ x, width: 420, team: t })),
  rivers: [],
  zones: [...zones, ...sovietZones].map(([t, x, w]) => ({ type: t.toLowerCase(), x, width: w })),
  ground: placed.map(([id, x]) => ({ type: GROUND_ENTITIES[id], x })),
};
const terrainFor = (seed) => buildTerrain(structuredClone({ ...map, seed }), structurePads(map, groundDefs, settings.pads), settings.zones);
// Pick the seed that makes the middle a hill: Hill 252.2 standing well above the station and the farm.
let best = { seed: 1943, score: -Infinity };
for (let seed = 1943; seed < 2343; seed++) {
  const t = terrainFor(seed);
  const top = Math.max(...[2960, 3000, 3040].map(t.heightAt));
  const score = top - Math.max(t.heightAt(2740), t.heightAt(3250)) - 0.3 * Math.abs(t.heightAt(3000) - top);
  if (score > best.score) best = { seed, score, top };
}
console.log('seed', best.seed, 'hill stands', best.score.toFixed(1), 'above the station and the farm');
map.seed = best.seed;
setField('seed', best.seed);
const terrain = terrainFor(best.seed);
const yAt = (x) => H - Math.round(terrain.heightAt(x));

for (const [x, t, nation] of airfields) {
  objects.entityInstances.push(entity('Airfield', x, yAt(x + 210), 420, { team: team(t), nation: nationValue(nation) }));
}
placed.sort((a, b) => a[1] - b[1]);
for (const [id, x, f] of placed) objects.entityInstances.push(entity(id, x, yAt(x), undefined, f));
for (const [t, x, w] of [...zones, ...sovietZones].sort((a, b) => a[1] - b[1])) zoneLayer.entityInstances.push(entity(t, x, H - 10, w));

writeFileSync(OUT, JSON.stringify(project, null, '	') + '\n');

// Check: the game reads it back as laid out.
const back = importLdtk(JSON.parse(readFileSync(OUT, 'utf8')));
const count = {};
for (const o of back.ground) count[o.type] = (count[o.type] ?? 0) + 1;
console.log(back.name, back.width, back.style, JSON.stringify(back.airfields));
console.log(JSON.stringify(count));
console.log(back.zones.map((z) => `${z.type}@${z.x}+${z.width}`).join(' '));
