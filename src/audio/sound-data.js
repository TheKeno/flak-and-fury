// Finds a vehicle's sound in data/sound.json: vehicle -> real engine -> shared sound build.
// A plane missing from the list (a new type, not yet entered) falls back on its engine layout.
export function engineSoundFor(sound, vehicleId, layout = 'inline') {
  const vehicle = sound.vehicles.find((v) => v.id === vehicleId);
  const engine = vehicle && sound.engines[vehicle.engine];
  const build = (engine && sound.builds[engine.build]) || sound.builds[layout] || sound.builds.inline;
  return { build, count: vehicle?.count ?? 1 };
}
