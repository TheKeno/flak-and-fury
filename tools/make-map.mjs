// Writes the starting LDtk project for the countryside map (maps/countryside.ldtk) and its guide image.
// Run once: node tools/make-map.mjs
// After that the .ldtk file is the map: edit it in LDtk. This tool refuses to overwrite it unless run
// with --force, which throws away every edit made in the editor.
import { existsSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildTerrain } from '../src/sim/terrain.js';
import { writeGuide } from './map-guide.mjs';

const OUT = new URL('../maps/countryside.ldtk', import.meta.url);
if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.error('maps/countryside.ldtk already exists (edit it in LDtk). Use --force to overwrite it.');
  process.exit(1);
}

const WIDTH = 3600;
const HEIGHT = 800; // level height in the editor: the ceiling plus some room above it
const SETTINGS = {
  seed: 1944,
  ceiling: 720,
  terrainBase: 30,
  terrainAmplitude: 70,
  skyLow: '#9cc4d8',
  skyHigh: '#3e6f9a',
  skySpace: '#1d3654',
};
const AIRFIELDS = [
  { x: 220, width: 420, team: 0, nation: 'Germany' },
  { x: 2960, width: 420, team: 1, nation: 'UK' },
];
// The west side's defences and targets, mirrored for the east side. [entity, x, fields]
const WEST_SIDE = [
  ['Radar', 150],
  ['Flak', 690],
  ['MgNest', 760],
  ['Tent', 820],
  ['Tent', 980],
  ['Flak', 1060],
  ['Tower', 1120],
  ['MgNest', 1180],
  ['Infantry', 1260, { squad: 5 }],
  ['Building', 1330],
  ['MgNest', 1420],
  ['Tent', 1470],
  ['Infantry', 1540, { squad: 4 }],
  ['Building', 1620],
];

// Entity types: [name, colour, width, height, doc, extra fields]
const ENTITIES = [
  ['Airfield', '#9C9A8E', 420, 8, 'Runway, hangar and ground crew. Stretch it to set the runway length.', ['nation']],
  ['Flak', '#E05040', 14, 9, 'Anti-aircraft gun: slow, accurate, reaches high. Fly low to dodge it.'],
  ['MgNest', '#E0A040', 12, 5, 'Machine-gun nest: fast bursts, short reach. Fly high to stay out of it.'],
  ['Infantry', '#C8B060', 22, 6, 'A squad of soldiers with rifles.', ['squad']],
  ['Tent', '#C8C090', 16, 8, 'Target.'],
  ['Tower', '#A07050', 10, 30, 'Watchtower. Target; planes that fly into it crash.'],
  ['Building', '#B0A080', 28, 18, 'Target; needs bombs. Planes that fly into it crash.'],
  ['Radar', '#60C0E0', 18, 40, "Radar station. Destroy the enemy's and their radar scope goes dark."],
];

let uid = 1;
const nextUid = () => uid++;

function fieldDef(identifier, type, typeName, extra = {}) {
  return {
    identifier,
    doc: extra.doc ?? null,
    __type: typeName,
    uid: nextUid(),
    type,
    isArray: false,
    canBeNull: false,
    arrayMinLength: null,
    arrayMaxLength: null,
    editorDisplayMode: extra.display ?? 'NameAndValue',
    editorDisplayScale: 1,
    editorDisplayPos: 'Beneath',
    editorLinkStyle: 'StraightArrow',
    editorDisplayColor: null,
    editorAlwaysShow: false,
    editorShowInWorld: true,
    editorCutLongValues: true,
    editorTextSuffix: null,
    editorTextPrefix: null,
    useForSmartColor: false,
    exportToToc: false,
    searchable: false,
    min: extra.min ?? null,
    max: extra.max ?? null,
    regex: null,
    acceptFileTypes: null,
    defaultOverride: extra.default ?? null,
    textLanguageMode: null,
    symmetricalRef: false,
    autoChainRef: false,
    allowOutOfLevelRef: true,
    allowedRefs: 'OnlySame',
    allowedRefsEntityUid: null,
    allowedRefTags: [],
    tilesetUid: null,
  };
}

const colourInt = (hex) => parseInt(hex.slice(1), 16);
function fieldInstance(def, value) {
  const editor =
    def.type === 'F_Int'
      ? { id: 'V_Int', params: [value] }
      : def.type === 'F_Float'
        ? { id: 'V_Float', params: [value] }
        : def.type === 'F_Color'
          ? { id: 'V_Int', params: [colourInt(value)] }
          : { id: 'V_String', params: [value] };
  return { __identifier: def.identifier, __type: def.__type, __value: value, __tile: null, defUid: def.uid, realEditorValues: [editor] };
}

function enumDef(identifier, values) {
  return {
    identifier,
    uid: nextUid(),
    values: values.map(([id, colour]) => ({ id, tileRect: null, color: colourInt(colour) })),
    iconTilesetUid: null,
    externalRelPath: null,
    externalFileChecksum: null,
    tags: [],
  };
}

