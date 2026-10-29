// Reads a level of an LDtk project (maps/*.ldtk, made in the free LDtk editor) into the game's map
// object. Pure data in, data out, so the Node tools and tests can use it too.
//
// One LDtk pixel is one world unit. LDtk measures y downwards from the top of the level; the game only
// uses the x positions of placed objects, which are stood on the ground when the world is built.
// Level fields hold the map settings (seed, ceiling, terrain, sky colours); the "Objects" entity layer
// holds the airfields and every ground object. A Bridge entity also puts a river under itself. The
// "Zones" layer says what the ground is like (src/sim/terrain.js shapes it; decor is placed from it).

// LDtk entity name -> ground object type in data/ground.json.
export const GROUND_ENTITIES = {
  Flak: 'flak',
  MgNest: 'mgNest',
  Infantry: 'infantry',
  Tent: 'tent',
  Tower: 'tower',
  Building: 'building',
  Radar: 'radar',
  Depot: 'depot',
};

// LDtk zone entity -> zone type.
export const ZONE_ENTITIES = { Field: 'field', Village: 'village', Wood: 'wood', Ridge: 'ridge' };

const fieldsOf = (instances) => Object.fromEntries((instances ?? []).map((f) => [f.__identifier, f.__value]));
const teamOf = (v) => (v == null ? null : Number(String(v).replace(/\D/g, '')));

export function importLdtk(project, levelName) {
  const level = levelName ? project.levels.find((l) => l.identifier === levelName) : project.levels[0];
  if (!level) throw new Error(`LDtk project has no level "${levelName}"`);
  const f = fieldsOf(level.fieldInstances);
  const map = {
    name: level.identifier,
    width: level.pxWid,
    ceiling: f.ceiling,
    seed: f.seed,
    terrain: { base: f.terrainBase, amplitude: f.terrainAmplitude },
    sky: { low: f.skyLow, high: f.skyHigh, space: f.skySpace },
    airfields: [],
    rivers: [],
    ground: [],
    zones: [],
  };
  for (const layer of level.layerInstances ?? []) {
    if (layer.__type !== 'Entities') continue;
    for (const e of layer.entityInstances) {
      const ef = fieldsOf(e.fieldInstances);
      const left = Math.round(e.px[0] - e.__pivot[0] * e.width);
      if (e.__identifier === 'Airfield') {
        map.airfields.push({ x: left, width: e.width, team: teamOf(ef.team), nation: String(ef.nation).toLowerCase() });
        continue;
      }
      if (ZONE_ENTITIES[e.__identifier]) {
        map.zones.push({ type: ZONE_ENTITIES[e.__identifier], x: left, width: e.width });
        continue;
      }
      if (e.__identifier === 'Bridge') {
        map.rivers.push({ x: left, width: e.width });
        map.ground.push({ type: 'bridge', x: left + e.width / 2, width: e.width, team: null });
        continue;
      }
      const type = GROUND_ENTITIES[e.__identifier];
      if (!type) continue; // an entity type this version of the game doesn't know yet
      const obj = { type, x: left + e.width / 2, team: teamOf(ef.team) };
      if (ef.squad != null) obj.squad = ef.squad;
      map.ground.push(obj);
    }
  }
  map.airfields.sort((a, b) => a.x - b.x);
  map.rivers.sort((a, b) => a.x - b.x);
  map.zones.sort((a, b) => a.x - b.x);
  map.ground.sort((a, b) => a.x - b.x);
  return map;
}
