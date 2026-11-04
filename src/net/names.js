// A guest changing its pilot name after joining (options menu): the host sets it on the guest's plane,
// and the snapshots carry it on to the screen, HUD and every other guest. `clean` is cleanName from
// src/ui/options.js (passed in so this stays free of the UI). Returns the new name, or null if none.
export function applyPilotName(world, planeId, raw, clean) {
  const p = world.planes.find((o) => o.id === planeId);
  if (!p) return null;
  const name = clean(raw);
  p.callsign = name || null;
  return p.callsign;
}
