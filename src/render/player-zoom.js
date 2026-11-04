// The player's scroll-wheel zoom on top of the camera's own zoom (speed, dogfight, looking around).
// Pure numbers, so the rules can be tested headless. Zoom here is the view width relative to normal:
// bigger shows more world, smaller is closer in.
import { clamp } from '../sim/math.js';

// The range the wheel factor itself may take: from the closest in to wheelOutMax times the camera's zoom.
export function wheelRange(cfg) {
  return [cfg.wheelMin, Math.max(cfg.wheelMin, cfg.wheelOutMax)];
}

// auto: the camera's own zoom this frame. wheel: the player's factor (1 = leave it as it is).
// fight: how far into dogfight framing the camera is (0..1).
// Out: the wheel may widen the view to wheelOutMax times the camera's own zoom, and never past
// fightZoomMax. Relative, not a fixed number, so the speed zoom (the feeling of going fast) still shows
// when the player has zoomed all the way out. The camera's own zoom is never cut by the cap.
// In: down to wheelMin with no fight; in a fight only wheelFightTighten tighter than the camera wants,
// so the planes it frames stay about where it put them. Blends with `fight`, so there's no jump.
export function playerZoom(auto, wheel, fight, cfg, maxZoom = Infinity) {
  let z = auto * wheel;
  z = Math.min(z, Math.max(auto, Math.min(auto * cfg.wheelOutMax, cfg.fightZoomMax)));
  const inFight = Math.max(cfg.wheelMin, auto * (1 - cfg.wheelFightTighten));
  const floor = cfg.wheelMin + (inFight - cfg.wheelMin) * clamp(fight, 0, 1);
  return clamp(Math.max(z, Math.min(floor, auto)), 0.01, maxZoom);
}
