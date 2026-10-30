// Finds a vehicle's sound in data/sound.json: vehicle -> real engine -> shared sound build.
// A plane missing from the list (a new type, not yet entered) falls back on its engine layout.
export function engineSoundFor(sound, vehicleId, layout = 'inline') {
  const vehicle = sound.vehicles.find((v) => v.id === vehicleId);
  const engine = vehicle && sound.engines[vehicle.engine];
  const build = (engine && sound.builds[engine.build]) || sound.builds[layout] || sound.builds.inline;
  const buildId = Object.keys(sound.builds).find((k) => sound.builds[k] === build);
  return { build, buildId, count: vehicle?.count ?? 1 };
}

// A value through a layer's mapping: from mapFrom..mapTo to its gain and pitch ranges.
export function mapRange(value, g) {
  const span = g.mapTo - g.mapFrom;
  const t = span ? Math.max(0, Math.min(1, (value - g.mapFrom) / span)) : 1;
  return { gain: g.gainLow + (g.gainHigh - g.gainLow) * t, pitch: g.pitchLow + (g.pitchHigh - g.pitchLow) * t };
}

// The game values a layer can follow. min and max are for the Lab's sliders.
export const DRIVERS = {
  plane: [
    { key: 'rpm', label: 'Rpm', min: 0, max: 3200, read: (p) => p.rpm },
    { key: 'load', label: 'Throttle', min: 0, max: 1, read: (p) => p.load },
    { key: 'speed', label: 'Airspeed', min: 0, max: 400, read: (p) => p.speed },
    { key: 'turn', label: 'Turn strength', min: 0, max: 4, read: (p, w, turn) => turn },
    { key: 'inverted', label: 'Rolled over', min: 0, max: 1, read: (p) => (p.inverted ? 1 : 0) },
    { key: 'altitude', label: 'Height over ground', min: 0, max: 800, read: (p, w) => p.y - w.terrain.heightAt(p.x) },
    { key: 'damage', label: 'Damage', min: 0, max: 1, read: (p) => 1 - Math.max(0, p.hp) / p.def.hp },
    { key: 'ground', label: 'On the ground', min: 0, max: 1, read: (p) => (p.state === 'ground' ? 1 : 0) },
    { key: 'service', label: 'Being serviced', min: 0, max: 1, read: (p) => (p.service?.wait <= 0 && p.service.phase !== 'done' ? 1 : 0) },
  ],
  tank: [
    { key: 'moving', label: 'Moving', min: 0, max: 1, read: (o) => (o.moving ? 1 : 0) },
    { key: 'speed', label: 'Speed', min: 0, max: 10, read: (o) => (o.moving ? o.def.speed : 0) },
  ],
};
