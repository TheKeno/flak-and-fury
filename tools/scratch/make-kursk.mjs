// ONE-OFF: made maps/kursk.ldtk from the layouts in ROADMAP.md: the blockout (2026-11-17, Decisions "Kursk map,
// first pass") and once more, 10,000 wide (2026-11-24, Decisions "Kursk map: longer, spaced out, a railway, tanks
// by train", build 1). The map is the owner's now, edited in LDtk: never run this again over it (it refuses if
// the file exists).
//   node tools/scratch/make-kursk.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { importLdtk, GROUND_ENTITIES } from '../../src/content/ldtk.js';
import { buildTerrain, structurePads } from '../../src/sim/terrain.js';
import { writeGuide } from '../map-guide.mjs';

const root = new URL('../../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const OUT = new URL('maps/kursk.ldtk', root);
if (existsSync(OUT)) throw new Error('maps/kursk.ldtk exists: it is the owner\'s now, edit it in LDtk');

const W = 10000;
const C = W / 2;
const H = 800;
const AMPLITUDE = 12; // the steppe's own ups and downs: gentle, a train must climb all of it
const groundDefs = read('data/ground.json');
const settings = read('data/settings.json');

// --- The layout: Germany (team 0) on the left. Each side's half is listed for Germany and mirrored. ---
// From the edge inward: airfield (140-900), an open run of about 1700 with a balka, the depot (2280-2470), the
// forward position (2705-3350) with a railway balka at its front, about 500 of no man's land, then the middle
// (3850-6150): wheat, the long rise of Hill 252.2 with the station town on its crest in the exact centre, the
// collective farm at the rise's Soviet foot (slope under 0.05), sunflowers.
// [piece, x, extra fields]. Scenery has no team.
const german = [
  ['Radar', 60],
  ['Windsock', 600],
  ['Flak', 640], ['LightFlak', 700], ['Flak', 770],
  ['Tent', 830], ['Tent', 860], ['Stores', 895],
  ['Flak', 2280], ['Depot', 2350], ['Flak', 2425], ['Tent', 2470],
  // The forward position: an izba village (houses from the zone) with the windmill, the orchard east of it with
  // the Pak line, looking over the railway balka.
  ['Windmill', 2705],
  ['LightFlak', 2785], ['LightFlak', 2925], ['MgNest', 2980],
  ['Infantry', 3040, { squad: 8 }],
  ['LightFlak', 3070], ['AtGun', 3125], ['AtGun', 3190],
  ['Dugout', 3235], ['MgNest', 3265], ['Infantry', 3295, { squad: 8 }], ['Wire', 3325], ['Hedgehog', 3350],
];
const orchard = [3005, 3017, 3093, 3103, 3153, 3165, 3213]; // apple trees between the guns
// The Soviet forward position mirrors the German one in its own look: dugouts, wire and a mine sign, the ZiS-3
// battery dug in on the open steppe behind its balka with birches, a church where the Germans have a windmill.
const swapForSoviets = { Windmill: 'Church' };
const sovietExtra = [['MineSign', W - 3300], ['Dugout', W - 3255], ['Wire', W - 3363]];
const sovietBirches = [W - 3015, W - 3210];

// The middle belongs to nobody: the station town on the crest (grain elevator in the exact centre, the landmark
// seen from both airfields), the collective farm at the rise's foot, telegraph poles by the line.
const middle = [
  ['Stooks', 3836], ['Stooks', 4294],
  ['WaterTower', 4910], ['Station', 4950], ['Elevator', C], ['TradeRow', 5045], ['TownRuin', 5090],
  ['Cowshed', 5585], ['Cowshed', 5645], ['Haystack', 5683], ['Well', 5700],
  ['Sunflowers', 6160], ['Sunflowers', 6172],
];
for (const x of [4310, 4600, 5400, 5540]) middle.push(['TelegraphPole', x]); // fields stay clear to land on

// Zones: [type, left edge, width, height (Rise only)]. Balkas are exactly 80 wide, the railway bridge's span.
const BALKA = 80;
const germanZones = [
  ['Balka', 1560, BALKA], // in the open run
  ['Wood', 2390, 70], // the depot's tree belt
  ['Rise', 2550, 1000, -12], // a slight dip at the forward position
  ['Village', 2725, 230],
  ['Balka', 3380, BALKA], // the railway balka in front of the Pak line, the forward position's landmark
];
const middleZones = [
  ['Field', 3850, 430], // wheat, a runway long to land on
  ['Rise', 4300, 1400, 40], // Hill 252.2: a long gentle rise, its crest in the exact centre
  ['Village', 4860, 280], // the station town
  ['Field', 5720, 430], // sunflowers
];
const mirrorZone = ([t, x, w, h]) => (h == null ? [t, W - x - w, w] : [t, W - x - w, w, h]);
const zones = [...germanZones, ...germanZones.map(mirrorZone), ...middleZones];

// The railway: whole track from each edge through the airfield and the depot to the station town, a trestle
// bridge over every balka (its ends at x +- 46, where the track stops), torn track in no man's land.
const bridges = zones.filter(([t]) => t === 'Balka').map(([, x]) => x + BALKA / 2).sort((a, b) => a - b);
const noMansLand = [[3466, 3850], [6150, W - 3466]];
const LENGTH = 48;
const track = []; // [piece, x]
function lay(a, b, torn) {
  // Lengths end to end from a to b; the last ones close up a little where 48 doesn't divide the stretch.
  const n = Math.ceil((b - a) / LENGTH);
  const step = n > 1 ? (b - a - LENGTH) / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    // Here and there a length is gone altogether, blown off the bed.
    if (torn && i % 4 === 2) continue;
    track.push([torn ? 'TrackTorn' : 'Track', Math.round(a + LENGTH / 2 + i * step)]);
  }
}
let from = 0;
for (const bx of [...bridges, W + 46]) {
  const to = bx - 46;
  // Split each stretch where no man's land begins and ends.
  const cuts = [from, ...noMansLand.flat().filter((c) => c > from && c < to), to];
  for (let i = 0; i < cuts.length - 1; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    lay(cuts[i], cuts[i + 1], noMansLand.some(([a, b]) => mid > a && mid < b));
  }
  from = bx + 46;
}

