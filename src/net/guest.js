// A guest's view of the host's world. Snapshots arrive about 20 times a second, a little unevenly, so
// the guest shows the world slightly in the past (cfg.delay): there is always a next snapshot to
// glide towards, and planes, bullets and turrets move smoothly between the two. Events (shots, hits,
// crashes) are released tick by tick on the same clock, so sounds and effects line up with what's
// on screen.
import { applyPatch, staticRefs, decodeEvent } from './snapshot.js';
import { takePoses, writePoses } from '../render/interpolate.js';
import { TICK_RATE } from '../sim/world.js';

// Further behind than this (a stall, the host fast-forwarding) and the clock jumps instead of catching up.
const SNAP_TICKS = 60;
// More snapshots than this waiting after such a jump, and the newest world is shown at once.
const CATCH_UP = 10;

// cfg: the net settings (delay), read live.
export function createGuestView(world, cfg) {
  const refs = staticRefs(world);
  let mirror = {}; // the host's world as plain data, as of the newest snapshot
  const queue = []; // snapshots not yet shown: { tick, patch, poses }
  let events = []; // [tick, event] not yet released
  let shown = null; // the snapshot now in the live world
  let latest = 0;
  let clock = 0; // the host tick being shown

  function show(entry) {
    // Undo the smoothing first: the patch only carries what changed since the last snapshot.
    if (shown) writePoses(world, shown.poses);
    if (entry.patch) applyPatch(world, entry.patch, refs);
    shown = entry;
  }

  return {
    get ready() {
      return shown !== null;
    },
    receive(msg) {
      // No patch: nothing changed since the last one.
      if (msg.p) mirror = applyPatch(mirror, msg.p);
      const entry = { tick: msg.tick, patch: msg.p, poses: takePoses(mirror) };
      latest = msg.tick;
      events.push(...msg.ev);
      if (!shown) {
        // The first snapshot is the whole world: show it at once.
        show(entry);
        clock = entry.tick;
      } else queue.push(entry);
    },
    // Moves the clock on by dt seconds and returns the events now due.
    update(dt) {
      if (!shown) return [];
      const target = latest - (cfg.delay ?? 0.1) * TICK_RATE;
      clock += dt * TICK_RATE;
      const behind = target - clock;
      if (Math.abs(behind) > SNAP_TICKS) {
        clock = target;
        // Long away (a hidden tab): jump straight to the newest world instead of replaying every
        // snapshot in one frame.
        if (queue.length > CATCH_UP) {
          if (shown) writePoses(world, shown.poses);
          applyPatch(world, { o: Object.fromEntries(Object.keys(mirror).map((k) => [k, { $: mirror[k] }])) }, refs);
          shown = queue[queue.length - 1];
          queue.length = 0;
          clock = shown.tick;
        }
        // What happened in the skipped stretch is past: no burst of old gunfire on coming back.
        events = events.filter(([tick]) => tick >= clock);
      } else clock += behind * Math.min(1, dt * 2);
      clock = Math.min(clock, latest);
      while (queue.length && queue[0].tick <= clock) show(queue.shift());
      const next = queue[0];
      if (next) writePoses(world, shown.poses, next.poses, (clock - shown.tick) / (next.tick - shown.tick));
      else writePoses(world, shown.poses);
      const due = [];
      let i = 0;
      while (i < events.length && events[i][0] <= clock) due.push(decodeEvent(events[i++][1], refs));
      if (i) events = events.slice(i);
      return due;
    },
  };
}
