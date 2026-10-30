// Dogfight camera: who the view should keep in frame around the focus plane, and how to frame them.
// Reads plain plane data only, so it runs the same for host and guests and can be tested headless.
import { clamp } from '../sim/math.js';

const PAD = 0.1; // share of the view kept clear on each side, so a framed plane isn't on the very edge

// range: how near an enemy must be to count (the camera passes the wider exit range once in a fight,
// so a plane hovering at the limit doesn't pump the camera in and out).
// Returns null if nobody's near, else { x, y, zoom }: the view centre relative to the focus plane,
// and the zoom that fits the planes that matter.
export function frameFight(focus, planes, cfg, range, viewW, viewH) {
  const near = [];
  const noseX = Math.cos(focus.angle);
  const noseY = Math.sin(focus.angle);
  for (const p of planes) {
    if (p.team === focus.team || p.state !== 'air' || p.dying) continue;
    const dx = p.x - focus.x;
    const dy = p.y - focus.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= range) continue;
    // Nearest counts most, and one behind you is more urgent than one you can already see coming.
    let weight = Math.max(0.05, 1 - dist / cfg.fightExit);
    if (dx * noseX + dy * noseY < 0) weight *= cfg.fightRear;
    // Already past and pulling away (a head-on pass): barely pull the view after it, nor zoom for it.
    const away = dist > 1 && ((p.vx - focus.vx) * dx + (p.vy - focus.vy) * dy) / dist > cfg.fightLeaveSpeed;
    if (away) weight *= 0.25;
    near.push({ dx, dy, weight, away });
  }
  if (!near.length) return null;
  near.sort((a, b) => b.weight - a.weight);
  near.length = Math.min(near.length, cfg.fightPlanes);

  // The centre of you and them, you counting as one full plane so you're never left at the edge.
  let total = 1;
  let x = 0;
  let y = 0;
  for (const n of near) {
    total += n.weight;
    x += n.dx * n.weight;
    y += n.dy * n.weight;
  }
  x /= total;
  y /= total;

  // Zoom out until everyone who matters fits around that centre, and you with them.
  const usable = 1 - PAD * 2;
  let zoom = Math.max((Math.abs(x) * 2) / (viewW * usable), (Math.abs(y) * 2) / (viewH * usable));
  for (const n of near) {
    if (n.away) continue;
    zoom = Math.max(zoom, (Math.abs(n.dx - x) * 2) / (viewW * usable), (Math.abs(n.dy - y) * 2) / (viewH * usable));
  }
  return { x, y, zoom: clamp(zoom, 1, cfg.fightZoomMax) };
}
