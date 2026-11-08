// Loads game content (data JSON, maps, sprites) from files, so it can be edited without touching code.
import { loadImage, buildPlaneSprite, buildPlaneFrames, buildRotations } from '../render/sprites.js';
import { importLdtk } from './ldtk.js';

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
  const [planeDefs, nations, weapons, settings, groundDefs, sound, project, tactics] = await Promise.all([
    json('data/planes.json'),
    json('data/nations.json'),
    json('data/weapons.json'),
    json('data/settings.json'),
    json('data/ground.json'),
    json('data/sound.json'),
    json(`maps/${mapName}.ldtk`),
    json('data/bot-tactics.json'),
  ]);
  const map = importLdtk(project);
  // Notes kept aside so the tuning panel can write the files back unchanged apart from the numbers.
  const notes = {
    planes: { _units: planeDefs._units },
    weapons: { _notes: weapons._notes },
    settings: { _notes: settings._notes },
    ground: { _notes: groundDefs._notes },
    tactics: { _notes: tactics._notes },
  };
  delete tactics._notes;
  delete planeDefs._units;
  delete weapons._notes;
  delete settings._notes;
  delete groundDefs._notes;

  const spriteNames = [
    ...new Set([...Object.values(planeDefs).map((d) => d.sprite), ...Object.values(groundDefs).map((d) => d.sprite).filter(Boolean)]),
    'hangar',
    'hangar-shut',
    ...Array.from({ length: 14 }, (_, i) => `hangar-d${i + 1}`), // door steps, see hangarSteps in tools/make-sprites.mjs
    'bomb',
  ];
  const images = Object.fromEntries(
    await Promise.all(spriteNames.map(async (n) => [n, await loadImage(`assets/sprites/${n}.png`)])),
  );

  // Planes rendered from 3D models also have a sheet of roll and ground frames (see
  // tools/make-sprites.mjs). A plane sprite without one simply flips and turns round at once.
  const planeSprites = [...new Set(Object.values(planeDefs).map((d) => d.sprite))];
  const sheets = Object.fromEntries(
    await Promise.all(
      planeSprites.map(async (n) => {
        try {
          return [n, { img: await loadImage(`assets/sprites/${n}-frames.png`), meta: await json(`assets/sprites/${n}.json`) }];
        } catch {
          return [n, null];
        }
      }),
    ),
  );

  // Painted, rotated plane sprites are built on first use and cached per plane type + paint + markings
  // setting, so switching the setting in the tuning panel repaints them at once.
  const cache = new Map();
  const frameCache = new Map();
  const markings = () => ({ swastika: Boolean(settings.markings?.historicalSwastika) });
  const planeFrames = (plane) => {
    const sheet = sheets[plane.def.sprite];
    if (!sheet) return null;
    const paint = plane.paint ?? nations[plane.nation].paint;
    const opts = markings();
    const key = `${plane.def.sprite}|${JSON.stringify(paint)}|${opts.swastika}`;
    if (!frameCache.has(key)) frameCache.set(key, buildPlaneFrames(sheet.img, sheet.meta, paint, opts));
    return frameCache.get(key);
  };
  const planeSprite = (plane) => {
    const paint = plane.paint ?? nations[plane.nation].paint;
    const opts = markings();
    const key = `${plane.def.sprite}|${JSON.stringify(paint)}|${opts.swastika}`;
    if (!cache.has(key)) cache.set(key, buildPlaneSprite(images[plane.def.sprite], plane.def, paint, opts));
    return cache.get(key);
  };

  // Ground vehicles drawn from the Outline Lab come as layers (see tools/make-sprites.mjs): the sprite's json says so.
  // A layered def with `sprites` (tanks) has one per nation.
  const vehicles = {};
  await Promise.all(
    [...new Set(Object.values(groundDefs).filter((d) => d.layers).flatMap((d) => [d.sprite, ...Object.values(d.sprites ?? {})]))].map(async (n) => {
      try {
        const meta = await json(`assets/sprites/${n}.json`);
        if (!meta.frames) return;
        const layers = {};
        await Promise.all(['hull', 'turret', 'gun', 'commander', 'gunner'].map(async (l) => { layers[l] = await loadImage(`assets/sprites/${n}-${l}.png`); }));
        vehicles[n] = { meta, layers };
      } catch {
        /* a plain sprite: no json */
      }
    }),
  );

  // Trucks from the Outline Lab, one per nation (a def's `sprites`): the open truck and the one with its tarp up.
  const trucks = {};
  await Promise.all(
    [...new Set(Object.values(groundDefs).filter((d) => !d.layers).flatMap((d) => Object.values(d.sprites ?? {})))].map(async (n) => {
      try {
        const [meta, open, tarp] = await Promise.all([json(`assets/sprites/${n}.json`), loadImage(`assets/sprites/${n}.png`), loadImage(`assets/sprites/${n}-tarp.png`)]);
        trucks[n] = { meta, open, tarp };
      } catch {
        /* not built yet: the truck isn't drawn */
      }
    }),
  );

  const bombSprite = buildRotations(toCanvas(images.bomb), [7, 3]);

  return { planeDefs, nations, weapons, settings, groundDefs, sound, tactics, notes, map, images, vehicles, trucks, planeSprite, planeFrames, bombSprite };
}
