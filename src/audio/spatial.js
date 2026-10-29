import { clamp } from '../sim/math.js';

// 1 px is about 0.4 m, so 343 m/s is roughly 860 px/s: a crash 860 px away is heard a second after it's seen.
export const SPEED_OF_SOUND = 860;

function fadeOut(dist, range) {
  const t = clamp((dist - range * 0.6) / (range * 0.4), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

// Where a sound at (x, y) moving at (vx, vy) sits for the listener: stereo pan, loudness,
// air absorption (distant sounds lose their highs), travel delay and Doppler shift.
// range: beyond it the sound isn't heard at all; it fades out over the last 40% of the way.
export function spatialize(listener, x, y, vx = 0, vy = 0, range = Infinity) {
  const dx = x - listener.x;
  const dy = y - listener.y;
  const dist = Math.hypot(dx, dy);
  const radial = dist > 1 ? (dx * (vx - listener.vx) + dy * (vy - listener.vy)) / dist : 0;
  return {
    dist,
    pan: clamp(dx / 300, -0.85, 0.85),
    gain: (1 / (1 + Math.pow(dist / 240, 1.4))) * fadeOut(dist, range),
    cutoff: clamp(18000 / (1 + dist / 260), 350, 18000),
    delay: dist / SPEED_OF_SOUND,
    doppler: clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND + radial), 0.6, 1.6),
  };
}
