// Runways are untouchable for now: a crater whose x lies on one does nothing. The damage, closing,
// crater-filling and runway-score systems were removed on purpose, to be decided again in one place in
// the MOBA discussion (see ROADMAP.md, Decisions: "Ground rules reset").

export const runwayAt = (world, x) => world.map.airfields.find((a) => a.height != null && x >= a.x && x < a.x + a.width);

// Every crater dug in the ground goes through here.
export function digCrater(world, x, radius, depth) {
  if (runwayAt(world, x)) return;
  world.terrain.crater(x, radius, depth);
}