const teamEnum = enumDef('Team', [['Team_0', '#D85040'], ['Team_1', '#4070D0']]);
const nationEnum = enumDef('Nation', [['Germany', '#5e6650'], ['UK', '#5b6b3f'], ['USA', '#9aa3a8'], ['Japan', '#c0262b'], ['Finland', '#2d5fa8'], ['USSR', '#c62a2a']]);

const levelFieldDefs = [
  fieldDef('seed', 'F_Int', 'Int', { doc: 'Shapes the hills. Run tools/map-guide.mjs after changing it.' }),
  fieldDef('ceiling', 'F_Int', 'Int', { doc: 'Blackout altitude (world units above the bottom of the level).' }),
  fieldDef('terrainBase', 'F_Int', 'Int', { doc: 'Lowest ground height.' }),
  fieldDef('terrainAmplitude', 'F_Int', 'Int', { doc: 'How tall the hills get.' }),
  fieldDef('skyLow', 'F_Color', 'Color'),
  fieldDef('skyHigh', 'F_Color', 'Color'),
  fieldDef('skySpace', 'F_Color', 'Color'),
];

const entityDefs = ENTITIES.map(([identifier, color, width, height, doc, extras = []]) => {
  const fieldDefs = [
    fieldDef('team', `F_Enum(${teamEnum.uid})`, 'LocalEnum.Team', { display: 'ValueOnly', default: { id: 'V_String', params: ['Team_0'] } }),
  ];
  if (extras.includes('nation')) fieldDefs.push(fieldDef('nation', `F_Enum(${nationEnum.uid})`, 'LocalEnum.Nation', { default: { id: 'V_String', params: ['Germany'] } }));
  if (extras.includes('squad')) fieldDefs.push(fieldDef('squad', 'F_Int', 'Int', { doc: 'Soldiers in the squad.', min: 1, max: 12, default: { id: 'V_Int', params: [4] } }));
  const airfield = identifier === 'Airfield';
  return {
    identifier,
    uid: nextUid(),
    tags: [],
    exportToToc: false,
    allowOutOfBounds: false,
    doc,
    width,
    height,
    resizableX: airfield,
    resizableY: false,
    minWidth: airfield ? 100 : null,
    maxWidth: null,
    minHeight: null,
    maxHeight: null,
    keepAspectRatio: false,
    tileOpacity: 1,
    fillOpacity: 0.45,
    lineOpacity: 1,
    hollow: false,
    color,
    renderMode: 'Rectangle',
    showName: true,
    tilesetId: null,
    tileRenderMode: 'FitInside',
    tileRect: null,
    uiTileRect: null,
    nineSliceBorders: [],
    maxCount: 0,
    limitScope: 'PerLevel',
    limitBehavior: 'MoveLastOne',
    pivotX: airfield ? 0 : 0.5,
    pivotY: 1,
    fieldDefs,
  };
});

const layerDef = {
  __type: 'Entities',
  identifier: 'Objects',
  type: 'Entities',
  uid: nextUid(),
  doc: 'Airfields and ground objects. Only the x position matters: the game stands each object on the ground.',
  uiColor: null,
  gridSize: 2,
  guideGridWid: 0,
  guideGridHei: 0,
  displayOpacity: 1,
  inactiveOpacity: 0.6,
  hideInList: false,
  hideFieldsWhenInactive: false,
  canSelectWhenInactive: true,
  renderInWorldView: true,
  pxOffsetX: 0,
  pxOffsetY: 0,
  parallaxFactorX: 0,
  parallaxFactorY: 0,
  parallaxScaling: true,
  requiredTags: [],
  excludedTags: [],
  autoTilesKilledByOtherLayerUid: null,
  uiFilterTags: [],
  useAsyncRender: false,
  intGridValues: [],
  intGridValuesGroups: [],
  autoRuleGroups: [],
  autoSourceLayerDefUid: null,
  tilesetDefUid: null,
  tilePivotX: 0,
  tilePivotY: 0,
  biomeFieldUid: null,
};

// Stand the objects on the hills in the editor too, using the same terrain the game builds.
const terrain = buildTerrain({
  width: WIDTH,
  seed: SETTINGS.seed,
  terrain: { base: SETTINGS.terrainBase, amplitude: SETTINGS.terrainAmplitude },
  airfields: structuredClone(AIRFIELDS),
});
const defOf = (name) => entityDefs.find((d) => d.identifier === name);