// --- Build the project from countryside's definitions. ---
const project = read('maps/countryside.ldtk');
const defs = project.defs;

// The zone pieces countryside doesn't have: Balka (a dry ravine) and Rise (a long swell or a shallow dip).
function addZoneDef(p, identifier, color, doc, fields = []) {
  if (p.defs.entities.some((e) => e.identifier === identifier)) return;
  const ridge = p.defs.entities.find((e) => e.identifier === 'Ridge');
  p.defs.entities.splice(p.defs.entities.indexOf(ridge) + 1, 0, { ...structuredClone(ridge), identifier, uid: p.nextUid++, color, doc, fieldDefs: fields });
}
addZoneDef(project, 'Balka', '#5A4E3A', 'A dry steppe ravine cut below the ground (settings zones: balkaDepth, balkaSide). Guns in it stand on its floor.');
const squad = defs.entities.find((e) => e.identifier === 'Infantry').fieldDefs.find((f) => f.identifier === 'squad');
const heightDef = { ...structuredClone(squad), identifier: 'height', uid: project.nextUid++, min: -60, max: 200, defaultOverride: { id: 'V_Int', params: [40] },
  doc: 'How far the ground is lifted at the middle (negative: a dip). Steepest slope: height x 3.14 / width.' };
addZoneDef(project, 'Rise', '#7A6A48', 'A long, gentle swell of the land laid over the ground (half a cosine wave over its width), or a shallow dip.', [heightDef]);
let uid = project.nextUid;

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
setField('ceiling', 1200);
setField('terrainBase', 30);
setField('terrainAmplitude', AMPLITUDE);
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
    const f = old ? structuredClone(old) : { __identifier: fd.identifier, __type: fd.__type, __value: fd.defaultOverride?.params[0] ?? null, __tile: null, defUid: fd.uid, realEditorValues: [] };
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
for (const x of sovietBirches) placed.push(['Birch', x, {}]);
for (const [id, x] of sovietExtra) placed.push([id, x, {}]);
for (const [id, x] of middle) placed.push([id, x, {}]);
for (const x of bridges) placed.push(['RailBridge', x, {}]);
for (const [id, x] of track) placed.push([id, x, {}]);

