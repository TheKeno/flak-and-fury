// Drawing between two states of the world. The sim runs at a fixed 60 ticks a second, but screens
// draw at 60, 120, 144... frames a second, so a frame usually falls between two ticks. Drawing the
// last tick's state as it is makes things jerk (0, 1 or 2 ticks a frame, unevenly); drawing them
// part-way between the last two states keeps them gliding. Single player and the host blend the
// last two ticks (src/main.js); a guest blends the last two snapshots from the host (src/net/guest.js).
// Only what's drawn is blended: the true values go back before the sim runs again.

// Values worth blending; the angles go the short way round.
const POSE = ['x', 'y', 'angle', 'rollAngle', 'aim'];
const ANGLES = new Set(['angle', 'rollAngle', 'aim']);
// Kept within 0..2PI: the renderer picks the roll frame from it.
const WRAPPED = new Set(['rollAngle']);
// A jump further than this between two states is a teleport (a respawn), not movement.
const TELEPORT = 300;
const TAU = Math.PI * 2;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);
const lerpAngle = (a, b, t) => a + ((((b - a) % TAU) + TAU + Math.PI) % TAU - Math.PI) * t;

// The pose of everything in the world's top-level lists (planes, ground, bullets, shells...): id ->
// [x, y, angle, rollAngle, aim], undefined where a thing doesn't have one. Works on the live world and
// on a guest's plain copy of the host's.
export function takePoses(world) {
  const poses = new Map();
  for (const k in world) {
    const list = world[k];
    if (!Array.isArray(list)) continue;
    for (const e of list) if (isObj(e) && typeof e.id === 'number') poses.set(e.id, POSE.map((f) => (typeof e[f] === 'number' ? e[f] : undefined)));
  }
  return poses;
}

// Writes poses into the live world's lists: from, or between from and to (t: 0..1). Things only in
// from stay put; things only in to (just spawned) aren't touched.
export function writePoses(world, from, to = null, t = 0) {
  for (const k in world) {
    const list = world[k];
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const a = isObj(e) && from.get(e.id);
      if (!a) continue;
      const b = to?.get(e.id);
      const jump = b && Math.abs((b[0] ?? 0) - (a[0] ?? 0)) + Math.abs((b[1] ?? 0) - (a[1] ?? 0)) > TELEPORT;
      for (let i = 0; i < POSE.length; i++) {
        if (a[i] === undefined) continue;
        const end = b && !jump ? b[i] : undefined;
        const f = POSE[i];
        if (end === undefined) e[f] = a[i];
        else if (!ANGLES.has(f)) e[f] = a[i] + (end - a[i]) * t;
        else {
          const v = lerpAngle(a[i], end, t);
          e[f] = WRAPPED.has(f) ? ((v % TAU) + TAU) % TAU : v;
        }
      }
    }
  }
}
