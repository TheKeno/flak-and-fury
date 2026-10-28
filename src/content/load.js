// Loads game content (data JSON, maps, sprites) from files, so it can be edited without touching code.
import { loadImage, buildPlaneSprite, buildRotations } from '../render/sprites.js';

const toCanvas = (img) => {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  return c;
};

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.json();
};

export async function loadContent(mapName) {
  const [planeDefs, nations, weapons, settings, map] = await Promise.all([
    json('data/planes.json'),
    json('data/nations.json'),
    json('data/weapons.json'),
    json('data/settings.json'),
    json(`maps/${mapName}.json`),
  ]);
  // Notes kept aside so the tuning panel can write the files back unchanged apart from the numbers.
  const notes = { planes: { _units: planeDefs._units }, weapons: { _notes: weapons._notes }, settings: { _notes: settings._notes } };
  delete planeDefs._units;
  delete weapons._notes;
  delete settings._notes;

  const spriteNames = [...new Set(Object.values(planeDefs).map((d) => d.sprite)), 'hangar', 'bomb'];
  const images = Object.fromEntries(
    await Promise.all(spriteNames.map(async (n) => [n, await loadImage(`assets/sprites/${n}.png`)])),
  );

  // Painted, rotated plane sprites are built on first use and cached per plane type + paint.
  const cache = new Map();
  const planeSprite = (plane) => {
    const paint = plane.paint ?? nations[plane.nation].paint;
    const key = `${plane.def.sprite}|${JSON.stringify(paint)}`;
    if (!cache.has(key)) cache.set(key, buildPlaneSprite(images[plane.def.sprite], plane.def, paint));
    return cache.get(key);
  };

  const bombSprite = buildRotations(toCanvas(images.bomb), [7, 3]);

  return { planeDefs, nations, weapons, settings, notes, map, images, planeSprite, bombSprite };
}