function entityInstance(name, centreX, team, fields = {}) {
  const d = defOf(name);
  const width = fields.width ?? d.width;
  const x = Math.round(centreX - (d.pivotX === 0 ? 0 : width / 2) + d.pivotX * width);
  const ground = name === 'Airfield' ? terrain.heightAt(centreX + width / 2) : terrain.heightAt(centreX);
  const y = Math.round(HEIGHT - ground);
  const values = { team: `Team_${team}`, ...fields };
  return {
    __identifier: name,
    __grid: [Math.floor(x / layerDef.gridSize), Math.floor(y / layerDef.gridSize)],
    __pivot: [d.pivotX, d.pivotY],
    __tags: [],
    __tile: null,
    __smartColor: d.color,
    iid: randomUUID(),
    width,
    height: d.height,
    defUid: d.uid,
    px: [x, y],
    fieldInstances: d.fieldDefs.map((fd) => fieldInstance(fd, values[fd.identifier] ?? fd.defaultOverride.params[0])),
  };
}

const entities = [
  ...AIRFIELDS.map((a) => entityInstance('Airfield', a.x, a.team, { nation: a.nation, width: a.width })),
  ...WEST_SIDE.map(([name, x, f]) => entityInstance(name, x, 0, f)),
  ...WEST_SIDE.map(([name, x, f]) => entityInstance(name, WIDTH - x, 1, f)),
].sort((a, b) => a.px[0] - b.px[0]);

const levelIid = randomUUID();
const worldIid = randomUUID();
const level = {
  identifier: 'Countryside',
  iid: levelIid,
  uid: nextUid(),
  worldX: 0,
  worldY: 0,
  worldDepth: 0,
  pxWid: WIDTH,
  pxHei: HEIGHT,
  __bgColor: SETTINGS.skyLow.toUpperCase(),
  bgColor: null,
  useAutoIdentifier: false,
  bgRelPath: 'countryside-guide.png',
  bgPos: 'Unscaled',
  bgPivotX: 0,
  bgPivotY: 0,
  __smartColor: '#ADADB5',
  __bgPos: { topLeftPx: [0, 0], scale: [1, 1], cropRect: [0, 0, WIDTH, HEIGHT] },
  externalRelPath: null,
  fieldInstances: levelFieldDefs.map((fd) => fieldInstance(fd, SETTINGS[fd.identifier])),
  layerInstances: [
    {
      __identifier: layerDef.identifier,
      __type: 'Entities',
      __cWid: Math.ceil(WIDTH / layerDef.gridSize),
      __cHei: Math.ceil(HEIGHT / layerDef.gridSize),
      __gridSize: layerDef.gridSize,
      __opacity: 1,
      __pxTotalOffsetX: 0,
      __pxTotalOffsetY: 0,
      __tilesetDefUid: null,
      __tilesetRelPath: null,
      iid: randomUUID(),
      levelId: 0,
      layerDefUid: layerDef.uid,
      pxOffsetX: 0,
      pxOffsetY: 0,
      visible: true,
      optionalRules: [],
      intGridCsv: [],
      autoLayerTiles: [],
      seed: 1944,
      overrideTilesetUid: null,
      gridTiles: [],
      entityInstances: entities,
    },
  ],
  __neighbours: [],
};
level.layerInstances[0].levelId = level.uid;

const project = {
  __header__: {
    fileType: 'LDtk Project JSON',
    app: 'LDtk',
    doc: 'https://ldtk.io/json',
    schema: 'https://ldtk.io/files/JSON_SCHEMA.json',
    appAuthor: "Sebastien 'deepnight' Benard",
    appVersion: '1.5.3',
    url: 'https://ldtk.io',
  },
  iid: randomUUID(),
  jsonVersion: '1.5.3',
  appBuildId: 473703,
  nextUid: uid,
  identifierStyle: 'Capitalize',
  toc: [],
  worldLayout: 'Free',
  worldGridWidth: 256,
  worldGridHeight: 256,
  defaultLevelWidth: WIDTH,
  defaultLevelHeight: HEIGHT,
  defaultPivotX: 0.5,
  defaultPivotY: 1,
  defaultGridSize: 2,
  defaultEntityWidth: 16,
  defaultEntityHeight: 16,
  bgColor: '#40465B',
  defaultLevelBgColor: SETTINGS.skyLow.toUpperCase(),
  minifyJson: false,
  externalLevels: false,
  exportTiled: false,
  simplifiedExport: false,
  imageExportMode: 'None',
  exportLevelBg: true,
  pngFilePattern: null,
  backupOnSave: false,
  backupLimit: 10,
  backupRelPath: null,
  levelNamePattern: '%world_Level_%idx',
  tutorialDesc: null,
  customCommands: [],
  flags: [],
  defs: {
    layers: [layerDef],
    entities: entityDefs,
    tilesets: [],
    enums: [teamEnum, nationEnum],
    externalEnums: [],
    levelFields: levelFieldDefs,
  },
  levels: [level],
  worlds: [],
  dummyWorldIid: worldIid,
};

writeFileSync(OUT, JSON.stringify(project, null, 2) + '\n');
console.log('wrote maps/countryside.ldtk');
writeGuide(OUT);
console.log('wrote maps/countryside-guide.png');