// Airfields are placed by their left edge, everything else by its centre.
const airfields = [[140, 0, 'germany'], [W - 140 - 420, 1, 'ussr']];

// --- Ground heights for the y positions (only x matters to the game; y puts the pieces on the guide's ground line). ---
const map = {
  width: W, seed: 1943, terrain: { base: 30, amplitude: AMPLITUDE },
  airfields: airfields.map(([x, t]) => ({ x, width: 420, team: t })),
  rivers: [],
  zones: zones.map(([t, x, w, h]) => ({ type: t.toLowerCase(), x, width: w, height: h })),
  ground: placed.map(([id, x]) => ({ type: GROUND_ENTITIES[id], x })),
};
const inBalka = (x) => map.zones.some((z) => z.type === 'balka' && x > z.x - 70 && x < z.x + z.width + 70);
const terrainFor = (seed) => buildTerrain(structuredClone({ ...map, seed }), structurePads(map, groundDefs, settings.pads), settings.zones);
function slopes(t) {
  let worst = 0;
  let sum = 0;
  let n = 0;
  for (let x = 4; x <= W - 4; x += 4) {
    if (inBalka(x)) continue;
    const s = Math.abs(t.heightAt(x + 4) - t.heightAt(x - 4)) / 8;
    worst = Math.max(worst, s);
    sum += s;
    n++;
  }
  return { worst, mean: sum / n };
}
// Pick the seed with the gentlest steepest slope (balkas aside), the crest still standing at the centre.
let best = { seed: 1943, score: Infinity };
for (let seed = 1943; seed < 2343; seed++) {
  const t = terrainFor(seed);
  const s = slopes(t);
  const crest = t.heightAt(C) - Math.max(t.heightAt(C - 500), t.heightAt(C + 500));
  const score = 2 * s.worst + s.mean + (crest < 25 ? 1 : 0);
  if (score < best.score) best = { seed, score, ...s, crest };
}
console.log('seed', best.seed, 'steepest', best.worst.toFixed(3), 'mean', best.mean.toFixed(3), 'crest stands', best.crest.toFixed(1));
map.seed = best.seed;
setField('seed', best.seed);
const terrain = terrainFor(best.seed);
const yAt = (x) => H - Math.round(terrain.heightAt(x));

for (const [x, t, nation] of airfields) {
  objects.entityInstances.push(entity('Airfield', x, yAt(x + 210), 420, { team: team(t), nation: nationValue(nation) }));
}
placed.sort((a, b) => a[1] - b[1]);
for (const [id, x, f] of placed) objects.entityInstances.push(entity(id, x, yAt(x), undefined, f));
for (const [t, x, w, h] of [...zones].sort((a, b) => a[1] - b[1])) {
  zoneLayer.entityInstances.push(entity(t, x, H - 10, w, h == null ? {} : { height: h }));
}

writeFileSync(OUT, JSON.stringify(project, null, '	') + '\n');
writeGuide(OUT);

// Check: the game reads it back as laid out.
const back = importLdtk(JSON.parse(readFileSync(OUT, 'utf8')));
const count = {};
for (const o of back.ground) count[o.type] = (count[o.type] ?? 0) + 1;
console.log(back.name, back.width, back.style, back.ceiling, JSON.stringify(back.airfields));
console.log(JSON.stringify(count));
console.log(back.zones.map((z) => `${z.type}@${z.x}+${z.width}${z.height ? `^${z.height}` : ''}`).join(' '));
